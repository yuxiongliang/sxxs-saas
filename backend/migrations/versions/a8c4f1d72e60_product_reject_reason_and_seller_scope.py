"""商品增加驳回原因 + 收回 seller_owner 的 product:manage

Revision ID: a8c4f1d72e60
Revises: f2b6d8e04c17
Create Date: 2026-11-13

两件事：

1. `products.reject_reason` —— 驳回是纯状态位时，卖家只能反复重提，
   根本不知道哪里不合格。
2. 删除 `seller_owner × product:manage` 的授权 —— 这个权限让卖家登录租户控制台
   后能改**同租户其它卖家**的商品（`/admin/products` 只按 tenant_id 过滤）。
   卖家该走 `/portal/seller/*`，那条链路用 `current_seller()` 做归属校验。
   代码侧同步：`seed_auth.ROLE_PERMISSIONS` 已移除、`FORBIDDEN_ROLE_PERMISSIONS` 已登记。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8c4f1d72e60"
down_revision: str | None = "f2b6d8e04c17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("reject_reason", sa.String(length=255), nullable=True))

    op.execute(
        sa.text(
            """
            DELETE FROM role_permissions rp
            USING roles r, permissions p
            WHERE rp.role_id = r.id
              AND rp.permission_id = p.id
              AND r.code = 'seller_owner'
              AND p.code = 'product:manage'
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r, permissions p
            WHERE r.code = 'seller_owner' AND p.code = 'product:manage'
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp
                WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        )
    )
    op.drop_column("products", "reject_reason")
