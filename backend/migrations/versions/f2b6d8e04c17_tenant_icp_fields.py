"""tenants 增加 ICP 备案号与许可证号

Revision ID: f2b6d8e04c17
Revises: e7a3c5d19b42
Create Date: 2026-11-13

页脚要展示「ICP 备案号 / ICP 许可证」，每个租户的号不同，只能在「站点品牌」里填，
不能写死在代码里。两列都可空：没填就不显示那一行。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2b6d8e04c17"
down_revision: str | None = "e7a3c5d19b42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("icp_number", sa.String(length=64), nullable=True))
    op.add_column("tenants", sa.Column("icp_license", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "icp_license")
    op.drop_column("tenants", "icp_number")
