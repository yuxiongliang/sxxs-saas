"""支付配置：从租户设置读商户参数，并给出「缺哪些字段」的明确清单。

运营最容易踩的坑不是签名写错，而是**配了一半就上线**：页面点支付报 500，
日志里只有一句 traceback。这里把"缺什么"算出来直接回给前端。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import setting as setting_service


class PaymentConfigError(Exception):
    """支付渠道未配置 / 配置不完整。消息直接面向运营，不要塞英文堆栈。"""

    def __init__(self, message: str, missing: list[str] | None = None):
        super().__init__(message)
        self.missing = missing or []


@dataclass(frozen=True)
class AlipayConfig:
    app_id: str
    private_key: str
    # 验签公钥：**证书模式下由「支付宝公钥证书」解析出来**，公钥模式下直接用 publicKey
    alipay_public_key: str
    notify_url: str
    return_url: str
    gateway: str
    # 证书模式：两个 SN **由证书内容自动算出**，不让运营手填（抄错就等于签名无效）
    app_cert_sn: str = ""
    alipay_root_cert_sn: str = ""


@dataclass(frozen=True)
class WechatConfig:
    mch_id: str
    app_id: str
    api_v3_key: str
    serial_no: str
    private_key: str
    notify_url: str
    api_base: str
    # 平台证书：用于验证回调签名。可空 —— 空时自动向微信拉取并缓存。
    platform_public_key: str = ""


@dataclass(frozen=True)
class PaymentConfig:
    alipay: AlipayConfig | None
    wechat: WechatConfig | None
    problems: dict[str, list[str]]


ALIPAY_PROD = "https://openapi.alipay.com/gateway.do"
ALIPAY_SANDBOX = "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
WECHAT_API = "https://api.mch.weixin.qq.com"


def _clean(value: object) -> str:
    return str(value or "").strip()


def missing_fields(config: dict, required: tuple[str, ...]) -> list[str]:
    return [key for key in required if not _clean(config.get(key))]


ALIPAY_REQUIRED = ("appId", "privateKey", "publicKey", "notifyUrl")
WECHAT_REQUIRED = ("mchId", "appId", "apiV3Key", "serialNo", "privateKey", "notifyUrl")


async def load_payment_config(db: AsyncSession, tenant_id: int) -> PaymentConfig:
    row = await setting_service.get_setting(db, "payment", tenant_id)
    config = row.config or {}

    alipay_raw = config.get("alipay") or {}
    wechat_raw = config.get("wechat") or {}
    problems: dict[str, list[str]] = {}

    alipay: AlipayConfig | None = None
    # 证书模式三件套：应用公钥证书 / 支付宝公钥证书 / 支付宝根证书
    app_cert = _clean(alipay_raw.get("appCertPublicKey"))
    alipay_cert = _clean(alipay_raw.get("alipayPublicCert"))
    root_cert = _clean(alipay_raw.get("alipayRootCert"))
    certificate_mode = bool(app_cert or alipay_cert or root_cert)

    required = (
        ("appId", "privateKey", "notifyUrl", "appCertPublicKey", "alipayPublicCert", "alipayRootCert")
        if certificate_mode
        else ALIPAY_REQUIRED
    )
    alipay_missing = missing_fields(alipay_raw, required)
    if alipay_missing:
        problems["alipay"] = alipay_missing
    elif alipay_raw.get("enabled", True):
        gateway = (
            ALIPAY_SANDBOX
            if _clean(alipay_raw.get("environment")) == "sandbox"
            else ALIPAY_PROD
        )
        app_sn = ""
        root_sn = ""
        verify_key = _clean(alipay_raw.get("publicKey"))
        if certificate_mode:
            # SN 从证书算，验签公钥从「支付宝公钥证书」取
            from app.services.payment.alipay_cert import (
                app_cert_sn as derive_app_sn,
            )
            from app.services.payment.alipay_cert import (
                public_key_from_certificate,
                root_cert_sn as derive_root_sn,
            )

            try:
                app_sn = derive_app_sn(app_cert)
                root_sn = derive_root_sn(root_cert)
                verify_key = public_key_from_certificate(alipay_cert)
            except ValueError as exc:
                problems["alipay"] = [str(exc)]
                return PaymentConfig(alipay=None, wechat=None, problems=problems)
        alipay = AlipayConfig(
            app_id=_clean(alipay_raw.get("appId")),
            private_key=_clean(alipay_raw.get("privateKey")),
            alipay_public_key=verify_key,
            notify_url=_clean(alipay_raw.get("notifyUrl")),
            return_url=_clean(alipay_raw.get("returnUrl")),
            gateway=gateway,
            app_cert_sn=app_sn,
            alipay_root_cert_sn=root_sn,
        )

    wechat: WechatConfig | None = None
    wechat_missing = missing_fields(wechat_raw, WECHAT_REQUIRED)
    if wechat_missing:
        problems["wechat"] = wechat_missing
    elif wechat_raw.get("enabled", True):
        wechat = WechatConfig(
            mch_id=_clean(wechat_raw.get("mchId")),
            app_id=_clean(wechat_raw.get("appId")),
            api_v3_key=_clean(wechat_raw.get("apiV3Key")),
            serial_no=_clean(wechat_raw.get("serialNo")),
            private_key=_clean(wechat_raw.get("privateKey")),
            notify_url=_clean(wechat_raw.get("notifyUrl")),
            api_base=WECHAT_API,
            # 可选：把微信平台证书公钥钉在配置里（生产推荐）。
            # 不钉的话回调时会去 /v3/certificates 拉取并解密，多一次网络依赖。
            platform_public_key=_clean(wechat_raw.get("platformPublicKey")),
        )

    return PaymentConfig(alipay=alipay, wechat=wechat, problems=problems)


def require_alipay(config: PaymentConfig) -> AlipayConfig:
    if config.alipay is None:
        missing = config.problems.get("alipay", [])
        raise PaymentConfigError(
            "支付宝未配置完整，请联系运营在「支付设置」补齐：" + "、".join(missing or ["已停用"]),
            missing,
        )
    return config.alipay


def require_wechat(config: PaymentConfig) -> WechatConfig:
    if config.wechat is None:
        missing = config.problems.get("wechat", [])
        raise PaymentConfigError(
            "微信支付未配置完整，请联系运营在「支付设置」补齐：" + "、".join(missing or ["已停用"]),
            missing,
        )
    return config.wechat
