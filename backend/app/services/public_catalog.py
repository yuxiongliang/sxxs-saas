"""公开商品橱窗：站点根页「商品」内页用，无需登录。

字段白名单是硬约束 —— 这是对匿名访客开放的接口：

* 只返回商品展示信息（名称/副标题/主图/首个 SKU 的价格与库存）；
* 只返回 on_sale 商品、且卖家必须 active；
* 不暴露卖家状态、KYC、用户、订单、财务等内部字段；
* 租户不存在或非 active 一律 404，不泄露租户是否存在。

返回结构与前端 PortalProduct 保持一致，商品卡片可直接复用。
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product, ProductSku
from app.models.interaction import ProductFavorite
from app.models.seller import Seller, Shop
from app.models.tenant import Tenant
from app.services import catalog_specs, catalog_stats

DEFAULT_TENANT_SLUG = "demo"
DEFAULT_LIMIT = 48
MAX_LIMIT = 120


async def resolve_tenant(db: AsyncSession, slug: str) -> Tenant:
    """公开的租户解析入口（品牌 / 商品列表都要用）。"""
    return await _resolve_tenant(db, slug)


async def _resolve_tenant(db: AsyncSession, slug: str) -> Tenant:
    """按 slug 解析租户；非 active 与不存在同样处理，避免被探测。"""
    tenant = (
        await db.scalars(select(Tenant).where(Tenant.slug == slug, Tenant.status == "active"))
    ).first()
    if tenant is None:
        raise HTTPException(status_code=404, detail="站点不存在或已停用")
    return tenant


def _product_public_dict(product, shop, seller, sku) -> dict:
    """列表与详情共用的一份字段白名单。"""
    return {
        "id": product.id,
        "seller_id": product.seller_id,
        "shop_id": product.shop_id,
        "name": product.name,
        "subtitle": product.subtitle,
        "status": product.status,
        "main_image": product.main_image,
        "shop_name": shop.name,
        "seller_name": seller.display_name,
        "sku": (
            {
                "id": sku.id,
                "name": sku.name,
                "price_cents": sku.price_cents,
                "stock": sku.stock,
            }
            if sku is not None
            else None
        ),
    }


async def list_public_products(
    db: AsyncSession, slug: str = DEFAULT_TENANT_SLUG, limit: int = DEFAULT_LIMIT
) -> list[dict]:
    """在售商品列表（公开）。

    多规格后不能再拿「第一条 SKU」当报价：那条可能是下架的/售罄的。
    列表统一用**可用 SKU 的起售价**（`price_min_cents`），并给出价格区间与规格数，
    卡片据此显示「¥xx 起」。
    """
    tenant = await _resolve_tenant(db, slug)
    bounded = max(1, min(limit, MAX_LIMIT))

    rows = (
        await db.execute(
            select(Product, Shop, Seller)
            .join(Shop, Shop.id == Product.shop_id)
            .join(Seller, Seller.id == Product.seller_id)
            .where(
                Product.tenant_id == tenant.id,
                Product.status == "on_sale",
                Seller.status == "active",
            )
            .order_by(Product.id.desc())
            .limit(bounded)
        )
    ).all()

    if not rows:
        return []

    product_ids = [row[0].id for row in rows]
    all_skus = list(
        (
            await db.scalars(
                select(ProductSku)
                .where(
                    ProductSku.tenant_id == tenant.id,
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

    result: list[dict] = []
    for product, shop, seller in rows:
        skus = skus_by_product.get(product.id, [])
        payload = _product_public_dict(product, shop, seller, skus[0] if skus else None)
        prices = [sku.price_cents for sku in skus]
        payload["price_min_cents"] = min(prices) if prices else None
        payload["price_max_cents"] = max(prices) if prices else None
        payload["sku_count"] = len(skus)
        # 列表卡片用：是否还有可买的 SKU（多规格时引导去详情选）
        payload["in_stock"] = any(sku.stock > 0 for sku in skus)
        result.append(payload)

    # 卡片上的「已售 N / ★4.8」：与运营端、卖家端同一份口径
    stats = await catalog_stats.stats_map(
        db, tenant_id=tenant.id, product_ids=[item["id"] for item in result]
    )
    for payload in result:
        stat = stats.get(payload["id"])
        payload["sold_count"] = stat.sold_count if stat else 0
        payload["favorite_count"] = stat.favorite_count if stat else 0
        payload["rating_avg"] = stat.rating_avg if stat else None
        payload["review_count"] = stat.review_count if stat else 0
    return result


async def get_public_product(
    db: AsyncSession,
    product_id: int,
    slug: str = DEFAULT_TENANT_SLUG,
    viewer_id: int | None = None,
) -> dict:
    """公开商品详情。非在售 / 卖家非 active / 跨租户一律 404，不区分原因。"""
    tenant = await _resolve_tenant(db, slug)
    row = (
        await db.execute(
            select(Product, Shop, Seller)
            .join(Shop, Shop.id == Product.shop_id)
            .join(Seller, Seller.id == Product.seller_id)
            .where(
                Product.tenant_id == tenant.id,
                Product.id == product_id,
                Product.status == "on_sale",
                Seller.status == "active",
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="商品不存在或已下架")

    product, shop, seller = row
    skus = list(
        (
            await db.scalars(
                select(ProductSku)
                .where(
                    ProductSku.tenant_id == tenant.id,
                    ProductSku.product_id == product.id,
                    ProductSku.status == "active",
                )
                .order_by(ProductSku.id)
            )
        ).all()
    )
    payload = _product_public_dict(product, shop, seller, skus[0] if skus else None)
    payload["skus"] = [
        {
            "id": sku.id,
            "sku_code": sku.sku_code,
            "name": sku.name,
            "price_cents": sku.price_cents,
            "stock": sku.stock,
            # 多规格选择器要靠这两个字段反查组合与切图
            "specs": sku.specs or {},
            "image_url": sku.image_url,
            "video_url": sku.video_url,
        }
        for sku in skus
    ]
    payload["spec_groups"] = await catalog_specs.load_spec_groups(db, product.id)
    prices = [sku.price_cents for sku in skus]
    payload["price_min_cents"] = min(prices) if prices else None
    payload["price_max_cents"] = max(prices) if prices else None

    # —— 浏览计数：原子自增，计数交给数据库，不靠应用层读-改-写 ——
    await db.execute(
        update(Product)
        .where(Product.id == product.id)
        .values(view_count=Product.view_count + 1)
    )
    await db.commit()

    stats = await catalog_stats.stats_for(
        db, tenant_id=tenant.id, product_id=product.id
    )
    # 统计是提交之后读的，view_count 已经含本次访问，不再额外 +1
    payload.update(stats.as_dict())

    # 收藏态：匿名访问永远是 false；token 无效也当匿名（get_optional_context）
    payload["is_favorited"] = False
    if viewer_id:
        payload["is_favorited"] = bool(
            await db.scalar(
                select(func.count(ProductFavorite.id)).where(
                    ProductFavorite.tenant_id == tenant.id,
                    ProductFavorite.user_id == viewer_id,
                    ProductFavorite.product_id == product.id,
                )
            )
        )
    return payload
