from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, func
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
    # 历史纯文本描述：老商品仍用它兵底渲染，新数据写下面四列
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ---- 富文本描述（产品决定：上 Tiptap v3，能力全量）----
    # 真身：ProseMirror doc JSON，编辑器回显用它
    description_doc: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # **服务端 nh3 清洗过**的 HTML，买家端直接渲染；不存未清洗的 HTML
    description_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 从清洗后的 HTML 抽出的纯文本，只给搜索用
    description_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # text（历史纯文本）/ doc（富文本），渐进迁移，老数据不动
    description_format: Mapped[str] = mapped_column(
        String(8), default="text", server_default="text"
    )
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    # 商品类型：physical（实物，唯一已开放）/ virtual / knowledge / event。
    # **创建后不可修改**：已有订单、库存、发货都按创建时的语义跑，改了会语义断层。
    # 类 Default 与迁移里的 server_default 必须一致（test_migrations 会校对）。
    product_type: Mapped[str] = mapped_column(
        String(16),
        default="physical",
        server_default="physical",
        index=True,
    )
    main_image: Mapped[str | None] = mapped_column(String(512), nullable=True)
    images: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # 审核驳回原因：卖家要知道为什么被驳回，否则只能反复重提。
    # 上架/重新提交时清空。
    reject_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 商品视频（主图/多图之外的展示素材）
    video_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # 交付方式（实物）：["express"] 物流快递 / ["pickup"] 自提 / 两者都支持。
    # NULL = 卖家还没选过（历史数据），**不允许发布**；由向导第 5 步填写。
    delivery_methods: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # 浏览数（PV）：买家侧打开详情页就 +1。运营后台预览不计，避免自己刷自己的数。
    # 这是「浏览量」不是广告曝光：刷新会重复计数，界面列头要写清楚。
    view_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 租户向卖家抽佣的商品级比例（万分比）；NULL = 继承分类默认值。
    # commission_locked = 已由运营调整过，卖家不能再改回去。
    commission_bps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    commission_locked: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class ProductSku(Base, TimestampMixin):
    __tablename__ = "product_skus"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("sellers.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    # 全局唯一：多规格后一个商品会有 N 条 SKU，旧的 `SKU-{product_id}` 会重复
    sku_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    price_cents: Mapped[int] = mapped_column(Integer)
    market_price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    locked_stock: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="active")
    # {"尺码": "XL", "颜色": "黑色"}：规格组名 → 规格值，多规格的商品靠它反查组合
    specs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # SKU 级覆盖图/视频：优先级高于规格值图，再高于商品主图
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    video_url: Mapped[str | None] = mapped_column(String(512), nullable=True)


class ProductSpecGroup(Base, TimestampMixin):
    """商品的规格组：尺码 / 颜色 / 款式（最多三级）。"""

    __tablename__ = "product_spec_groups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    name: Mapped[str] = mapped_column(String(32))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class ProductSpecValue(Base, TimestampMixin):
    """规格值：XL / 黑色 / 薄款；每个值可挂 1 图或 1 视频。"""

    __tablename__ = "product_spec_values"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("product_spec_groups.id"), index=True)
    value: Mapped[str] = mapped_column(String(64))
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    video_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)


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
