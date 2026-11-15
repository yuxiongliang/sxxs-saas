"""Finance administration: 提现审核 + 结算批次。

佣金规则（commission_rules）已下线：租户向卖家的抽佣比例改由
`products.commission_bps` > `categories.default_commission_bps` > 系统 10% 解析，
见 `services/finance.resolve_commission_rate`。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_permission
from app.core.response import ok
from app.models.seller import Seller
from app.models.user import User
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


async def _payout_payload(db: AsyncSession, payouts: list) -> list[dict]:
    """提现记录带上卖家归属人：全站规则是「用户ID + 用户名」，不显示裸 seller_id。"""
    seller_ids = {item.seller_id for item in payouts}
    sellers = (
        list((await db.scalars(select(Seller).where(Seller.id.in_(seller_ids)))).all())
        if seller_ids
        else []
    )
    seller_map = {seller.id: seller for seller in sellers}
    owner_ids = {seller.owner_user_id for seller in sellers}
    owners = (
        list((await db.scalars(select(User).where(User.id.in_(owner_ids)))).all())
        if owner_ids
        else []
    )
    owner_map = {owner.id: owner for owner in owners}

    payload = []
    for item in payouts:
        seller = seller_map.get(item.seller_id)
        owner = owner_map.get(seller.owner_user_id) if seller else None
        data = PayoutOut.model_validate(item).model_dump()
        data.update(
            {
                "seller_name": seller.display_name if seller else None,
                "seller_public_id": owner.public_id if owner else None,
                "seller_username": owner.username if owner else None,
            }
        )
        payload.append(data)
    return payload


# --------------------------------------------------------------------------- #
# Payout review (提现审核)
# --------------------------------------------------------------------------- #


@router.get("/payouts", response_model=ApiResponse[list[dict]])
async def list_payouts(
    status: str | None = Query(default=None),
    context: AuthContext = Depends(require_permission("payout:read")),
    db: AsyncSession = Depends(get_db),
):
    payouts = await finance_service.list_payouts(db, context, status)
    return ok(await _payout_payload(db, payouts))


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
