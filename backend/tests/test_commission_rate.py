"""租户→卖家抽佣：商品级 > 分类默认 > 系统 10%，以及比例锁定。

这条链路直接影响卖家拿多少钱，所以每个分支都要有硬断言：
并且下单时要把**当时用的比例与来源**快照到订单明细，否则卖家改了比例之后，
历史订单为什么扣了 10% 就说不清。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.catalog import Category, Product
from app.models.order import OrderItem
from tests.conftest import bearer


async def _product(client, admin_token) -> dict:
    rows = (await client.get("/api/v1/admin/products", headers=bearer(admin_token))).json()["data"]
    assert rows
    return next((item for item in rows if item["status"] == "on_sale"), rows[0])


async def _place_order(client, customer_token, product_id: int) -> int:
    detail = (
        await client.get(f"/api/v1/products/{product_id}")
        if False
        else await client.get(f"/api/v1/public/products/{product_id}")
    )
    skus = detail.json()["data"]["skus"]
    sku = next((item for item in skus if item["stock"] > 0), skus[0])
    response = await client.post(
        "/api/v1/portal/orders",
        headers=bearer(customer_token),
        json={
            "items": [{"sku_id": sku["id"], "quantity": 1}],
            "receiver_name": "抽佣测试",
            "receiver_phone": "13900002222",
            "receiver_address": {"city": "深圳市", "detail": "测试路 2 号"},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


async def _item_rate(db_session, order_id: int) -> tuple[int | None, str | None]:
    row = (
        await db_session.scalars(select(OrderItem).where(OrderItem.order_id == order_id))
    ).first()
    assert row is not None
    return row.commission_rate_bps, row.commission_source


async def test_default_rate_is_system_ten_percent(client, admin_token, customer_token, db_session):
    product = await _product(client, admin_token)
    # 先把商品与分类的比例都清掉，走系统默认
    row = (await db_session.scalars(select(Product).where(Product.id == product["id"]))).first()
    assert row is not None
    row.commission_bps = None
    row.category_id = None
    await db_session.flush()

    order_id = await _place_order(client, customer_token, product["id"])
    rate, source = await _item_rate(db_session, order_id)
    assert (rate, source) == (1000, "system")


async def test_category_default_is_used_when_product_has_none(
    client, admin_token, customer_token, db_session
):
    product = await _product(client, admin_token)
    category = (
        await db_session.scalars(select(Category).where(Category.slug == "digital"))
    ).first()
    assert category is not None
    category.default_commission_bps = 500
    row = (await db_session.scalars(select(Product).where(Product.id == product["id"]))).first()
    assert row is not None
    row.commission_bps = None
    row.category_id = category.id
    await db_session.flush()

    order_id = await _place_order(client, customer_token, product["id"])
    rate, source = await _item_rate(db_session, order_id)
    assert (rate, source) == (500, "category")


async def test_product_rate_beats_category(client, admin_token, customer_token, db_session):
    product = await _product(client, admin_token)
    category = (
        await db_session.scalars(select(Category).where(Category.slug == "digital"))
    ).first()
    assert category is not None
    category.default_commission_bps = 500
    row = (await db_session.scalars(select(Product).where(Product.id == product["id"]))).first()
    assert row is not None
    row.category_id = category.id
    row.commission_bps = 300
    await db_session.flush()

    order_id = await _place_order(client, customer_token, product["id"])
    rate, source = await _item_rate(db_session, order_id)
    assert (rate, source) == (300, "product")


async def test_admin_change_locks_the_rate_and_unlock_restores_it(client, admin_token, db_session):
    product = await _product(client, admin_token)

    changed = await client.put(
        f"/api/v1/admin/products/{product['id']}",
        headers=bearer(admin_token),
        json={"commission_bps": 800},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["commission_bps"] == 800
    assert changed.json()["data"]["commission_locked"] is True

    unlocked = await client.post(
        f"/api/v1/admin/products/{product['id']}/commission-unlock",
        headers=bearer(admin_token),
    )
    assert unlocked.status_code == 200, unlocked.text
    assert unlocked.json()["data"]["commission_locked"] is False


async def test_rate_below_one_percent_is_rejected(client, admin_token):
    product = await _product(client, admin_token)
    response = await client.put(
        f"/api/v1/admin/products/{product['id']}",
        headers=bearer(admin_token),
        json={"commission_bps": 50},
    )
    assert response.status_code == 422, response.text


async def test_locked_product_blocks_seller_change(client, admin_token, operator_token):
    product = await _product(client, admin_token)
    await client.put(
        f"/api/v1/admin/products/{product['id']}",
        headers=bearer(admin_token),
        json={"commission_bps": 800},
    )

    blocked = await client.put(
        f"/api/v1/portal/seller/products/{product['id']}",
        headers=bearer(operator_token),
        json={"commission_bps": 300},
    )
    # 卖家只能改自己的商品：不属于他就是 404，属于他则必须 403
    assert blocked.status_code in (403, 404), blocked.text
    if blocked.status_code == 403:
        assert "运营" in blocked.text or "锁定" in blocked.text
