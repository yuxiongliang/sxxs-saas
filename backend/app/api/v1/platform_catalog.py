"""平台端：全站商品总览（跨租户只读）。

平台看的是**数据**，不是替租户运营商品：这里没有任何写接口，
商品编辑/上架/改价都留在租户控制台和卖家中心。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_platform_permission
from app.core.response import ok
from app.models.catalog import Product
from app.models.seller import Seller, Shop
from app.models.tenant import Tenant
from app.schemas.common import ApiResponse
from app.services import catalog_stats

router = APIRouter(prefix="/platform/products", tags=["平台商品总览"])

PLATFORM_READ = "platform:tenant:read"


@router.get(
    "",
    response_model=ApiResponse[list[dict]],
    dependencies=[Depends(require_platform_permission(PLATFORM_READ))],
)
async def platform_products(
    keyword: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=24),
    tenant_id: int | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """商品 + 销量/浏览/收藏/评分。统计口径与租户端、卖家端完全一致。"""
    stmt = (
        select(Product, Seller, Shop, Tenant)
        .join(Seller, Seller.id == Product.seller_id, isouter=True)
        .join(Shop, Shop.id == Product.shop_id, isouter=True)
        .join(Tenant, Tenant.id == Product.tenant_id, isouter=True)
    )
    if tenant_id is not None:
        stmt = stmt.where(Product.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(Product.status == status)
    if keyword:
        stmt = stmt.where(Product.name.ilike(f"%{keyword.strip()}%"))

    rows = (await db.execute(stmt.order_by(Product.id.desc()).limit(limit))).all()
    # 跨租户：tenant_id=None，统计不按租户过滤
    stats = await catalog_stats.stats_map(
        db, tenant_id=None, product_ids=[row[0].id for row in rows]
    )
    return ok(
        [
            {
                "id": product.id,
                "tenant_id": product.tenant_id,
                "tenant_name": (tenant.display_name or tenant.name) if tenant else None,
                "seller_name": seller.display_name if seller else None,
                "shop_name": shop.name if shop else None,
                "name": product.name,
                "main_image": product.main_image,
                "status": product.status,
                **stats.get(product.id, catalog_stats.ProductStats()).as_dict(),
            }
            for product, seller, shop, tenant in rows
        ]
    )
