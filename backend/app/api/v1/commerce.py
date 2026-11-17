from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_context, get_db, require_permission
from app.core.response import ok
from app.models.catalog import InventoryLog, Product, ProductSku
from app.models.order import Order, OrderItem, SellerOrder
from app.models.seller import Seller, Shop
from app.models.user import User
from app.schemas.commerce import (
    ProductSkuUpdate,
    ProductSpecsUpdate,
    ProductStatusRequest,
    ProductUpdate,
    RefundCreateRequest,
    SellerReviewRequest,
    ShipmentCreateRequest,
)
from app.schemas.common import ApiResponse
from app.schemas.order import OrderCreateRequest
from app.services import attachment as attachment_service
from app.services import audit as audit_service
from app.services import catalog_specs, catalog_stats, rich_text
from app.services import category as category_service
from app.services import finance as finance_service
from app.services import order as order_service
from app.services.auth import AuthContext

router = APIRouter(tags=["C2C 商城"])


def _seller_dict(seller: Seller, owner: User | None = None) -> dict:
    """卖家对外形状。

    `display_name` 是店铺/卖家名，`owner_username` 是登录用户名 —— 后台列表两列都要，
    只给裸 `owner_user_id` 运营没法判断是谁。
    """
    return {
        "id": seller.id,
        "display_name": seller.display_name,
        "seller_type": seller.seller_type,
        "status": seller.status,
        "kyc_status": seller.kyc_status,
        "owner_user_id": seller.owner_user_id,
        "owner_username": owner.username if owner else None,
        "owner_public_id": owner.public_id if owner else None,
    }


def _item_dict(item: OrderItem) -> dict:
    """订单行对外形状。

    `image` / `product_type` 都是**下单时的快照**：商品后来换图/换类型，
    历史订单仍按当时的成交内容展示（对账、客服、退款都靠这个）。
    `seller_order_id` 必须带上 —— 发货/退款是**卖家单粒度**，
    一个订单可能拆多个卖家单，拿订单 id 去发货会发错单。
    """
    return {
        "id": item.id,
        "product_id": item.product_id,
        "sku_id": item.sku_id,
        "seller_id": item.seller_id,
        "seller_order_id": item.seller_order_id,
        "product_type": item.product_type or "physical",
        "product_name": item.product_name,
        "sku_name": item.sku_name,
        "image": item.image,
        "price_cents": item.price_cents,
        "quantity": item.quantity,
        "subtotal_cents": item.subtotal_cents,
    }


async def _order_items_map(
    db: AsyncSession, order_ids: list[int]
) -> dict[int, list[OrderItem]]:
    """批量取订单行（IN 一次），避免列表页逐单查。"""
    if not order_ids:
        return {}
    rows = list(
        (
            await db.scalars(
                select(OrderItem)
                .where(OrderItem.order_id.in_(order_ids))
                .order_by(OrderItem.id)
            )
        ).all()
    )
    grouped: dict[int, list[OrderItem]] = {}
    for row in rows:
        grouped.setdefault(row.order_id, []).append(row)
    return grouped


