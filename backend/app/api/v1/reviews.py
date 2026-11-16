"""商品评价接口：买家提交/展示 + 运营/卖家/平台三端管理。

鉴权矩阵（和收藏那张表同构）：

| 路径 | 谁 | 鉴权 |
|---|---|---|
| `GET /public/products/{id}/reviews` | 任何人 | 匿名可读（只返回 visible、匿名的已脱敏） |
| `POST /portal/reviews` | 买家 | 登录 + 订单归属 |
| `GET /portal/reviews` / `.../reviewable` | 买家 | 登录 |
| `GET /admin/reviews` | 运营 | `product:read` |
| `POST /admin/reviews/{id}/status|reply` | 运营 | `product:moderate` |
| `GET /portal/seller/reviews` | 卖家 | 归属校验 |
| `POST /portal/seller/reviews/{id}/reply` | 卖家 | 归属校验（**只能回复，不能隐藏**） |
| `GET/POST /platform/reviews...` | 平台 | `platform:tenant:read` / `platform:tenant:manage` |
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_context,
    get_db,
    require_permission,
    require_platform_permission,
)
from app.core.response import ok
from app.models.interaction import ProductReview
from app.models.order import Order, OrderItem, SellerOrder
from app.schemas.common import ApiResponse
from app.services import reviews as review_service
from app.services import seller_center
from app.services.auth import AuthContext
from app.services.public_catalog import resolve_tenant

router = APIRouter(tags=["商品评价"])
PLATFORM_READ = "platform:tenant:read"
PLATFORM_MANAGE = "platform:tenant:manage"


class ReviewCreate(BaseModel):
    order_item_id: int
    rating: int = Field(ge=1, le=5)
    content: str | None = Field(default=None, max_length=1000)
    # [{ "type": "image"|"video", "url": "/api/v1/attachments/public/12" }]
    media: list[dict] | None = None
    is_anonymous: bool = False


class StatusPayload(BaseModel):
    status: str


class ReplyPayload(BaseModel):
    reply: str = Field(min_length=1, max_length=1000)


# ---------------------------------------------------------------- 买家侧


@router.get("/public/products/{product_id}/reviews", response_model=ApiResponse[dict])
async def public_product_reviews(
    product_id: int,
    slug: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """商品详情页的评价区。匿名可读；匿名评价在这里被脱敏到「匿名买家」。"""
    tenant = await resolve_tenant(db, slug or "demo")
    items, total, avg = await review_service.public_reviews(
        db, tenant_id=tenant.id, product_id=product_id, limit=limit, offset=offset
    )
    return ok({"list": items, "total": total, "rating_avg": avg, "limit": limit, "offset": offset})


@router.post("/portal/reviews", response_model=ApiResponse[dict])
async def create_review(
    payload: ReviewCreate,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """提交评价。先发后审：立刻可见；审核只写 moderation_status。"""
    # 订单项必须属于当前买家：直接查一遍，别依赖前端传的 order_id
    owned = await db.scalar(
        select(OrderItem.id)
        .join(SellerOrder, SellerOrder.id == OrderItem.seller_order_id)
        .join(Order, Order.id == SellerOrder.order_id)
        .where(
            OrderItem.id == payload.order_item_id,
            OrderItem.tenant_id == context.tenant.id,
            Order.buyer_id == context.user.id,
        )
    )
    if owned is None:
        raise HTTPException(status_code=404, detail="订单项不存在或不属于你")

    review = await review_service.create_review(
        db,
        tenant_id=context.tenant.id,
        user_id=context.user.id,
        order_item_id=payload.order_item_id,
        rating=payload.rating,
        content=payload.content,
        media=payload.media,
        is_anonymous=payload.is_anonymous,
    )
    return ok({"id": review.id}, "评价已发布")


@router.get("/portal/reviews", response_model=ApiResponse[list[dict]])
async def my_reviews(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return ok(
        await review_service.list_reviews(
            db, tenant_id=context.tenant.id, user_id=context.user.id
        )
    )


@router.get("/portal/reviews/reviewable", response_model=ApiResponse[list[dict]])
async def reviewable_items(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """待评价订单项：订单已完成后才能评，且一个订单项只能评一次。"""
    return ok(
        await review_service.reviewable_order_items(
            db, tenant_id=context.tenant.id, user_id=context.user.id
        )
    )


# ---------------------------------------------------------------- 租户运营


@router.get(
    "/admin/reviews",
    response_model=ApiResponse[list[dict]],
    dependencies=[Depends(require_permission("product:read"))],
)
async def admin_reviews(
    keyword: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=16),
    moderation_status: str | None = Query(default=None, max_length=16),
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """运营视角：本租户全部评价。匿名的在这里也显示真实 用户ID + 用户名。"""
    return ok(
        await review_service.list_reviews(
            db,
            tenant_id=context.tenant.id,
            keyword=keyword,
            status=status,
            moderation_status=moderation_status,
        )
    )


@router.post(
    "/admin/reviews/{review_id}/status",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_permission("product:moderate"))],
)
async def admin_set_review_status(
    review_id: int,
    payload: StatusPayload,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """隐藏 / 恢复。**只有运营和平台能做，卖家没有这个入口。**"""
    review = await review_service.set_status(
        db, tenant_id=context.tenant.id, review_id=review_id, status=payload.status
    )
    return ok({"id": review.id, "status": review.status}, "已更新")


@router.post(
    "/admin/reviews/{review_id}/reply",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_permission("product:moderate"))],
)
async def admin_reply_review(
    review_id: int,
    payload: ReplyPayload,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    review = await review_service.reply(
        db,
        tenant_id=context.tenant.id,
        review_id=review_id,
        text=payload.reply,
        actor_id=context.user.id,
    )
    return ok({"id": review.id, "reply": review.reply}, "已回复")


# ---------------------------------------------------------------- 卖家


@router.get("/portal/seller/reviews", response_model=ApiResponse[list[dict]])
async def seller_reviews(
    keyword: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=16),
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家视角：只看得见自己商品收到的评价（归属校验）。"""
    seller, _shop = await seller_center.current_seller(db, context)
    return ok(
        await review_service.list_reviews(
            db, tenant_id=context.tenant.id, seller_id=seller.id, keyword=keyword, status=status
        )
    )


