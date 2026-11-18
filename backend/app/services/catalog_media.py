"""商品「成交图」的唯一口径 —— 只要展示的是"某一支 SKU 长什么样"，就必须走这里。

优先级（与前端 `src/pages/commerce/products/components/specUtils.ts::resolveMedia` 一致）：

    ① SKU 覆盖图  product_skus.image_url
    ② 规格值图    product_spec_values.image_url（按选中组合逐组匹配）
    ③ 商品主图    products.main_image

为什么必须一处算：详情页、购物车、确认页、订单快照四处都要这张图，各写一遍就会出现
"详情页是红款、下单后订单里是白款"的错位。历史上确认页与订单快照只取了
`sku.image_url or main_image`，**漏了规格值图**，于是只设规格值图（最常见用法）时
买家看到的商品图与订单里的不一样。

**不**走这里的：商品列表卡片 / 收藏 / 评价 / 平台目录 —— 那是"商品封面"，固定主图。
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import (
    Product,
    ProductSku,
    ProductSpecGroup,
    ProductSpecValue,
)


def pick_image(
    *,
    sku: ProductSku | None,
    product: Product | None,
    spec_images: dict[tuple[str, str], str] | None = None,
) -> str | None:
    """纯函数部分：给定已查好的规格值图，按优先级挑一张。"""
    if sku is not None and sku.image_url:
        return sku.image_url
    specs = (sku.specs or {}) if sku is not None else {}
    for group_name, value_name in specs.items():
        image = (spec_images or {}).get((group_name, value_name))
        if image:
            return image
    return product.main_image if product is not None else None


async def spec_image_map(
    db: AsyncSession, product_ids: Iterable[int]
) -> dict[int, dict[tuple[str, str], str]]:
    """{product_id: {(规格组名, 规格值): 图直链}}，一次查完供批量使用。"""
    ids = {pid for pid in product_ids if pid}
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(
                ProductSpecGroup.product_id,
                ProductSpecGroup.name,
                ProductSpecValue.value,
                ProductSpecValue.image_url,
            )
            .join(ProductSpecValue, ProductSpecValue.group_id == ProductSpecGroup.id)
            .where(ProductSpecGroup.product_id.in_(ids))
        )
    ).all()
    result: dict[int, dict[tuple[str, str], str]] = {}
    for product_id, group_name, value, image_url in rows:
        if not image_url:
            continue
        result.setdefault(product_id, {})[(group_name, value)] = image_url
    return result


async def effective_image(
    db: AsyncSession, product: Product | None, sku: ProductSku | None
) -> str | None:
    """单条用（下单快照、购物车行）。批量场景用 `effective_image_map`。"""
    if product is None and sku is None:
        return None
    product_id = product.id if product is not None else sku.product_id
    mapping = await spec_image_map(db, [product_id])
    return pick_image(
        sku=sku, product=product, spec_images=mapping.get(product_id, {})
    )


async def effective_image_map(
    db: AsyncSession, pairs: Iterable[tuple[Product | None, ProductSku | None]]
) -> dict[int, str | None]:
    """批量：返回 {sku_id: 成交图}，确认页一次算完，避免 N+1。"""
    pairs = list(pairs)
    product_ids = [
        product.id if product is not None else (sku.product_id if sku else None)
        for product, sku in pairs
    ]
    mapping = await spec_image_map(db, [pid for pid in product_ids if pid])
    out: dict[int, str | None] = {}
    for product, sku in pairs:
        if sku is None:
            continue
        product_id = product.id if product is not None else sku.product_id
        out[sku.id] = pick_image(
            sku=sku, product=product, spec_images=mapping.get(product_id, {})
        )
    return out
