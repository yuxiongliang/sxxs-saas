"""公开接口：无需登录即可访问的只读数据。

租户身份来自请求 Host（B6）：tenant_domains 里 active 的域名 → 该租户。
Host 解析不出来时才走 ?tenant= 兜底，且兜底可用 settings.tenant_host_fallback 关掉 ——
线上必须是关的，否则未知域名会被静默当成 demo 站。
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_optional_context
from app.core.response import ok
from app.services import public_catalog as public_catalog_service
from app.services import public_related as public_related_service
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
    seller_id: int | None = Query(default=None),
    sort: str = Query(default=public_catalog_service.SORT_DEFAULT, max_length=16),
    # 同城筛选（结构化 city，精确匹配；买家不需要定位也能用）
    city: str | None = Query(default=None, max_length=32),
    # 距离范围（公里）：必须同时给 buyer_lat/buyer_lng，否则忽略
    radius_km: float | None = Query(default=None, gt=0, le=500),
    # 买家坐标：只用于服务端算距离，**不会被回传**
    buyer_lat: float | None = Query(default=None, ge=-90, le=90),
    buyer_lng: float | None = Query(default=None, ge=-180, le=180),
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
            city=city,
            radius_km=radius_km,
            buyer_lat=buyer_lat,
            buyer_lng=buyer_lng,
            keyword=keyword,
            category_id=category_id,
            min_price_cents=min_price_cents,
            max_price_cents=max_price_cents,
            sort=sort,
            page=page,
            page_size=page_size,
            seller_id=seller_id,
        )
    )


@router.get("/products/{product_id}/related")
async def public_related_products(
    product_id: int,
    request: Request,
    tenant: str | None = Query(
        default=None,
        max_length=64,
        description="租户 slug（仅 Host 解析不出来时的兜底）",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
):
    """详情页「猜你喜欢」：相似商品分页流（同分类 → 同卖家 → 全站兵底）。

    分页而不是一次给完：前端无限加载，用 `page * pageSize >= total` 判到底。
    """
    slug = await _tenant_slug(request, tenant, db)
    return ok(
        await public_related_service.related_products(
            db, product_id, slug, page=page, page_size=page_size
        )
    )


#: 行政区划数据随仓库走（`app/data/regions.json`），不依赖第三方服务：
#: 高德只提供地理编码，没有区划树；运营侧也不想因为外部 API 挂了就选不了地址。
_REGIONS_PATH = Path(__file__).resolve().parents[2] / "data" / "regions.json"
_regions_cache: list[dict] | None = None


def _load_regions() -> list[dict]:
    global _regions_cache
    if _regions_cache is None:
        _regions_cache = json.loads(_REGIONS_PATH.read_text(encoding="utf-8"))
    return _regions_cache


@router.get("/regions")
async def public_regions(response: Response):
    """省-市-区三级行政区划（匿名可读，长缓存）。

    买家新增收货地址、购物车手动地址都用它做级联选择。
    """
    response.headers["Cache-Control"] = "public, max-age=604800"
    return ok(_load_regions())


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
    # 买家坐标：只用于服务端算「距您 x km」，不会回传给前端
    buyer_lat: float | None = Query(default=None, ge=-90, le=90),
    buyer_lng: float | None = Query(default=None, ge=-180, le=180),
    db: AsyncSession = Depends(get_db),
    viewer: AuthContext | None = Depends(get_optional_context),
):
    """公开商品详情：匿名可浏览，含该商品的全部 SKU。

    带 token 访问时会多返回 `is_favorited`；顺便在这里给浏览数 +1（唯一计数入口）。
    """
    slug = await _tenant_slug(request, tenant, db)
    return ok(
        await public_catalog_service.get_public_product(
            db,
            product_id,
            slug,
            viewer_id=viewer.user.id if viewer else None,
            buyer_lat=buyer_lat,
            buyer_lng=buyer_lng,
        )
    )


@router.get("/geo/reverse")
async def public_geo_reverse(
    request: Request,
    tenant: str | None = Query(default=None, max_length=64),
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    db: AsyncSession = Depends(get_db),
):
    """坐标 → 行政区（省/市/区）。

    为什么买家要用它：买家角色**没有** `amap:read` 权限，拿不到高德客户端配置；
    而"同城"筛选需要知道自己在哪个市。这里由服务端用租户自己的高德 webKey 代查，
    只返回行政区名（不给详细地址），失败时返回空对象而不是 500 ——
    定位/反查失败不应该让整个列表白屏。
    """
    from app.services import amap as amap_service
    from app.services import geo as geo_service
    from app.services import setting_resolver

    slug = await _tenant_slug(request, tenant, db)
    tenant_row = await public_catalog_service._resolve_tenant(db, slug)
    config = await setting_resolver.resolve_for_runtime(db, tenant_row.id, "amap")
    try:
        result = await amap_service.regeo(
            str(config.get("webKey") or ""), lng, lat, "base"
        )
    except Exception:  # noqa: BLE001 - 反查失败降级为空，不阻塞列表
        return ok({"province": None, "city": None, "district": None})
    return ok(
        {
            "province": result.get("province") or None,
            "city": result.get("city") or None,
            "district": result.get("district") or None,
            "location": geo_service.location_summary(
                result.get("province"), result.get("city"), result.get("district")
            ),
        }
    )


@router.get("/jobs/heartbeat")
async def jobs_heartbeat(db: AsyncSession = Depends(get_db)):
    """worker 心跳探针（无鉴权）。

    只回"在线/离线 + 最后心跳时间"，不含任务内容 —— 给 dev-up 和运维脚本探活用，
    也让「进程活着但卡死」这种情况能被外部发现。
    """
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.models.job import WorkerHeartbeat

    rows = list((await db.scalars(select(WorkerHeartbeat))).all())
    now = datetime.now(UTC)
    online = any(
        row.last_seen_at and (now - row.last_seen_at).total_seconds() <= 120
        for row in rows
    )
    if not online:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="worker 心跳超时")
    return ok(
        {
            "online": True,
            "workers": [
                {
                    "instance_id": row.instance_id,
                    "jobs_done": row.jobs_done,
                    "last_seen_at": row.last_seen_at.isoformat()
                    if row.last_seen_at
                    else None,
                }
                for row in rows
            ],
        }
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
