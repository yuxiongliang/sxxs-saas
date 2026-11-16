"""公开接口：无需登录即可访问的只读数据。

租户身份来自请求 Host（B6）：tenant_domains 里 active 的域名 → 该租户。
Host 解析不出来时才走 ?tenant= 兜底，且兜底可用 settings.tenant_host_fallback 关掉 ——
线上必须是关的，否则未知域名会被静默当成 demo 站。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_optional_context
from app.core.response import ok
from app.services import public_catalog as public_catalog_service
from app.services import tenant_domains
from app.services.auth import AuthContext

router = APIRouter(prefix="/public", tags=["公开接口"])


async def _tenant_slug(request: Request, tenant: str | None, db: AsyncSession) -> str:
    """Host 优先的租户解析；解析不到就是 404，不猜。"""
    record = await tenant_domains.resolve_public_tenant(db, request, tenant)
    return record.slug


@router.get("/products")
async def public_products(
    request: Request,
    tenant: str | None = Query(
        default=None,
        max_length=64,
        description="租户 slug（仅 Host 解析不出来时的兜底）",
    ),
    keyword: str | None = Query(default=None, max_length=64),
    category_id: int | None = Query(default=None),
    min_price_cents: int | None = Query(default=None, ge=0),
    max_price_cents: int | None = Query(default=None, ge=0),
    sort: str = Query(default=public_catalog_service.SORT_DEFAULT, max_length=16),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=public_catalog_service.DEFAULT_PAGE_SIZE, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    """站点根页「商品」内页：匿名可读的在售商品橱窗（搜索 / 分类 / 价格 / 排序 / 分页）。

    `sort` 传未知值不报 400，回落到综合排序 —— 链接被人手改过不应该白屏。
    """
    slug = await _tenant_slug(request, tenant, db)
    return ok(
        await public_catalog_service.list_public_products(
            db,
            slug,
            keyword=keyword,
            category_id=category_id,
            min_price_cents=min_price_cents,
            max_price_cents=max_price_cents,
            sort=sort,
            page=page,
            page_size=page_size,
        )
    )


@router.get("/categories")
async def public_categories(
    request: Request,
    tenant: str | None = Query(
        default=None,
        max_length=64,
        description="租户 slug（仅 Host 解析不出来时的兜底）",
    ),
    db: AsyncSession = Depends(get_db),
):
    """买家端商品筛选用的分类。

    就是租户端「商品管理 → 商品分类」里那套**平台级分类**（全租户共用、租户只读），
    只返回启用中的一级分类（`parent_id is null`）。
    """
    from sqlalchemy import select as sa_select

    from app.models.catalog import Category

    # 先做一次租户解析：Host 不对就不应该泄露任何分类
    await _tenant_slug(request, tenant, db)
    rows = (
        await db.scalars(
            sa_select(Category)
            .where(
                Category.tenant_id.is_(None),
                Category.status == "active",
                Category.parent_id.is_(None),
            )
            .order_by(Category.sort, Category.id)
        )
    ).all()
    return ok([{"id": row.id, "name": row.name, "slug": row.slug} for row in rows])


@router.get("/products/{product_id}")
async def public_product_detail(
    product_id: int,
    request: Request,
    tenant: str | None = Query(
        default=None,
        max_length=64,
        description="租户 slug（仅 Host 解析不出来时的兜底）",
    ),
    db: AsyncSession = Depends(get_db),
    viewer: AuthContext | None = Depends(get_optional_context),
):
    """公开商品详情：匿名可浏览，含该商品的全部 SKU。

    带 token 访问时会多返回 `is_favorited`；顺便在这里给浏览数 +1（唯一计数入口）。
    """
    slug = await _tenant_slug(request, tenant, db)
    return ok(
        await public_catalog_service.get_public_product(
            db, product_id, slug, viewer_id=viewer.user.id if viewer else None
        )
    )


@router.get("/brand")
async def public_brand(
    request: Request,
    tenant: str | None = Query(
        default=None,
        max_length=64,
        description="租户 slug（仅 Host 解析不出来时的兜底）",
    ),
    db: AsyncSession = Depends(get_db),
):
    """站点品牌：匿名可读。登录页 / 站点标题 / 通知模板都要用。"""
    record = await tenant_domains.resolve_public_tenant(db, request, tenant)
    return ok(
        {
            "slug": record.slug,
            "name": record.name,
            "display_name": record.display_name or record.name,
            "site_description": record.site_description,
            "logo_url": record.logo_url,
            "favicon_url": record.favicon_url,
            "icp_number": record.icp_number,
            "icp_license": record.icp_license,
        }
    )
