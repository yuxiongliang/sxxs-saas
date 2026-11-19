"""时间控制：订单链路上「等多久自动做什么」的可配置口径。

守的契约（这几条任何一条破了都会直接坑到钱或货）：

1. 配置要能校验：负数/超 365 天/未知字段必须拒绝，否则建单时才炸；
2. `unpaid_close_days` > 0 时：下单落 `expires_at` + 排 `close_unpaid`；
   支付成功必须撤销该任务，**到点不能把已付款订单关掉**；
3. 自动确认收货天数读租户配置（快递 / 自提各一个），0 = 不自动确认；
4. 售后窗口：`completed` 订单在窗口内可申请，过期拒绝；
5. 租户选「跟随系统」时用平台默认值；
6. 改配置**只影响之后新排的任务**（历史任务用入队时的快照）。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.job import ScheduledJob
from app.models.order import Order, SellerOrder
from tests.conftest import bearer

PHYSICAL = "physical"


async def _save_time_control(client, admin_token, config: dict, source="override"):
    return await client.put(
        "/api/v1/settings/time_control",
        headers=bearer(admin_token),
        json={"source": source, "enabled": True, "config": {PHYSICAL: config}},
    )


async def _order(client, customer_token, db_session) -> dict:
    from tests.test_order_dual_status_delivery import _sku

    _product, sku = await _sku(db_session)
    response = await client.post(
        "/api/v1/portal/orders",
        headers=bearer(customer_token),
        json={
            "items": [{"sku_id": sku.id, "quantity": 1}],
            "receiver_name": "时间控制",
            "receiver_phone": "13900000001",
            "receiver_address": {"detail": "测试路 2 号"},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


# ---------- 1. 配置校验 ----------


@pytest.mark.parametrize(
    ("config", "keyword"),
    [
        ({"unpaid_close_days": -1}, "0-365"),
        ({"unpaid_close_days": 400}, "0-365"),
        ({"ship_days": "三天"}, "整数"),
        ({"unknown_field": 3}, "未知的时间控制字段"),
    ],
)
async def test_time_control_rejects_bad_values(client, admin_token, config, keyword):
    response = await _save_time_control(client, admin_token, config)
    assert response.status_code == 400, response.text
    assert keyword in response.text


async def test_time_control_rejects_unknown_product_type(client, admin_token):
    response = await client.put(
        "/api/v1/settings/time_control",
        headers=bearer(admin_token),
        json={"source": "override", "enabled": True, "config": {"virtual": {"ship_days": 1}}},
    )
    assert response.status_code == 400
    assert "未知的商品类型" in response.text


async def test_time_control_saves_and_audits(client, admin_token):
    response = await _save_time_control(
        client, admin_token, {"unpaid_close_days": 2, "auto_confirm_days": 5}
    )
    assert response.status_code == 200, response.text
    config = response.json()["data"]["config"][PHYSICAL]
    assert config["unpaid_close_days"] == 2
    assert config["auto_confirm_days"] == 5
    # 没传的字段回落默认（7 天快递 / 90 天自提）
    assert config["pickup_auto_confirm_days"] == 90

    logs = await client.get(
        "/api/v1/audit-logs",
        headers=bearer(admin_token),
        params={"action": "setting.updated", "target_type": "setting"},
    )
    assert logs.status_code == 200, logs.text
    assert logs.json()["data"]["list"], "改自动行为必须留审计"


# ---------- 2. 待支付自动关闭 ----------


async def test_unpaid_order_schedules_close_job(client, admin_token, customer_token, db_session):
    await _save_time_control(client, admin_token, {"unpaid_close_days": 1})
    order = await _order(client, customer_token, db_session)

    row = await db_session.get(Order, order["id"])
    await db_session.refresh(row)
    assert row.expires_at is not None

    job = (
        await db_session.execute(
            select(ScheduledJob).where(
                ScheduledJob.kind == "close_unpaid",
                ScheduledJob.ref_id == order["id"],
            )
        )
    ).scalars().first()
    assert job is not None
    assert job.meta == {"rule": "unpaid_close", "days": 1}


async def test_paid_order_cancels_close_job(client, admin_token, customer_token, db_session):
    await _save_time_control(client, admin_token, {"unpaid_close_days": 1})
    order = await _order(client, customer_token, db_session)
    await client.post(
        f"/api/v1/admin/orders/{order['id']}/mock-pay", headers=bearer(admin_token)
    )
    # 撤销是在 mark_paid 里做的，触发一次查询让会话拿到最新状态
    job = (
        await db_session.execute(
            select(ScheduledJob).where(
                ScheduledJob.kind == "close_unpaid",
                ScheduledJob.ref_id == order["id"],
            )
        )
    ).scalars().first()
    await db_session.refresh(job)
    assert job.status == "cancelled"


async def test_close_unpaid_releases_stock(client, admin_token, customer_token, db_session):
    from app.models.catalog import ProductSku

    from tests.test_order_dual_status_delivery import _sku

    await _save_time_control(client, admin_token, {"unpaid_close_days": 1})
    order = await _order(client, customer_token, db_session)
    _product, sku_row = await _sku(db_session)
    sku_id = sku_row.id
    sku = await db_session.get(ProductSku, sku_id)
    await db_session.refresh(sku)
    locked_before = sku.locked_stock

    # 直接跑 handler（等价于到点执行）
    from app.worker.handlers import close_unpaid

    job = (
        await db_session.execute(
            select(ScheduledJob).where(
                ScheduledJob.kind == "close_unpaid",
                ScheduledJob.ref_id == order["id"],
            )
        )
    ).scalars().first()
    note = await close_unpaid(db_session, job)
    assert note == "closed"

    detail = await client.get(
        f"/api/v1/portal/orders/{order['id']}", headers=bearer(customer_token)
    )
    assert detail.status_code == 200
    assert detail.json()["data"]["payment_status"] == "cancelled"
    await db_session.refresh(sku)
    assert sku.locked_stock == max(0, locked_before - 1)


# ---------- 3. 自动确认收货读租户配置 ----------


async def test_auto_confirm_uses_tenant_days(client, admin_token, customer_token, db_session):
    await _save_time_control(client, admin_token, {"auto_confirm_days": 3})
    order = await _order(client, customer_token, db_session)
    await client.post(
        f"/api/v1/admin/orders/{order['id']}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order["id"])
        )
    ).scalars().first()
    await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
        json={"carrier": "顺丰", "tracking_no": "SF-TC-1"},
    )

    job = (
        await db_session.execute(
            select(ScheduledJob).where(
                ScheduledJob.kind == "auto_complete",
                ScheduledJob.ref_id == seller_order.id,
            )
        )
    ).scalars().first()
    await db_session.refresh(job)
    await db_session.refresh(seller_order)
    assert job.meta["days"] == 3
    assert abs((job.run_at - seller_order.shipped_at).days - 3) <= 1


def test_pickup_uses_its_own_auto_confirm_days():
    """自提没有物流签收，自动确认天数必须能和快递分开配（否则只剩 7 天没人取货）。"""
    from datetime import UTC, datetime

    from app.services.time_control import TimeControl, auto_confirm_deadline

    control = TimeControl(auto_confirm_days=3, pickup_auto_confirm_days=30)
    shipped = datetime(2026, 1, 1, tzinfo=UTC)
    assert control.auto_confirm_days_for("pickup") == 30
    assert control.auto_confirm_days_for("express") == 3
    assert auto_confirm_deadline(control, shipped, "pickup").day == 31
    assert auto_confirm_deadline(control, shipped, "express").day == 4
    # 0 天 = 不自动确认，不排任务
    assert control.auto_confirm_days_for("express") > 0
    assert auto_confirm_deadline(TimeControl(auto_confirm_days=0), shipped, "express") is None


# ---------- 4. 售后窗口 ----------


async def test_refund_allowed_within_window_after_completion(
    client, admin_token, customer_token, db_session
):
    await _save_time_control(client, admin_token, {"refund_window_days": 7})
    order = await _order(client, customer_token, db_session)
    await client.post(
        f"/api/v1/admin/orders/{order['id']}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order["id"])
        )
    ).scalars().first()
    await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
        json={"carrier": "顺丰", "tracking_no": "SF-TC-2"},
    )
    await client.post(
        f"/api/v1/portal/orders/{order['id']}/confirm", headers=bearer(customer_token)
    )

    applied = await client.post(
        f"/api/v1/portal/orders/{order['id']}/refund-request",
        headers=bearer(customer_token),
        json={"amount_cents": 1, "reason": "确认收货后发现瑕疵"},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["data"]["payment_status"] == "refunding"


async def test_refund_rejected_after_window(client, admin_token, customer_token, db_session):
    await _save_time_control(client, admin_token, {"refund_window_days": 1})
    order = await _order(client, customer_token, db_session)
    await client.post(
        f"/api/v1/admin/orders/{order['id']}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == order["id"])
        )
    ).scalars().first()
    await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
        json={"carrier": "顺丰", "tracking_no": "SF-TC-3"},
    )
    await client.post(
        f"/api/v1/portal/orders/{order['id']}/confirm", headers=bearer(customer_token)
    )

    # 把完成时间挪到窗口之外
    row = await db_session.get(Order, order["id"])
    row.completed_at = datetime.now(UTC) - timedelta(days=3)
    await db_session.commit()

    rejected = await client.post(
        f"/api/v1/portal/orders/{order['id']}/refund-request",
        headers=bearer(customer_token),
        json={"amount_cents": 1, "reason": "来晚了"},
    )
    assert rejected.status_code == 400
    assert "已超过售后期限" in rejected.text


# ---------- 5. 平台默认值 + 跟随系统 ----------


async def test_inherit_uses_platform_default(client, admin_token, platform_token):
    platform = await client.put(
        "/api/v1/platform/settings/time_control",
        headers=bearer(platform_token),
        json={
            "enabled": True,
            "config": {"physical": {"unpaid_close_days": 5, "auto_confirm_days": 4}},
        },
    )
    assert platform.status_code == 200, platform.text

    inherit = await client.put(
        "/api/v1/settings/time_control",
        headers=bearer(admin_token),
        json={"source": "inherit", "enabled": True},
    )
    assert inherit.status_code == 200, inherit.text
    data = inherit.json()["data"]
    # 生效来源沿用既有枚举：平台接管时 effective_source = inherit
    assert data["effective_source"] == "inherit"
    assert data["platform_active"] is True
    assert data["config"][PHYSICAL]["unpaid_close_days"] == 5

    # 还原：平台关掉接管，避免影响其它用例
    await client.put(
        "/api/v1/platform/settings/time_control",
        headers=bearer(platform_token),
        json={"enabled": False, "config": {"physical": {}}},
    )
