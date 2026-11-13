"""多规格：规格组 / 规格值 / SKU 覆盖图 + 商品视频与佣金比例

Revision ID: c5d1a8f60e73
Revises: b3e9f2a7c48d
Create Date: 2026-11-13

一个商品 → N 个规格组（≤ 3 级）→ 每个组下 N 个规格值；规格值做笛卡尔积得到 SKU。

另外三列：

* `products.video_url` —— 商品视频（主图/多图之外的素材）；
* `products.commission_bps` / `commission_locked` —— 租户向卖家抽佣的商品级比例与锁定标记；
* `product_skus.image_url` / `video_url` —— SKU 级覆盖图，优先级高于规格值图。

`product_skus.sku_code` 从「普通索引」改成「唯一索引」：旧的 `SKU-{product_id}` 在多规格下
会让同一商品的 N 条 SKU 得到相同编码。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5d1a8f60e73"
down_revision: str | None = "b3e9f2a7c48d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("video_url", sa.String(length=512), nullable=True))
    op.add_column("products", sa.Column("commission_bps", sa.Integer(), nullable=True))
    op.add_column(
        "products",
        sa.Column(
            "commission_locked", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
    )

    op.add_column("product_skus", sa.Column("image_url", sa.String(length=512), nullable=True))
    op.add_column("product_skus", sa.Column("video_url", sa.String(length=512), nullable=True))
    op.drop_index("ix_product_skus_sku_code", table_name="product_skus")
    op.create_index("ix_product_skus_sku_code", "product_skus", ["sku_code"], unique=True)

    op.create_table(
        "product_spec_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_spec_group_product"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_product_spec_groups_product_id", "product_spec_groups", ["product_id"], unique=False
    )

    op.create_table(
        "product_spec_values",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("value", sa.String(length=64), nullable=False),
        sa.Column("image_url", sa.String(length=512), nullable=True),
        sa.Column("video_url", sa.String(length=512), nullable=True),
        sa.Column("sort", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["group_id"], ["product_spec_groups.id"], name="fk_spec_value_group"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_product_spec_values_group_id", "product_spec_values", ["group_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_product_spec_values_group_id", table_name="product_spec_values")
    op.drop_table("product_spec_values")
    op.drop_index("ix_product_spec_groups_product_id", table_name="product_spec_groups")
    op.drop_table("product_spec_groups")

    op.drop_index("ix_product_skus_sku_code", table_name="product_skus")
    op.create_index("ix_product_skus_sku_code", "product_skus", ["sku_code"], unique=False)
    op.drop_column("product_skus", "video_url")
    op.drop_column("product_skus", "image_url")

    op.drop_column("products", "commission_locked")
    op.drop_column("products", "commission_bps")
    op.drop_column("products", "video_url")
