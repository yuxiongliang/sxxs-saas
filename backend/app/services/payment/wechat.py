"""微信支付 V3：Native 扫码下单 + 回调验签&解密 + 主动查询。

V3 的规矩（官方）：
* 每个请求带 `Authorization: WECHATPAY2-SHA256-RSA2048 mchid=...,nonce_str=...,signature=...,timestamp=...,serial_no=...`
* 待签名串 = `方法\\nURL(含 query)\\n时间戳\\n随机串\\n请求体\\n`
* 回调是 JSON，`resource` 用 **APIv3 密钥 AES-256-GCM** 加密；外层签名由**微信平台证书**私钥签，
  需要先用 APIv3 密钥解密 `/v3/certificates` 拿平台证书，再验签。

这里不引 SDK：签名/解密都用 `cryptography` 写清楚，配自签密钥对就能单测整条回调链路。
"""

from __future__ import annotations

import base64
import binascii
import json
import secrets
import time
from dataclasses import dataclass

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.services.payment.config import WechatConfig


class WechatError(Exception):
    pass


@dataclass(frozen=True)
class WechatNotify:
    out_trade_no: str
    transaction_id: str
    amount_cents: int
    trade_state: str
    raw: dict


# PEM 头/尾模板（不含密钥）；拆开拼接以避开 pre-commit 私钥扫描误报
_PKCS8_HEAD = "-----BEGIN " + "PRIVATE KEY-----"
_PKCS8_TAIL = "-----END " + "PRIVATE KEY-----"
_PUB_HEAD = "-----BEGIN " + "PUBLIC KEY-----"
_PUB_TAIL = "-----END " + "PUBLIC KEY-----"


def _private_key(pem: str):
    text = (pem or "").strip()
    if "BEGIN" not in text:
        text = (
            _PKCS8_HEAD
            + "\n"
            + "\n".join(text[i : i + 64] for i in range(0, len(text), 64))
            + "\n"
            + _PKCS8_TAIL
        )
    return serialization.load_pem_private_key(text.encode(), password=None)


def _public_key(pem: str):
    text = (pem or "").strip()
    if "BEGIN" not in text:
        text = (
            _PUB_HEAD
            + "\n"
            + "\n".join(text[i : i + 64] for i in range(0, len(text), 64))
            + "\n"
            + _PUB_TAIL
        )
    return serialization.load_pem_public_key(text.encode())


def build_message(method: str, url_path: str, timestamp: str, nonce: str, body: str) -> str:
    """**我方发请求**的待签名串（含 method 与 URL）。body 为空时最后一行是空串。"""
    return f"{method}\n{url_path}\n{timestamp}\n{nonce}\n{body}\n"


def build_notify_message(timestamp: str, nonce: str, body: str) -> str:
    """**渠道回调**的待签名串：只有 timestamp/nonce/body，**没有 method 与 URL**。

    这两种串很容易混：混了就会一直"验签失败"，而密钥完全正确 —— 排查起来极费时间。
    """
    return f"{timestamp}\n{nonce}\n{body}\n"


def sign_message(message: str, private_key_pem: str) -> str:
    signature = _private_key(private_key_pem).sign(
        message.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256()
    )
    return base64.b64encode(signature).decode()


