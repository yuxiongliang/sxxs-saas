"""商品所在地（LBS）+ 订单位置快照 + 自提门店坐标

三张表一起加，是因为「距离」这件事需要三个来源：

* `products` —— 卖家把商品挂在哪儿（同城筛选、列表/详情的距离都靠它）；
* `order_items` —— **下单时的位置快照**。商品之后改所在地不能改历史订单
  （与类型/佣金快照同一口径），买家/卖家看订单时看到的应是"当时在哪"；
* `shops` —— 自提门店坐标，确认页要算「自提门店距您多远」。

坐标用 `numeric(10,7)`（≈1cm 精度），**不做四舍五入**；
但公开接口一律不返回坐标，只返回服务端算好的 `distance_m`（见
`services/geo.py`），避免把卖家精确位置暴露到全网可爬的接口里。

存量商品/订单/店铺全部为 NULL：不参与距离排序与半径过滤，界面显示「—」，
不猜、不伪造。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4d7e10a8f52"
down_revision: str | None = "b7f9c2e14d83"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _location_columns(prefix: str = "") -> list[sa.Column]:
    return [
        sa.Column(f"{prefix}province", sa.String(length=32), nullable=True),
        sa.Column(f"{prefix}city", sa.String(length=32), nullable=True),
        sa.Column(f"{prefix}district", sa.String(length=32), nullable=True),
        sa.Column(f"{prefix}address", sa.String(length=255), nullable=True),
        sa.Column(f"{prefix}latitude", sa.Numeric(10, 7), nullable=True),
        sa.Column(f"{prefix}longitude", sa.Numeric(10, 7), nullable=True),
    ]


def upgrade() -> None:
    for column in _location_columns():
        op.add_column("products", column)
    # 同城筛选按 city 走索引；距离排序没法用普通索引（表达式），先只索引 city
    op.create_index("ix_products_city", "products", ["city"])

    for column in _location_columns("location_"):
        op.add_column("order_items", column)

    op.add_column("shops", sa.Column("latitude", sa.Numeric(10, 7), nullable=True))
    op.add_column("shops", sa.Column("longitude", sa.Numeric(10, 7), nullable=True))


def downgrade() -> None:
    op.drop_column("shops", "longitude")
    op.drop_column("shops", "latitude")
    for name in ("location_address", "location_district", "location_city", "location_province",
                 "location_longitude", "location_latitude"):
        op.drop_column("order_items", name)
    op.drop_index("ix_products_city", table_name="products")
    for name in ("province", "city", "district", "address", "latitude", "longitude"):
        op.drop_column("products", name)
