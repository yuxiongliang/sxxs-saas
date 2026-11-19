"""时间控制：订单支付截止 + 定时任务依据快照

租户可在「系统设置 → 基础设置 → 时间控制」里配四个时间（按商品类型）：
发货时限、自动确认收货（快递/自提各自一个）、售后窗口、待支付关闭。
这两列都是为了**不让口径漂移**：

* `orders.expires_at` —— 下单那一刻就把截止时间定下来。若改成"读配置实时算"，
  租户改一次配置，历史订单的倒计时会跟着跳，买家看到的和当初下单时承诺的不一致。
* `scheduled_jobs.meta` —— 任务入队时把依据（哪条规则、多少天、来自租户还是平台）
  一起写进去。平台端「定时任务」页据此解释"为什么是这个时间执行"，
  配置后续再改也不会篡改历史任务的解释。

两列都可空，存量数据不受影响。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7f9c2e14d83"
down_revision: str | None = "a8e2f61c4d05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_orders_expires_at", "orders", ["expires_at"])
    op.add_column(
        "scheduled_jobs",
        sa.Column("meta", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scheduled_jobs", "meta")
    op.drop_index("ix_orders_expires_at", table_name="orders")
    op.drop_column("orders", "expires_at")