def _product_dict(
    product: Product,
    sku: ProductSku | None = None,
    skus: list[ProductSku] | None = None,
    seller: Seller | None = None,
    shop: Shop | None = None,
    owner: User | None = None,
) -> dict:
    """商品对外的统一形状。

    带上了价格/库存/SKU 数与卖家店铺名：运营在商品管理页要直接看出「卖多少钱、还有几件」，
    原来只回 name/status，连改价改库存在界面上都无从下手。

    不再返回 `subtitle` —— 副标题已全站下线（列保留，历史数据不丢）。
    """
    sku_list = skus if skus is not None else ([sku] if sku is not None else [])
    # 统计只算**在售（active）**的 SKU：停用的历史 SKU 还留在库里（订单外键指着它），
    # 但不能计入「库存 / SKU 数 / 价格」，否则运营在编辑器里把规格库存改成 0，
    # 回到列表看到的还是旧合计，就会觉得「保存无效」。
    active_skus = [item for item in sku_list if item.status == "active"]
    data = {
        "id": product.id,
        "seller_id": product.seller_id,
        "shop_id": product.shop_id,
        "category_id": product.category_id,
        "name": product.name,
        # 商品类型（physical / virtual / knowledge / event）；创建后不可改，
        # 三端共用这个字段做标签与筛选
        "product_type": product.product_type,
        "description": product.description,
        # 富文本：编辑器回显需要 doc，审核页要能直接看渲染效果
        "description_format": product.description_format,
        "description_doc": product.description_doc,
        "description_html": product.description_html,
        "status": product.status,
        "main_image": product.main_image,
        "images": product.images or [],
        "video_url": product.video_url,
        "commission_bps": product.commission_bps,
        "commission_locked": bool(product.commission_locked),
        "reject_reason": product.reject_reason,
        "created_at": product.created_at.isoformat() if product.created_at else None,
        "updated_at": product.updated_at.isoformat() if product.updated_at else None,
        "seller_name": seller.display_name if seller else None,
        "seller_owner_username": owner.username if owner else None,
        "seller_owner_public_id": owner.public_id if owner else None,
        "shop_name": shop.name if shop else None,
        "sku_count": len(active_skus),
        "inactive_sku_count": len(sku_list) - len(active_skus),
        "stock": sum(item.stock for item in active_skus),
        "locked_stock": sum(item.locked_stock for item in active_skus),
        "skus": [
            {
                "id": item.id,
                "sku_code": item.sku_code,
                "name": item.name,
                "price_cents": item.price_cents,
                "stock": item.stock,
                "locked_stock": item.locked_stock,
                "status": item.status,
                "specs": item.specs or {},
                "image_url": item.image_url,
                "video_url": item.video_url,
            }
            for item in sku_list
        ],
    }
    if active_skus:
        # 列表页用**在售 SKU 的最低价**作为「起售价」，不能用停用的历史 SKU
        cheapest = min(active_skus, key=lambda item: item.price_cents)
        data["price_cents"] = cheapest.price_cents
        data["sku"] = {
            "id": cheapest.id,
            "name": cheapest.name,
            "price_cents": cheapest.price_cents,
            "stock": cheapest.stock,
        }
    return data


@router.get("/admin/sellers")
async def admin_sellers(
    keyword: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=16),
    seller_type: str | None = Query(default=None, max_length=16),
    kyc_status: str | None = Query(default=None, max_length=16),
    context: AuthContext = Depends(require_permission("seller:read")),
    db: AsyncSession = Depends(get_db),
):
    """卖家列表。keyword 同时匹配 用户名 / 用户ID / 卖家名。"""
    stmt = (
        select(Seller, User)
        .join(User, User.id == Seller.owner_user_id, isouter=True)
        .where(Seller.tenant_id == context.tenant.id)
    )
    if status:
        stmt = stmt.where(Seller.status == status)
    if seller_type:
        stmt = stmt.where(Seller.seller_type == seller_type)
    if kyc_status:
        stmt = stmt.where(Seller.kyc_status == kyc_status)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                Seller.display_name.ilike(pattern),
                User.username.ilike(pattern),
                User.public_id.ilike(pattern),
            )
        )
    rows = list((await db.execute(stmt.order_by(Seller.id))).all())
    return ok([_seller_dict(seller, owner) for seller, owner in rows])


@router.get("/admin/orders/{order_id}")
async def admin_order_detail(
    order_id: int,
    context: AuthContext = Depends(require_permission("order:read:tenant")),
    db: AsyncSession = Depends(get_db),
):
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    seller_orders = list(
        (
            await db.scalars(
                select(SellerOrder).where(
                    SellerOrder.tenant_id == context.tenant.id,
                    SellerOrder.order_id == order.id,
                )
            )
        ).all()
    )
    items = list(
        (
            await db.scalars(
                select(OrderItem).where(
                    OrderItem.tenant_id == context.tenant.id,
                    OrderItem.order_id == order.id,
                )
            )
        ).all()
    )
    buyer_identity = await _identity_map(db, {order.buyer_id})
    buyer_public_id, buyer_username = buyer_identity.get(order.buyer_id, (None, None))
    seller_identities = await _seller_identity_map(
        db, {item.seller_id for item in seller_orders}
    )
    return ok(
        {
            "id": order.id,
            "order_no": order.order_no,
            "buyer_id": order.buyer_id,
            "buyer_public_id": buyer_public_id,
            "buyer_username": buyer_username,
            "status": order.status,
            "payable_amount_cents": order.payable_amount_cents,
            "seller_orders": [
                {
                    "id": item.id,
                    "seller_id": item.seller_id,
                    **(seller_identities.get(item.seller_id) or {}),
                    "status": item.status,
                    "goods_amount_cents": item.goods_amount_cents,
                    "commission_amount_cents": item.commission_amount_cents,
                    "payable_to_seller_cents": item.payable_to_seller_cents,
                }
                for item in seller_orders
            ],
            "items": [_item_dict(item) for item in items],
        }
    )


