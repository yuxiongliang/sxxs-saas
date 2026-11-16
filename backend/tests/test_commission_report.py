"""按月抽佣台账：GMV × 类目比例，买断/自定义档期豁免。

口径（2026-11-13 更新）：基数 = 当月**已完成**订单金额（`completed_at` 落在当月、
`status='completed'`）；已支付但未确认收货的**不计入**。比例 = 租户所属业务类目；
买断（lifetime）与自定义档期（custom）套餐的租户恒为 0。

这是**乙线**（平台→租户），与 `tests/test_commission_rate.py` 的甲线（租户→卖家）无关。
"""

from __future__ import annotations

from tests.conftest import bearer

REPORT = "/api/v1/platform/commission-report"


async def _make_category(client, token, code="test-cat", bps=500) -> int:
    created = await client.post(
        "/api/v1/platform/service-categories",
        headers=bearer(token),
        json={"code": code, "name": f"类目 {code}", "commission_bps": bps},
    )
    assert created.status_code == 200, created.text
    return created.json()["data"]["id"]


async def _assign(client, token, tenant_id: int, category_id: int | None) -> None:
    response = await client.put(
        f"/api/v1/platform/tenants/{tenant_id}/service-category",
        headers=bearer(token),
        json={"service_category_id": category_id},
    )
    assert response.status_code == 200, response.text


async def test_requires_platform_token(client, admin_token):
    response = await client.get(REPORT, headers=bearer(admin_token))
    assert response.status_code == 401, response.text


async def test_only_completed_orders_count_into_gmv(client, platform_token, customer_token, db_session):
    """已支付但未确认收货的订单不能算进抽佣基数 —— 这是本轮改动的核心。"""
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.models.order import Order, SellerOrder

    category_id = await _make_category(client, platform_token, "completed-cat", 500)
    await _assign(client, platform_token, 1, category_id)

    detail = (await client.get("/api/v1/public/products?page_size=1")).json()["data"]["list"][0]
    product = (await client.get(f"/api/v1/public/products/{detail['id']}")).json()["data"]
    sku = next((item for item in product["skus"] if item["stock"] > 0), product["skus"][0])

    ordered = await client.post(
        "/api/v1/portal/orders",
        headers=bearer(customer_token),
        json={
            "items": [{"sku_id": sku["id"], "quantity": 1}],
            "receiver_name": "抽佣口径",
            "receiver_phone": "13900003333",
            "receiver_address": {"city": "深圳市", "detail": "测试路 3 号"},
        },
    )
    assert ordered.status_code == 200, ordered.text
    order_id = ordered.json()["data"]["id"]
    await client.post(
        f"/api/v1/portal/orders/{order_id}/mock-pay", headers=bearer(customer_token)
    )

    # 已支付但未完成 → 不计入
    before = (await client.get(REPORT, headers=bearer(platform_token))).json()["data"]
    demo_before = next(row for row in before["rows"] if row["tenant_id"] == 1)

    # 手动把这单标成已完成（当前月份）
    order = await db_session.get(Order, order_id)
    assert order is not None
    order.status = "completed"
    order.completed_at = datetime.now(UTC)
    seller_orders = (
        await db_session.execute(select(SellerOrder).where(SellerOrder.order_id == order_id))
    ).scalars().all()
    for row in seller_orders:
        row.status = "completed"
        row.completed_at = datetime.now(UTC)
    await db_session.flush()

    after = (await client.get(REPORT, headers=bearer(platform_token))).json()["data"]
    demo_after = next(row for row in after["rows"] if row["tenant_id"] == 1)
    assert demo_after["gmv_cents"] > demo_before["gmv_cents"], "完成后才计入 GMV"
    assert demo_after["commission_cents"] == demo_after["gmv_cents"] * 500 // 10000


async def test_commission_follows_category_rate(client, platform_token):
    category_id = await _make_category(client, platform_token, "rate-cat", 500)
    await _assign(client, platform_token, 1, category_id)

    report = (await client.get(REPORT, headers=bearer(platform_token))).json()["data"]
    demo = next(row for row in report["rows"] if row["tenant_id"] == 1)
    assert demo["service_category"]["commission_bps"] == 500
    assert demo["waived"] is False
    assert demo["rate_bps"] == 500
    # 公式必须自洽：应抽佣 = GMV × bps / 10000（向下取整）
    assert demo["commission_cents"] == demo["gmv_cents"] * 500 // 10000
    assert report["total_commission_cents"] == sum(
        row["commission_cents"] for row in report["rows"]
    )


async def test_buyout_tenant_is_waived_even_with_category(client, platform_token):
    category_id = await _make_category(client, platform_token, "waive-cat", 800)
    created = await client.post(
        "/api/v1/platform/tenants",
        headers=bearer(platform_token),
        json={
            "name": "买断测试站",
            "slug": "buyout-market",
            "email": "owner-buyout@example.com",
            "nickname": "站长",
            "password": "Buyout@123456",
            "service_category_id": category_id,
        },
    )
    assert created.status_code == 200, created.text
    tenant_id = created.json()["data"]["id"]

    report = (await client.get(REPORT, headers=bearer(platform_token))).json()["data"]
    row = next(item for item in report["rows"] if item["tenant_id"] == tenant_id)
    assert row["plan_period"] == "lifetime", "新租户默认买断"
    assert row["waived"] is True
    assert row["rate_bps"] == 0
    assert row["commission_cents"] == 0


async def test_bad_month_is_rejected(client, platform_token):
    response = await client.get(
        REPORT, headers=bearer(platform_token), params={"month": "2026-13-01"}
    )
    assert response.status_code == 400, response.text
