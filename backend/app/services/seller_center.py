import secrets
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import InventoryLog, Product, ProductSku
from app.models.order import OrderItem, SellerOrder, Shipment
from app.models.seller import Seller, SellerMember, Shop
from app.schemas.commerce import (
    ProductSpecsUpdate,
    SellerProductCreate,
    SellerProductStatusRequest,
    SellerProductUpdate,
)
from app.services import attachment as attachment_service
from app.services import audit as audit_service
from app.services import catalog_specs, catalog_stats, rich_text
from app.services import category as category_service
from app.services import finance as finance_service
from app.services.auth import AuthContext


async def current_seller(db: AsyncSession, context: AuthContext) -> tuple[Seller, Shop | None]:
    seller = (
        await db.scalars(
            select(Seller)
            .join(SellerMember, SellerMember.seller_id == Seller.id)
            .where(
                Seller.tenant_id == context.tenant.id,
                SellerMember.user_id == context.user.id,
                SellerMember.status == "active",
                Seller.status == "active",
            )
        )
    ).first()
    if seller is None:
        raise HTTPException(status_code=403, detail="当前账号不是卖家")
    shop = (
        await db.scalars(
            select(Shop).where(Shop.tenant_id == context.tenant.id, Shop.seller_id == seller.id)
        )
    ).first()
    return seller, shop


async def seller_products(
    db: AsyncSession, context: AuthContext, product_type: str | None = None
) -> list[dict]:
    seller, _ = await current_seller(db, context)
    stmt = select(Product).where(
        Product.tenant_id == context.tenant.id,
        Product.seller_id == seller.id,
    )
    if product_type:
        stmt = stmt.where(Product.product_type == product_type)
    products = list((await db.scalars(stmt.order_by(Product.id.desc()))).all())
    result = []
    # 销量/浏览/收藏/评分：和租户运营端、平台端同一口径（services/catalog_stats.py）
    stats = await catalog_stats.stats_map(
        db, tenant_id=context.tenant.id, product_ids=[product.id for product in products]
    )
    for product in products:
        sku = (
            await db.scalars(
                select(ProductSku).where(
                    ProductSku.tenant_id == context.tenant.id,
                    ProductSku.product_id == product.id,
                )
            )
        ).first()
        result.append(
            {
                "id": product.id,
                "name": product.name,
                "description": product.description,
                "description_format": product.description_format,
                "description_doc": product.description_doc,
                "description_html": product.description_html,
                "main_image": product.main_image,
                "video_url": product.video_url,
                "status": product.status,
                # 商品类型：卖家列表也要显示，创建后不可改
                "product_type": product.product_type,
                # 驳回原因要给卖家看，否则只能反复重提
                "reject_reason": product.reject_reason,
                # 卖家要看得到自己设的佣金比例，以及是否被运营锁住
                "category_id": product.category_id,
                "commission_bps": product.commission_bps,
                "commission_locked": bool(product.commission_locked),
                "price_cents": sku.price_cents if sku else 0,
                "stock": sku.stock if sku else 0,
                "sku_id": sku.id if sku else None,
                "locked_stock": sku.locked_stock if sku else 0,
                **stats.get(product.id, catalog_stats.ProductStats()).as_dict(),
            }
        )
    return result


async def _own_product(db: AsyncSession, context: AuthContext, product_id: int) -> Product:
    """卖家只能动自己的商品：归属校验靠 current_seller()，不靠权限码。"""
    seller, _ = await current_seller(db, context)
    product = await db.get(Product, product_id)
    if product is None or product.tenant_id != context.tenant.id or product.seller_id != seller.id:
        raise HTTPException(status_code=404, detail="商品不存在")
    return product