@router.get("/admin/sellers/{seller_id}/ledger")
async def seller_ledger(
    seller_id: int,
    context: AuthContext = Depends(require_permission("payout:read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await finance_service.seller_ledger(db, context, seller_id))


@router.post("/admin/sellers/{seller_id}/payouts")
async def create_payout(
    seller_id: int,
    context: AuthContext = Depends(require_permission("payout:manage")),
    db: AsyncSession = Depends(get_db),
):
    payout = await finance_service.create_payout(
        db, context, seller_id, requested_by=context.user.id
    )
    return ok(
        {"id": payout.id, "amount_cents": payout.amount_cents, "status": payout.status}, "结算完成"
    )


@router.post("/admin/sellers/{seller_id}/review")
async def review_seller(
    seller_id: int,
    payload: SellerReviewRequest,
    context: AuthContext = Depends(require_permission("seller:kyc")),
    db: AsyncSession = Depends(get_db),
):
    seller = await db.get(Seller, seller_id)
    if seller is None or seller.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="卖家不存在")
    seller.status = payload.status
    seller.kyc_status = payload.kyc_status
    await db.commit()
    await db.refresh(seller)
    return ok(_seller_dict(seller), "卖家审核完成")


# 商品状态机：每一步只允许这些迁移，不能让 review 端点任意跳。
PRODUCT_STATUS_FLOW: dict[str, set[str]] = {
    "draft": {"pending_review"},
    "pending_review": {"on_sale", "rejected"},
    "rejected": {"pending_review"},
    "on_sale": {"off_sale"},
    "off_sale": {"on_sale"},
}
# 审核类迁移需要 product:moderate；上下架类需要 product:manage。
# 否则「有 manage 就能自行上架」= 审核形同虚设。
REVIEW_TRANSITIONS: set[tuple[str, str]] = {
    ("draft", "pending_review"),
    ("pending_review", "on_sale"),
    ("pending_review", "rejected"),
    ("rejected", "pending_review"),
}
STATUS_LABEL = {
    "draft": "草稿",
    "pending_review": "待审核",
    "on_sale": "在售",
    "off_sale": "已下架",
    "rejected": "已驳回",
}


async def _product_skus(db: AsyncSession, product_ids: list[int]) -> dict[int, list[ProductSku]]:
    if not product_ids:
        return {}
    rows = list(
        (
            await db.scalars(
                select(ProductSku)
                .where(ProductSku.product_id.in_(product_ids))
                .order_by(ProductSku.id)
            )
        ).all()
    )
    grouped: dict[int, list[ProductSku]] = {}
    for row in rows:
        grouped.setdefault(row.product_id, []).append(row)
    return grouped


async def _load_product(db: AsyncSession, context: AuthContext, product_id: int) -> Product:
    product = await db.get(Product, product_id)
    if product is None or product.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="商品不存在")
    return product


@router.get("/admin/categories", response_model=ApiResponse[list[dict]])
async def admin_categories(
    keyword: str | None = Query(default=None, max_length=64),
    context: AuthContext = Depends(require_permission("product:read")),
    db: AsyncSession = Depends(get_db),
):
    """租户端只读：商品分类是平台统一定的，租户只负责选。"""
    return ok(
        await category_service.list_categories(db, include_archived=False, keyword=keyword)
    )


async def _identity_map(db: AsyncSession, user_ids: set[int]) -> dict[int, tuple[str, str]]:
    """批量把 user_id 解成 (public_id, username)。全站口径：只给用户ID+用户名，不给裸 ID。"""
    if not user_ids:
        return {}
    users = (await db.scalars(select(User).where(User.id.in_(user_ids)))).all()
    return {user.id: (user.public_id, user.username) for user in users}


async def _seller_identity_map(db: AsyncSession, seller_ids: set[int]) -> dict[int, dict]:
    """卖家 id → {seller_name, seller_public_id, seller_username}。"""
    if not seller_ids:
        return {}
    sellers = (await db.scalars(select(Seller).where(Seller.id.in_(seller_ids)))).all()
    owners = await _identity_map(db, {seller.owner_user_id for seller in sellers})
    result: dict[int, dict] = {}
    for seller in sellers:
        public_id, username = owners.get(seller.owner_user_id, (None, None))
        result[seller.id] = {
            "seller_name": seller.display_name,
            "seller_public_id": public_id,
            "seller_username": username,
        }
    return result


@router.get("/admin/products")
async def admin_products(
    keyword: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=24),
    category_id: int | None = Query(default=None),
    product_type: str | None = Query(default=None, max_length=16),
    context: AuthContext = Depends(require_permission("product:read")),
    db: AsyncSession = Depends(get_db),
):
    """商品列表。keyword 同时匹配 商品名 / 卖家用户名 / 店铺名。"""
    stmt = (
        select(Product, Seller, Shop, User)
        .join(Seller, Seller.id == Product.seller_id, isouter=True)
        .join(Shop, Shop.id == Product.shop_id, isouter=True)
        .join(User, User.id == Seller.owner_user_id, isouter=True)
        .where(Product.tenant_id == context.tenant.id)
    )
    if status:
        stmt = stmt.where(Product.status == status)
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if product_type:
        stmt = stmt.where(Product.product_type == product_type)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(pattern),
                Shop.name.ilike(pattern),
                User.username.ilike(pattern),
            )
        )
    rows = list((await db.execute(stmt.order_by(Product.id.desc()))).all())
    skus = await _product_skus(db, [row[0].id for row in rows])
    # 销量/浏览/收藏/评分：一次批量查，和列表条目一起返回（口径见 services/catalog_stats）
    stats = await catalog_stats.stats_map(
        db, tenant_id=context.tenant.id, product_ids=[row[0].id for row in rows]
    )
    return ok(
        [
            {
                **_product_dict(
                    product,
                    skus=skus.get(product.id, []),
                    seller=seller,
                    shop=shop,
                    owner=owner,
                ),
                **stats.get(product.id, catalog_stats.ProductStats()).as_dict(),
            }
            for product, seller, shop, owner in rows
        ]
    )


