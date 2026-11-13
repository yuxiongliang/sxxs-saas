from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NotificationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    channel: str = "sms"
    template: str = ""
    audience: str = "all"
    # 通知分类：决定命中哪些用户的「新消息通知」偏好
    category: str = Field(default="system", pattern="^(transaction|finance|im|system|marketing)$")
    content: str = ""
    scheduled_at: datetime | None = None


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    channel: str
    template: str
    audience: str
    category: str
    content: str
    status: str
    scheduled_at: datetime | None = None
    sent_at: datetime | None = None
    total: int
    success_count: int
    failed_count: int
    skipped_count: int = 0
    error_message: str | None = None
    created_at: datetime


class NotificationStats(BaseModel):
    total: int
    success: int
    failed: int
    pending: int
    channels: dict[str, int]
