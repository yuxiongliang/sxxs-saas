"""订单状态拆两列 + 交付方式 + 自提点信息

## 为什么拆
旧 `orders.status` 一个列同时表达「钱」和「货」：`paid` 既表示已付款也表示待发货，
运营筛「已支付未发货」根本筛不出来。拆成 `payment_status` / `fulfillment_status`。

旧值映射：
    pending_payment      → unpaid        + awaiting_payment
    paid / processing    → paid          + to_ship
    shipped              → paid          + shipped
    partially_shipped    → paid          + shipped      （产品口径取消「部分发货」）
    completed            → paid          + completed
    cancelled            → cancelled     + cancelled
    refunded             → refunded      + completed
    closed（死枚举）      → cancelled     + cancelled

旧的 `status` 列**本轮不删**，留给迁移 `e9c4a72b6d38` 删；这样可以先上线双状态、
观察一轮再删列，回滚更容易。

## 交付方式
* `products.delivery_methods`  —— 卖家勾选的可用方式（JSON：express / pickup）
* `seller_orders.delivery_method` —— 下单时买家选的（一个卖家单一种）
* `order_items.delivery_method`   —— 快照，列表展示用
* `shops.address` / `pickup_note` —— 自提点信息
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7b3e5a18d42"
down_revision: str | None = "a4d7c2e91b03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 旧 status → (payment_status, fulfillment_status)
LEGACY_MAP: dict[str, tuple[str, str]] = {
    "pending_payment": ("unpaid", "awaiting_payment"),
    "paid": ("paid", "to_ship"),
    "processing": ("paid", "to_ship"),
    "shipped": ("paid", "shipped"),
    "partially_shipped": ("paid", "shipped"),
    "completed": ("paid", "completed"),
    "cancelled": ("cancelled", "cancelled"),
    "closed": ("cancelled", "cancelled"),
    "refunded": ("refunded", "completed"),
    "refunding": ("refunding", "to_ship"),
}


def _backfill(table: str) -> None:
    cases_pay = " ".join(
        f"WHEN '{legacy}' THEN '{pay}'" for legacy, (pay, _) in LEGACY_MAP.items()
    )
    cases_ful = " ".join(
        f"WHEN '{legacy}' THEN '{ful}'" for legacy, (_, ful) in LEGACY_MAP.items()
    )
    op.execute(
        f"UPDATE {table} SET "
        f"payment_status = CASE status {cases_pay} ELSE 'unpaid' END, "
        f"fulfillment_status = CASE status {cases_ful} ELSE 'awaiting_payment' END"
    )


def upgrade() -> None:
    # ---- 1) 订单双状态 ----
    for table in ("orders", "seller_orders"):
        op.add_column(
            table,
            sa.Column(
                "payment_status",
                sa.String(length=24),
                nullable=False,
                server_default="unpaid",
            ),
        )
        op.add_column(
            table,
            sa.Column(
                "fulfillment_status",
                sa.String(length=24),
                nullable=False,
                server_default="awaiting_payment",
            ),
        )
        op.create_index(f"ix_{table}_payment_status", table, ["payment_status"])
        op.create_index(f"ix_{table}_fulfillment_status", table, ["fulfillment_status"])
        _backfill(table)

    # ---- 2) 交付方式 ----
    op.add_column(
        "products", sa.Column("delivery_methods", sa.JSON(), nullable=True)
    )
    op.add_column(
        "seller_orders",
        sa.Column(
            "delivery_method",
            sa.String(length=16),
            nullable=False,
            server_default="express",
        ),
    )
    op.add_column(
        "order_items", sa.Column("delivery_method", sa.String(length=16), nullable=True)
    )
    # 历史订单都是按快递走的（系统此前只有快递这一条交付路径）
    op.execute(
        "UPDATE order_items SET delivery_method = 'express' WHERE delivery_method IS NULL"
    )

    # ---- 3) 自提点 ----
    op.add_column("shops", sa.Column("address", sa.String(length=255), nullable=True))
    op.add_column(
        "shops", sa.Column("pickup_note", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("shops", "pickup_note")
    op.drop_column("shops", "address")
    op.drop_column("order_items", "delivery_method")
    op.drop_column("seller_orders", "delivery_method")
    op.drop_column("products", "delivery_methods")
    for table in ("orders", "seller_orders"):
        op.drop_index(f"ix_{table}_fulfillment_status", table_name=table)
        op.drop_index(f"ix_{table}_payment_status", table_name=table)
        op.drop_column(table, "fulfillment_status")
        op.drop_column(table, "payment_status")