async def seller_product_detail(
    db: AsyncSession, context: AuthContext, product_id: int
) -> dict:
    """卖家看自己商品的详情（含规格树与全部 SKU）。

    与运营端 `GET /admin/products/{id}` **同一个形状**：编辑向导是同一套组件，
    少一个字段就要在前端写分支，迟早两边走样。
    """
    product = await _own_product(db, context, product_id)
    skus = list(
        (
            await db.scalars(
                select(ProductSku)
                .where(ProductSku.product_id == product.id)
                .order_by(ProductSku.id)
            )
        ).all()
    )
    return {
        "id": product.id,
        "seller_id": product.seller_id,
        "shop_id": product.shop_id,
        "category_id": product.category_id,
        "name": product.name,
        "product_type": product.product_type,
        "description": product.description,
        "description_format": product.description_format,
        "description_doc": product.description_doc,
        "description_html": product.description_html,
        "status": product.status,
        "main_image": product.main_image,
        "images": product.images or [],
        "video_url": product.video_url,
        "reject_reason": product.reject_reason,
        "commission_bps": product.commission_bps,
        "commission_locked": bool(product.commission_locked),
        "spec_groups": await catalog_specs.load_spec_groups(db, product.id),
        "skus": [
            {
                "id": sku.id,
                "sku_code": sku.sku_code,
                "name": sku.name,
                "price_cents": sku.price_cents,
                "stock": sku.stock,
                "locked_stock": sku.locked_stock,
                "status": sku.status,
                "specs": sku.specs or {},
                "image_url": sku.image_url,
                "video_url": sku.video_url,
            }
            for sku in skus
        ],
    }


async def save_seller_product_specs(
    db: AsyncSession, context: AuthContext, product_id: int, payload: ProductSpecsUpdate
) -> dict:
    """卖家改自己的规格树。

    和运营端的差别只有一处，但很关键：**卖家改规格要重新过审**。
    运营端保存不回退状态（那是内部纠错），卖家保存属于「卖的东西变了」，
    不退审就等于先过审再换货。
    """
    product = await _own_product(db, context, product_id)
    skus = await catalog_specs.save_specs(db, product, payload, context.tenant.id)
    bounced = False
    if product.status == "on_sale":
        product.status = "pending_review"
        product.reject_reason = None
        bounced = True
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
            "bounced_to_review": str(bounced),
        },
    )
    await db.commit()
    await db.refresh(product)
    return {
        "id": product.id,
        "status": product.status,
        "bounced_to_review": bounced,
        "skus": [
            {
                "id": sku.id,
                "price_cents": sku.price_cents,
                "stock": sku.stock,
                "status": sku.status,
                "specs": sku.specs or {},
            }
            for sku in skus
        ],
    }


