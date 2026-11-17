"""钱包：账户、流水、余额支付、退款入账、货款划转、提现。

三条必须守住的不变量：

1. **钱只有一份**：货款划转进钱包时同时写一条负数 seller ledger（`wallet_transfer`），
   于是 `卖家可提现(Payout) + 钱包余额 == 货款总额`。否则同一笔货款能被提两次。
2. **余额只能由流水驱动**：任何入账/出账都走 `_apply()`，账本与缓存值同事务更新。
3. **幂等**：`wallet_transactions` 上 `(type, ref_type, ref_id)` 唯一 ——
   支付回调重试、定时任务重跑、退款补记都不会记两次。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import LedgerEntry
from app.models.order import Order, SellerOrder
from app.models.user import User
from app.models.wallet import WalletAccount, WalletTransaction, WalletWithdrawal
from app.services import audit as audit_service
from app.services.auth import AuthContext

TX_RECHARGE = "recharge"
TX_PAY = "pay"
TX_REFUND = "refund"
TX_TRANSFER_IN = "transfer_in"
TX_WITHDRAW = "withdraw"
TX_WITHDRAW_REJECT = "withdraw_reject"

LEDGER_WALLET_TRANSFER = "wallet_transfer"

WITHDRAWAL_METHODS = ("alipay", "wechat", "bank")


async def get_or_create_account(
    db: AsyncSession, tenant_id: int, user_id: int
) -> WalletAccount:
    """懒创建：迁移不批量灌账户（少一次全表操作，且只给真正用的人建）。"""
    account = (
        await db.scalars(
            select(WalletAccount).where(
                WalletAccount.tenant_id == tenant_id, WalletAccount.user_id == user_id
            )
        )
    ).first()
    if account is not None:
        return account
    account = WalletAccount(tenant_id=tenant_id, user_id=user_id)
    db.add(account)
    try:
        await db.flush()
    except IntegrityError:
        # 并发首建：另一个请求刚建好，回读即可
        await db.rollback()
        account = (
            await db.scalars(
                select(WalletAccount).where(
                    WalletAccount.tenant_id == tenant_id,
                    WalletAccount.user_id == user_id,
                )
            )
        ).first()
        assert account is not None
    return account


async def _locked_account(db: AsyncSession, account_id: int) -> WalletAccount:
    """行锁：并发下单/提现不能同时扣同一份余额。"""
    account = (
        await db.scalars(
            select(WalletAccount)
            .where(WalletAccount.id == account_id)
            .with_for_update()
        )
    ).first()
    if account is None:
        raise HTTPException(status_code=404, detail="钱包账户不存在")
    return account


async def _apply(
    db: AsyncSession,
    account: WalletAccount,
    *,
    tx_type: str,
    amount_cents: int,
    ref_type: str,
    ref_id: int,
    remark: str | None = None,
    idempotency_key: str | None = None,
) -> WalletTransaction | None:
    """记一笔流水并同步余额。已存在同一笔时返回 None（幂等）。"""
    if idempotency_key:
        existing = (
            await db.scalars(
                select(WalletTransaction).where(
                    WalletTransaction.idempotency_key == idempotency_key
                )
            )
        ).first()
    else:
        existing = (
            await db.scalars(
                select(WalletTransaction).where(
                    WalletTransaction.type == tx_type,
                    WalletTransaction.ref_type == ref_type,
                    WalletTransaction.ref_id == ref_id,
                )
            )
        ).first()
    if existing is not None:
        return None
    new_balance = account.balance_cents + amount_cents
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="钱包余额不足")
    account.balance_cents = new_balance
    tx = WalletTransaction(
        tenant_id=account.tenant_id,
        account_id=account.id,
        type=tx_type,
        amount_cents=amount_cents,
        balance_after=new_balance,
        ref_type=ref_type,
        ref_id=ref_id,
        remark=remark,
        idempotency_key=idempotency_key,
    )
    db.add(tx)
    await db.flush()
    return tx


# ---------------------------------------------------------------- 查询


async def wallet_overview(db: AsyncSession, context: AuthContext) -> dict:
    account = await get_or_create_account(db, context.tenant.id, context.user.id)
    txs = list(
        (
            await db.scalars(
                select(WalletTransaction)
                .where(WalletTransaction.account_id == account.id)
                .order_by(WalletTransaction.id.desc())
                .limit(100)
            )
        ).all()
    )
    withdrawals = list(
        (
            await db.scalars(
                select(WalletWithdrawal)
                .where(WalletWithdrawal.account_id == account.id)
                .order_by(WalletWithdrawal.id.desc())
                .limit(50)
            )
        ).all()
    )
    return {
        "account_id": account.id,
        "balance_cents": account.balance_cents,
        "frozen_cents": account.frozen_cents,
        "available_cents": max(0, account.balance_cents - account.frozen_cents),
        "transactions": [
            {
                "id": item.id,
                "type": item.type,
                "amount_cents": item.amount_cents,
                "balance_after": item.balance_after,
                "remark": item.remark,
                "created_at": item.created_at.isoformat() if item.created_at else None,
            }
            for item in txs
        ],
        "withdrawals": [
            {
                "id": item.id,
                "amount_cents": item.amount_cents,
                "method": item.method,
                "account_name": item.account_name,
                "account_no": item.account_no,
                "status": item.status,
                "note": item.note,
                "created_at": item.created_at.isoformat() if item.created_at else None,
            }
            for item in withdrawals
        ],
    }


# ---------------------------------------------------------------- 充值 / 支付 / 退款


async def recharge(
    db: AsyncSession, context: AuthContext, amount_cents: int, client_txn_id: str
) -> dict:
    """模拟充值：真实接微信/支付宝时这里是回调入口，接口形状不变。"""
    if amount_cents <= 0:
        raise HTTPException(status_code=400, detail="充值金额必须大于 0")
    account = await _locked_account(
        db, (await get_or_create_account(db, context.tenant.id, context.user.id)).id
    )
    tx = await _apply(
        db,
        account,
        tx_type=TX_RECHARGE,
        amount_cents=amount_cents,
        ref_type="recharge",
        ref_id=0,
        remark=f"模拟充值 {client_txn_id}",
        idempotency_key=f"recharge:{client_txn_id}",
    )
    if tx is None:
        return {"balance_cents": account.balance_cents, "duplicated": True}
    await audit_service.record(
        db,
        action=audit_service.ACTION_WALLET_RECHARGE,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="wallet",
        target_id=account.id,
        after={"amount_cents": amount_cents, "balance_cents": account.balance_cents},
    )
    await db.commit()
    return {"balance_cents": account.balance_cents, "duplicated": False}


async def pay_order_with_wallet(
    db: AsyncSession, context: AuthContext, order_id: int
) -> Order:
    """余额支付：即时成功，不需要回调。重复调用返回当前订单（幂等）。"""
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != context.tenant.id or order.buyer_id != context.user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    if order.payment_status == "paid":
        return order
    if order.payment_status != "unpaid":
        raise HTTPException(status_code=400, detail="当前订单状态不可支付")

    account = await get_or_create_account(db, context.tenant.id, context.user.id)
    account = await _locked_account(db, account.id)
    available = account.balance_cents - account.frozen_cents
    if available < order.payable_amount_cents:
        raise HTTPException(
            status_code=400,
            detail=f"钱包可用余额不足（可用 {available / 100:.2f} 元）",
        )
    tx = await _apply(
        db,
        account,
        tx_type=TX_PAY,
        amount_cents=-order.payable_amount_cents,
        ref_type="order",
        ref_id=order.id,
        remark=f"余额支付订单 {order.order_no}",
    )
    if tx is None:
        return order

    # 复用与模拟支付同一段状态机（订单/卖家单/库存/台账/Payment）
    from app.services import order as order_service

    order = await order_service.mark_order_paid(
        db, context, order, provider="wallet", commit=False
    )
    await audit_service.record(
        db,
        action=audit_service.ACTION_WALLET_PAY,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="order",
        target_id=order.id,
        after={
            "amount_cents": order.payable_amount_cents,
            "provider": "wallet",
            "order_no": order.order_no,
        },
    )
    await db.commit()
    await db.refresh(order)
    return order


async def credit_refund(
    db: AsyncSession,
    *,
    tenant_id: int,
    buyer_id: int,
    refund_id: int,
    amount_cents: int,
    provider: str | None,
) -> None:
    """退款退回买家钱包余额（产品口径）。

    不 commit：由调用方（退款流程）在同一事务里提交，保证"订单退款"与"钱包入账"要么都成、要么都不成。
    """
    account = await get_or_create_account(db, tenant_id, buyer_id)
    account = await _locked_account(db, account.id)
    await _apply(
        db,
        account,
        tx_type=TX_REFUND,
        amount_cents=amount_cents,
        ref_type="refund",
        ref_id=refund_id,
        remark=f"订单退款入账（原支付渠道 {provider or 'unknown'}）",
    )


# ---------------------------------------------------------------- 货款划转进钱包


async def transfer_seller_earnings(
    db: AsyncSession, tenant_id: int, seller_order_id: int
) -> bool:
    """账期到期：把该卖家单的货款划进卖家的钱包。

    同时写一条负数 seller ledger（`wallet_transfer`）—— 这是防"双重提现"的关键：
    货款进了钱包，Payout 的可提现金额同步减少，同一笔钱只存在一处。
    """
    seller_order = await db.get(SellerOrder, seller_order_id)
    if seller_order is None or seller_order.tenant_id != tenant_id:
        return False
    if seller_order.fulfillment_status != "completed":
        return False
    # 已退款/部分退款的不划转
    if seller_order.payment_status in ("refunded", "refunding"):
        return False

    from app.models.seller import Seller

    seller = await db.get(Seller, seller_order.seller_id)
    if seller is None:
        return False

    account = await get_or_create_account(db, tenant_id, seller.owner_user_id)
    account = await _locked_account(db, account.id)
    amount = seller_order.payable_to_seller_cents
    if amount <= 0:
        return False

    tx = await _apply(
        db,
        account,
        tx_type=TX_TRANSFER_IN,
        amount_cents=amount,
        ref_type="seller_order",
        ref_id=seller_order.id,
        remark=f"货款自动结算（{seller_order.seller_order_no}）",
    )
    if tx is None:
        return False

    db.add(
        LedgerEntry(
            tenant_id=tenant_id,
            seller_id=seller_order.seller_id,
            order_id=seller_order.order_id,
            seller_order_id=seller_order.id,
            type=LEDGER_WALLET_TRANSFER,
            amount_cents=-amount,
            idempotency_key=f"wallet_transfer:{seller_order.id}",
        )
    )
    await audit_service.record(
        db,
        action=audit_service.ACTION_WALLET_TRANSFER,
        tenant_id=tenant_id,
        actor_id=None,
        target_type="seller_order",
        target_id=seller_order.id,
        after={"amount_cents": amount, "account_id": account.id},
    )
    await db.commit()
    return True


# ---------------------------------------------------------------- 提现


async def request_withdrawal(
    db: AsyncSession,
    context: AuthContext,
    amount_cents: int,
    method: str,
    account_name: str,
    account_no: str,
) -> WalletWithdrawal:
    if amount_cents <= 0:
        raise HTTPException(status_code=400, detail="提现金额必须大于 0")
    if method not in WITHDRAWAL_METHODS:
        raise HTTPException(status_code=400, detail="不支持的收款方式")
    if not account_name.strip() or not account_no.strip():
        raise HTTPException(status_code=400, detail="请填写收款人与收款账号")

    account = await get_or_create_account(db, context.tenant.id, context.user.id)
    account = await _locked_account(db, account.id)
    available = account.balance_cents - account.frozen_cents
    if amount_cents > available:
        raise HTTPException(
            status_code=400, detail=f"可提现余额不足（可用 {available / 100:.2f} 元）"
        )
    # 冻结：申请后这笔钱不能再花，否则审核通过时余额不够
    account.frozen_cents += amount_cents
    withdrawal = WalletWithdrawal(
        tenant_id=context.tenant.id,
        account_id=account.id,
        user_id=context.user.id,
        amount_cents=amount_cents,
        method=method,
        account_name=account_name.strip(),
        account_no=account_no.strip(),
        status="pending",
    )
    db.add(withdrawal)
    await db.flush()
    await audit_service.record(
        db,
        action=audit_service.ACTION_WALLET_WITHDRAW_REQUEST,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="wallet_withdrawal",
        target_id=withdrawal.id,
        after={"amount_cents": amount_cents, "method": method},
    )
    await db.commit()
    await db.refresh(withdrawal)
    return withdrawal


async def review_withdrawal(
    db: AsyncSession, context: AuthContext, withdrawal_id: int, approve: bool, note: str
) -> WalletWithdrawal:
    """租户运营审核提现：通过即扣冻结额并记流水；驳回只解冻。"""
    withdrawal = await db.get(WalletWithdrawal, withdrawal_id)
    if withdrawal is None or withdrawal.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="提现申请不存在")
    if withdrawal.status != "pending":
        raise HTTPException(status_code=400, detail="该申请已处理")

    account = await _locked_account(db, withdrawal.account_id)
    if approve:
        withdrawal.status = "paid"
        withdrawal.paid_at = datetime.now(UTC)
        account.frozen_cents = max(0, account.frozen_cents - withdrawal.amount_cents)
        await _apply(
            db,
            account,
            tx_type=TX_WITHDRAW,
            amount_cents=-withdrawal.amount_cents,
            ref_type="withdrawal",
            ref_id=withdrawal.id,
            remark=f"提现打款（{withdrawal.method}）",
        )
    else:
        withdrawal.status = "rejected"
        account.frozen_cents = max(0, account.frozen_cents - withdrawal.amount_cents)
    withdrawal.note = note or withdrawal.note
    withdrawal.reviewed_by = context.user.id
    withdrawal.reviewed_at = datetime.now(UTC)
    await audit_service.record(
        db,
        action=audit_service.ACTION_WALLET_WITHDRAW_REVIEW,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="wallet_withdrawal",
        target_id=withdrawal.id,
        after={
            "approve": str(approve),
            "amount_cents": withdrawal.amount_cents,
            "note": note,
        },
    )
    await db.commit()
    await db.refresh(withdrawal)
    return withdrawal


async def list_withdrawals(
    db: AsyncSession, context: AuthContext, status: str | None = None
) -> list[dict]:
    """租户运营视角：本租户所有提现申请（含申请人身份：用户ID + 用户名）。"""
    stmt = select(WalletWithdrawal).where(
        WalletWithdrawal.tenant_id == context.tenant.id
    )
    if status:
        stmt = stmt.where(WalletWithdrawal.status == status)
    rows = list(
        (await db.scalars(stmt.order_by(WalletWithdrawal.id.desc()).limit(200))).all()
    )
    users = {
        user.id: user
        for user in (
            await db.scalars(
                select(User).where(User.id.in_({row.user_id for row in rows}))
            )
        ).all()
    } if rows else {}
    return [
        {
            "id": row.id,
            "user_id": row.user_id,
            "user_public_id": users.get(row.user_id).public_id
            if users.get(row.user_id)
            else None,
            "user_username": users.get(row.user_id).username
            if users.get(row.user_id)
            else None,
            "amount_cents": row.amount_cents,
            "method": row.method,
            "account_name": row.account_name,
            "account_no": row.account_no,
            "status": row.status,
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]
