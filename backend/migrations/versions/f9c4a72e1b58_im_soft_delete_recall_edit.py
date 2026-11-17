"""IM：会话软删除 + 消息撤回/编辑

Revision ID: f9c4a72e1b58
Revises: e6b3f71c9d24
Create Date: 2026-11-17

三个时间戳，各管一件事：

* `conversation_members.hidden_at` —— **按成员**软删会话：一方删了不影响另一方。
  收到新消息时清空（否则会出现「有未读但列表里看不见」）。
* `messages.recalled_at` —— 撤回。消息行保留（审计与举报要能回溯），
  只是把 `content`/`payload` 清空，前端显示「该消息已撤回」。
* `messages.edited_at` —— 编辑（仅文本），前端显示「已编辑」。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f9c4a72e1b58"
down_revision: str | None = "e6b3f71c9d24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversation_members",
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "messages", sa.Column("recalled_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "messages", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("messages", "edited_at")
    op.drop_column("messages", "recalled_at")
    op.drop_column("conversation_members", "hidden_at")
