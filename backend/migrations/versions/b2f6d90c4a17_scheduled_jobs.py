"""延时任务队列（scheduled_jobs）与 worker 心跳

## 为什么要有这张表
「7 天自动收货」「自提 90 天兜底」都需要**到点执行**，而系统此前只有
「HTTP 请求进来 → 干活」这一种执行方式。任务落库后可以查询、手动重跑、取消、
看到失败原因 —— 这是 Celery/Redis 方案给不了的运维可见性。

## 为什么没有 (kind, ref_type, ref_id) 的部分唯一索引
`CREATE UNIQUE INDEX ... WHERE status = 'pending'` 是合法 PostgreSQL，但
Alembic autogenerate 看不见部分索引，`test_migrations.py` 会一直报 schema drift。
幂等改由 `services/jobs.schedule()` 先查后插保证（同一个业务对象并发入队极少见，
真撞了也只是多一条待执行任务，handler 内会二次校验业务状态）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2f6d90c4a17"
down_revision: str | None = "c7b3e5a18d42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scheduled_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("ref_type", sa.String(length=32), nullable=False),
        sa.Column("ref_id", sa.Integer(), nullable=False),
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="pending"
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_scheduled_jobs_tenant_id", "scheduled_jobs", ["tenant_id"])
    op.create_index("ix_scheduled_jobs_kind", "scheduled_jobs", ["kind"])
    op.create_index("ix_scheduled_jobs_run_at", "scheduled_jobs", ["run_at"])
    op.create_index("ix_scheduled_jobs_status", "scheduled_jobs", ["status"])
    # worker 每次循环按 (status, run_at) 取到期任务，组合索引避免全表扫
    op.create_index(
        "ix_scheduled_jobs_status_run_at", "scheduled_jobs", ["status", "run_at"]
    )

    op.create_table(
        "worker_heartbeats",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("instance_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("version", sa.String(length=32), nullable=True),
        sa.Column("jobs_done", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("worker_heartbeats")
    op.drop_index("ix_scheduled_jobs_status_run_at", table_name="scheduled_jobs")
    op.drop_index("ix_scheduled_jobs_status", table_name="scheduled_jobs")
    op.drop_index("ix_scheduled_jobs_run_at", table_name="scheduled_jobs")
    op.drop_index("ix_scheduled_jobs_kind", table_name="scheduled_jobs")
    op.drop_index("ix_scheduled_jobs_tenant_id", table_name="scheduled_jobs")
    op.drop_table("scheduled_jobs")
