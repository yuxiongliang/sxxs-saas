"""商品描述富文本

Revision ID: e6b3f71c9d24
Revises: d3a9c71f6b28
Create Date: 2026-11-17

四列，各司其职：

* `description_doc`     —— 富文本真身（ProseMirror doc JSON），编辑器回显用它
* `description_html`    —— **服务端 nh3 清洗过**的 HTML，买家端直接渲染它
  （不在渲染时现算：现算意味着「渲染路径上有一步没清洗」的风险，
   清洗结果落库才是可审计、可回归的）
* `description_text`    —— 从清洗后的 HTML 抽出的纯文本，只给搜索用
* `description_format`  —— `text`（历史纯文本）/ `doc`（富文本），渐进迁移，老数据不动

原来的 `description` 列**保留**：老商品还是纯文本，兜底渲染。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e6b3f71c9d24"
down_revision: str | None = "d3a9c71f6b28"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("description_doc", sa.JSON(), nullable=True))
    op.add_column("products", sa.Column("description_html", sa.Text(), nullable=True))
    op.add_column("products", sa.Column("description_text", sa.Text(), nullable=True))
    op.add_column(
        "products",
        sa.Column(
            "description_format",
            sa.String(length=8),
            nullable=False,
            server_default="text",
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "description_format")
    op.drop_column("products", "description_text")
    op.drop_column("products", "description_html")
    op.drop_column("products", "description_doc")
