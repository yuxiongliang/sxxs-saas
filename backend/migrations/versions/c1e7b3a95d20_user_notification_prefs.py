"""用户级通知偏好：分类 × 渠道开关 + 通知记录补分类

Revision ID: c1e7b3a95d20
Revises: b8d2f4a61c07
Create Date: 2026-11-13

背景：「个人设置 → 新消息通知」原来是 Ant Design Pro 模板里的三个假开关
（`defaultChecked`，不发请求、不落库）。要让它真有用，必须先有一个
**按用户**的偏好维度，而原表 `notifications` 只是一条群发记录（无收件人、无分类）。

本次：

1. `notifications.category` —— 群发属于哪个分类（transaction/finance/im/system/marketing），
   发送时用它匹配用户偏好；存量行回填 `system`。
2. `notifications.skipped_count` —— 命中 audience 但被租户渠道开关或用户偏好挡掉的人数，
   跟 `success_count` 分开记，避免「成功率」说谎。
3. `user_notification_prefs` —— 用户 × 租户 × 分类 × 渠道的开关。只存「关掉」的行也合法，
   读的时候按缺行 = 开启解释；站内信（inbox）不在此表可写范围内。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c1e7b3a95d20"
down_revision: str | None = "b8d2f4a61c07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("category", sa.String(length=32), server_default="system", nullable=False),
    )
    op.add_column(
        "notifications",
        sa.Column("skipped_count", sa.BigInteger(), server_default="0", nullable=False),
    )

    op.create_table(
        "user_notification_prefs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"], name="fk_user_notification_prefs_tenant"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_user_notification_prefs_user"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "user_id", "category", "channel", name="uq_user_notification_pref"
        ),
    )
    op.create_index(
        op.f("ix_user_notification_prefs_tenant_id"),
        "user_notification_prefs",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_notification_prefs_user_id"),
        "user_notification_prefs",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_user_notification_prefs_user_id"), table_name="user_notification_prefs"
    )
    op.drop_index(
        op.f("ix_user_notification_prefs_tenant_id"), table_name="user_notification_prefs"
    )
    op.drop_table("user_notification_prefs")
    op.drop_column("notifications", "skipped_count")
    op.drop_column("notifications", "category")
