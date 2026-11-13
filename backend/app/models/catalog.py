from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Category(Base, TimestampMixin):
    """商品分类（平台级，全租户共用）。

    `tenant_id` 保留列但**可空**：NULL = 平台级分类（唯一形态）。
    平台统一建分类并在上面设「分类默认抽佣比例」，租户只能选，不能自建——
    否则每家租户一套分类，平台的抽佣口径和商品筛选全部碎片化。
    """

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id"), nullable=True, index=True
    )
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(64))
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="active")
    # 分类默认抽佣比例（万分比，500=5%）：卖家未在商品上单独填时用它。
    # 注意与 `service_categories.commission_bps`（平台向**租户**抽）不是一回事。
    default_commission_bps: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0"
    )


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("sellers.id"), index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    subtitle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    main_image: Mapped[str | None] = mapped_column(String(512), nullable=True)
    images: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # 审核驳回原因：卖家要知道为什么被驳回，否则只能反复重提。
    # 上架/重新提交时清空。
    reject_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class ProductSku(Base, TimestampMixin):
    __tablename__ = "product_skus"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("sellers.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    sku_code: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128))
    price_cents: Mapped[int] = mapped_column(Integer)
    market_price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    locked_stock: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="active")
    specs: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class InventoryLog(Base):
    __tablename__ = "inventory_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("sellers.id"), index=True)
    sku_id: Mapped[int] = mapped_column(ForeignKey("product_skus.id"), index=True)
    change: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(64), default="")
    order_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
