"""payments 表补真实支付所需字段

* `out_trade_no` —— 商户订单号，格式 `T{tenant_id}-{order_no}`：
  回调不带鉴权，靠这个前缀反查租户，再取该租户的商户配置验签。
  一个回调地址服务所有租户，这是标准做法（也是多租户最容易被漏掉的一环）。
* `environment` —— sandbox / production。支付宝沙箱与生产网关不同，
  出问题时第一件事就是确认走的哪套。

老数据（模拟支付）两列为空，不受影响。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8e2f61c4d05"
down_revision: str | None = "d5c8e1a73f26"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "payments", sa.Column("out_trade_no", sa.String(length=64), nullable=True)
    )
    op.create_index("ix_payments_out_trade_no", "payments", ["out_trade_no"])
    op.add_column(
        "payments",
        sa.Column(
            "environment",
            sa.String(length=16),
            nullable=False,
            server_default="production",
        ),
    )


def downgrade() -> None:
    op.drop_column("payments", "environment")
    op.drop_index("ix_payments_out_trade_no", table_name="payments")
    op.drop_column("payments", "out_trade_no")
