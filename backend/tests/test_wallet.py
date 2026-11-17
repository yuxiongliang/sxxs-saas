"""钱包测试：充值 / 余额支付 / 退款入账 / 货款划转 / 提现 / 防双提。

三条必须守住的：
1. 钱只有一份：货款划进钱包后，Payout 可提现余额同步减少（防双提）
2. 余额只能由流水驱动，余额不足必须拒绝
3. 幂等：充值/支付/退款/划转重放都不会记两次
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.catalog import Product, ProductSku
from app.models.finance import LedgerEntry
from app.models.order import Order, SellerOrder
from app.models.wallet import WalletAccount, WalletTransaction
from app.services import finance as finance_service
from app.services import wallet as wallet_service
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


async def _place_order(client, token, db_session) -> dict:
    _, sku = await _sku(db_session)
    response = await client.post(
        "/api/v1/portal/orders",
        headers=bearer(token),
        json={
            "items": [{"sku_id": sku.id, "quantity": 1}],
            "receiver_name": "钱包买家",
            "receiver_phone": "13900000000",
            "receiver_address": {"detail": "测试路 1 号"},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _recharge(client, token, amount: int, key: str) -> dict:
    response = await client.post(
        "/api/v1/wallet/recharge",
        headers=bearer(token),
        json={"amount_cents": amount, "client_txn_id": key},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_recharge_is_idempotent(client, customer_token):
    first = await _recharge(client, customer_token, 50_000, "txn-1")
    second = await _recharge(client, customer_token, 50_000, "txn-1")
    assert first["balance_cents"] == 50_000
    # 同一个 client_txn_id 重试不能充两次
    assert second["balance_cents"] == 50_000
    assert second["duplicated"] is True


async def test_wallet_pay_deducts_and_marks_paid(
    client, customer_token, db_session
):
    await _recharge(client, customer_token, 100_000, "txn-pay")
    created = await _place_order(client, customer_token, db_session)
    paid = await client.post(
        f"/api/v1/portal/orders/{created['id']}/mock-pay",
        headers=bearer(customer_token),
        json={"method": "wallet"},
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["data"]["payment_status"] == "paid"

    wallet = (await client.get("/api/v1/wallet", headers=bearer(customer_token))).json()[
        "data"
    ]
    assert wallet["balance_cents"] == 100_000 - created["payable_amount_cents"]

    # 重放同一笔支付不能重复扣款
    replay = await client.post(
        f"/api/v1/portal/orders/{created['id']}/mock-pay",
        headers=bearer(customer_token),
        json={"method": "wallet"},
    )
    assert replay.status_code == 200
    after = (await client.get("/api/v1/wallet", headers=bearer(customer_token))).json()[
        "data"
    ]
    assert after["balance_cents"] == wallet["balance_cents"]


async def test_wallet_pay_rejects_insufficient_balance(
    client, customer_token, db_session
):
    created = await _place_order(client, customer_token, db_session)
    response = await client.post(
        f"/api/v1/portal/orders/{created['id']}/mock-pay",
        headers=bearer(customer_token),
        json={"method": "wallet"},
    )
    assert response.status_code == 400
    assert "余额不足" in response.json()["message"]


async def test_refund_credits_wallet(client, admin_token, customer_token, db_session):
    created = await _place_order(client, customer_token, db_session)
    await client.post(
        f"/api/v1/portal/orders/{created['id']}/mock-pay",
        headers=bearer(customer_token),
        json={"method": "wechat"},
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == created["id"])
        )
    ).scalars().first()
    refunded = await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/refund",
        headers=bearer(admin_token),
        json={"amount_cents": seller_order.goods_amount_cents, "reason": "退款"},
    )
    assert refunded.status_code == 200, refunded.text

    wallet = (
        await client.get("/api/v1/wallet", headers=bearer(customer_token))
    ).json()["data"]
    assert wallet["balance_cents"] == seller_order.goods_amount_cents
    types = [row["type"] for row in wallet["transactions"]]
    assert "refund" in types


async def test_earnings_transfer_and_no_double_withdrawal(
    client, admin_token, customer_token, operator_token, db_session
):
    """货款划进钱包后，卖家 Payout 的可提现余额必须同步减少（钱只有一份）。"""
    created = await _place_order(client, customer_token, db_session)
    await client.post(
        f"/api/v1/admin/orders/{created['id']}/mock-pay", headers=bearer(admin_token)
    )
    seller_order = (
        await db_session.execute(
            select(SellerOrder).where(SellerOrder.order_id == created["id"])
        )
    ).scalars().first()
    await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
        json={"carrier": "顺丰", "tracking_no": "SF-W1"},
    )
    await client.post(
        f"/api/v1/portal/orders/{created['id']}/confirm", headers=bearer(customer_token)
    )

    # 账期设为 0：可立即结算
    from app.models.tenant import Tenant

    tenant = await db_session.get(Tenant, 1)
    tenant.settlement_hold_days = 0
    await db_session.commit()

    ledger_before = (
        await client.get(
            f"/api/v1/admin/sellers/{seller_order.seller_id}/ledger",
            headers=bearer(admin_token),
        )
    ).json()["data"]
    assert ledger_before["available_cents"] > 0

    transferred = await wallet_service.transfer_seller_earnings(
        db_session, 1, seller_order.id
    )
    assert transferred is True

    ledger_after = (
        await client.get(
            f"/api/v1/admin/sellers/{seller_order.seller_id}/ledger",
            headers=bearer(admin_token),
        )
    ).json()["data"]
    # 划走了就不可再通过 payout 提现
    assert ledger_after["available_cents"] == 0

    entry = (
        await db_session.execute(
            select(LedgerEntry).where(
                LedgerEntry.idempotency_key == f"wallet_transfer:{seller_order.id}"
            )
        )
    ).scalars().first()
    assert entry is not None and entry.amount_cents < 0

    # 幂等：再划一次不会再入账
    assert await wallet_service.transfer_seller_earnings(
        db_session, 1, seller_order.id
    ) is False
    count = len(
        (
            await db_session.execute(
                select(WalletTransaction).where(
                    WalletTransaction.type == "transfer_in",
                    WalletTransaction.ref_id == seller_order.id,
                )
            )
        ).scalars().all()
    )
    assert count == 1


async def test_withdrawal_freeze_and_review(
    client, admin_token, customer_token
):
    await _recharge(client, customer_token, 30_000, "txn-w")
    applied = await client.post(
        "/api/v1/wallet/withdrawals",
        headers=bearer(customer_token),
        json={
            "amount_cents": 20_000,
            "method": "alipay",
            "account_name": "张三",
            "account_no": "zhangsan@example.com",
        },
    )
    assert applied.status_code == 200, applied.text
    withdrawal_id = applied.json()["data"]["id"]

    wallet = (
        await client.get("/api/v1/wallet", headers=bearer(customer_token))
    ).json()["data"]
    # 申请即冻结：余额还在，但可用额减少（否则申请完还能花掉）
    assert wallet["balance_cents"] == 30_000
    assert wallet["frozen_cents"] == 20_000
    assert wallet["available_cents"] == 10_000

    listed = await client.get(
        "/api/v1/admin/finance/withdrawals", headers=bearer(admin_token)
    )
    assert listed.status_code == 200, listed.text
    row = listed.json()["data"][0]
    assert row["user_public_id"], "资金审核要按 用户ID + 用户名 展示"

    reviewed = await client.post(
        f"/api/v1/admin/finance/withdrawals/{withdrawal_id}/review",
        headers=bearer(admin_token),
        json={"approve": True, "note": "已打款"},
    )
    assert reviewed.status_code == 200, reviewed.text

    final = (
        await client.get("/api/v1/wallet", headers=bearer(customer_token))
    ).json()["data"]
    assert final["balance_cents"] == 10_000
    assert final["frozen_cents"] == 0
