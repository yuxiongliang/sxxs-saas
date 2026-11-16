"""买家与商品之间的互动：收藏、评价。

为什么单独一个模块而不是塞进 `catalog.py`：这两张表描述的是**买家的行为**，
商品本身没有它们也成立（删掉商品互动历史不影响商品）。放一起会让
catalog 模块同时承担「商品定义」和「用户行为」两种职责。
"""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ProductFavorite(Base, TimestampMixin):
    """一个买家收藏一个商品。

    `(user_id, product_id)` 唯一 —— 重复点收藏是幂等的，不是插两行。
    收藏不用软删除：取消收藏就是删行，没有「历史收藏」的语义。
    """

    __tablename__ = "product_favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "product_id", name="uq_favorite_user_product"),
        Index("ix_favorite_tenant_product", "tenant_id", "product_id"),
        Index("ix_favorite_tenant_user", "tenant_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)


class ProductReview(Base, TimestampMixin):
    """一条商品评价。

    设计要点：

    * `order_item_id` 唯一 —— **一个订单项只能评一次**，天然防刷，也让「评价」能追溯到
      真实成交（不是随便谁都能评）。
    * **先发后审**：落库即 `status='visible'`。大模型审核只写 `moderation_status`，
      不改变可见性 —— 审核不能阻塞买家发布。
    * **匿名**：`is_anonymous` 只影响**买家侧展示**（显示「匿名买家」）。
      运营 / 卖家 / 平台三端一律仍能看到真实 user_id，否则出纠纷没法定位人。
    * 隐藏（`status='hidden'`）只有运营和平台能做；卖家只能回复。
    """

    __tablename__ = "product_reviews"
    __table_args__ = (
        UniqueConstraint("order_item_id", name="uq_review_order_item"),
        Index("ix_review_tenant_product", "tenant_id", "product_id"),
        Index("ix_review_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    sku_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_skus.id"), nullable=True, index=True
    )
    seller_id: Mapped[int] = mapped_column(ForeignKey("sellers.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    rating: Mapped[int] = mapped_column(SmallInteger, default=5)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # [{ "type": "image"|"video", "url": "/api/v1/attachments/public/12" }]
    media: Mapped[list | None] = mapped_column(JSON, nullable=True)
    is_anonymous: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )

    # visible | hidden
    status: Mapped[str] = mapped_column(
        String(16), default="visible", server_default="visible", index=True
    )
    # 预留的大模型审核结论：skipped（未接入） / pending / passed / flagged / blocked
    moderation_status: Mapped[str] = mapped_column(
        String(16), default="skipped", server_default="skipped"
    )
    moderation_note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # 卖家或运营的回复（不覆盖、不追加多条，保持一条简洁）
    reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replied_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