@router.get("/admin/products/{product_id}")
async def admin_product_detail(
    product_id: int,
    context: AuthContext = Depends(require_permission("product:read")),
    db: AsyncSession = Depends(get_db),
):
    """商品详情（含全部 SKU 与规格树）。编辑弹窗要靠它回显描述/图片/规格/价格/库存。"""
    product = await _load_product(db, context, product_id)
    skus = (await _product_skus(db, [product.id])).get(product.id, [])
    seller = await db.get(Seller, product.seller_id)
    shop = await db.get(Shop, product.shop_id)
    owner = await db.get(User, seller.owner_user_id) if seller else None
    payload = _product_dict(product, skus=skus, seller=seller, shop=shop, owner=owner)
    payload["spec_groups"] = await catalog_specs.load_spec_groups(db, product.id)
    # 编辑弹窗顶部要显示「已售 / 浏览 / 收藏 / 评分」，与列表同一口径
    stats = await catalog_stats.stats_for(db, tenant_id=context.tenant.id, product_id=product.id)
    payload.update(stats.as_dict())
    return ok(payload)


@router.post("/admin/products/{product_id}/commission-unlock", response_model=ApiResponse[dict])
async def unlock_product_commission(
    product_id: int,
    context: AuthContext = Depends(require_permission("product:manage")),
    db: AsyncSession = Depends(get_db),
):
    """解除佣金锁定，把比例的决定权还给卖家（运营误调时的回退口）。"""
    product = await _load_product(db, context, product_id)
    product.commission_locked = False
    await audit_service.record(
        db,
        action=audit_service.ACTION_PRODUCT_UPDATED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="product",
        target_id=product.id,
        before={"commission_locked": "True"},
        after={"commission_locked": "False"},
    )
    await db.commit()
    return ok(
        {"id": product.id, "commission_locked": False, "commission_bps": product.commission_bps},
        "已解除锁定，卖家可自行修改佣金比例",
    )


