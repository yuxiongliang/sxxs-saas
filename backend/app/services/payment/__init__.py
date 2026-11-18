"""真实支付接入：支付宝（电脑网站支付）+ 微信（Native 扫码）。

只做两件事的**真实**实现，不做「点了就成功」的假支付：

* 下单：生成签名后的支付跳转 URL（支付宝）/ 扫码链接（微信）——必须在商户后台真实可付；
* 回调：**验签 + 金额核对 + 幂等**后才把订单置为已支付；回调原始报文入库备查。

配置来源：**租户自己的商户号**（平台约定「平台不代收业务款」，支付配置强制租户自定义），
存在 `system_settings` 的 `payment` 分类里（结构见 `services/setting.DEFAULT_SETTINGS`）。

退款口径（产品决定）：**退款退回买家钱包余额**，不调用渠道原路退回。
"""

from app.services.payment.alipay import AlipayGateway
from app.services.payment.config import (
    PaymentConfigError,
    load_payment_config,
    missing_fields,
)
from app.services.payment.wechat import WechatGateway

# 编排函数（下单/回调/查询）在 service.py，这里 re-export 方便调用方
from app.services.payment.service import (  # noqa: E402
    create_payment,
    handle_alipay_notify,
    handle_wechat_notify,
    out_trade_no,
    query_and_sync,
    settle_paid_order,
    sync_pending_payment,
)

__all__ = [
    "AlipayGateway",
    "PaymentConfigError",
    "WechatGateway",
    "create_payment",
    "handle_alipay_notify",
    "handle_wechat_notify",
    "load_payment_config",
    "missing_fields",
    "out_trade_no",
    "query_and_sync",
    "settle_paid_order",
    "sync_pending_payment",
]
