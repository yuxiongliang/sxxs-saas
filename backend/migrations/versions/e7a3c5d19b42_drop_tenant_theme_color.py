"""tenants 删除 theme_color：站点品牌不再提供自定义主题色

Revision ID: e7a3c5d19b42
Revises: d4f8a2c61e90
Create Date: 2026-11-13

产品决定：全站配色跟随控制台主题（antd token + 深色模式）。按租户自定义主色会和
组件库色板、深色模式、状态色（成功/警告/错误）打架，且这一列从落地起就只有
品牌页那个输入框在用，没有任何地方真拿它去改主题 —— 属于「填了不生效」的字段。

同批：租户品牌页去掉主题色输入框与预览卡，logo 改为从附件中心选图。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7a3c5d19b42"
down_revision: str | None = "d4f8a2c61e90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("tenants", "theme_color")


def downgrade() -> None:
    op.add_column("tenants", sa.Column("theme_color", sa.String(length=16), nullable=True))
