from typing import Literal

from pydantic import BaseModel, Field


class SellerReviewRequest(BaseModel):
    status: str = Field(pattern="^(active|suspended|closed)$")
    kyc_status: str = Field(pattern="^(none|pending|approved|rejected)$")


class ProductReviewRequest(BaseModel):
    status: str = Field(
        pattern="^(draft|pending_review|on_sale|off_sale|rejected|deleted)$"
    )


class ShipmentCreateRequest(BaseModel):
    carrier: str = Field(min_length=1, max_length=64)
    tracking_no: str = Field(min_length=1, max_length=128)


class ProductUpdate(BaseModel):
    """改商品资料。

    **没有 status**：状态只能走 `POST /admin/products/{id}/status`，那里有状态机与
    权限区分。混在这里等于「有 product:manage 就能绕过 product:moderate 直接上架」。
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    main_image: str | None = Field(default=None, max_length=512)
    # 商品视频：编辑器里已经能选，之前 schema 没这个字段 → 选了也不保存
    video_url: str | None = Field(default=None, max_length=512)
    # ---- 富文本描述（Tiptap v3）----
    # 前端同时传两份：doc 是真身（回显用），html 由编辑器生成。
    # 服务端会用 nh3 重新清洗 html 再落库，**不信任前端传来的 html**。
    description_doc: dict | None = None
    description_html: str | None = None
    images: list[str] | None = None
    category_id: int | None = None
    # 交付方式（express / pickup），运营也能改
    delivery_methods: list[str] | None = None
    # 租户向卖家抽佣的比例（万分比）：>=100 即 1%；不传 = 保持原值
    commission_bps: int | None = Field(default=None, ge=100, le=100_000)


class ProductStatusRequest(BaseModel):
    # deleted = 软删除（运营端也能删，走同一个状态机）
    status: str = Field(
        pattern="^(draft|pending_review|on_sale|off_sale|rejected|deleted)$"
    )
    # 驳回时给卖家的原因（卖家中心会展示）
    reason: str | None = Field(default=None, max_length=255)


class ProductSkuUpdate(BaseModel):
    """改价 / 改库存。库存变更会写 InventoryLog，不直接覆盖。"""

    price_cents: int | None = Field(default=None, gt=0, le=100_000_000)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)


class SellerProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    price_cents: int = Field(gt=0)
    stock: int = Field(ge=0)
    category_id: int | None = None
    # 商品类型：创建时确定，**之后任何接口都不收**（改类型会让已发生的订单语义断层）。
    # 只有 physical 开放；其它三类在下单/发货/库存上还没打通，直接拒绝写入，
    # 否则库里会出现一堆没有配套逻辑的"虚拟商品"。
    product_type: str = Field(default="physical", max_length=16)
    # 卖家也要能传主图/视频：卖家中心原来根本没收这两个字段，
    # 新建的商品永远没有主图，详情页只剩占位图。
    main_image: str | None = Field(default=None, max_length=512)
    video_url: str | None = Field(default=None, max_length=512)
    # 描述：向导第 4 步填的就是这些。原来创建接口没有这三个字段，
    # 卖家在新建时写的详情会被**静默丢弃**（和之前「选了图不保存」同一类 bug）。
    description: str | None = None
    description_doc: dict | None = None
    description_html: str | None = None
    # 交付方式：向导第 5 步。express 物流快递 / pickup 自提，可多选；
    # 一个都没选 = 未完成发布条件（服务层会拒绝提交审核）
    delivery_methods: list[str] | None = None


class SellerProductUpdate(BaseModel):
    """卖家改自己的商品。

    在售商品改了内容（名称/描述/主图/价格）会**自动打回待审核** —— 否则先提交个
    合规商品过审，再把标题和主图换成违禁内容，审核就白做了。

    多规格后价格/库存必须指明 `sku_id`（不再猜「第一个 SKU」）。
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    # 分类：向导第 2 步「基础信息」里有它，缺了卖家就改不了分类
    category_id: int | None = None
    main_image: str | None = Field(default=None, max_length=512)
    video_url: str | None = Field(default=None, max_length=512)
    # 卖家也能用富文本描述（卖家是主要填写方）
    description_doc: dict | None = None
    description_html: str | None = None
    sku_id: int | None = Field(default=None, description="要改价/改库存的 SKU；单规格可省略")
    price_cents: int | None = Field(default=None, gt=0, le=100_000_000)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)
    # 卖家自填的佣金比例（万分比，下限 1%）；商品被运营锁定后不可再改
    commission_bps: int | None = Field(default=None, ge=100, le=100_000)
    # 交付方式（向导第 5 步）
    delivery_methods: list[str] | None = None


class SpecValueIn(BaseModel):
    value: str = Field(min_length=1, max_length=64)
    image_url: str | None = Field(default=None, max_length=512)
    video_url: str | None = Field(default=None, max_length=512)


class SpecGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    values: list[SpecValueIn] = Field(min_length=1)


class SpecSkuIn(BaseModel):
    """一个规格组合（笛卡尔积）对应的 SKU。`specs` = {组名: 值}。"""

    specs: dict[str, str] = Field(default_factory=dict)
    price_cents: int | None = Field(default=None, gt=0, le=100_000_000)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)
    image_url: str | None = Field(default=None, max_length=512)
    video_url: str | None = Field(default=None, max_length=512)
    status: str = Field(default="active", pattern="^(active|inactive)$")


class ProductSpecsUpdate(BaseModel):
    """整体保存规格树 + 每个组合的 SKU。最多三级规格。"""

    groups: list[SpecGroupIn] = Field(default_factory=list, max_length=3)
    skus: list[SpecSkuIn] = Field(default_factory=list)


class SellerProductStatusRequest(BaseModel):
    """卖家能做的状态变更只有两种：自己下架、被驳回后重新提交。"""

    status: str = Field(pattern="^(off_sale|pending_review)$")


class RefundCreateRequest(BaseModel):
    amount_cents: int = Field(gt=0)
    reason: str = Field(default="", max_length=255)


class RefundRejectRequest(BaseModel):
    reason: str = Field(default="", max_length=255)


class SellerShipRequest(BaseModel):
    """卖家发货。自提单只需标记「备货完成」，所以运单信息可为空
    （快递单缺运单号由服务层拒绝，校验规则只有一份）。"""

    carrier: str = Field(default="", max_length=64)
    tracking_no: str = Field(default="", max_length=128)


class WalletPayRequest(BaseModel):
    """买家支付方式。本期微信/支付宝是模拟渠道，接口形状与真实一致。"""

    method: Literal["wallet", "wechat", "alipay"] = "wallet"


class WalletRechargeRequest(BaseModel):
    amount_cents: int = Field(gt=0, le=10_000_000)
    # 客户端幂等键：重试不会充两次
    client_txn_id: str = Field(min_length=1, max_length=64)


class WalletWithdrawRequest(BaseModel):
    amount_cents: int = Field(gt=0)
    method: Literal["alipay", "wechat", "bank"]
    account_name: str = Field(min_length=1, max_length=64)
    account_no: str = Field(min_length=1, max_length=128)


class WalletWithdrawReviewRequest(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=255)


class ShopProfileUpdate(BaseModel):
    """卖家店铺资料。自提信息在这里维护。"""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    address: str | None = Field(default=None, max_length=255)
    pickup_note: str | None = Field(default=None, max_length=255)


class SellerApplyRequest(BaseModel):
    """买家申请开店。"""

    shop_name: str = Field(min_length=2, max_length=64)
    contact_phone: str = Field(default="", max_length=32)
