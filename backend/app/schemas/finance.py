from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PayoutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seller_id: int
    amount_cents: int
    status: str
    reject_reason: str
    settlement_batch_id: int | None = None
    requested_by: int | None = None
    reviewed_by: int | None = None
    paid_at: datetime | None = None


class PayoutRejectRequest(BaseModel):
    reason: str = Field(default="", max_length=255)


class SettlementBatchCreate(BaseModel):
    period_start: datetime
    period_end: datetime
    note: str = Field(default="", max_length=255)


class SettlementBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    batch_no: str
    period_start: datetime
    period_end: datetime
    status: str
    total_amount_cents: int
    seller_count: int
    payout_count: int
    note: str
    confirmed_at: datetime | None = None
    paid_at: datetime | None = None