@router.put("/admin/products/{product_id}/specs")
async def save_product_specs(
    product_id: int,
    payload: ProductSpecsUpdate,
    context: AuthContext = Depends(require_permission("product:manage")),
    db: AsyncSession = Depends(get_db),
):
    """整体保存规格树：笛卡尔积生成 SKU，老组合保留价/库存，消失的组合只停用。"""
    product = await _load_product(db, context, product_id)
    skus = await catalog_specs.save_specs(db, product, payload, context.tenant.id)
    await audit_service.record(
        db,
        action=audit_service.ACTION_PRODUCT_UPDATED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="product_specs",
        target_id=product.id,
        before=None,
        after={
            "groups": ",".join(group.name for group in payload.groups),
            "sku_count": str(len(skus)),
        },
    )
    await db.commit()
    await db.refresh(product)
    return ok(
        {
            "id": product.id,
            "status": product.status,
            "skus": [
                {
                    "id": sku.id,
                    "sku_code": sku.sku_code,
                    "name": sku.name,
                    "price_cents": sku.price_cents,
                    "stock": sku.stock,
                    "status": sku.status,
                    "specs": sku.specs or {},
                }
                for sku in skus
            ],
        },
        "规格已保存",
    )


# 只有这些字段允许自助改；状态必须走 /status（见 ProductUpdate 注释）。
PRODUCT_EDITABLE_FIELDS = ("name", "description", "main_image", "video_url", "images")


@router.put("/admin/products/{product_id}")
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    context: AuthContext = Depends(require_permission("product:manage")),
    db: AsyncSession = Depends(get_db),
):
    product = await _load_product(db, context, product_id)
    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data:
        await category_service.ensure_category_usable(db, data["category_id"])
    # 媒体字段的空串归一成 NULL：前端「清除」传 `''`，库里不应该出现空字符串
    for media_key in ("main_image", "video_url"):
        if media_key in data and not data[media_key]:
            data[media_key] = None
    applied: dict[str, object] = {}
    for key in PRODUCT_EDITABLE_FIELDS:
        if key in data:
            setattr(product, key, data[key])
            applied[key] = data[key]
    if "category_id" in data:
        product.category_id = data["category_id"]
        applied["category_id"] = data["category_id"]
    # ---- 富文本描述：服务端重新清洗 html，不信任前端传来的 html ----
    if "description_doc" in data or "description_html" in data:
        doc, html, text = rich_text.prepare_payload(
            data.get("description_doc"), data.get("description_html")
        )
        product.description_doc = doc
        product.description_html = html
        product.description_text = text
        product.description_format = "doc" if doc is not None else "text"
        # 审计里只记摘要：整份 doc 会把审计表灌炚
        applied["description"] = f"富文本（{len(text or '')} 字）"
        # 富文本里的图片也要发布给匿名买家看
        for url in rich_text.image_urls(html):
            await attachment_service.publish_by_public_url(db, context.tenant.id, url)
    if data.get("commission_bps") is not None:
        # 运营改比例 → 锁定，卖家不能再改回去（Q7）
        product.commission_bps = data["commission_bps"]
        product.commission_locked = True
        applied["commission_bps"] = data["commission_bps"]
    if "main_image" in applied:
        # 商品主图要给匿名访客看：引用的附件必须发布，否则前台只显示破图
        await attachment_service.publish_by_public_url(
            db, context.tenant.id, product.main_image
        )
    if "video_url" in applied:
        await attachment_service.publish_by_public_url(
            db, context.tenant.id, product.video_url
        )
    if "images" in applied:
        for image in product.images or []:
            await attachment_service.publish_by_public_url(db, context.tenant.id, image)
    if applied:
        await audit_service.record(
            db,
            action=audit_service.ACTION_PRODUCT_UPDATED,
            tenant_id=context.tenant.id,
            actor_id=context.user.id,
            target_type="product",
            target_id=product.id,
            before=None,
            after={key: str(value) for key, value in applied.items()},
        )
    await db.commit()
    await db.refresh(product)
    return ok(_product_dict(product), "商品已更新")


