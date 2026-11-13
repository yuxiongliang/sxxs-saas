"""下线 commission_rules 规则体系

Revision ID: e2a7d5f39c48
Revises: d9f4b2c81a35
Create Date: 2026-11-13

租户向卖家抽佣的比例改为「商品级 > 分类默认 > 系统 10%」三层解析
（`services/finance.resolve_commission_rate`），规则表因此没有任何消费方：

* 下单时不再查规则（`order.py` 直接按商品比例算，并把比例/来源快照到 `order_items`）；
* 租户控制台「财务 → 佣金规则」页已移除；
* 后端 `/admin/commission-rules*` 四个端点与对应 schema 已删除。

历史订单的金额是下单时固化的（`seller_orders.commission_amount_cents`），
删表不影响已发生的钱。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2a7d5f39c48"
down_revision: str | None = "d9f4b2c81a35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_commission_rules_tenant_id", table_name="commission_rules")
    op.drop_table("commission_rules")


def downgrade() -> None:
    op.create_table(
        "commission_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), server_default="默认佣金规则", nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("seller_id", sa.Integer(), nullable=True),
        sa.Column("rate_bps", sa.Integer(), nullable=False),
        sa.Column("fixed_fee_cents", sa.Integer(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="commission_rules_tenant_id_fkey"),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], name="commission_rules_category_id_fkey"
        ),
        sa.ForeignKeyConstraint(["seller_id"], ["sellers.id"], name="commission_rules_seller_id_fkey"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_commission_rules_tenant_id", "commission_rules", ["tenant_id"])
