from pydantic import BaseModel, Field


class SellerReviewRequest(BaseModel):
    status: str = Field(pattern="^(active|suspended|closed)$")
    kyc_status: str = Field(pattern="^(none|pending|approved|rejected)$")


class ProductReviewRequest(BaseModel):
    status: str = Field(pattern="^(draft|pending_review|on_sale|off_sale|rejected)$")


class ShipmentCreateRequest(BaseModel):
    carrier: str = Field(min_length=1, max_length=64)
    tracking_no: str = Field(min_length=1, max_length=128)


class ProductUpdate(BaseModel):
    """改商品资料。

    **没有 status**：状态只能走 `POST /admin/products/{id}/status`，那里有状态机与
    权限区分。混在这里等于「有 product:manage 就能绕过 product:moderate 直接上架」。
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=255)
    description: str | None = None
    main_image: str | None = Field(default=None, max_length=512)
    images: list[str] | None = None
    category_id: int | None = None


class ProductStatusRequest(BaseModel):
    status: str = Field(pattern="^(draft|pending_review|on_sale|off_sale|rejected)$")
    # 驳回时给卖家的原因（卖家中心会展示）
    reason: str | None = Field(default=None, max_length=255)


class ProductSkuUpdate(BaseModel):
    """改价 / 改库存。库存变更会写 InventoryLog，不直接覆盖。"""

    price_cents: int | None = Field(default=None, gt=0, le=100_000_000)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)


class SellerProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=255)
    price_cents: int = Field(gt=0)
    stock: int = Field(ge=0)
    category_id: int | None = None


class SellerProductUpdate(BaseModel):
    """卖家改自己的商品。

    在售商品改了内容（名称/描述/主图/价格）会**自动打回待审核** —— 否则先提交个
    合规商品过审，再把标题和主图换成违禁内容，审核就白做了。
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=255)
    description: str | None = None
    main_image: str | None = Field(default=None, max_length=512)
    price_cents: int | None = Field(default=None, gt=0, le=100_000_000)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)


class SellerProductStatusRequest(BaseModel):
    """卖家能做的状态变更只有两种：自己下架、被驳回后重新提交。"""

    status: str = Field(pattern="^(off_sale|pending_review)$")


class RefundCreateRequest(BaseModel):
    amount_cents: int = Field(gt=0)
    reason: str = Field(default="", max_length=255)


class SellerShipRequest(BaseModel):
    carrier: str = Field(min_length=1, max_length=64)
    tracking_no: str = Field(min_length=1, max_length=128)


class SellerApplyRequest(BaseModel):
    """买家申请开店。"""

    shop_name: str = Field(min_length=2, max_length=64)
    contact_phone: str = Field(default="", max_length=32)