@router.post("/admin/products/{product_id}/status")
async def change_product_status(
    product_id: int,
    payload: ProductStatusRequest,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """上下架 / 审核统一入口：按状态机迁移，并按迁移类型校验权限。"""
    product = await _load_product(db, context, product_id)
    current, target = product.status, payload.status
    if target == current:
        return ok(_product_dict(product), "状态未变")
    if target not in PRODUCT_STATUS_FLOW.get(current, set()):
        raise HTTPException(
            status_code=400,
            detail=(
                f"不能从「{STATUS_LABEL.get(current, current)}」"
                f"直接改为「{STATUS_LABEL.get(target, target)}」"
            ),
        )
    required = (
        "product:moderate" if (current, target) in REVIEW_TRANSITIONS else "product:manage"
    )
    if required not in context.permissions:
        raise HTTPException(status_code=403, detail="无权限")

    if target == "on_sale":
        seller = await db.get(Seller, product.seller_id)
        if seller is None or seller.status != "active":
            raise HTTPException(status_code=400, detail="卖家未启用，不能上架")
        skus = (await _product_skus(db, [product.id])).get(product.id, [])
        active_skus = [item for item in skus if item.status == "active"]
        if not active_skus:
            raise HTTPException(status_code=400, detail="商品没有可用的 SKU，不能上架")
        if all(item.stock <= 0 for item in active_skus):
            raise HTTPException(status_code=400, detail="所有 SKU 库存为 0，先补货再上架")

    product.status = target
    # 驳回要留原因；上架/其他迁移清空上一次的驳回原因
    product.reject_reason = (payload.reason or None) if target == "rejected" else None
    await audit_service.record(
        db,
        action=audit_service.ACTION_PRODUCT_REVIEWED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="product",
        target_id=product.id,
        before={"status": current},
        after={"status": target},
    )
    await db.commit()
    await db.refresh(product)
    return ok(_product_dict(product), "商品状态已更新")


@router.put("/admin/products/{product_id}/skus/{sku_id}")
async def update_product_sku(
    product_id: int,
    sku_id: int,
    payload: ProductSkuUpdate,
    context: AuthContext = Depends(require_permission("product:manage")),
    db: AsyncSession = Depends(get_db),
):
    """改价 / 改库存。库存变化写 InventoryLog，保证与订单占用可对账。"""
    product = await _load_product(db, context, product_id)
    sku = await db.get(ProductSku, sku_id)
    if sku is None or sku.product_id != product.id or sku.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="SKU 不存在")

    changed: dict[str, object] = {}
    if payload.price_cents is not None and payload.price_cents != sku.price_cents:
        changed["price_cents"] = payload.price_cents
        sku.price_cents = payload.price_cents
    if payload.stock is not None and payload.stock != sku.stock:
        if payload.stock < sku.locked_stock:
            raise HTTPException(
                status_code=400,
                detail=f"库存不能低于已锁定数量（{sku.locked_stock}）",
            )
        delta = payload.stock - sku.stock
        sku.stock = payload.stock
        db.add(
            InventoryLog(
                tenant_id=context.tenant.id,
                seller_id=sku.seller_id,
                sku_id=sku.id,
                change=delta,
                reason="manual_adjust",
            )
        )
        changed["stock"] = payload.stock

    if changed:
        await audit_service.record(
            db,
            action=audit_service.ACTION_PRODUCT_UPDATED,
            tenant_id=context.tenant.id,
            actor_id=context.user.id,
            target_type="product_sku",
            target_id=sku.id,
            before=None,
            after={key: str(value) for key, value in changed.items()},
        )
    await db.commit()
    await db.refresh(product)
    skus = (await _product_skus(db, [product.id])).get(product.id, [])
    return ok(_product_dict(product, skus=skus), "SKU 已更新")


