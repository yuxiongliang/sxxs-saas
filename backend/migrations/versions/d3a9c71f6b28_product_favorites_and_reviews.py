"""商品互动：收藏、评价、浏览计数、AI 审核预留接口

Revision ID: d3a9c71f6b28
Revises: b7d1e94f2a63
Create Date: 2026-11-16

三件事一次提交（互相关联，拆开会出现「页面有了表没建」的中间态）：

1. `products.view_count` —— 买家打开详情页 +1，把「浏览」做成可展示的数据。
   带 server_default='0'：存量商品必须有值，否则列表里会冒出 NULL。
2. `product_favorites` —— 收藏关系，(user_id, product_id) 唯一，重复收藏幂等。
3. `product_reviews` —— 一条评价对应一个订单项（唯一），保证「只有真买过的人能评」。
   先发后审：落库即 visible；大模型审核结论单独存 moderation_status，不参与可见性判断。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3a9c71f6b28"
down_revision: str | None = "b7d1e94f2a63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "product_favorites",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "product_id", name="uq_favorite_user_product"),
    )
    op.create_index("ix_product_favorites_tenant_id", "product_favorites", ["tenant_id"])
    op.create_index("ix_product_favorites_user_id", "product_favorites", ["user_id"])
    op.create_index("ix_product_favorites_product_id", "product_favorites", ["product_id"])
    op.create_index(
        "ix_favorite_tenant_product", "product_favorites", ["tenant_id", "product_id"]
    )
    op.create_index("ix_favorite_tenant_user", "product_favorites", ["tenant_id", "user_id"])

    op.create_table(
        "product_reviews",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("order_item_id", sa.Integer(), sa.ForeignKey("order_items.id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("sku_id", sa.Integer(), sa.ForeignKey("product_skus.id"), nullable=True),
        sa.Column("seller_id", sa.Integer(), sa.ForeignKey("sellers.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("media", sa.JSON(), nullable=True),
        sa.Column("is_anonymous", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="visible"),
        sa.Column(
            "moderation_status", sa.String(length=16), nullable=False, server_default="skipped"
        ),
        sa.Column("moderation_note", sa.String(length=255), nullable=True),
        sa.Column("reply", sa.Text(), nullable=True),
        sa.Column("replied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replied_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("order_item_id", name="uq_review_order_item"),
    )
    op.create_index("ix_product_reviews_tenant_id", "product_reviews", ["tenant_id"])
    op.create_index("ix_product_reviews_order_id", "product_reviews", ["order_id"])
    op.create_index("ix_product_reviews_order_item_id", "product_reviews", ["order_item_id"])
    op.create_index("ix_product_reviews_product_id", "product_reviews", ["product_id"])
    op.create_index("ix_product_reviews_sku_id", "product_reviews", ["sku_id"])
    op.create_index("ix_product_reviews_seller_id", "product_reviews", ["seller_id"])
    op.create_index("ix_product_reviews_user_id", "product_reviews", ["user_id"])
    op.create_index("ix_product_reviews_status", "product_reviews", ["status"])
    op.create_index(
        "ix_review_tenant_product", "product_reviews", ["tenant_id", "product_id"]
    )
    op.create_index("ix_review_tenant_status", "product_reviews", ["tenant_id", "status"])


def downgrade() -> None:
    op.drop_table("product_reviews")
    op.drop_table("product_favorites")
    op.drop_column("products", "view_count")
