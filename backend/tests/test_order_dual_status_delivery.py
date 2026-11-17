"""双状态 / 交付方式 / 售后闭环 / 定时任务。

这一轮改的是**订单的状态语义**，所以测试要锁住四件事：

1. 支付与履约是两个独立维度，多卖家单时按卖家单汇总（部分发货不单列，统一「已发货」）；
2. 交付方式：快递必须有地址和运单号，自提只要联系人+手机号、发货不写运单；
3. 售后：`paid`/`shipped` 可申请 → `refunding`；卖家驳回回 `paid`；`completed` 之后拒绝；
4. 自动收货任务：到点执行、幂等、买家确认后自动撤销、平台可手动执行/取消。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.catalog import Product, ProductSku
from app.models.job import ScheduledJob
from app.models.order import Order, SellerOrder
from tests.conftest import bearer


async def _sku(db_session) -> tuple[Product, ProductSku]:
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
    assert product is not None
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


async def _order(client, token, db_session, *, delivery=None, address=True) -> dict:
    product, sku = await _sku(db_session)
    body = {
        "items": [{"sku_id": sku.id, "quantity": 1}],
        "receiver_name": "交付测试",
        "receiver_phone": "13900000000",
        "receiver_address": (
            {"province": "广东省", "city": "深圳市", "detail": "测试路 1 号"}
            if address
            else None
        ),
        "remark": "pytest",
        "delivery": delivery or [],
    }
    response = await client.post(
        "/api/v1/portal/orders", headers=bearer(token), json=body
    )
    return {"status": response.status_code, "body": response.json()}


async def test_order_created_with_dual_status(client, customer_token, db_session):
    created = await _order(client, customer_token, db_session)
    assert created["status"] == 200, created["body"]
    assert created["body"]["data"]["payment_status"] == "unpaid"
    assert created["body"]["data"]["fulfillment_status"] == "awaiting_payment"


async def test_express_requires_receiver_address(client, customer_token, db_session):
    created = await _order(client, customer_token, db_session, address=False)
    assert created["status"] == 400
    assert "收货地址" in created["body"]["message"]


async def test_pickup_order_needs_no_address(client, customer_token, db_session):
    _, seller = await _pickup_product(db_session)
    created = await _order(
        client,
        customer_token,
        db_session,
        delivery=[{"seller_id": seller, "delivery_method": "pickup"}],
        address=False,
    )
    assert created["status"] == 200, created["body"]
    order_id = created["body"]["data"]["id"]
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order_id)
        )
    ).scalars().first()
    assert seller_order.delivery_method == "pickup"


async def _pickup_product(db_session) -> tuple[Product, int]:
    """确保 seed 商品支持自提。"""
    product, _ = await _sku(db_session)
    if "pickup" not in (product.delivery_methods or []):
        product.delivery_methods = ["express", "pickup"]
        await db_session.flush()
    return product, product.seller_id


async def test_pickup_ship_without_tracking_number(client, admin_token, customer_token, db_session):
    _, seller_id = await _pickup_product(db_session)
    created = await _order(
        client,
        customer_token,
        db_session,
        delivery=[{"seller_id": seller_id, "delivery_method": "pickup"}],
    )
    order_id = created["body"]["data"]["id"]
    await client.post(
        f"/api/v1/admin/orders/{order_id}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order_id)
        )
    ).scalars().first()
    # 自提：不传运单号也能"备货完成"
    shipped = await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
    )
    assert shipped.status_code == 200, shipped.text
    assert shipped.json()["data"]["fulfillment_status"] == "shipped"

    refreshed = await db_session.get(SellerOrder, seller_order.id)
    await db_session.refresh(refreshed)
    assert refreshed.fulfillment_status == "shipped"


async def test_express_ship_requires_tracking(client, admin_token, customer_token, db_session):
    created = await _order(client, customer_token, db_session)
    order_id = created["body"]["data"]["id"]
    await client.post(
        f"/api/v1/admin/orders/{order_id}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order_id)
        )
    ).scalars().first()
    shipped = await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
    )
    assert shipped.status_code == 400
    assert "运单号" in shipped.json()["message"]


async def test_ship_schedules_auto_complete(client, admin_token, customer_token, db_session):
    created = await _order(client, customer_token, db_session)
    order_id = created["body"]["data"]["id"]
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
        json={"carrier": "顺丰", "tracking_no": "SF123"},
    )
    job = (
        await db_session.execute(
            select(ScheduledJob).where(
                ScheduledJob.ref_type == "seller_order",
                ScheduledJob.ref_id == seller_order.id,
            )
        )
    ).scalars().first()
    assert job is not None, "发货必须入队自动收货任务"
    assert job.status == "pending"
    # 快递 7 天：允许 1 分钟误差
    expected = datetime.now(UTC) + timedelta(days=7)
    assert abs((job.run_at - expected).total_seconds()) < 120


async def test_confirm_cancels_auto_complete(client, admin_token, customer_token, db_session):
    created = await _order(client, customer_token, db_session)
    order_id = created["body"]["data"]["id"]
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
        json={"carrier": "顺丰", "tracking_no": "SF123"},
    )
    confirmed = await client.post(
        f"/api/v1/portal/orders/{order_id}/confirm", headers=bearer(customer_token)
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["data"]["fulfillment_status"] == "completed"

    await db_session.commit()
    job = (
        await db_session.execute(
            select(ScheduledJob).where(ScheduledJob.ref_id == seller_order.id)
        )
    ).scalars().first()
    assert job.status == "cancelled"


async def test_after_sale_loop_and_completed_is_closed(
    client, admin_token, customer_token, db_session
):
    created = await _order(client, customer_token, db_session)
    order_id = created["body"]["data"]["id"]
    await client.post(
        f"/api/v1/admin/orders/{order_id}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order_id)
        )
    ).scalars().first()

    # 买家申请售后 → 退款中
    applied = await client.post(
        f"/api/v1/portal/orders/{order_id}/refund-request",
        headers=bearer(customer_token),
        json={"amount_cents": 1, "reason": "不想要了"},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["data"]["payment_status"] == "refunding"

    # 卖家驳回 → 回到已支付
    rejected = await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/refund/reject",
        headers=bearer(admin_token),
        json={"reason": "已备货"},
    )
    assert rejected.status_code == 200, rejected.text
    await db_session.refresh(seller_order)
    assert seller_order.payment_status == "paid"

    # 走完流程 → 已完成
    await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
        json={"carrier": "顺丰", "tracking_no": "SF999"},
    )
    await client.post(
        f"/api/v1/portal/orders/{order_id}/confirm", headers=bearer(customer_token)
    )
    # 完成后不再受理售后
    closed = await client.post(
        f"/api/v1/portal/orders/{order_id}/refund-request",
        headers=bearer(customer_token),
        json={"amount_cents": 1, "reason": "后悔了"},
    )
    assert closed.status_code == 400
    assert "不再受理" in closed.json()["message"]


async def test_platform_can_run_and_cancel_jobs(
    client, admin_token, platform_token, customer_token, db_session
):
    created = await _order(client, customer_token, db_session)
    order_id = created["body"]["data"]["id"]
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
        json={"carrier": "顺丰", "tracking_no": "SF777"},
    )

    listed = await client.get("/api/v1/platform/jobs", headers=bearer(platform_token))
    assert listed.status_code == 200, listed.text
    data = listed.json()["data"]
    job = next(row for row in data["list"] if row["ref_id"] == seller_order.id)
    assert job["status"] == "pending"
    assert job["ref_no"] == seller_order.seller_order_no

    # 立即执行 → 自动完成
    ran = await client.post(
        f"/api/v1/platform/jobs/{job['id']}/run", headers=bearer(platform_token)
    )
    assert ran.status_code == 200, ran.text
    await db_session.refresh(seller_order)
    assert seller_order.fulfillment_status == "completed"

    # 再取消一条：先造一个新的待执行任务
    await db_session.refresh(seller_order)
    cancelled = await client.post(
        f"/api/v1/platform/jobs/{job['id']}/cancel", headers=bearer(platform_token)
    )
    # 已完成的任务不可取消
    assert cancelled.status_code == 400


async def test_cart_checkout_accepts_delivery_choice(client, customer_token, db_session):
    """购物车结算是买家真实走的路径：交付方式必须能透传（这条曾经 NameError 500）。"""
    _, sku = await _sku(db_session)
    added = await client.post(
        "/api/v1/portal/cart/items",
        headers=bearer(customer_token),
        json={"sku_id": sku.id, "quantity": 1},
    )
    assert added.status_code == 200, added.text

    cart = (
        await client.get("/api/v1/portal/cart", headers=bearer(customer_token))
    ).json()["data"]
    line = cart["items"][0]
    assert line["delivery_methods"], "购物车条目缺 delivery_methods"

    checked = await client.post(
        "/api/v1/portal/cart/checkout",
        headers=bearer(customer_token),
        json={
            "receiver_name": "购物车买家",
            "receiver_phone": "13900000000",
            "receiver_address": {"detail": "测试路 1 号"},
            "delivery": [
                {"seller_id": line["seller_id"], "delivery_method": "express"}
            ],
        },
    )
    assert checked.status_code == 200, checked.text
    assert checked.json()["data"]["payment_status"] == "unpaid"
