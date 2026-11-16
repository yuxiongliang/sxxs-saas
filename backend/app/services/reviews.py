"""商品评价：提交 / 展示 / 回复 / 隐藏。

规则（与产品约定一致）：

* **只有真买过的人能评**：`order_item_id` 唯一，且订单项所属子订单必须 `completed`。
* **先发后审**：落库即 `status='visible'`，立即可见；大模型审核只写
  `moderation_status`，**不改变可见性**（审核不能阻塞买家发布）。
* **匿名只对买家侧生效**：前台显示「匿名买家」，运营/卖家/平台三端一律看得到
  真实 `用户ID + 用户名`（否则出纠纷没法定位人）。
* **隐藏只有运营和平台能做**；卖家只能回复。
"""

from __future__ import annotations

import asyncio

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product, ProductSku
from app.models.interaction import ProductReview
from app.models.order import Order, OrderItem, SellerOrder
from app.models.seller import Seller, Shop
from app.models.user import User
from app.services import review_moderation

DEFAULT_LIMIT = 200
MAX_CONTENT = 1000
MAX_MEDIA = 6


def _media_list(raw: list | None) -> list[dict]:
    """规整媒体列表：只保留 image / video 两类，最多 6 条。"""
    out: list[dict] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        kind = str(item.get("type") or "image").strip()
        if not url or kind not in ("image", "video"):
            continue
        out.append({"type": kind, "url": url})
        if len(out) >= MAX_MEDIA:
            break
    return out


async def create_review(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int,
    order_item_id: int,
    rating: int,
    content: str | None,
    media: list | None,
    is_anonymous: bool,
) -> ProductReview:
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="评分必须是 1-5 星")
    if content and len(content) > MAX_CONTENT:
        raise HTTPException(status_code=400, detail=f"评价内容最多 {MAX_CONTENT} 字")

    item_row = (
        await db.execute(
            select(OrderItem, SellerOrder)
            .join(SellerOrder, SellerOrder.id == OrderItem.seller_order_id)
            .where(
                OrderItem.id == order_item_id,
                OrderItem.tenant_id == tenant_id,
            )
        )
    ).first()
    if item_row is None:
        raise HTTPException(status_code=404, detail="订单项不存在")
    item, seller_order = item_row
    # 只能评自己买过的东西：item 的买家通过 order 关联，这里用 seller_order.tenant 校验后
    # 再由调用方保证 order 属于当前用户（见 api 层）
    if seller_order.status != "completed":
        raise HTTPException(status_code=400, detail="订单完成后才能评价")

    exists = (
        await db.scalars(
            select(ProductReview).where(ProductReview.order_item_id == order_item_id)
        )
    ).first()
    if exists is not None:
        raise HTTPException(status_code=400, detail="这个订单项已经评价过了")

    review = ProductReview(
        tenant_id=tenant_id,
        order_id=seller_order.order_id,
        order_item_id=order_item_id,
        product_id=item.product_id,
        sku_id=item.sku_id,
        seller_id=item.seller_id,
        user_id=user_id,
        rating=rating,
        content=(content or "").strip() or None,
        media=_media_list(media),
        is_anonymous=bool(is_anonymous),
        status="visible",
        moderation_status="pending",
    )
    db.add(review)
    await db.flush()

    # 大模型审核：只写结论，不改可见性，失败也不影响发布
    verdict = await review_moderation.evaluate_review(
        content=review.content, rating=review.rating, tenant_id=tenant_id
    )
    review.moderation_status = verdict.action
    review.moderation_note = verdict.reason[:255] if verdict.reason else None

    await db.commit()
    await db.refresh(review)
    return review


