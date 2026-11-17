"""商品类型（products.product_type）与订单行类型快照。

守的契约：

1. 类型**创建时确定**，之后任何接口都不收 —— 改类型会让已发生的订单语义断层；
2. 目前只开放 `physical`，其它三类后端直接 400（不能只靠前端禁用）；
3. `order_items.product_type` 是**下单快照**：商品后来改类型，历史订单不变；
4. 三端订单列表（控制台 / 卖家 / 买家）都要直接带商品明细，运营和买家不用点进详情。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.catalog import Product
from app.models.order import OrderItem
from tests.conftest import bearer


async def _create_product(client, token, name: str, **extra) -> dict:
    body = {"name": name, "price_cents": 8800, "stock": 5, **extra}
    response = await client.post(
        "/api/v1/portal/seller/products", headers=bearer(token), json=body
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _first_purchasable_sku(db_session, tenant_id: int = 1):
    product = (
        (
            await db_session.execute(
                select(Product).where(
                    Product.tenant_id == tenant_id, Product.status == "on_sale"
                )
            )
        )
        .scalars()
        .first()
    )
    assert product is not None, "seed 里必须有在售商品"
    from app.models.catalog import ProductSku

    sku = (
        (
            await db_session.execute(
                select(ProductSku).where(ProductSku.product_id == product.id)
            )
        )
        .scalars()
        .first()
    )
    assert sku is not None
    return product, sku


def _order_body(sku_id: int) -> dict:
    return {
        "items": [{"sku_id": sku_id, "quantity": 1}],
        "receiver_name": "类型测试",
        "receiver_phone": "13900000000",
        "receiver_address": {"province": "广东省", "city": "深圳市", "detail": "测试路"},
        "remark": "pytest",
    }


# ---------------------------------------------------------------- 创建与校验


async def test_created_product_defaults_to_physical(client, operator_token):
    created = await _create_product(client, operator_token, "默认类型商品")
    products = (
        await client.get("/api/v1/portal/seller/products", headers=bearer(operator_token))
    ).json()["data"]
    target = next(item for item in products if item["id"] == created["id"])
    assert target["product_type"] == "physical"


async def test_non_physical_type_is_rejected_by_backend(client, operator_token):
    """前端禁用只是体验；接口必须同样拒，否则能绕过 UI 写入半成品数据。"""
    response = await client.post(
        "/api/v1/portal/seller/products",
        headers=bearer(operator_token),
        json={"name": "虚拟商品", "price_cents": 100, "stock": 1, "product_type": "virtual"},
    )
    assert response.status_code == 400, response.text
    assert "待开发" in response.json()["message"]


async def test_product_type_cannot_be_changed_on_update(
    client, operator_token, db_session
):
    """更新接口不接受 product_type：传了也不生效（schema 里就没有这个字段）。"""
    created = await _create_product(client, operator_token, "不可改类型")
    response = await client.put(
        f"/api/v1/portal/seller/products/{created['id']}",
        headers=bearer(operator_token),
        json={"name": "不可改类型-改名", "product_type": "virtual"},
    )
    assert response.status_code == 200, response.text

    product = await db_session.get(Product, created["id"])
    await db_session.refresh(product)
    assert product.product_type == "physical"
    assert product.name == "不可改类型-改名"


# ---------------------------------------------------------------- 订单快照


async def test_order_items_snapshot_product_type(
    client, customer_token, db_session
):
    product, sku = await _first_purchasable_sku(db_session)
    created = await client.post(
        "/api/v1/portal/orders", headers=bearer(customer_token), json=_order_body(sku.id)
    )
    assert created.status_code == 200, created.text
    order_id = created.json()["data"]["id"]

    item = (
        (
            await db_session.execute(
                select(OrderItem).where(
                    OrderItem.order_id == order_id,
                    OrderItem.product_id == product.id,
                )
            )
        )
        .scalars()
        .first()
    )
    assert item is not None
    assert item.product_type == "physical"

    # 商品后来改类型（模拟未来开放虚拟商品），历史订单行不能被带走
    product.product_type = "virtual"
    await db_session.flush()
    await db_session.refresh(item)
    assert item.product_type == "physical"


# ---------------------------------------------------------------- 三端订单列表


async def test_admin_order_list_returns_items(client, admin_token, customer_token, db_session):
    _, sku = await _first_purchasable_sku(db_session)
    await client.post(
        "/api/v1/portal/orders", headers=bearer(customer_token), json=_order_body(sku.id)
    )
    response = await client.get("/api/v1/admin/orders", headers=bearer(admin_token))
    assert response.status_code == 200, response.text
    orders = response.json()["data"]
    assert orders, "应该有订单"
    order = orders[0]
    assert order["items"], "列表必须直接带商品明细，不能只有订单头"
    item = order["items"][0]
    # 发货/退款是卖家单粒度：行里必须带 seller_order_id
    for key in (
        "seller_order_id",
        "product_type",
        "product_name",
        "sku_name",
        "image",
        "quantity",
        "subtotal_cents",
    ):
        assert key in item, f"订单行缺 {key}"
    assert order["created_at"]


async def test_buyer_order_list_returns_items(client, customer_token, db_session):
    _, sku = await _first_purchasable_sku(db_session)
    await client.post(
        "/api/v1/portal/orders", headers=bearer(customer_token), json=_order_body(sku.id)
    )
    response = await client.get("/api/v1/portal/orders", headers=bearer(customer_token))
    assert response.status_code == 200, response.text
    orders = response.json()["data"]
    assert orders[0]["items"], "买家也要在列表里直接看到买的是什么"
    assert orders[0]["items"][0]["product_type"] == "physical"


async def test_seller_order_list_returns_items(client, operator_token, customer_token, db_session):
    _, sku = await _first_purchasable_sku(db_session)
    await client.post(
        "/api/v1/portal/orders", headers=bearer(customer_token), json=_order_body(sku.id)
    )
    response = await client.get("/api/v1/portal/seller/orders", headers=bearer(operator_token))
    assert response.status_code == 200, response.text
    orders = response.json()["data"]
    assert orders, "卖家应该看到自己的卖家单"
    assert orders[0]["items"], "卖家要知道自己卖了什么"


# ---------------------------------------------------------------- 筛选


async def test_admin_product_list_filters_by_type(client, admin_token):
    ok = await client.get(
        "/api/v1/admin/products", headers=bearer(admin_token), params={"product_type": "physical"}
    )
    assert ok.status_code == 200
    assert ok.json()["data"], "实物商品应该有数据"

    empty = await client.get(
        "/api/v1/admin/products", headers=bearer(admin_token), params={"product_type": "virtual"}
    )
    assert empty.status_code == 200
    assert empty.json()["data"] == []


async def test_seller_product_list_filters_by_type(client, operator_token):
    response = await client.get(
        "/api/v1/portal/seller/products",
        headers=bearer(operator_token),
        params={"product_type": "physical"},
    )
    assert response.status_code == 200


async def test_platform_product_list_filters_by_type(client, platform_token):
    response = await client.get(
        "/api/v1/platform/products",
        headers=bearer(platform_token),
        params={"product_type": "virtual"},
    )
    assert response.status_code == 200
    assert response.json()["data"] == []
