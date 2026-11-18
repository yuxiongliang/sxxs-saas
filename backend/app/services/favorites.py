"""商品收藏：买家收藏/取消收藏，以及三端（运营 / 卖家 / 平台）的查看。

口径统一：
* 一处收藏 = 一行 `product_favorites`，重复收藏幂等（不报错、不插重复行）。
* 用户标识一律 join `users` 取 `public_id` / `username`，**不返回裸 user_id**（全站硬规则）。
* 卖家只能看**自己店铺商品**的收藏；运营看本租户；平台跨租户。

列表都返回同一形状，三端共用前端组件，避免三份实现三种字段名。
"""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product
from app.models.interaction import ProductFavorite
from app.models.seller import Seller, Shop
from app.models.user import User

# 与其它模块保持一致：一次最多返回这么多行，调用方要分页请显式传
DEFAULT_LIMIT = 200


async def toggle_favorite(
    db: AsyncSession, *, tenant_id: int, user_id: int, product_id: int, favorite: bool
) -> bool:
    """收藏 / 取消收藏。返回最终状态（True = 已收藏）。

    收藏是幂等操作：重复点收藏不会变成两行，取消一个没收藏的也不报错 ——
    前端连点两下不应该出现 500。
    """
    existing = (
        await db.scalars(
            select(ProductFavorite).where(
                ProductFavorite.tenant_id == tenant_id,
                ProductFavorite.user_id == user_id,
                ProductFavorite.product_id == product_id,
            )
        )
    ).first()

    if favorite and existing is None:
        db.add(
            ProductFavorite(tenant_id=tenant_id, user_id=user_id, product_id=product_id)
        )
    elif not favorite and existing is not None:
        await db.delete(existing)
    await db.commit()
    return favorite


async def favorite_product_ids(
    db: AsyncSession, *, tenant_id: int, user_id: int, product_ids: list[int]
) -> set[int]:
    """批量判断哪些商品已被该用户收藏（列表页一次查完，别在循环里查）。"""
    if not product_ids:
        return set()
    rows = await db.scalars(
        select(ProductFavorite.product_id).where(
            ProductFavorite.tenant_id == tenant_id,
            ProductFavorite.user_id == user_id,
            ProductFavorite.product_id.in_(product_ids),
        )
    )
    return set(rows.all())


async def list_favorites(
    db: AsyncSession,
    *,
    tenant_id: int | None,
    seller_id: int | None = None,
    user_id: int | None = None,
    product_id: int | None = None,
    keyword: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict]:
    """收藏列表。参数组合决定视角：

    * `tenant_id` 必传；传 `None` = 跨租户（仅平台端）
    * `seller_id` —— 卖家中心（只看自己商品的收藏）
    * `user_id` —— 买家「我的收藏」
    * `keyword` —— 匹配 商品名 / 用户名 / 用户ID / 店铺名
    """
    stmt = (
        select(ProductFavorite, Product, User, Seller, Shop)
        .join(Product, Product.id == ProductFavorite.product_id)
        .join(User, User.id == ProductFavorite.user_id)
        .join(Seller, Seller.id == Product.seller_id, isouter=True)
        .join(Shop, Shop.id == Product.shop_id, isouter=True)
        # 商品被卖家/运营软删除后，收藏条目不该再展示（否则点进去是 404）
        .where(Product.status != "deleted")
    )
    if tenant_id is not None:
        stmt = stmt.where(ProductFavorite.tenant_id == tenant_id)
    if seller_id is not None:
        stmt = stmt.where(Product.seller_id == seller_id)
    if user_id is not None:
        stmt = stmt.where(ProductFavorite.user_id == user_id)
    if product_id is not None:
        stmt = stmt.where(ProductFavorite.product_id == product_id)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(pattern),
                User.username.ilike(pattern),
                User.public_id.ilike(pattern),
                Shop.name.ilike(pattern),
            )
        )

    rows = (await db.execute(stmt.order_by(ProductFavorite.id.desc()).limit(limit))).all()
    return [
        {
            "id": favorite.id,
            "tenant_id": favorite.tenant_id,
            "product_id": product.id,
            "product_name": product.name,
            "product_image": product.main_image,
            "product_status": product.status,
            "price_cents": None,  # 由调用方按需补（避免这里再查一遍 SKU）
            "seller_shop_name": shop.name if shop else None,
            "seller_name": seller.display_name if seller else None,
            # 人物标识：用户ID + 用户名（不返回裸 user_id）
            "user_public_id": user.public_id,
            "user_username": user.username,
            "created_at": favorite.created_at.isoformat() if favorite.created_at else None,
        }
        for favorite, product, user, seller, shop in rows
    ]


async def count_favorites(
    db: AsyncSession, *, tenant_id: int | None, seller_id: int | None = None
) -> int:
    stmt = select(func.count(ProductFavorite.id))
    if tenant_id is not None:
        stmt = stmt.where(ProductFavorite.tenant_id == tenant_id)
    if seller_id is not None:
        stmt = stmt.join(Product, Product.id == ProductFavorite.product_id).where(
            Product.seller_id == seller_id
        )
    return int(await db.scalar(stmt) or 0)
