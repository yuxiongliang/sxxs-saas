"""历史商品回填交付方式 = 物流快递

`products.delivery_methods` 是新增列，老商品全是 NULL。而新规则是「不选交付方式不能发布」——
如果不回填，运营/卖家重新提交审核时会莫名被拦，而他们从没被问过这个问题。

系统此前只有"快递"这一条交付路径（`Shipment` + 运单号），所以回填 `["express"]`
是**按既有事实**补数据，不是替用户选。
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "f1b8c4d29e70"
down_revision: str | None = "e9c4a72b6d38"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE products SET delivery_methods = '[\"express\"]'::json "
        "WHERE delivery_methods IS NULL"
    )


def downgrade() -> None:
    # 不回滚数据：把已有交付方式清空等于让商品重新"未选择"，没意义
    pass
