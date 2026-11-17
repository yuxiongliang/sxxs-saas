from typing import Literal

from pydantic import BaseModel, Field


class OrderItemInput(BaseModel):
    sku_id: int
    quantity: int = Field(ge=1, le=999)


class OrderDeliveryChoice(BaseModel):
    """买家按**卖家**选交付方式：一单可拆多卖家单，可能一个快递一个自提。"""

    seller_id: int
    delivery_method: Literal["express", "pickup"]


class OrderCreateRequest(BaseModel):
    items: list[OrderItemInput] = Field(min_length=1)
    # 自提单不需要收货地址，所以收货人信息只做长度校验、不强制；
    # 「快递必须有地址」这条业务规则在 services/order.create_order 里按交付方式判断。
    receiver_name: str | None = Field(default=None, max_length=64)
    receiver_phone: str | None = Field(default=None, max_length=32)
    receiver_address: dict | None = None
    remark: str | None = None
    delivery: list[OrderDeliveryChoice] = Field(default_factory=list)
