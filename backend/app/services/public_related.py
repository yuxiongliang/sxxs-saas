"""详情页「猜你喜欢」：相似商品分页流。

相似度用**一条 SQL 的分层排序**表达，而不是在 Python 里拼几段再合并：

1. 同分类（含子类）—— 最像
2. 同卖家 —— 次之
3. 其他在售商品 —— 兜底，保证永远不空

`ORDER BY tier, <综合排序>, Product.id DESC` 的最后一个 id 是**稳定 tiebreaker**：
分页是 offset 语义，同分商品的顺序必须确定，否则第 2 页会重复或漏项。
"""

from __future__ import annotations

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product
from app.models.seller import Seller
from app.services.public_catalog import (
    _favorite_sq,
    _in_stock_sq,
    _resolve_tenant,
    _sold_sq,
)
from app.services.public_catalog_cards import build_card_payloads

DEFAULT_PAGE_SIZE = 12
MAX_PAGE_SIZE = 24


async def _related_filters(tenant_id: int, current: Product):
    filters = [
        Product.tenant_id == tenant_id,
        Product.status == "on_sale",
        Seller.status == "active",
        Product.id != current.id,
    ]
    return filters


async def related_products(
    db: AsyncSession,
    product_id: int,
    slug: str,
    *,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> dict:
    tenant = await _resolve_tenant(db, slug)
    current = (
        await db.scalars(
            select(Product).where(Product.id == product_id, Product.tenant_id == tenant.id)
        )
    ).first()
    if current is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="商品不存在")

    bounded_page = max(1, page)
    bounded_size = max(1, min(page_size, MAX_PAGE_SIZE))
    filters = await _related_filters(tenant.id, current)

    # 同分类（含子类）：商品 category_id 为空的直接落到 tier 2
    if current.category_id is None:
        tier = case((Product.seller_id == current.seller_id, 1), else_=2)
    else:
        from app.services.public_catalog import _category_scope_ids

        category_ids = await _category_scope_ids(db, current.category_id) or []
        tier = case(
            (Product.category_id.in_(category_ids), 0),
            (Product.seller_id == current.seller_id, 1),
            else_=2,
        )

    sold = func.coalesce(_sold_sq.c.sold, 0)
    favorites = func.coalesce(_favorite_sq.c.favorites, 0)
    in_stock = func.coalesce(_in_stock_sq.c.in_stock, 0)

    joined = (
        select(Product)
        .join(Seller, Seller.id == Product.seller_id)
        .join(_in_stock_sq, _in_stock_sq.c.product_id == Product.id, isouter=True)
        .join(_sold_sq, _sold_sq.c.product_id == Product.id, isouter=True)
        .join(_favorite_sq, _favorite_sq.c.product_id == Product.id, isouter=True)
        .where(*filters)
    )
    total = int(await db.scalar(select(func.count()).select_from(joined.subquery())) or 0)

    rows = list(
        (
            await db.scalars(
                joined.order_by(
                    tier.asc(),
                    in_stock.desc(),
                    sold.desc(),
                    favorites.desc(),
                    Product.created_at.desc(),
                    Product.id.desc(),
                )
                .offset((bounded_page - 1) * bounded_size)
                .limit(bounded_size)
            )
        ).all()
    )

    payloads = await build_card_payloads(db, tenant_id=tenant.id, rows=rows)
    return {
        "list": payloads,
        "total": total,
        "page": bounded_page,
        "pageSize": bounded_size,
    }