@router.get("/admin/orders")
async def admin_orders(
    keyword: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=24),
    context: AuthContext = Depends(require_permission("order:read:tenant")),
    db: AsyncSession = Depends(get_db),
):
    """订单列表。keyword 同时匹配 订单号 / 买家用户名 / 买家用户ID。"""
    stmt = (
        select(Order)
        .join(User, User.id == Order.buyer_id, isouter=True)
        .where(Order.tenant_id == context.tenant.id)
    )
    if status:
        stmt = stmt.where(Order.status == status)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                Order.order_no.ilike(pattern),
                User.username.ilike(pattern),
                User.public_id.ilike(pattern),
            )
        )
    orders = list((await db.scalars(stmt.order_by(Order.id.desc()))).all())
    order_ids = [order.id for order in orders]
    buyers = await _identity_map(db, {item.buyer_id for item in orders})
    # 商品行 + 卖家拆单都批量取一次：列表页要能直接看到「买了什么、发到哪一步」，
    # 否则必须点开详情抽屉，运营一屏只能处理一单。
    items_map = await _order_items_map(db, order_ids)
    seller_orders_map: dict[int, list[SellerOrder]] = {}
    if order_ids:
        rows = list(
            (
                await db.scalars(
                    select(SellerOrder)
                    .where(SellerOrder.order_id.in_(order_ids))
                    .order_by(SellerOrder.id)
                )
            ).all()
        )
        for row in rows:
            seller_orders_map.setdefault(row.order_id, []).append(row)
    seller_identities = await _seller_identity_map(
        db, {row.seller_id for rows in seller_orders_map.values() for row in rows}
    )
    payload = []
    for item in orders:
        public_id, username = buyers.get(item.buyer_id, (None, None))
        payload.append(
            {
                "id": item.id,
                "order_no": item.order_no,
                "buyer_id": item.buyer_id,
                "buyer_public_id": public_id,
                "buyer_username": username,
                "status": item.status,
                "payable_amount_cents": item.payable_amount_cents,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "items": [_item_dict(row) for row in items_map.get(item.id, [])],
                # 发货/退款是卖家单粒度，列表里也要能看到每个卖家单走到哪一步
                "seller_orders": [
                    {
                        "id": row.id,
                        "seller_id": row.seller_id,
                        **(seller_identities.get(row.seller_id) or {}),
                        "status": row.status,
                        "goods_amount_cents": row.goods_amount_cents,
                        "commission_amount_cents": row.commission_amount_cents,
                        "payable_to_seller_cents": row.payable_to_seller_cents,
                    }
                    for row in seller_orders_map.get(item.id, [])
                ],
            }
        )
    return ok(payload)


