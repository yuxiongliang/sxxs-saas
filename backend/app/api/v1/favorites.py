"""商品收藏接口：买家收藏 + 三端查看。

路径分五组，鉴权各走各的：

| 路径 | 谁 | 鉴权 |
|---|---|---|
| `POST/DELETE /public/products/{id}/favorite` | 买家 | 必须登录 |
| `GET /portal/favorites` | 买家（我的收藏） | 登录 |
| `GET /admin/favorites` | 租户运营 | `product:read` |
| `GET /portal/seller/favorites` | 卖家（自己店铺商品） | 归属校验 |
| `GET /platform/favorites` | 平台（跨租户） | `platform:tenant:read` |
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_context,
    get_db,
    require_permission,
    require_platform_permission,
)
from app.core.response import ok
from app.models.catalog import Product
from app.schemas.common import ApiResponse
from app.services import favorites as favorite_service
from app.services import seller_center
from app.services.auth import AuthContext

router = APIRouter(tags=["商品收藏"])

PLATFORM_READ = "platform:tenant:read"


async def _assert_product_in_tenant(db: AsyncSession, tenant_id: int, product_id: int) -> None:
    """收藏前确认商品属于当前租户 —— 否则 A 租户能拿 B 租户的商品 id 刷收藏。"""
    found = await db.scalar(
        select(Product.id).where(Product.id == product_id, Product.tenant_id == tenant_id)
    )
    if found is None:
        raise HTTPException(status_code=404, detail="商品不存在")


@router.post("/public/products/{product_id}/favorite", response_model=ApiResponse[dict])
async def add_favorite(
    product_id: int,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    await _assert_product_in_tenant(db, context.tenant.id, product_id)
    state = await favorite_service.toggle_favorite(
        db,
        tenant_id=context.tenant.id,
        user_id=context.user.id,
        product_id=product_id,
        favorite=True,
    )
    return ok({"is_favorited": state}, "已收藏")


@router.delete("/public/products/{product_id}/favorite", response_model=ApiResponse[dict])
async def remove_favorite(
    product_id: int,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    state = await favorite_service.toggle_favorite(
        db,
        tenant_id=context.tenant.id,
        user_id=context.user.id,
        product_id=product_id,
        favorite=False,
    )
    return ok({"is_favorited": state}, "已取消收藏")


@router.get("/portal/favorites", response_model=ApiResponse[list[dict]])
async def my_favorites(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """买家「我的收藏」。只返回本人 + 本租户的收藏。"""
    return ok(
        await favorite_service.list_favorites(
            db, tenant_id=context.tenant.id, user_id=context.user.id
        )
    )


@router.get(
    "/admin/favorites",
    response_model=ApiResponse[list[dict]],
    dependencies=[Depends(require_permission("product:read"))],
)
async def admin_favorites(
    keyword: str | None = Query(default=None, max_length=64),
    product_id: int | None = Query(default=None),
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """运营视角：本租户全部收藏记录（谁收藏了哪个商品）。"""
    return ok(
        await favorite_service.list_favorites(
            db,
            tenant_id=context.tenant.id,
            keyword=keyword,
            product_id=product_id,
        )
    )


@router.get("/portal/seller/favorites", response_model=ApiResponse[list[dict]])
async def seller_favorites(
    keyword: str | None = Query(default=None, max_length=64),
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家视角：只看得见**自己店铺商品**的收藏（归属校验，不需要权限码）。"""
    seller, _shop = await seller_center.current_seller(db, context)
    return ok(
        await favorite_service.list_favorites(
            db, tenant_id=context.tenant.id, seller_id=seller.id, keyword=keyword
        )
    )


@router.get(
    "/platform/favorites",
    response_model=ApiResponse[list[dict]],
    dependencies=[Depends(require_platform_permission(PLATFORM_READ))],
)
async def platform_favorites(
    keyword: str | None = Query(default=None, max_length=64),
    tenant_id: int | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """平台视角：**跨租户**全站收藏。`tenant_id=None` 表示不筛租户。"""
    return ok(await favorite_service.list_favorites(db, tenant_id=tenant_id, keyword=keyword))