async def public_reviews(
    db: AsyncSession,
    *,
    tenant_id: int,
    product_id: int,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int, float | None]:
    """买家侧评价列表：只返回 visible，匿名脱敏。"""
    base = select(ProductReview).where(
        ProductReview.tenant_id == tenant_id,
        ProductReview.product_id == product_id,
        ProductReview.status == "visible",
    )
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    avg = await db.scalar(
        select(func.avg(ProductReview.rating)).where(
            ProductReview.tenant_id == tenant_id,
            ProductReview.product_id == product_id,
            ProductReview.status == "visible",
        )
    )
    rows = list(
        (
            await db.scalars(base.order_by(ProductReview.id.desc()).offset(offset).limit(limit))
        ).all()
    )
    # 昵称也不回，只给「匿名买家 / 用户名」两种结果，避免匿名被昵称泄漏
    users = {}
    if any(not r.is_anonymous for r in rows):
        ids = [r.user_id for r in rows if not r.is_anonymous]
        for user in (await db.scalars(select(User).where(User.id.in_(ids)))).all():
            users[user.id] = user

    out = []
    for review in rows:
        author = users.get(review.user_id)
        out.append(
            {
                "id": review.id,
                "rating": review.rating,
                "content": review.content,
                "media": review.media or [],
                "is_anonymous": review.is_anonymous,
                # 匿名时**不返回**任何可识别信息（连用户ID也不给）
                "user_public_id": None if review.is_anonymous else (author.public_id if author else None),
                "user_username": None if review.is_anonymous else (author.username if author else None),
                "display_name": "匿名买家" if review.is_anonymous else (author.username if author else "买家"),
                "reply": review.reply,
                "replied_at": review.replied_at.isoformat() if review.replied_at else None,
                "created_at": review.created_at.isoformat() if review.created_at else None,
            }
        )
    return out, total, round(float(avg), 2) if avg is not None else None


async def list_reviews(
    db: AsyncSession,
    *,
    tenant_id: int | None,
    seller_id: int | None = None,
    user_id: int | None = None,
    keyword: str | None = None,
    status: str | None = None,
    moderation_status: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict]:
    """管理侧评价列表（运营 / 卖家 / 平台共用一份形状）。

    与买家侧的关键差别：**永远返回真实用户信息**，即使 `is_anonymous`。
    """
    stmt = (
        select(ProductReview, Product, User, Seller, Shop, ProductSku)
        .join(Product, Product.id == ProductReview.product_id)
        .join(User, User.id == ProductReview.user_id)
        .join(Seller, Seller.id == ProductReview.seller_id, isouter=True)
        .join(Shop, Shop.id == Product.shop_id, isouter=True)
        .join(ProductSku, ProductSku.id == ProductReview.sku_id, isouter=True)
    )
    if tenant_id is not None:
        stmt = stmt.where(ProductReview.tenant_id == tenant_id)
    if seller_id is not None:
        stmt = stmt.where(ProductReview.seller_id == seller_id)
    if user_id is not None:
        stmt = stmt.where(ProductReview.user_id == user_id)
    if status:
        stmt = stmt.where(ProductReview.status == status)
    if moderation_status:
        stmt = stmt.where(ProductReview.moderation_status == moderation_status)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(pattern),
                User.username.ilike(pattern),
                User.public_id.ilike(pattern),
                ProductReview.content.ilike(pattern),
            )
        )

    rows = (await db.execute(stmt.order_by(ProductReview.id.desc()).limit(limit))).all()
    return [
        {
            "id": review.id,
            "tenant_id": review.tenant_id,
            "product_id": product.id,
            "product_name": product.name,
            "product_image": product.main_image,
            "sku_name": sku.name if sku else None,
            "seller_shop_name": shop.name if shop else None,
            "seller_name": seller.display_name if seller else None,
            "rating": review.rating,
            "content": review.content,
            "media": review.media or [],
            "is_anonymous": review.is_anonymous,
            # 管理侧：真实身份始终可见
            "user_public_id": user.public_id,
            "user_username": user.username,
            "status": review.status,
            "moderation_status": review.moderation_status,
            "moderation_note": review.moderation_note,
            "reply": review.reply,
            "replied_at": review.replied_at.isoformat() if review.replied_at else None,
            "created_at": review.created_at.isoformat() if review.created_at else None,
        }
        for review, product, user, seller, shop, sku in rows
    ]


