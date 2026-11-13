from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), index=True, default=1, server_default="1"
    )
    title: Mapped[str] = mapped_column(String(200))
    channel: Mapped[str] = mapped_column(String(16), index=True)
    template: Mapped[str] = mapped_column(String(128), default="")
    audience: Mapped[str] = mapped_column(String(64), default="all")
    # 通知分类（transaction / finance / im / system / marketing）：
    # 用户在「个人设置 → 新消息通知」里按分类关短信/邮件，就靠这一列匹配。
    category: Mapped[str] = mapped_column(String(32), default="system", server_default="system")
    content: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total: Mapped[int] = mapped_column(BigInteger, default=0)
    success_count: Mapped[int] = mapped_column(BigInteger, default=0)
    failed_count: Mapped[int] = mapped_column(BigInteger, default=0)
    # 命中收件人、但被偏好（租户渠道开关 / 用户开关）挡掉的条数
    skipped_count: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
