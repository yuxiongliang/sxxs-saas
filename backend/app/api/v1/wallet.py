"""钱包接口：本人钱包 / 充值 / 提现；租户运营的资金审核。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_context, get_db, require_permission
from app.core.response import ok
from app.schemas.commerce import (
    WalletRechargeRequest,
    WalletWithdrawRequest,
    WalletWithdrawReviewRequest,
)
from app.services import wallet as wallet_service
from app.services.auth import AuthContext

router = APIRouter(prefix="/wallet", tags=["钱包"])


@router.get("")
async def my_wallet(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return ok(await wallet_service.wallet_overview(db, context))


@router.post("/recharge")
async def recharge(
    payload: WalletRechargeRequest,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """模拟充值。真实接微信/支付宝时，这里换成"创建支付单 + 回调入账"。"""
    result = await wallet_service.recharge(
        db, context, payload.amount_cents, payload.client_txn_id
    )
    return ok(result, "充值成功")


@router.post("/withdrawals")
async def request_withdrawal(
    payload: WalletWithdrawRequest,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    withdrawal = await wallet_service.request_withdrawal(
        db,
        context,
        payload.amount_cents,
        payload.method,
        payload.account_name,
        payload.account_no,
    )
    return ok({"id": withdrawal.id, "status": withdrawal.status}, "提现申请已提交")


# ---------------- 租户运营：资金审核 ----------------
admin_router = APIRouter(prefix="/admin/finance", tags=["资金审核"])


@admin_router.get("/withdrawals")
async def list_withdrawals(
    status: str | None = Query(default=None, max_length=16),
    context: AuthContext = Depends(require_permission("payout:read")),
    db: AsyncSession = Depends(get_db),
):
    """本租户所有提现申请（用户ID + 用户名口径）。"""
    return ok(await wallet_service.list_withdrawals(db, context, status))


@admin_router.post("/withdrawals/{withdrawal_id}/review")
async def review_withdrawal(
    withdrawal_id: int,
    payload: WalletWithdrawReviewRequest,
    context: AuthContext = Depends(require_permission("payout:manage")),
    db: AsyncSession = Depends(get_db),
):
    withdrawal = await wallet_service.review_withdrawal(
        db, context, withdrawal_id, payload.approve, payload.note
    )
    return ok(
        {"id": withdrawal.id, "status": withdrawal.status},
        "已打款" if payload.approve else "已驳回",
    )
