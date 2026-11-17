from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Order(Base, TimestampMixin):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("tenant_id", "order_no", name="uq_order_no"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    order_no: Mapped[str] = mapped_column(String(64), index=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # 双状态：钱（payment_status）与货（fulfillment_status）各自独立演进。
    # 旧 `status` 列已删除（迁移 d1a9f0c3b7e2），映射与汇总规则见 services/order_state.py。
    payment_status: Mapped[str] = mapped_column(
        String(24), default="unpaid", server_default="unpaid", index=True
    )
    fulfillment_status: Mapped[str] = mapped_column(
        String(24), default="awaiting_payment", server_default="awaiting_payment", index=True
    )
    total_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    discount_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    payable_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    receiver_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    receiver_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    receiver_address: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel: Mapped[str] = mapped_column(String(16), default="portal")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SellerOrder(Base, TimestampMixin):
    __tablename__ = "seller_orders"
    __table_args__ = (UniqueConstraint("tenant_id", "seller_order_no", name="uq_seller_order_no"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("sellers.id"), index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    seller_order_no: Mapped[str] = mapped_column(String(64), index=True)
    # 双状态（同 orders，规则见 services/order_state.py）
    payment_status: Mapped[str] = mapped_column(
        String(24), default="unpaid", server_default="unpaid", index=True
    )
    fulfillment_status: Mapped[str] = mapped_column(
        String(24), default="awaiting_payment", server_default="awaiting_payment", index=True
    )
    # 交付方式：一个卖家单一种（一单可拆多卖家单，可能一个快递一个自提）
    delivery_method: Mapped[str] = mapped_column(
        String(16), default="express", server_default="express"
    )
    goods_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    commission_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    payable_to_seller_cents: Mapped[int] = mapped_column(Integer, default=0)
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    seller_order_id: Mapped[int] = mapped_column(ForeignKey("seller_orders.id"), index=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("sellers.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    sku_id: Mapped[int] = mapped_column(ForeignKey("product_skus.id"))
    product_name: Mapped[str] = mapped_column(String(200))
    sku_name: Mapped[str] = mapped_column(String(128))
    # 下单时的商品类型快照：商品以后改类型，历史订单仍按当时的语义对账
    product_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 下单时的交付方式快照（express / pickup）
    delivery_method: Mapped[str | None] = mapped_column(String(16), nullable=True)
    image: Mapped[str | None] = mapped_column(String(512), nullable=True)
    price_cents: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    subtotal_cents: Mapped[int] = mapped_column(Integer)
    # 下单时的抽佣快照：卖家之后改了商品比例，历史订单也能说清当时按什么扣的
    commission_rate_bps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    commission_source: Mapped[str | None] = mapped_column(String(16), nullable=True)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    provider_trade_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # 商户订单号：**带租户前缀**（T{tenant_id}-{order_no}）。回调用它反查租户 →
    # 取该租户的商户配置 → 验签。一个回调地址服务所有租户，靠这个前缀分流。
    out_trade_no: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    # sandbox / production：支付宝沙箱与生产网关不同，排查时必须一眼看出走的哪套
    environment: Mapped[str] = mapped_column(
        String(16), default="production", server_default="production"
    )
    amount_cents: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    seller_order_id: Mapped[int] = mapped_column(ForeignKey("seller_orders.id"), index=True)
    carrier: Mapped[str] = mapped_column(String(64))
    tracking_no: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(16), default="shipped")
    shipped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Refund(Base):
    __tablename__ = "refunds"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    seller_order_id: Mapped[int] = mapped_column(ForeignKey("seller_orders.id"), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(255), default="")
    # 这笔钱原本走什么渠道（余额/微信/支付宝）。本期退款统一退回钱包余额，
    # 但渠道要留痕，否则对账说不清"退的是哪条渠道的钱"。
    provider: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="refunded")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
