"""平台端商品分类管理（平台级，全租户共用）。

拼写上看它和 `platform_service_categories.py` 很像，但那是**租户的业务类目**
（决定平台向租户抽多少佣）；这里是**商品分类**（挂在商品上，携带「租户向卖家抽佣」的
分类默认比例）。不要合并两者。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_platform_permission
from app.core.response import ok
from app.schemas.category import CategoryCreate, CategoryUpdate
from app.schemas.common import ApiResponse
from app.services import category as category_service

router = APIRouter(prefix="/platform/categories", tags=["平台商品分类"])

READ = "platform:tenant:read"
WRITE = "platform:tenant:manage"


@router.get("", response_model=ApiResponse[list[dict]])
async def list_categories(
    include_archived: bool = Query(default=True),
    keyword: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, pattern="^(active|archived)$"),
    _context=Depends(require_platform_permission(READ)),
    db: AsyncSession = Depends(get_db),
):
    return ok(
        await category_service.list_categories(
            db, include_archived=include_archived, keyword=keyword, status=status
        )
    )


@router.post("", response_model=ApiResponse[dict])
async def create_category(
    payload: CategoryCreate,
    _context=Depends(require_platform_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    row = await category_service.create_category(db, payload)
    return ok(category_service._serialize(row), "分类已创建")


@router.put("/{category_id}", response_model=ApiResponse[dict])
async def update_category(
    category_id: int,
    payload: CategoryUpdate,
    _context=Depends(require_platform_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    row = await category_service.update_category(db, category_id, payload)
    return ok(category_service._serialize(row), "分类已更新")


@router.delete("/{category_id}", response_model=ApiResponse[None])
async def delete_category(
    category_id: int,
    _context=Depends(require_platform_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    await category_service.delete_category(db, category_id)
    return ok(None, "分类已删除")
