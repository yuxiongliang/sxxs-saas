"""tenants 增加站点描述

Revision ID: b7d1e94f2a63
Revises: e2a7d5f39c48
Create Date: 2026-11-16

「站点品牌」要能填一句站点介绍，用在登录页副标题、页脚与商城顶部。
用 Text 而不是 String(255)：描述是自然语言，长度由接口层（300 字）约束，
不要在库里留个会突然截断的硬上限。可空——没填就不显示。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d1e94f2a63"
down_revision: str | None = "e2a7d5f39c48"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("site_description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "site_description")