async def update_seller_product(
    db: AsyncSession, context: AuthContext, product_id: int, payload: SellerProductUpdate
) -> dict:
    """卖家改自己的商品。在售商品改动后自动打回待审核。"""
    product = await _own_product(db, context, product_id)
    data = payload.model_dump(exclude_unset=True)
    # 媒体字段的空串归一成 NULL（前端「清除」传 `''`）
    for media_key in ("main_image", "video_url"):
        if media_key in data and not data[media_key]:
            data[media_key] = None

    # 分类变更也算内容变更（换分类等于换展示位，必须重新过审）
    category_changed = False
    if "category_id" in data and data["category_id"] != product.category_id:
        await category_service.ensure_category_usable(db, data["category_id"])
        product.category_id = data["category_id"]
        category_changed = True

    content_changed = category_changed
    for key in ("name", "description", "main_image", "video_url"):
        if key in data and getattr(product, key) != data[key]:
            setattr(product, key, data[key])
            content_changed = True
    # ---- 富文本描述：与运营端同一条口径，服务端重新清洗 ----
    if "description_doc" in data or "description_html" in data:
        doc, html, text = rich_text.prepare_payload(
            data.get("description_doc"), data.get("description_html")
        )
        product.description_doc = doc
        product.description_html = html
        product.description_text = text
        product.description_format = "doc" if doc is not None else "text"
        content_changed = True
        for url in rich_text.image_urls(html):
            await attachment_service.publish_by_public_url(db, context.tenant.id, url)
    if content_changed and ("main_image" in data or "video_url" in data):
        # 卖家上传的主图/视频也要发布给匿名访客看（原来只有控制台路径做了，卖家路径漏了）
        await attachment_service.publish_by_public_url(
            db, context.tenant.id, product.main_image
        )
        await attachment_service.publish_by_public_url(
            db, context.tenant.id, product.video_url
        )

    if data.get("commission_bps") is not None:
        # 运营调过比例就锁住，卖家不能再改回去（否则锁定等于没锁）
        if product.commission_locked:
            raise HTTPException(
                status_code=403,
                detail="该商品的佣金比例已被运营调整，卖家不能再改；如有异议请联系运营",
            )
        product.commission_bps = data["commission_bps"]

    # 多规格后不能“猜第一条 SKU”：卖家改价/改库存必须指明 sku_id，
    # 否则会静默改到别的规格上（库存流水也跟着错）。
    all_skus = list(
        (
            await db.scalars(
                select(ProductSku)
                .where(ProductSku.product_id == product.id)
                .order_by(ProductSku.id)
            )
        ).all()
    )
    wanted_sku_id = data.pop("sku_id", None)
    if wanted_sku_id is not None:
        sku = next((item for item in all_skus if item.id == wanted_sku_id), None)
        if sku is None:
            raise HTTPException(status_code=404, detail="SKU 不存在")
    elif len(all_skus) > 1 and ("price_cents" in data or "stock" in data):
        raise HTTPException(
            status_code=400,
            detail="多规格商品改价/改库存请指定 sku_id",
        )
    else:
        sku = all_skus[0] if all_skus else None
    price_changed = False
    stock_changed = False
    if sku is not None:
        if "price_cents" in data and data["price_cents"] != sku.price_cents:
            sku.price_cents = data["price_cents"]
            price_changed = True
        if "stock" in data and data["stock"] != sku.stock:
            if data["stock"] < sku.locked_stock:
                raise HTTPException(
                    status_code=400,
                    detail=f"库存不能低于已锁定数量（{sku.locked_stock}）",
                )
            delta = data["stock"] - sku.stock
            sku.stock = data["stock"]
            db.add(
                InventoryLog(
                    tenant_id=context.tenant.id,
                    seller_id=sku.seller_id,
                    sku_id=sku.id,
                    change=delta,
                    reason="seller_adjust",
                )
            )
            stock_changed = True

    bounced = False
    if product.status == "on_sale" and (content_changed or price_changed):
        # 过审后又改内容/价格：必须重新审，否则可以先过审再换成违规内容。
        product.status = "pending_review"
        product.reject_reason = None
        bounced = True

    if content_changed or price_changed or stock_changed or bounced:
        await audit_service.record(
            db,
            action=audit_service.ACTION_PRODUCT_UPDATED,
            tenant_id=context.tenant.id,
            actor_id=context.user.id,
            target_type="product",
            target_id=product.id,
            before=None,
            after={
                "fields": ",".join(sorted(data.keys())),
                "bounced_to_review": str(bounced),
            },
        )
    await db.commit()
    await db.refresh(product)
    return {
        "id": product.id,
        "name": product.name,
        "status": product.status,
        "reject_reason": product.reject_reason,
        "price_cents": sku.price_cents if sku else 0,
        "stock": sku.stock if sku else 0,
        "bounced_to_review": bounced,
    }


async def change_seller_product_status(
    db: AsyncSession,
    context: AuthContext,
    product_id: int,
    payload: SellerProductStatusRequest,
) -> dict:
    """卖家能做的状态变更：自己下架、被驳回后重新提交。"""
    product = await _own_product(db, context, product_id)
    current, target = product.status, payload.status

    if target == "off_sale":
        if current != "on_sale":
            raise HTTPException(status_code=400, detail="只有在售商品可以下架")
    elif target == "pending_review":
        if current not in {"rejected", "draft", "off_sale"}:
            raise HTTPException(
                status_code=400, detail="只有被驳回/草稿/已下架的商品可以重新提交审核"
            )
    else:  # pragma: no cover - schema 已限死两个值
        raise HTTPException(status_code=400, detail="不支持的状态")

    before = product.status
    product.status = target
    # 重新提审时清空上次的驳回原因
    product.reject_reason = None
    await audit_service.record(
        db,
        action=audit_service.ACTION_PRODUCT_REVIEWED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="product",
        target_id=product.id,
        before={"status": before},
        after={"status": target},
    )
    await db.commit()
    await db.refresh(product)
    return {"id": product.id, "status": product.status}