async def set_status(
    db: AsyncSession, *, tenant_id: int | None, review_id: int, status: str
) -> ProductReview:
    """隐藏 / 恢复。只有运营（本租户）和平台（跨租户）能调到这里。"""
    if status not in ("visible", "hidden"):
        raise HTTPException(status_code=400, detail="状态只能是 visible 或 hidden")
    review = await _get_review(db, tenant_id, review_id)
    review.status = status
    await db.commit()
    await db.refresh(review)
    return review


async def reply(
    db: AsyncSession, *, tenant_id: int | None, review_id: int, text: str, actor_id: int
) -> ProductReview:
    """回复评价。卖家（归属校验在 API 层）与运营/平台都能回，但回复是覆盖式的。"""
    clean = (text or "").strip()
    if not clean:
        raise HTTPException(status_code=400, detail="回复内容不能为空")
    review = await _get_review(db, tenant_id, review_id)
    review.reply = clean[:MAX_CONTENT]
    review.replied_by = actor_id
    review.replied_at = func.now()
    await db.commit()
    await db.refresh(review)
    return review


async def _get_review(
    db: AsyncSession, tenant_id: int | None, review_id: int
) -> ProductReview:
    stmt = select(ProductReview).where(ProductReview.id == review_id)
    if tenant_id is not None:
        stmt = stmt.where(ProductReview.tenant_id == tenant_id)
    review = (await db.scalars(stmt)).first()
    if review is None:
        raise HTTPException(status_code=404, detail="评价不存在")
    return review


async def reviewable_order_items(
    db: AsyncSession, *, tenant_id: int, user_id: int
) -> list[dict]:
    """待评价的订单项：订单已完成、且还没评过。

    客户端的「评价」入口靠它决定显不显示按钮 —— 不是所有完成订单都能评。
    """
    reviewed = select(ProductReview.order_item_id)
    rows = (
        await db.execute(
            select(OrderItem, SellerOrder)
            .join(SellerOrder, SellerOrder.id == OrderItem.seller_order_id)
            .join(Order, Order.id == SellerOrder.order_id)
            .where(
                OrderItem.tenant_id == tenant_id,
                Order.buyer_id == user_id,
                SellerOrder.status == "completed",
                OrderItem.id.not_in(reviewed),
            )
            .order_by(OrderItem.id.desc())
        )
    ).all()
    return [
        {
            "order_item_id": item.id,
            "order_id": seller_order.order_id,
            "product_id": item.product_id,
            "product_name": item.product_name,
            "sku_name": item.sku_name,
            "image": item.image,
        }
        for item, seller_order in rows
    ]


async def count_reviews(
    db: AsyncSession, *, tenant_id: int | None, seller_id: int | None = None
) -> int:
    stmt = select(func.count(ProductReview.id))
    if tenant_id is not None:
        stmt = stmt.where(ProductReview.tenant_id == tenant_id)
    if seller_id is not None:
        stmt = stmt.where(ProductReview.seller_id == seller_id)
    return int(await db.scalar(stmt) or 0)


async def average_rating(
    db: AsyncSession, *, tenant_id: int | None, seller_id: int | None = None
) -> float | None:
    stmt = select(func.avg(ProductReview.rating)).where(ProductReview.status == "visible")
    if tenant_id is not None:
        stmt = stmt.where(ProductReview.tenant_id == tenant_id)
    if seller_id is not None:
        stmt = stmt.where(ProductReview.seller_id == seller_id)
    value = await db.scalar(stmt)
    return round(float(value), 2) if value is not None else None


__all__ = [
    "average_rating",
    "count_reviews",
    "create_review",
    "list_reviews",
    "public_reviews",
    "reply",
    "reviewable_order_items",
    "set_status",
]


_ = asyncio  # 保留以便后续接入异步审核任务
