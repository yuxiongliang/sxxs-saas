"""Finance administration: commission rules, payout review, settlement batches."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_permission
from app.core.response import ok
from app.schemas.common import ApiResponse
from app.schemas.finance import (
    PayoutOut,
    PayoutRejectRequest,
    SettlementBatchCreate,
    SettlementBatchOut,
)
from app.services import finance as finance_service
from app.services.auth import AuthContext

router = APIRouter(prefix="/admin", tags=["财务中心"])


# --------------------------------------------------------------------------- #
# Payout review (提现审核)
# --------------------------------------------------------------------------- #


@router.get("/payouts", response_model=ApiResponse[list[PayoutOut]])
async def list_payouts(
    status: str | None = Query(default=None),
    context: AuthContext = Depends(require_permission("payout:read")),
    db: AsyncSession = Depends(get_db),
):
    payouts = await finance_service.list_payouts(db, context, status)
    return ok([PayoutOut.model_validate(item) for item in payouts])


@router.post("/payouts/{payout_id}/approve", response_model=ApiResponse[PayoutOut])
async def approve_payout(
    payout_id: int,
    context: AuthContext = Depends(require_permission("payout:manage")),
    db: AsyncSession = Depends(get_db),
):
    payout = await finance_service.review_payout(db, context, payout_id, "approve")
    return ok(PayoutOut.model_validate(payout), "提现已审核通过")


@router.post("/payouts/{payout_id}/reject", response_model=ApiResponse[PayoutOut])
async def reject_payout(
    payout_id: int,
    payload: PayoutRejectRequest,
    context: AuthContext = Depends(require_permission("payout:manage")),
    db: AsyncSession = Depends(get_db),
):
    payout = await finance_service.review_payout(
        db, context, payout_id, "reject", payload.reason
    )
    return ok(PayoutOut.model_validate(payout), "提现已驳回")


@router.post("/payouts/{payout_id}/pay", response_model=ApiResponse[PayoutOut])
async def pay_payout(
    payout_id: int,
    context: AuthContext = Depends(require_permission("payout:manage")),
    db: AsyncSession = Depends(get_db),
):
    payout = await finance_service.mark_payout_paid(db, context, payout_id)
    return ok(PayoutOut.model_validate(payout), "提现已打款")


# --------------------------------------------------------------------------- #
# Settlement batches (结算批次)
# --------------------------------------------------------------------------- #


@router.get("/settlement-batches", response_model=ApiResponse[list[SettlementBatchOut]])
async def list_settlement_batches(
    context: AuthContext = Depends(require_permission("payout:read")),
    db: AsyncSession = Depends(get_db),
):
    batches = await finance_service.list_settlement_batches(db, context)
    return ok([SettlementBatchOut.model_validate(item) for item in batches])


@router.post("/settlement-batches", response_model=ApiResponse[SettlementBatchOut])
async def create_settlement_batch(
    payload: SettlementBatchCreate,
    context: AuthContext = Depends(require_permission("payout:manage")),
    db: AsyncSession = Depends(get_db),
):
    batch = await finance_service.create_settlement_batch(
        db, context, payload.period_start, payload.period_end, payload.note
    )
    return ok(SettlementBatchOut.model_validate(batch), "结算批次已创建")


@router.post(
    "/settlement-batches/{batch_id}/confirm", response_model=ApiResponse[SettlementBatchOut]
)
async def confirm_settlement_batch(
    batch_id: int,
    context: AuthContext = Depends(require_permission("payout:manage")),
    db: AsyncSession = Depends(get_db),
):
    batch = await finance_service.confirm_settlement_batch(db, context, batch_id)
    return ok(SettlementBatchOut.model_validate(batch), "结算批次已确认")


@router.post(
    "/settlement-batches/{batch_id}/pay", response_model=ApiResponse[SettlementBatchOut]
)
async def pay_settlement_batch(
    batch_id: int,
    context: AuthContext = Depends(require_permission("payout:manage")),
    db: AsyncSession = Depends(get_db),
):
    batch = await finance_service.pay_settlement_batch(db, context, batch_id)
    return ok(SettlementBatchOut.model_validate(batch), "结算批次已打款")