async def create_seller_product(
    db: AsyncSession, context: AuthContext, payload: SellerProductCreate
) -> dict:
    seller, shop = await current_seller(db, context)
    if shop is None:
        raise HTTPException(status_code=400, detail="卖家店铺不存在")
    # 只有实物商品已打通下单/库存/发货/退款；其它三类先拒，
    # 否则库里会出现一堆没有配套逻辑的「虚拟商品」
    if payload.product_type != "physical":
        raise HTTPException(
            status_code=400,
            detail="该商品类型待开发，目前仅支持实物商品",
        )
    await category_service.ensure_category_usable(db, payload.category_id)
    product = Product(
        tenant_id=context.tenant.id,
        seller_id=seller.id,
        shop_id=shop.id,
        category_id=payload.category_id,
        name=payload.name,
        product_type=payload.product_type,
        main_image=payload.main_image or None,
        video_url=payload.video_url or None,
        status="pending_review",
        created_by=context.user.id,
    )
    # 描述：纯文本兜底 + 富文本（服务端重新清洗后落库，和运营端同一条口径）
    if payload.description:
        product.description = payload.description
    if payload.description_doc or payload.description_html:
        doc, html, text = rich_text.prepare_payload(
            payload.description_doc, payload.description_html
        )
        product.description_doc = doc
        product.description_html = html
        product.description_text = text
        product.description_format = "doc"
    db.add(product)
    await db.flush()
    # 主图/视频是给匿名买家看的，引用的附件必须发布
    await attachment_service.publish_by_public_url(
        db, context.tenant.id, product.main_image
    )
    await attachment_service.publish_by_public_url(
        db, context.tenant.id, product.video_url
    )
    db.add(
        ProductSku(
            tenant_id=context.tenant.id,
            seller_id=seller.id,
            product_id=product.id,
            sku_code=f"SKU-{product.id}",
            name=payload.name,
            price_cents=payload.price_cents,
            stock=payload.stock,
            status="active",
        )
    )
    await db.commit()
    return {"id": product.id, "name": product.name, "status": product.status}


async def ship_seller_order(
    db: AsyncSession,
    context: AuthContext,
    seller_order_id: int,
    carrier: str,
    tracking_no: str,
) -> dict:
    seller, _ = await current_seller(db, context)
    seller_order = await db.get(SellerOrder, seller_order_id)
    if (
        seller_order is None
        or seller_order.tenant_id != context.tenant.id
        or seller_order.seller_id != seller.id
    ):
        raise HTTPException(status_code=404, detail="卖家订单不存在")
    if seller_order.status not in {"paid", "processing"}:
        raise HTTPException(status_code=400, detail="当前卖家订单不可发货")
    seller_order.status = "shipped"
    seller_order.shipped_at = datetime.now(UTC)
    db.add(
        Shipment(
            tenant_id=context.tenant.id,
            seller_order_id=seller_order.id,
            carrier=carrier,
            tracking_no=tracking_no,
            status="shipped",
        )
    )
    await db.commit()
    return {"id": seller_order.id, "status": seller_order.status}


async def request_payout(db: AsyncSession, context: AuthContext):
    seller, _ = await current_seller(db, context)
    return await finance_service.create_payout(db, context, seller.id, requested_by=context.user.id)


