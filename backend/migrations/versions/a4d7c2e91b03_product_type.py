"""商品类型：products.product_type + order_items.product_type 快照

四类商品：实物 / 虚拟 / 知识付费 / 活动报名。**当前只开放实物**，其余在下单、
发货、库存、退款上都没打通，所以：

* `products.product_type` 只允许 `physical`（接口层再校验一次，见 schemas/commerce.py）；
* `order_items.product_type` 是**下单快照** —— 商品以后要是改了类型，历史订单仍按
  当时的语义对账，不被污染。

历史数据全部回填 `physical`（系统此前只有实物商品这一种形态）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4d7c2e91b03"
down_revision: str | None = "f9c4a72e1b58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "product_type",
            sa.String(length=16),
            nullable=False,
            server_default="physical",
        ),
    )
    op.create_index(
        "ix_products_product_type", "products", ["product_type"], unique=False
    )

    op.add_column(
        "order_items",
        sa.Column("product_type", sa.String(length=16), nullable=True),
    )
    # 历史订单回填：此前只有实物这一种，直接按 physical 补齐
    op.execute("UPDATE order_items SET product_type = 'physical' WHERE product_type IS NULL")


def downgrade() -> None:
    op.drop_column("order_items", "product_type")
    op.drop_index("ix_products_product_type", table_name="products")
    op.drop_column("products", "product_type")
