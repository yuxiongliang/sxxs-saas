"""订单确认页的预览：**只读**算出"这一单会买什么、多少钱、能不能买"。

价格与库存的最终裁判仍是 `order.create_order` / `cart.checkout`（提交时重新算一遍、加行锁）。
这里不做写操作，只把服务端看到的事实摆给用户确认，避免前端自己拿商品详情拼一份可能过期的清单。
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product, ProductSku
from app.models.seller import Seller, Shop
from app.services import cart as cart_service
from app.services import catalog_media
from app.services.auth import AuthContext

EXPRESS = "express"
PICKUP = "pickup"


def _issue(product: Product | None, sku: ProductSku | None, quantity: int, seller: Seller | None) -> str | None:
    if product is None or sku is None:
        return "商品已删除"
    if product.status == "deleted":
        return f"「{product.name}」已被删除"
    if product.status != "on_sale":
        return f"「{product.name}」已下架"
    if sku.status != "active":
        return f"「{product.name}」该规格已停售"
    if seller is None or seller.status != "active":
        return f"「{product.name}」的卖家不可用"
    if sku.stock < quantity:
        return f"「{product.name}」库存不足（仅剩 {sku.stock} 件）"
    return None


async def build_preview(
    db: AsyncSession,
    context: AuthContext,
    *,
    mode: str,
    sku_id: int | None = None,
    quantity: int = 1,
) -> dict:
    """`mode='buy'` 用 sku_id+quantity；`mode='cart'` 用购物车里已勾选的行。"""
    if mode == "buy":
        if sku_id is None:
            raise HTTPException(status_code=400, detail="缺少 sku_id")
        rows = [(sku_id, max(1, quantity))]
    elif mode == "cart":
        selected = await cart_service.selected_cart_items(db, context)
        rows = [(item.sku_id, item.quantity) for item in selected]
        if not rows:
            return {
                "items": [],
                "sellers": [],
                "total_cents": 0,
                "issues": ["购物车里没有已勾选的商品"],
            }
    else:
        raise HTTPException(status_code=400, detail="未知的结算来源")

    items: list[dict] = []
    sellers: dict[int, dict] = {}
    issues: list[str] = []
    total = 0

    # 图片一次算完：清单可能十几行，逐行查规格值图就是 N+1
    pairs: list[tuple[Product | None, ProductSku | None]] = []
    for current_sku_id, _ in rows:
        preview_sku = await db.get(ProductSku, current_sku_id)
        preview_product = (
            await db.get(Product, preview_sku.product_id) if preview_sku else None
        )
        pairs.append((preview_product, preview_sku))
    images = await catalog_media.effective_image_map(db, pairs)

    for current_sku_id, current_quantity in rows:
        sku = await db.get(ProductSku, current_sku_id)
        product = await db.get(Product, sku.product_id) if sku else None
        seller = await db.get(Seller, product.seller_id) if product else None
        shop = await db.get(Shop, product.shop_id) if product else None

        problem = _issue(product, sku, current_quantity, seller)
        if problem:
            issues.append(problem)
        if product is None or sku is None or seller is None:
            continue

        subtotal = sku.price_cents * current_quantity
        total += subtotal
        items.append(
            {
                "sku_id": sku.id,
                "product_id": product.id,
                "seller_id": seller.id,
                "shop_name": shop.name if shop else None,
                # 买家侧只展示用户名（全站口径的买家侧例外，见 docs）
                "seller_username": None,
                "product_name": product.name,
                "sku_name": sku.name,
                # 图优先取 SKU 图，和下单快照一致
                "image": images.get(sku.id),
                "price_cents": sku.price_cents,
                "quantity": current_quantity,
                "subtotal_cents": subtotal,
                "delivery_methods": product.delivery_methods or [EXPRESS],
            }
        )
        sellers.setdefault(
            seller.id,
            {
                "seller_id": seller.id,
                "shop_name": shop.name if shop else None,
                "delivery_methods": product.delivery_methods or [EXPRESS],
                "pickup_address": shop.address if shop else None,
                "pickup_note": shop.pickup_note if shop else None,
            },
        )

    # 卖家展示信息：买家侧只给「店铺名 + 用户名」，不出现 usr_ 编号
    if sellers:
        from app.models.user import User

        rows = (
            await db.execute(
                select(Seller.id, Seller.display_name, User.username)
                .join(User, User.id == Seller.owner_user_id, isouter=True)
                .where(Seller.id.in_(list(sellers)))
            )
        ).all()
        for seller_id, display_name, username in rows:
            payload = sellers[seller_id]
            payload["seller_name"] = display_name
            payload["seller_username"] = username
        for item in items:
            item["seller_username"] = sellers[item["seller_id"]].get("seller_username")

    return {
        "items": items,
        "sellers": list(sellers.values()),
        "total_cents": total,
        "issues": issues,
    }
