from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NotificationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    channel: str = "sms"
    template: str = ""
    # 只允许「全员」或「按角色」。写错/写空一律 400 —— 旧实现里任何不认识的值
    # （包括 `custom`、`role:` 空尾巴）都会静默退化成全员，等于把内部提醒发给所有客户。
    audience: str = Field(default="all", pattern=r"^(all|role:[a-z0-9_-]{1,32})$")
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
