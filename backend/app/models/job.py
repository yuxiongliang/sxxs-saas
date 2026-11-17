from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ScheduledJob(Base, TimestampMixin):
    """延时任务队列。

    `(kind, ref_type, ref_id)` 在 pending 状态下的唯一性由应用层保证
    （`services/jobs.schedule` 先查后插），这里不加部分索引 —— 迁移里的
    部分唯一索引在不同 PostgreSQL 版本行为一致但 Alembic autogenerate 看不见它，
    会一直报 schema drift。
    """

    __tablename__ = "scheduled_jobs"
    # worker 每次循环按 (status, run_at) 取到期任务；索引必须和迁移里的一致，
    # 否则 test_migrations 会报 autogenerate 差异
    __table_args__ = (
        Index("ix_scheduled_jobs_status_run_at", "status", "run_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), index=True)
    ref_type: Mapped[str] = mapped_column(String(32))
    ref_id: Mapped[int] = mapped_column(Integer)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(
        String(16), default="pending", server_default="pending", index=True
    )
    attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class WorkerHeartbeat(Base):
    """常驻 worker 的心跳。

    常驻进程最大的坑是「进程活着但卡死」——pm2 只看到进程在，业务其实停了。
    管理页读这张表才知道 worker 到底还在不在干活。
    """

    __tablename__ = "worker_heartbeats"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    instance_id: Mapped[str] = mapped_column(String(64), unique=True)
    version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    jobs_done: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
