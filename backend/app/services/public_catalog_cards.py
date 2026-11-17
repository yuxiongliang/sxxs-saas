"""在公开商品列表/相似商品之间复用的「行 -> 卡片 payload」构造。

抽出来是因为详情页的「猜你喜欢」需要**和列表完全一样**的卡片字段
（价格区间 / 有货 / 已售 / 浏览 / 评分）。两处各写一遍迟早会出现
「列表有评分、推荐没有」这种漂移。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product, ProductSku
from app.models.seller import Seller, Shop
from app.services import catalog_stats
from app.services.public_catalog import _product_public_dict


async def build_card_payloads(
    db: AsyncSession, *, tenant_id: int, rows: list[Product]
) -> list[dict]:
    """把商品行批量组装成卡片 payload（一次查完店铺/卖家/SKU/统计，不做 N+1）。"""
    if not rows:
        return []

    shop_ids = {row.shop_id for row in rows}
    seller_ids = {row.seller_id for row in rows}
    shops = {
        shop.id: shop
        for shop in (await db.scalars(select(Shop).where(Shop.id.in_(shop_ids)))).all()
    }
    sellers = {
        seller.id: seller
        for seller in (
            await db.scalars(select(Seller).where(Seller.id.in_(seller_ids)))
        ).all()
    }

    product_ids = [row.id for row in rows]
    all_skus = list(
        (
            await db.scalars(
                select(ProductSku)
                .where(
                    ProductSku.tenant_id == tenant_id,
                    ProductSku.product_id.in_(product_ids),
                    ProductSku.status == "active",
                )
                .order_by(ProductSku.id)
            )
        ).all()
    )
    skus_by_product: dict[int, list[ProductSku]] = {}
    for sku in all_skus:
        skus_by_product.setdefault(sku.product_id, []).append(sku)

    stats = await catalog_stats.stats_map(
        db, tenant_id=tenant_id, product_ids=product_ids
    )

    result: list[dict] = []
    for product in rows:
        shop = shops.get(product.shop_id)
        seller = sellers.get(product.seller_id)
        if seller is None:
            continue
        skus = skus_by_product.get(product.id, [])
        payload = _product_public_dict(product, shop, seller, skus[0] if skus else None)
        prices = [sku.price_cents for sku in skus]
        payload["price_min_cents"] = min(prices) if prices else None
        payload["price_max_cents"] = max(prices) if prices else None
        payload["sku_count"] = len(skus)
        payload["in_stock"] = any(sku.stock > 0 for sku in skus)
        stat = stats.get(product.id)
        payload["sold_count"] = stat.sold_count if stat else 0
        payload["favorite_count"] = stat.favorite_count if stat else 0
        payload["rating_avg"] = stat.rating_avg if stat else None
        payload["review_count"] = stat.review_count if stat else 0
        payload["view_count"] = product.view_count or 0
        result.append(payload)
    return result
