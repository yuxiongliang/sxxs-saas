"""订单的**两个状态**：支付状态 + 履约状态。

以前只有一个 `status` 列，把「付没付钱」和「发没发货」混在一起：
`paid` 既表示付了钱、也表示还没发货；`shipped` 又反过来暗示付过钱。
运营想筛「已支付但没发货」时根本筛不出来，前端也只能把 9 个值挤在一个下拉里。

现在拆成两列，各自独立演进：

* `payment_status`    —— 钱的事：待支付 / 已支付 / 退款中 / 部分退款 / 已退款 / 已取消
* `fulfillment_status`—— 货的事：待付款 / 待发货 / 已发货 / 已完成 / 已取消

**订单级状态由卖家单汇总**（一单可拆多卖家单）。规则集中在这里，写入方不要各算各的。
"""

from __future__ import annotations

from app.models.order import Order, SellerOrder

# ---- 支付状态 ----
PAY_UNPAID = "unpaid"
PAY_PAID = "paid"
PAY_REFUNDING = "refunding"
PAY_PARTIALLY_REFUNDED = "partially_refunded"
PAY_REFUNDED = "refunded"
PAY_CANCELLED = "cancelled"

# ---- 履约状态 ----
FULFILL_AWAITING_PAYMENT = "awaiting_payment"
FULFILL_TO_SHIP = "to_ship"
FULFILL_SHIPPED = "shipped"
FULFILL_COMPLETED = "completed"
FULFILL_CANCELLED = "cancelled"

PAYMENT_STATUSES = (
    PAY_UNPAID,
    PAY_PAID,
    PAY_REFUNDING,
    PAY_PARTIALLY_REFUNDED,
    PAY_REFUNDED,
    PAY_CANCELLED,
)

FULFILLMENT_STATUSES = (
    FULFILL_AWAITING_PAYMENT,
    FULFILL_TO_SHIP,
    FULFILL_SHIPPED,
    FULFILL_COMPLETED,
    FULFILL_CANCELLED,
)

# 计入「已售」的履约状态：销量 / 佣金 / 评分口径都从这里取，
# 不要在别处再抄一份字面量（拆状态时最容易漏的就是这些统计口径）。
SOLD_FULFILLMENTS = (FULFILL_TO_SHIP, FULFILL_SHIPPED, FULFILL_COMPLETED)

# 卖家能发货的履约状态
SHIPPABLE_FULFILLMENTS = (FULFILL_TO_SHIP,)

# 买家能申请售后的履约状态：**完成后不再允许**（业务口径）
AFTER_SALE_FULFILLMENTS = (FULFILL_TO_SHIP, FULFILL_SHIPPED)


def sync_order(order: Order, seller_orders: list[SellerOrder]) -> None:
    """按卖家单汇总订单的两个状态（唯一入口）。"""
    if not seller_orders:
        return
    payments = [item.payment_status for item in seller_orders]
    fulfillments = [item.fulfillment_status for item in seller_orders]

    # 全取消：两边都显示「已取消」（产品口径：取消就是取消，不区分付没付）
    if all(status == FULFILL_CANCELLED for status in fulfillments):
        order.fulfillment_status = FULFILL_CANCELLED
        order.payment_status = PAY_CANCELLED
        return

    if all(status == PAY_REFUNDED for status in payments):
        order.payment_status = PAY_REFUNDED
        # 钱全退了，这单就结束了：履行状态一律「已关闭」（产品口径）
        # 部分退款不走这条 —— 还剩了货款没退，订单仍在履约中
        order.fulfillment_status = FULFILL_CANCELLED
        return
    elif any(status == PAY_REFUNDING for status in payments):
        order.payment_status = PAY_REFUNDING
    elif any(
        status in (PAY_REFUNDED, PAY_PARTIALLY_REFUNDED) for status in payments
    ):
        order.payment_status = PAY_PARTIALLY_REFUNDED
    elif all(status == PAY_UNPAID for status in payments):
        order.payment_status = PAY_UNPAID
    else:
        order.payment_status = PAY_PAID

    if all(status == FULFILL_COMPLETED for status in fulfillments):
        order.fulfillment_status = FULFILL_COMPLETED
    elif any(
        status in (FULFILL_SHIPPED, FULFILL_COMPLETED) for status in fulfillments
    ):
        # 部分发货也算「已发货」：产品口径不要「部分发货」这个中间态
        order.fulfillment_status = FULFILL_SHIPPED
    elif all(status == FULFILL_TO_SHIP for status in fulfillments):
        order.fulfillment_status = FULFILL_TO_SHIP
    else:
        order.fulfillment_status = FULFILL_AWAITING_PAYMENT
