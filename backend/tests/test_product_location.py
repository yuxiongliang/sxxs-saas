"""商品所在地（LBS）：录入、公开展示、距离排序/同城/半径、订单快照。

守的契约：

1. **坐标不出公开接口**：列表/详情只给省市区与 `distance_m`，绝不返回经纬度；
2. 距离用直线（haversine），排序与展示同一公式；
3. 无坐标商品：不参与距离排序（排最后）、不参与半径过滤、界面显示「未设置」；
4. 位置变更算内容变更：在售商品改所在地会打回待审核；
5. 下单时**冻结**位置快照，商品之后改位置不影响历史订单。
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.order import OrderItem
from app.services.geo import haversine_m
from tests.conftest import bearer

HANGZHOU = (30.2741, 120.1551)
SHANGHAI = (31.2304, 121.4737)


async def _create_on_sale(
    client, operator_token, admin_token, *, name: str, lat: float | None, lng: float | None,
    city: str | None, stock: int = 5,
) -> dict:
    created = await client.post(
        "/api/v1/portal/seller/products",
        headers=bearer(operator_token),
        json={
            "name": name,
            "price_cents": 1999,
            "stock": stock,
            "delivery_methods": ["express"],
            "province": "浙江省" if city else None,
            "city": city,
            "district": "测试区" if city else None,
            "latitude": lat,
            "longitude": lng,
        },
    )
    assert created.status_code == 200, created.text
    product_id = created.json()["data"]["id"]
    approved = await client.post(
        f"/api/v1/admin/products/{product_id}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )
    assert approved.status_code == 200, approved.text
    return {"id": product_id, **created.json()["data"]}


async def test_seller_location_roundtrip(client, operator_token):
    created = await client.post(
        "/api/v1/portal/seller/products",
        headers=bearer(operator_token),
        json={
            "name": "带位置的商品",
            "price_cents": 1000,
            "stock": 3,
            "delivery_methods": ["express"],
            "province": "浙江省",
            "city": "台州市",
            "district": "椒江区",
            "address": "某某路 1 号",
            "latitude": HANGZHOU[0],
            "longitude": HANGZHOU[1],
        },
    )
    assert created.status_code == 200, created.text
    detail = await client.get(
        f"/api/v1/portal/seller/products/{created.json()['data']['id']}",
        headers=bearer(operator_token),
    )
    assert detail.status_code == 200, detail.text
    data = detail.json()["data"]
    assert data["city"] == "台州市"
    assert float(data["latitude"]) == pytest.approx(HANGZHOU[0], abs=1e-4)


async def test_location_change_bounces_on_sale_product(
    client, operator_token, admin_token
):
    product = await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="改位置会打回",
        lat=HANGZHOU[0],
        lng=HANGZHOU[1],
        city="杭州市",
    )
    updated = await client.put(
        f"/api/v1/portal/seller/products/{product['id']}",
        headers=bearer(operator_token),
        json={"city": "台州市", "latitude": SHANGHAI[0], "longitude": SHANGHAI[1]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["status"] == "pending_review"


async def test_public_payload_has_location_but_no_coordinates(
    client, operator_token, admin_token
):
    await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="位置公开字段",
        lat=HANGZHOU[0],
        lng=HANGZHOU[1],
        city="杭州市",
    )
    response = await client.get("/api/v1/public/products", params={"keyword": "位置公开字段"})
    assert response.status_code == 200, response.text
    item = response.json()["data"]["list"][0]
    assert item["city"] == "杭州市"
    assert item["location"] == "浙江省 杭州市 测试区"
    # 坐标绝不外发
    assert "latitude" not in item and "longitude" not in item
    assert "shop_latitude" not in item


async def test_distance_and_sorting(client, operator_token, admin_token):
    await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="近的杭州货",
        lat=HANGZHOU[0],
        lng=HANGZHOU[1],
        city="杭州市",
    )
    await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="远的上海货",
        lat=SHANGHAI[0],
        lng=SHANGHAI[1],
        city="上海市",
    )

    response = await client.get(
        "/api/v1/public/products",
        params={
            "keyword": "货",
            "sort": "distance",
            "buyer_lat": HANGZHOU[0],
            "buyer_lng": HANGZHOU[1],
            "page_size": 20,
        },
    )
    assert response.status_code == 200, response.text
    rows = [row for row in response.json()["data"]["list"] if "货" in row["name"]]
    assert len(rows) >= 2
    first, second = rows[0], rows[1]
    assert first["name"] == "近的杭州货"
    assert first["distance_m"] is not None and second["distance_m"] is not None
    assert first["distance_m"] < second["distance_m"]
    # 距离与服务端 haversine 同口径（±2m 容差）
    expect = haversine_m(HANGZHOU[0], HANGZHOU[1], SHANGHAI[0], SHANGHAI[1])
    assert second["distance_m"] == pytest.approx(expect, abs=2)


async def test_city_filter_and_radius(client, operator_token, admin_token):
    await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="同城筛选-杭",
        lat=HANGZHOU[0],
        lng=HANGZHOU[1],
        city="杭州市",
    )
    await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="同城筛选-沪",
        lat=SHANGHAI[0],
        lng=SHANGHAI[1],
        city="上海市",
    )

    by_city = await client.get(
        "/api/v1/public/products", params={"keyword": "同城筛选", "city": "杭州市"}
    )
    names = [row["name"] for row in by_city.json()["data"]["list"]]
    assert names == ["同城筛选-杭"]

    near = await client.get(
        "/api/v1/public/products",
        params={
            "keyword": "同城筛选",
            "radius_km": 50,
            "buyer_lat": HANGZHOU[0],
            "buyer_lng": HANGZHOU[1],
        },
    )
    names = [row["name"] for row in near.json()["data"]["list"]]
    assert names == ["同城筛选-杭"]


async def test_products_without_location_do_not_break_filters(
    client, operator_token, admin_token
):
    await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="无坐标商品",
        lat=None,
        lng=None,
        city=None,
    )
    response = await client.get(
        "/api/v1/public/products",
        params={
            "keyword": "无坐标商品",
            "sort": "distance",
            "buyer_lat": HANGZHOU[0],
            "buyer_lng": HANGZHOU[1],
        },
    )
    assert response.status_code == 200, response.text
    row = response.json()["data"]["list"][0]
    assert row["distance_m"] is None
    assert row["location"] is None


async def test_order_snapshots_location(
    client, operator_token, admin_token, customer_token, db_session
):
    product = await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="下单快照位置",
        lat=HANGZHOU[0],
        lng=HANGZHOU[1],
        city="杭州市",
    )
    detail = await client.get(
        f"/api/v1/admin/products/{product['id']}", headers=bearer(admin_token)
    )
    sku_id = next(
        row["id"] for row in detail.json()["data"]["skus"] if row["status"] == "active"
    )
    order = await client.post(
        "/api/v1/portal/orders",
        headers=bearer(customer_token),
        json={
            "items": [{"sku_id": sku_id, "quantity": 1}],
            "receiver_name": "快照测试",
            "receiver_phone": "13900007777",
            "receiver_address": {"province": "浙江省", "city": "杭州市", "detail": "路 1 号"},
        },
    )
    assert order.status_code == 200, order.text
    order_id = order.json()["data"]["id"]

    item = (
        await db_session.execute(
            select(OrderItem).where(OrderItem.order_id == order_id)
        )
    ).scalars().first()
    assert item is not None
    assert item.location_city == "杭州市"
    assert item.location_latitude == Decimal(str(HANGZHOU[0])).quantize(Decimal("0.0000001"))

    # 商品改位置不影响已下单的快照
    await client.put(
        f"/api/v1/admin/products/{product['id']}",
        headers=bearer(admin_token),
        json={"city": "上海市", "latitude": SHANGHAI[0], "longitude": SHANGHAI[1]},
    )
    await db_session.refresh(item)
    assert item.location_city == "杭州市"


async def test_checkout_preview_returns_pickup_distance(
    client, operator_token, admin_token, customer_token, db_session
):
    """自提门店距离：服务端算，坐标不下发。"""
    # 给店铺设坐标（自提门店）
    shop = await client.put(
        "/api/v1/portal/seller/shop",
        headers=bearer(operator_token),
        json={
            "address": "杭州市某自提点",
            "latitude": HANGZHOU[0],
            "longitude": HANGZHOU[1],
        },
    )
    assert shop.status_code == 200, shop.text

    product = await _create_on_sale(
        client,
        operator_token,
        admin_token,
        name="自提距离商品",
        lat=HANGZHOU[0],
        lng=HANGZHOU[1],
        city="杭州市",
    )
    detail = await client.get(
        f"/api/v1/admin/products/{product['id']}", headers=bearer(admin_token)
    )
    sku_id = next(
        row["id"] for row in detail.json()["data"]["skus"] if row["status"] == "active"
    )

    preview = await client.post(
        "/api/v1/portal/checkout/preview",
        headers=bearer(customer_token),
        json={
            "mode": "buy",
            "sku_id": sku_id,
            "quantity": 1,
            "buyer_lat": SHANGHAI[0],
            "buyer_lng": SHANGHAI[1],
        },
    )
    assert preview.status_code == 200, preview.text
    seller = preview.json()["data"]["sellers"][0]
    expected = haversine_m(SHANGHAI[0], SHANGHAI[1], HANGZHOU[0], HANGZHOU[1])
    assert seller["pickup_distance_m"] == pytest.approx(expected, abs=2)
    assert seller["location"] == "浙江省 杭州市 测试区"
