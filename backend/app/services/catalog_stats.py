"""商品统计：销量 / 浏览 / 收藏 / 评分。

**所有页面共用这一份口径**，避免出现「运营端说卖了 10 件、卖家中心说 8 件」：

| 指标 | 口径 |
|---|---|
| 销量 `sold_count` | `SUM(order_items.quantity)`，且 `seller_orders.fulfillment_status` ∈ {to_ship, shipped, completed}（已付款未发货也算卖出）。取消/退款不计 |
| 浏览 `view_count` | `products.view_count`（买家侧详情页 PV，刷新会累计） |
| 收藏 `favorite_count` | `product_favorites` 行数 |
| 评分 `rating_avg` / `review_count` | 只算 `status='visible'` 的评价 |

一次批量查询（每张表一条 GROUP BY），绝不按商品循环查 —— 列表默认一屏 20 条。
`tenant_id=None` 表示**跨租户**（平台端总览用），其余场景必须传租户 id。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product
from app.models.interaction import ProductFavorite, ProductReview
from app.models.order import OrderItem, SellerOrder

# 计入「已售」的子订单状态：买家付过钱、且没有取消/退款
# 计入「已售」的履约状态：拆双状态后按 fulfillment_status 判断。
# 口径必须与 services/order_state.SOLD_FULFILLMENTS 一致（同一个概念不抄两份字面量）。
SOLD_STATUSES = ("to_ship", "shipped", "completed")


@dataclass(frozen=True)
class ProductStats:
    sold_count: int = 0
    view_count: int = 0
    favorite_count: int = 0
    review_count: int = 0
    rating_avg: float | None = None

    def as_dict(self) -> dict:
        return {
            "sold_count": self.sold_count,
            "view_count": self.view_count,
            "favorite_count": self.favorite_count,
            "review_count": self.review_count,
            # 前端展示两位小数；没有评价时给 None（界面显示「—」而不是 0 分）
            "rating_avg": self.rating_avg,
        }


def _scoped(stmt, column, tenant_id: int | None):
    return stmt if tenant_id is None else stmt.where(column == tenant_id)


async def _sold_counts(
    db: AsyncSession, tenant_id: int | None, product_ids: list[int]
) -> dict[int, int]:
    if not product_ids:
        return {}
    stmt = (
        select(OrderItem.product_id, func.sum(OrderItem.quantity))
        .join(SellerOrder, SellerOrder.id == OrderItem.seller_order_id)
        .where(
            OrderItem.product_id.in_(product_ids),
            SellerOrder.fulfillment_status.in_(SOLD_STATUSES),
        )
        .group_by(OrderItem.product_id)
    )
    stmt = _scoped(stmt, OrderItem.tenant_id, tenant_id)
    return {int(pid): int(total or 0) for pid, total in (await db.execute(stmt)).all()}


async def _favorite_counts(
    db: AsyncSession, tenant_id: int | None, product_ids: list[int]
) -> dict[int, int]:
    if not product_ids:
        return {}
    stmt = (
        select(ProductFavorite.product_id, func.count(ProductFavorite.id))
        .where(ProductFavorite.product_id.in_(product_ids))
        .group_by(ProductFavorite.product_id)
    )
    stmt = _scoped(stmt, ProductFavorite.tenant_id, tenant_id)
    return {int(pid): int(total or 0) for pid, total in (await db.execute(stmt)).all()}


async def _review_aggregates(
    db: AsyncSession, tenant_id: int | None, product_ids: list[int]
) -> dict[int, tuple[int, float | None]]:
    if not product_ids:
        return {}
    stmt = (
        select(
            ProductReview.product_id,
            func.count(ProductReview.id),
            func.avg(ProductReview.rating),
        )
        .where(
            ProductReview.product_id.in_(product_ids),
            ProductReview.status == "visible",
        )
        .group_by(ProductReview.product_id)
    )
    stmt = _scoped(stmt, ProductReview.tenant_id, tenant_id)
    out: dict[int, tuple[int, float | None]] = {}
    for pid, count, avg in (await db.execute(stmt)).all():
        out[int(pid)] = (int(count or 0), round(float(avg), 2) if avg is not None else None)
    return out


async def stats_map(
    db: AsyncSession, *, tenant_id: int | None, product_ids: list[int]
) -> dict[int, ProductStats]:
    """批量取统计。`tenant_id=None` = 跨租户（仅平台端）。"""
    ids = sorted({pid for pid in product_ids if pid})
    if not ids:
        return {}

    sold = await _sold_counts(db, tenant_id, ids)
    favorites = await _favorite_counts(db, tenant_id, ids)
    reviews = await _review_aggregates(db, tenant_id, ids)

    # 浏览数就在商品表上，随商品行一起取，不必再查一次
    view_stmt = select(Product.id, Product.view_count).where(Product.id.in_(ids))
    view_stmt = _scoped(view_stmt, Product.tenant_id, tenant_id)
    views = {int(pid): int(count or 0) for pid, count in (await db.execute(view_stmt)).all()}

    out: dict[int, ProductStats] = {}
    for pid in ids:
        review_count, rating_avg = reviews.get(pid, (0, None))
        out[pid] = ProductStats(
            sold_count=sold.get(pid, 0),
            view_count=views.get(pid, 0),
            favorite_count=favorites.get(pid, 0),
            review_count=review_count,
            rating_avg=rating_avg,
        )
    return out


async def stats_for(db: AsyncSession, *, tenant_id: int | None, product_id: int) -> ProductStats:
    """单商品版本（详情页用），内部复用批量实现。"""
    result = await stats_map(db, tenant_id=tenant_id, product_ids=[product_id])
    return result.get(product_id, ProductStats())


def rating_text(value: float | None) -> str:
    """评分展示：两位小数，没评价给「—」。"""
    if value is None:
        return "—"
    return f"{math.floor(value * 100 + 0.5) / 100:.2f}"
