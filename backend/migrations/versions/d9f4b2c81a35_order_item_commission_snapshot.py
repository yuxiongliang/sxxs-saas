"""订单明细记录抽佣快照（比例 + 来源）

Revision ID: d9f4b2c81a35
Revises: c5d1a8f60e73
Create Date: 2026-11-13

抽佣改成「商品级比例 > 分类默认 > 系统 10%」之后，比例是可变的：
卖家（或运营）随时能改。历史订单为什么扣了 10% 而不是 5%，只有把**下单当时**的
比例与来源落下来才能举证，所以给 `order_items` 加两列快照。

旧订单留 NULL —— 当时的口径是 `commission_rules`，无法准确回填，不瞎猜。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9f4b2c81a35"
down_revision: str | None = "c5d1a8f60e73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("commission_rate_bps", sa.Integer(), nullable=True))
    op.add_column(
        "order_items", sa.Column("commission_source", sa.String(length=16), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("order_items", "commission_source")
    op.drop_column("order_items", "commission_rate_bps")
