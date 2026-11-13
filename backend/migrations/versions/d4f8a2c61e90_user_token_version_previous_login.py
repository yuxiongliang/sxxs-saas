"""users 增加 token_version 与 previous_login_at

Revision ID: d4f8a2c61e90
Revises: c1e7b3a95d20
Create Date: 2026-11-13

两件事：

1. `token_version` —— 会话代次。改密码 / 被管理员重置时 +1，写进 access token
   的 claim；`context_from_payload` 与 `refresh` 都会比对。没有它的话，A 浏览器
   改完密码，B 浏览器靠 HttpOnly 的 refresh cookie 最长还能续用 7 天。
2. `previous_login_at` —— 登录时把旧值挪过来。只存一个 `last_login_at` 时，
   「安全设置」里的「上次登录」永远等于刚刚，看不出异常登录。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4f8a2c61e90"
down_revision: str | None = "c1e7b3a95d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("previous_login_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "previous_login_at")
    op.drop_column("users", "token_version")
