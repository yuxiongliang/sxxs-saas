"""买家订单列表（详情页下线后）与省市区数据接口。

详情页已经删了，列表必须自带：收货人/电话/地址、备注、时间、物流单号。
少一样，买家就得靠回忆。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.catalog import Product, ProductSku
from app.models.order import Order, SellerOrder
from tests.conftest import bearer


async def _sku(db_session):
    product = (
        (
            await db_session.execute(
                select(Product).where(
                    Product.tenant_id == 1, Product.status == "on_sale"
                )
            )
        )
        .scalars()
        .first()
    )
    sku = (
        (
            await db_session.execute(
                select(ProductSku).where(ProductSku.product_id == product.id)
            )
        )
        .scalars()
        .first()
    )
    return product, sku


async def _place(client, token, db_session) -> dict:
    _, sku = await _sku(db_session)
    response = await client.post(
        "/api/v1/portal/orders",
        headers=bearer(token),
        json={
            "items": [{"sku_id": sku.id, "quantity": 1}],
            "receiver_name": "列表收货人",
            "receiver_phone": "13900001234",
            "receiver_address": {"province": "广东省", "city": "深圳市", "detail": "科技园 1 号"},
            "remark": "放门口",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_buyer_order_list_carries_receiver_and_remark(
    client, customer_token, db_session
):
    await _place(client, customer_token, db_session)
    listed = await client.get("/api/v1/portal/orders", headers=bearer(customer_token))
    assert listed.status_code == 200, listed.text
    row = listed.json()["data"][0]
    for key in (
        "receiver_name",
        "receiver_phone",
        "receiver_address",
        "remark",
        "created_at",
        "items",
    ):
        assert key in row, f"买家订单列表缺 {key}"
    assert row["receiver_name"] == "列表收货人"
    assert row["remark"] == "放门口"


async def test_buyer_order_list_carries_tracking_no(
    client, admin_token, customer_token, db_session
):
    created = await _place(client, customer_token, db_session)
    order_id = created["id"]
    await client.post(
        f"/api/v1/admin/orders/{order_id}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order_id)
        )
    ).scalars().first()
    await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
        json={"carrier": "顺丰", "tracking_no": "SF-LIST-1"},
    )

    listed = await client.get("/api/v1/portal/orders", headers=bearer(customer_token))
    row = next(
        item for item in listed.json()["data"] if item["id"] == order_id
    )
    assert row["shipments"], "列表必须带物流单号（详情页已下线）"
    assert row["shipments"][0]["tracking_no"] == "SF-LIST-1"
    assert row["shipments"][0]["carrier"] == "顺丰"


async def test_refunded_order_is_closed(client, admin_token, customer_token, db_session):
    """全额退款后履行状态一律「已关闭」（产品口径）。"""
    created = await _place(client, customer_token, db_session)
    order_id = created["id"]
    await client.post(
        f"/api/v1/admin/orders/{order_id}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order_id)
        )
    ).scalars().first()
    await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/refund",
        headers=bearer(admin_token),
        json={"amount_cents": seller_order.goods_amount_cents, "reason": "全额退"},
    )
    order = await db_session.get(Order, order_id)
    await db_session.refresh(order)
    assert order.payment_status == "refunded"
    assert order.fulfillment_status == "cancelled"


async def test_public_regions_returns_three_levels(client):
    response = await client.get("/api/v1/public/regions")
    assert response.status_code == 200, response.text
    tree = response.json()["data"]
    assert len(tree) >= 34, "省级行政区应含港澳台"
    beijing = next(item for item in tree if item["name"] == "北京市")
    # 直辖市的二级直接是自身，不能出现「市辖区」这种内部名
    assert beijing["children"][0]["name"] == "北京市"
    assert beijing["children"][0]["children"][0]["name"] == "东城区"
    assert any(item["name"] == "香港特别行政区" for item in tree)