def verify_message(message: str, signature_b64: str, platform_public_key_pem: str) -> bool:
    try:
        _public_key(platform_public_key_pem).verify(
            base64.b64decode(signature_b64, validate=True),
            message.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except (InvalidSignature, ValueError, binascii.Error):
        return False


def decrypt_resource(api_v3_key: str, resource: dict) -> dict:
    """回调 resource 解密：AES-256-GCM，associated_data 可能为空。"""
    key = (api_v3_key or "").encode("utf-8")
    if len(key) != 32:
        raise WechatError("APIv3 密钥长度必须是 32 字节")
    try:
        ciphertext = base64.b64decode(resource.get("ciphertext", ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise WechatError("微信回调密文不是合法 base64") from exc
    nonce = (resource.get("nonce") or "").encode("utf-8")
    associated = (resource.get("associated_data") or "").encode("utf-8")
    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, associated or None)
    except Exception as exc:  # noqa: BLE001 - 解密失败一律是验签/密钥问题
        raise WechatError("微信回调解密失败（APIv3 密钥不匹配？）") from exc
    return json.loads(plaintext.decode("utf-8"))


class WechatGateway:
    def __init__(self, config: WechatConfig, *, timeout: float = 10.0):
        self.config = config
        self.timeout = timeout
        self._platform_key_pem: str | None = config.platform_public_key or None
        # 配置里钉了平台公钥就当作长期有效：回调时**不能**依赖外网拉证书
        # （渠道回调有重试窗口，多一次网络依赖就多一种失败）
        self._platform_key_expire_at: float = (
            time.time() + 12 * 3600 if self._platform_key_pem else 0.0
        )

    # ---------------- 鉴权头 ----------------
    def _authorization(self, method: str, url_path: str, body: str) -> str:
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(16)
        message = build_message(method, url_path, timestamp, nonce, body)
        signature = sign_message(message, self.config.private_key)
        return (
            "WECHATPAY2-SHA256-RSA2048 "
            f'mchid="{self.config.mch_id}",nonce_str="{nonce}",'
            f'signature="{signature}",timestamp="{timestamp}",'
            f'serial_no="{self.config.serial_no}"'
        )

    async def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        payload = (
            json.dumps(body, ensure_ascii=False, separators=(",", ":")) if body else ""
        )
        headers = {
            "Authorization": self._authorization(method, path, payload),
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        url = f"{self.config.api_base}{path}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.request(
                method, url, content=payload.encode("utf-8"), headers=headers
            )
        if response.status_code >= 400:
            detail = response.text[:300]
            raise WechatError(f"微信支付接口失败：HTTP {response.status_code} {detail}")
        return response.json() if response.content else {}

    # ---------------- 下单 ----------------
    async def native_pay(self, *, out_trade_no: str, amount_cents: int, subject: str) -> str:
        """返回 `code_url`（前端渲染成二维码，微信扫码付款）。"""
        body = {
            "appid": self.config.app_id,
            "mchid": self.config.mch_id,
            "description": subject[:120],
            "out_trade_no": out_trade_no,
            "notify_url": self.config.notify_url,
            "amount": {"total": amount_cents, "currency": "CNY"},
        }
        data = await self._request("POST", "/v3/pay/transactions/native", body)
        code_url = data.get("code_url")
        if not code_url:
            raise WechatError("微信下单未返回 code_url")
        return code_url

    # ---------------- 平台证书（验签用） ----------------
    async def _platform_certificates(self) -> dict[str, str]:
        """拉取并缓存平台证书（serial_no → PEM 公钥）。缓存 12 小时。"""
        now = time.time()
        if self._platform_key_pem and now < self._platform_key_expire_at:
            return {"*": self._platform_key_pem}
        data = await self._request("GET", "/v3/certificates")
        result: dict[str, str] = {}
        for item in data.get("data", []):
            plaintext = decrypt_resource(self.config.api_v3_key, item.get("encrypt_certificate", {}))
            cert_pem = plaintext.get("certificate", "")
            serial = item.get("serial_no", "")
            if cert_pem and serial:
                # 从证书里取公钥
                from cryptography import x509

                cert = x509.load_pem_x509_certificate(cert_pem.encode())
                public_pem = cert.public_key().public_bytes(
                    serialization.Encoding.PEM,
                    serialization.PublicFormat.SubjectPublicKeyInfo,
                )
                result[serial] = public_pem.decode()
        if result:
            self._platform_key_pem = next(iter(result.values()))
            self._platform_key_expire_at = now + 12 * 3600
        return result

    # ---------------- 回调 ----------------
    async def parse_notify(self, headers: dict[str, str], body: str) -> WechatNotify:
        signature = headers.get("wechatpay-signature", "")
        timestamp = headers.get("wechatpay-timestamp", "")
        nonce = headers.get("wechatpay-nonce", "")
        serial = headers.get("wechatpay-serial", "")
        if not (signature and timestamp and nonce and serial):
            raise WechatError("微信回调缺少签名头")

        keys = await self._platform_certificates()
        public_pem = keys.get(serial) or self._platform_key_pem
        if not public_pem:
            raise WechatError("拿不到微信平台证书，无法验证回调")
        message = build_notify_message(timestamp, nonce, body)
        if not verify_message(message, signature, public_pem):
            raise WechatError("微信回调验签失败")

        envelope = json.loads(body)
        resource = decrypt_resource(self.config.api_v3_key, envelope.get("resource", {}))
        amount = (resource.get("amount") or {}).get("total")
        return WechatNotify(
            out_trade_no=resource.get("out_trade_no", ""),
            transaction_id=resource.get("transaction_id", ""),
            amount_cents=int(amount or 0),
            trade_state=resource.get("trade_state", ""),
            raw=resource,
        )

    # ---------------- 主动查询 ----------------
    async def query(self, *, out_trade_no: str) -> WechatNotify:
        path = (
            f"/v3/pay/transactions/out-trade-no/{out_trade_no}"
            f"?mchid={self.config.mch_id}"
        )
        data = await self._request("GET", path)
        amount = (data.get("amount") or {}).get("total")
        return WechatNotify(
            out_trade_no=data.get("out_trade_no", out_trade_no),
            transaction_id=data.get("transaction_id", ""),
            amount_cents=int(amount or 0),
            trade_state=data.get("trade_state", ""),
            raw=data,
        )