@router.post("/admin/orders/{order_id}/mock-pay")
async def mock_pay_order(
    order_id: int,
    context: AuthContext = Depends(require_permission("order:manage")),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.mock_pay(db, context, order_id)
    return ok({"id": order.id, "order_no": order.order_no, "status": order.status}, "支付成功")


@router.post("/admin/orders/{order_id}/cancel")
async def cancel_order(
    order_id: int,
    context: AuthContext = Depends(require_permission("order:manage")),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.cancel_order(db, context, order_id)
    return ok({"id": order.id, "order_no": order.order_no, "status": order.status}, "订单已取消")


@router.post("/admin/seller-orders/{seller_order_id}/ship")
async def ship_order(
    seller_order_id: int,
    payload: ShipmentCreateRequest,
    context: AuthContext = Depends(require_permission("order:manage")),
    db: AsyncSession = Depends(get_db),
):
    seller_order = await order_service.ship_seller_order(
        db, context, seller_order_id, payload.carrier, payload.tracking_no
    )
    return ok({"id": seller_order.id, "status": seller_order.status}, "发货成功")


@router.post("/admin/seller-orders/{seller_order_id}/refund")
async def refund_order(
    seller_order_id: int,
    payload: RefundCreateRequest,
    context: AuthContext = Depends(require_permission("order:refund")),
    db: AsyncSession = Depends(get_db),
):
    refund = await order_service.refund_seller_order(
        db, context, seller_order_id, payload.amount_cents, payload.reason
    )
    return ok({"id": refund.id, "status": refund.status}, "退款成功")


@router.post("/portal/orders/{order_id}/confirm")
async def confirm_order(
    order_id: int,
    context: AuthContext = Depends(require_permission("order:read:self")),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.confirm_order(db, context, order_id)
    return ok({"id": order.id, "status": order.status}, "已确认收货")


@router.post("/portal/orders/{order_id}/mock-pay")
async def mock_pay_portal_order(
    order_id: int,
    context: AuthContext = Depends(require_permission("order:read:self")),
    db: AsyncSession = Depends(get_db),
):
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != context.tenant.id or order.buyer_id != context.user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    order = await order_service.mock_pay(db, context, order_id)
    return ok({"id": order.id, "status": order.status}, "支付成功")


@router.get("/portal/products")
async def portal_products(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    products = list(
        (
            await db.scalars(
                select(Product)
                .where(
                    Product.tenant_id == context.tenant.id,
                    Product.status == "on_sale",
                )
                .order_by(Product.id.desc())
            )
        ).all()
    )
    result = []
    for product in products:
        sku = (
            await db.scalars(
                select(ProductSku).where(
                    ProductSku.tenant_id == context.tenant.id,
                    ProductSku.product_id == product.id,
                )
            )
        ).first()
        result.append(_product_dict(product, sku))
    return ok(result)


@router.post("/portal/orders")
async def create_portal_order(
    payload: OrderCreateRequest,
    context: AuthContext = Depends(require_permission("order:create")),
    db: AsyncSession = Depends(get_db),
):
    order = await order_service.create_order(db, context, payload)
    return ok(
        {
            "id": order.id,
            "order_no": order.order_no,
            "status": order.status,
            "payable_amount_cents": order.payable_amount_cents,
        },
        "订单创建成功",
    )


@router.get("/portal/orders")
async def portal_orders(
    context: AuthContext = Depends(require_permission("order:read:self")),
    db: AsyncSession = Depends(get_db),
):
    orders = list(
        (
            await db.scalars(
                select(Order)
                .where(
                    Order.tenant_id == context.tenant.id,
                    Order.buyer_id == context.user.id,
                )
                .order_by(Order.id.desc())
            )
        ).all()
    )
    items_map = await _order_items_map(db, [order.id for order in orders])
    return ok(
        [
            {
                "id": item.id,
                "order_no": item.order_no,
                "status": item.status,
                "payable_amount_cents": item.payable_amount_cents,
                "created_at": item.created_at,
                # 买家也要在列表里直接看到买的是什么，不用点进详情
                "items": [_item_dict(row) for row in items_map.get(item.id, [])],
            }
            for item in orders
        ]
    )


@router.get("/portal/orders/{order_id}")
async def portal_order_detail(
    order_id: int,
    context: AuthContext = Depends(require_permission("order:read:self")),
    db: AsyncSession = Depends(get_db),
):
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != context.tenant.id or order.buyer_id != context.user.id:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="订单不存在")
    seller_orders = list(
        (
            await db.scalars(
                select(SellerOrder).where(
                    SellerOrder.tenant_id == context.tenant.id,
                    SellerOrder.order_id == order.id,
                )
            )
        ).all()
    )
    items = list(
        (
            await db.scalars(
                select(OrderItem).where(
                    OrderItem.tenant_id == context.tenant.id,
                    OrderItem.order_id == order.id,
                )
            )
        ).all()
    )
    return ok(
        {
            "id": order.id,
            "order_no": order.order_no,
            "status": order.status,
            "payable_amount_cents": order.payable_amount_cents,
            "seller_orders": [
                {"id": item.id, "seller_id": item.seller_id, "status": item.status}
                for item in seller_orders
            ],
            "items": [_item_dict(item) for item in items],
        }
    )
