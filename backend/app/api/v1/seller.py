from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_context, get_db, require_permission
from app.core.response import ok
from app.schemas.commerce import (
    ProductSpecsUpdate,
    ShopProfileUpdate,
    RefundCreateRequest,
    RefundRejectRequest,
    SellerApplyRequest,
    SellerProductCreate,
    SellerProductStatusRequest,
    SellerProductUpdate,
    SellerShipRequest,
)
from app.services import category as category_service
from app.services import order as order_service
from app.services import seller_center as seller_service
from app.services.auth import AuthContext

router = APIRouter(prefix="/portal/seller", tags=["卖家中心"])


@router.get("/application")
async def seller_application(
    # 只返回调用者自己的开店状态，不涉及他人数据，因此不要求 seller:apply。
    # 若在这里要求该权限，已经是店主但角色不带 seller:apply 的账号
    # （如 operator + seller_owner）会被误判成「未开店」，看到「申请开店」。
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """当前用户的开店状态：未申请 / 审核中 / 已通过。买家页面据此决定是否显示「我的店铺」。"""
    return ok(await seller_service.seller_application(db, context))


@router.post("/apply")
async def apply_seller(
    payload: SellerApplyRequest,
    context: AuthContext = Depends(require_permission("seller:apply")),
    db: AsyncSession = Depends(get_db),
):
    """买家自助申请开店：创建待审核的卖家与店铺，管理员在后台审核通过后即可经营。"""
    result = await seller_service.apply_seller(
        db, context, payload.shop_name, payload.contact_phone
    )
    return ok(result, "申请已提交，等待平台审核")


@router.get("/profile")
async def seller_profile(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    seller, shop = await seller_service.current_seller(db, context)
    return ok(
        {
            "id": seller.id,
            "display_name": seller.display_name,
            "status": seller.status,
            "kyc_status": seller.kyc_status,
            "shop": (
                {
                    "id": shop.id,
                    "name": shop.name,
                    "slug": shop.slug,
                    "description": shop.description,
                    # 自提点信息：买家选自提时要看到
                    "address": shop.address,
                    "pickup_note": shop.pickup_note,
                }
                if shop
                else None
            ),
        }
    )


@router.post("/products")
async def create_product(
    payload: SellerProductCreate,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return ok(await seller_service.create_seller_product(db, context, payload), "商品已提交审核")


@router.post("/orders/{seller_order_id}/refund/reject")
async def seller_reject_refund(
    seller_order_id: int,
    payload: RefundRejectRequest,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家驳回买家的售后申请（归属校验在服务层 current_seller）。"""
    refund = await order_service.reject_refund(
        db, context, seller_order_id, payload.reason
    )
    return ok({"id": refund.id, "status": refund.status}, "已驳回售后申请")


@router.post("/orders/{seller_order_id}/refund")
async def seller_refund_order(
    seller_order_id: int,
    payload: RefundCreateRequest,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家同意退款（买家申请过则复用那条待处理记录）。"""
    refund = await order_service.refund_seller_order(
        db, context, seller_order_id, payload.amount_cents, payload.reason
    )
    return ok({"id": refund.id, "status": refund.status}, "退款成功")


@router.post("/orders/{seller_order_id}/ship")
async def ship_order(
    seller_order_id: int,
    payload: SellerShipRequest,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return ok(
        await seller_service.ship_seller_order(
            db, context, seller_order_id, payload.carrier, payload.tracking_no
        ),
        "发货成功",
    )


@router.post("/payouts")
async def request_payout(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    payout = await seller_service.request_payout(db, context)
    return ok(
        {"id": payout.id, "amount_cents": payout.amount_cents, "status": payout.status}, "结算成功"
    )


@router.put("/shop")
async def update_shop(
    payload: ShopProfileUpdate,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """维护店铺资料（含自提点地址与说明）。"""
    return ok(await seller_service.update_shop_profile(db, context, payload), "店铺资料已更新")


@router.get("/products")
async def seller_products(
    product_type: str | None = Query(default=None, max_length=16),
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return ok(await seller_service.seller_products(db, context, product_type))


@router.get("/categories")
async def seller_categories(
    keyword: str | None = Query(default=None, max_length=64),
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家选分类用：分类是**平台统一定的**，卖家/租户都只读。

    和 `GET /admin/categories` 同一份数据、同一个形状 —— 编辑向导是同一套组件，
    少一处就要在前端写分支。
    """
    return ok(
        await category_service.list_categories(db, include_archived=False, keyword=keyword)
    )


@router.get("/products/{product_id}")
async def seller_product_detail(
    product_id: int,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家商品详情（编辑向导回显：规格树 + 全部 SKU）。"""
    return ok(await seller_service.seller_product_detail(db, context, product_id))


@router.put("/products/{product_id}/specs")
async def save_seller_product_specs(
    product_id: int,
    payload: ProductSpecsUpdate,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家保存规格：笛卡尔积生成 SKU；在售商品改规格会重新过审。"""
    result = await seller_service.save_seller_product_specs(db, context, product_id, payload)
    return ok(result, "规格已保存")


@router.put("/products/{product_id}")
async def update_seller_product(
    product_id: int,
    payload: SellerProductUpdate,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家改自己的商品（归属校验走 current_seller，不需要 product:manage）。"""
    return ok(
        await seller_service.update_seller_product(db, context, product_id, payload),
        "商品已更新",
    )


@router.post("/products/{product_id}/status")
async def change_seller_product_status(
    product_id: int,
    payload: SellerProductStatusRequest,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家自己下架 / 被驳回后重新提交审核。"""
    return ok(
        await seller_service.change_seller_product_status(db, context, product_id, payload),
        "商品状态已更新",
    )


@router.delete("/products/{product_id}")
async def delete_seller_product(
    product_id: int,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """卖家软删除自己的商品（列表/商城不再展示，历史订单与审计保留）。"""
    return ok(
        await seller_service.delete_seller_product(db, context, product_id),
        "商品已删除",
    )


@router.get("/orders")
async def seller_orders(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return ok(await seller_service.seller_orders(db, context))
