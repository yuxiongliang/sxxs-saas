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
    alipay_public_key: str
    notify_url: str
    return_url: str
    gateway: str
    # 证书模式（支付宝新应用默认）：两者都填才会在请求里带 cert SN。
    # 应用是证书模式却按公钥模式请求 → 支付宝直接回 invalid-signature。
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
    alipay_missing = missing_fields(alipay_raw, ALIPAY_REQUIRED)
    if alipay_missing:
        problems["alipay"] = alipay_missing
    elif alipay_raw.get("enabled", True):
        gateway = (
            ALIPAY_SANDBOX
            if _clean(alipay_raw.get("environment")) == "sandbox"
            else ALIPAY_PROD
        )
        alipay = AlipayConfig(
            app_id=_clean(alipay_raw.get("appId")),
            private_key=_clean(alipay_raw.get("privateKey")),
            alipay_public_key=_clean(alipay_raw.get("publicKey")),
            notify_url=_clean(alipay_raw.get("notifyUrl")),
            return_url=_clean(alipay_raw.get("returnUrl")),
            gateway=gateway,
            app_cert_sn=_clean(alipay_raw.get("appCertSn")),
            alipay_root_cert_sn=_clean(alipay_raw.get("alipayRootCertSn")),
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