@router.post("/portal/seller/reviews/{review_id}/reply", response_model=ApiResponse[dict])
async def seller_reply_review(
    review_id: int,
    payload: ReplyPayload,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家回复。**卖家只能回复，不能隐藏**（隐藏是运营/平台的权力）。"""
    seller, _shop = await seller_center.current_seller(db, context)
    review = await db.scalar(
        select(ProductReview).where(
            ProductReview.id == review_id,
            ProductReview.tenant_id == context.tenant.id,
            ProductReview.seller_id == seller.id,
        )
    )
    if review is None:
        raise HTTPException(status_code=404, detail="评价不存在")
    updated = await review_service.reply(
        db,
        tenant_id=context.tenant.id,
        review_id=review_id,
        text=payload.reply,
        actor_id=context.user.id,
    )
    return ok({"id": updated.id, "reply": updated.reply}, "已回复")


# ---------------------------------------------------------------- 平台


@router.get(
    "/platform/reviews",
    response_model=ApiResponse[list[dict]],
    dependencies=[Depends(require_platform_permission(PLATFORM_READ))],
)
async def platform_reviews(
    keyword: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=16),
    moderation_status: str | None = Query(default=None, max_length=16),
    tenant_id: int | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """平台视角：**跨租户**全站评价。`moderation_status=flagged` 就是人工抽查口。"""
    return ok(
        await review_service.list_reviews(
            db,
            tenant_id=tenant_id,
            keyword=keyword,
            status=status,
            moderation_status=moderation_status,
        )
    )


@router.post(
    "/platform/reviews/{review_id}/status",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_platform_permission(PLATFORM_MANAGE))],
)
async def platform_set_review_status(
    review_id: int,
    payload: StatusPayload,
    db: AsyncSession = Depends(get_db),
):
    review = await review_service.set_status(
        db, tenant_id=None, review_id=review_id, status=payload.status
    )
    return ok({"id": review.id, "status": review.status}, "已更新")


@router.post(
    "/platform/reviews/{review_id}/reply",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_platform_permission(PLATFORM_MANAGE))],
)
async def platform_reply_review(
    review_id: int,
    payload: ReplyPayload,
    context=Depends(require_platform_permission(PLATFORM_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    review = await review_service.reply(
        db,
        tenant_id=None,
        review_id=review_id,
        text=payload.reply,
        actor_id=None,
    )
    return ok({"id": review.id, "reply": review.reply}, "已回复")


@router.get(
    "/platform/review-moderation",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_platform_permission(PLATFORM_READ))],
)
async def review_moderation_status():
    """自动审核能力现状（能力声明）。

    故意返回 `enabled: false` 且文案写明「未接入」：
    接口已预留（`services/review_moderation.py`），但没有真接模型，
    界面不能把它渲染成一个能用的开关。
    """
    return ok(
        {
            "enabled": False,
            "provider": "stub",
            "mode": "先发后审",
            "note": "自动审核接口已预留，当前未接入模型；评价发布即展示，请人工抽查隐藏。",
        }
    )


