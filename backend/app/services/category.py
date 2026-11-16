"""商品分类：平台级（全租户共用），平台建、租户只读选。

与 `service_categories` 的区别：

* `service_categories` = **租户的业务类目**，决定平台向该租户抽多少佣（`tenants.service_category_id`）；
* `categories`（本模块）= **商品分类**，挂在 `products.category_id` 上，带的是
  「租户向卖家抽佣」的**分类默认比例**（`default_commission_bps`）。

两个 `commission_bps` 语义不同、方向相反，命名上刻意区分（后者带 `default_` 前缀）。
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Category, Product
from app.schemas.category import CategoryCreate, CategoryUpdate


def _serialize(row: Category, product_count: int = 0) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "slug": row.slug,
        "sort": row.sort,
        "status": row.status,
        "default_commission_bps": row.default_commission_bps,
        "product_count": product_count,
    }


async def list_categories(
    db: AsyncSession,
    *,
    include_archived: bool = False,
    keyword: str | None = None,
    status: str | None = None,
) -> list[dict]:
    """平台级分类列表（附带被多少商品引用，便于删除前判断）。

    `keyword` 同时匹配名称与 slug；`status` 可精确筛启用/停用。
    """
    stmt = select(Category).where(Category.tenant_id.is_(None))
    if status:
        stmt = stmt.where(Category.status == status)
    elif not include_archived:
        stmt = stmt.where(Category.status == "active")
    if keyword:
        pattern = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(Category.name.ilike(pattern), Category.slug.ilike(pattern)))
    stmt = stmt.order_by(Category.sort, Category.id)
    rows = list((await db.scalars(stmt)).all())
    counts = dict(
        (
            await db.execute(
                select(Product.category_id, func.count(Product.id))
                .where(Product.category_id.is_not(None))
                .group_by(Product.category_id)
            )
        ).all()
    )
    items = [_serialize(row, int(counts.get(row.id, 0))) for row in rows]
    return items


async def get_category(db: AsyncSession, category_id: int) -> Category:
    row = await db.get(Category, category_id)
    if row is None or row.tenant_id is not None:
        raise HTTPException(status_code=404, detail="分类不存在")
    return row


async def create_category(db: AsyncSession, payload: CategoryCreate) -> Category:
    exists = await db.scalars(select(Category).where(Category.slug == payload.slug))
    if exists.first() is not None:
        raise HTTPException(status_code=409, detail="分类标识（slug）已存在")
    row = Category(
        tenant_id=None,
        name=payload.name,
        slug=payload.slug,
        sort=payload.sort,
        status=payload.status,
        default_commission_bps=payload.default_commission_bps,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_category(db: AsyncSession, category_id: int, payload: CategoryUpdate) -> Category:
    row = await get_category(db, category_id)
    data = payload.model_dump(exclude_unset=True)
    if "slug" in data and data["slug"] != row.slug:
        exists = await db.scalars(
            select(Category).where(Category.slug == data["slug"], Category.id != row.id)
        )
        if exists.first() is not None:
            raise HTTPException(status_code=409, detail="分类标识（slug）已存在")
    for key, value in data.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return row


async def delete_category(db: AsyncSession, category_id: int) -> None:
    """被商品引用就不能删：提示改为「停用」，否则商品会挂在空分类上。"""
    row = await get_category(db, category_id)
    in_use = int(
        await db.scalar(select(func.count(Product.id)).where(Product.category_id == row.id)) or 0
    )
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"该分类下还有 {in_use} 个商品，不能删除；请改为「停用」",
        )
    await db.delete(row)
    await db.commit()


async def ensure_category_usable(db: AsyncSession, category_id: int | None) -> None:
    """商品创建/编辑时校验分类：必须存在且启用（平台级）。"""
    if category_id is None:
        return
    row = await db.get(Category, category_id)
    if row is None or row.tenant_id is not None:
        raise HTTPException(status_code=400, detail="商品分类不存在")
    if row.status != "active":
        raise HTTPException(status_code=400, detail="该分类已停用，请换一个")