async def seller_orders(db: AsyncSession, context: AuthContext) -> list[dict]:
    seller, _ = await current_seller(db, context)
    orders = list(
        (
            await db.scalars(
                select(SellerOrder)
                .where(
                    SellerOrder.tenant_id == context.tenant.id,
                    SellerOrder.seller_id == seller.id,
                )
                .order_by(SellerOrder.id.desc())
            )
        ).all()
    )
    # 卖家要知道自己到底卖了什么：图片/名称/规格/类型都从订单行快照取，
    # 原来只回金额，卖家只能靠记性或去问运营。
    items_map: dict[int, list[OrderItem]] = {}
    if orders:
        rows = list(
            (
                await db.scalars(
                    select(OrderItem).where(
                        OrderItem.seller_order_id.in_([item.id for item in orders])
                    )
                )
            ).all()
        )
        for row in rows:
            items_map.setdefault(row.seller_order_id, []).append(row)
    return [
        {
            "id": item.id,
            "order_id": item.order_id,
            "seller_order_no": item.seller_order_no,
            "status": item.status,
            "goods_amount_cents": item.goods_amount_cents,
            "commission_amount_cents": item.commission_amount_cents,
            "payable_to_seller_cents": item.payable_to_seller_cents,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "items": [
                {
                    "id": row.id,
                    "product_id": row.product_id,
                    "product_type": row.product_type or "physical",
                    "product_name": row.product_name,
                    "sku_name": row.sku_name,
                    "image": row.image,
                    "price_cents": row.price_cents,
                    "quantity": row.quantity,
                    "subtotal_cents": row.subtotal_cents,
                }
                for row in items_map.get(item.id, [])
            ],
        }
        for item in orders
    ]


async def _find_membership(
    db: AsyncSession, context: AuthContext
) -> tuple[Seller, Shop | None] | None:
    """按成员关系找卖家（不看 status），用于区分「没申请」和「审核中」。"""
    seller = (
        await db.scalars(
            select(Seller)
            .join(SellerMember, SellerMember.seller_id == Seller.id)
            .where(
                Seller.tenant_id == context.tenant.id,
                SellerMember.user_id == context.user.id,
                SellerMember.status == "active",
            )
        )
    ).first()
    if seller is None:
        return None
    shop = (
        await db.scalars(
            select(Shop).where(Shop.tenant_id == context.tenant.id, Shop.seller_id == seller.id)
        )
    ).first()
    return seller, shop


async def seller_application(db: AsyncSession, context: AuthContext) -> dict:
    """当前用户的开店状态：未申请 / 审核中 / 已通过（被拒则回落为未申请）。"""
    found = await _find_membership(db, context)
    if found is None:
        return {"has_seller": False, "status": "none", "shop": None}
    seller, shop = found
    return {
        "has_seller": True,
        "status": seller.status,
        "seller_id": seller.id,
        "display_name": seller.display_name,
        "kyc_status": seller.kyc_status,
        "shop": (
            {"id": shop.id, "name": shop.name, "slug": shop.slug, "status": shop.status}
            if shop
            else None
        ),
    }


async def apply_seller(
    db: AsyncSession, context: AuthContext, shop_name: str, contact_phone: str = ""
) -> dict:
    """买家自助申请开店：建 pending 的卖家 + 店铺 + 店主成员关系。

    幂等语义：已经申请过（含审核中）返回 409，避免重复插入卖家/店铺。
    """
    found = await _find_membership(db, context)
    if found is not None:
        seller, _shop = found
        label = "审核中" if seller.status == "pending" else "已成为店主"
        raise HTTPException(status_code=409, detail=f"你{label}，无需重复申请")

    seller = Seller(
        tenant_id=context.tenant.id,
        owner_user_id=context.user.id,
        display_name=shop_name,
        seller_type="individual",
        status="pending",
        kyc_status="pending",
        contact_phone=contact_phone or None,
    )
    db.add(seller)
    await db.flush()

    shop = Shop(
        tenant_id=context.tenant.id,
        seller_id=seller.id,
        name=shop_name,
        slug=f"shop-{secrets.token_hex(4)}",
        status="active",
    )
    db.add(shop)
    db.add(
        SellerMember(
            tenant_id=context.tenant.id,
            seller_id=seller.id,
            user_id=context.user.id,
            role="owner",
            status="active",
        )
    )
    await audit_service.record(
        db,
        action=audit_service.ACTION_SELLER_APPLIED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="seller",
        target_id=seller.id,
        after={"display_name": shop_name, "status": "pending"},
    )
    await db.commit()
    await db.refresh(seller)
    await db.refresh(shop)
    return {
        "has_seller": True,
        "status": seller.status,
        "seller_id": seller.id,
        "display_name": seller.display_name,
        "kyc_status": seller.kyc_status,
        "shop": {"id": shop.id, "name": shop.name, "slug": shop.slug, "status": shop.status},
    }
