from pydantic import BaseModel, ConfigDict, Field


class CartItemCreate(BaseModel):
    sku_id: int
    quantity: int = Field(default=1, ge=1, le=999)


class CartItemUpdate(BaseModel):
    quantity: int | None = Field(default=None, ge=1, le=999)
    selected: bool | None = None


class CartItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    sku_id: int
    seller_id: int
    quantity: int
    selected: bool
    product_name: str
    sku_name: str
    price_cents: int
    stock: int
    main_image: str | None = None
    subtotal_cents: int
    available: bool
    # 交付方式与自提门店：结算页按卖家选快递/自提时要显示
    delivery_methods: list[str] = []
    shop_address: str | None = None
    shop_pickup_note: str | None = None


class CartSummary(BaseModel):
    items: list[CartItemOut]
    selected_count: int
    selected_amount_cents: int
    total_count: int
    invalid_count: int


class ProductSkuOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku_code: str
    name: str
    price_cents: int
    stock: int
    status: str


class PortalProductDetail(BaseModel):
    id: int
    name: str
    description: str | None = None
    status: str
    main_image: str | None = None
    images: list[str] | None = None
    seller_id: int
    seller_name: str | None = None
    shop_id: int
    shop_name: str | None = None
    skus: list[ProductSkuOut]


class AddressCreate(BaseModel):
    receiver_name: str = Field(min_length=1, max_length=64)
    receiver_phone: str = Field(min_length=1, max_length=32)
    # 省市区**不能为空**：之前默认空串，前端没传上来也照样 200，
    # 结果就是"选了省市区但保存下来是空的"——必须让后端明确拒绝。
    province: str = Field(min_length=1, max_length=64)
    city: str = Field(min_length=1, max_length=64)
    district: str = Field(min_length=1, max_length=64)
    detail: str = Field(min_length=1, max_length=255)
    is_default: bool = False


class AddressUpdate(BaseModel):
    receiver_name: str | None = Field(default=None, min_length=1, max_length=64)
    receiver_phone: str | None = Field(default=None, min_length=1, max_length=32)
    # 传了就不能是空串（不传 = 不改这一项，由 exclude_unset 控制）
    province: str | None = Field(default=None, min_length=1, max_length=64)
    city: str | None = Field(default=None, min_length=1, max_length=64)
    district: str | None = Field(default=None, min_length=1, max_length=64)
    detail: str | None = Field(default=None, min_length=1, max_length=255)
    is_default: bool | None = None


class AddressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    receiver_name: str
    receiver_phone: str
    province: str
    city: str
    district: str
    detail: str
    is_default: bool


class CheckoutFromCartRequest(BaseModel):
    """Checkout only the *selected* cart lines."""

    # 自提单不需要收货地址，所以这三项不再强制（快递单缺地址由服务层拒绝）
    receiver_name: str | None = Field(default=None, max_length=64)
    receiver_phone: str | None = Field(default=None, max_length=32)
    receiver_address: dict | None = None
    remark: str | None = None
    address_id: int | None = None
    # 按卖家选交付方式：express / pickup
    delivery: list[dict] = []
