"""categories 改平台级 + 分类默认抽佣比例

Revision ID: b3e9f2a7c48d
Revises: a8c4f1d72e60
Create Date: 2026-11-13

商品分类在产品上是**平台统一维护**的（平台建、租户只能选），否则每家租户一套分类，
抽佣口径与商品筛选都会碎片化。所以：

1. `categories.tenant_id` 改可空，存量行（示例「数码」）统一 `tenant_id = NULL` 升为平台级；
2. 新增 `default_commission_bps`（分类默认抽佣比例，卖家没在商品上单独填时用它）；
3. `slug` 加唯一约束 —— 平台级分类必须全局唯一，否则 seed 的幂等判据会重复插入。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3e9f2a7c48d"
down_revision: str | None = "a8c4f1d72e60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("categories", "tenant_id", existing_type=sa.Integer(), nullable=True)
    op.add_column(
        "categories",
        sa.Column(
            "default_commission_bps", sa.Integer(), server_default="0", nullable=False
        ),
    )
    # 存量分类升为平台级：id 不变，商品上的 category_id 关联不受影响
    op.execute(sa.text("UPDATE categories SET tenant_id = NULL"))
    op.create_index("ix_categories_slug", "categories", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_categories_slug", table_name="categories")
    op.alter_column("categories", "tenant_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("categories", "default_commission_bps")
