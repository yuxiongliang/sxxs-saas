"""删除旧的单状态列 `orders.status` / `seller_orders.status`

双状态（`payment_status` / `fulfillment_status`）已上线并全量回填，
代码里所有读写都切过去了。这一步把旧列删掉，避免"两套状态并存、迟早不一致"。

回滚：`downgrade()` 会把列加回来并按双状态反推旧值（不完美但可运行）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e9c4a72b6d38"
down_revision: str | None = "b2f6d90c4a17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 双状态 → 旧 status（downgrade 用）
REVERSE_MAP = {
    ("unpaid", "awaiting_payment"): "pending_payment",
    ("paid", "to_ship"): "paid",
    ("paid", "shipped"): "shipped",
    ("paid", "completed"): "completed",
    ("cancelled", "cancelled"): "cancelled",
    ("refunded", "completed"): "refunded",
    ("refunded", "cancelled"): "refunded",
    ("refunding", "shipped"): "refunding",
    ("refunding", "to_ship"): "refunding",
    ("partially_refunded", "completed"): "completed",
    ("partially_refunded", "shipped"): "shipped",
}


def upgrade() -> None:
    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_column("orders", "status")
    op.drop_index("ix_seller_orders_status", table_name="seller_orders")
    op.drop_column("seller_orders", "status")


def downgrade() -> None:
    for table in ("orders", "seller_orders"):
        op.add_column(
            table,
            sa.Column(
                "status",
                sa.String(length=32),
                nullable=False,
                server_default="pending_payment",
            ),
        )
        op.create_index(f"ix_{table}_status", table, ["status"])
        for (payment, fulfillment), legacy in REVERSE_MAP.items():
            op.execute(
                f"UPDATE {table} SET status = '{legacy}' "
                f"WHERE payment_status = '{payment}' AND fulfillment_status = '{fulfillment}'"
            )
