import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product, ProductSku
from app.models.order import (
    Order,
    OrderItem,
    Payment,
    Refund,
    SellerOrder,
    Shipment,
)
from app.models.seller import Seller, Shop
from app.schemas.order import OrderCreateRequest
from app.services import audit as audit_service
from app.services import catalog_media
from app.services import finance as finance_service
from app.services import jobs as jobs_service
from app.services import order_state as st
from app.services import time_control
from app.services import wallet as wallet_service
from app.services.auth import AuthContext

EXPRESS = "express"
PICKUP = "pickup"
DELIVERY_METHODS = (EXPRESS, PICKUP)


def _order_no(prefix: str) -> str:
    return f"{prefix}{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}{secrets.token_hex(3).upper()}"


async def _seller_orders(db: AsyncSession, order_id: int) -> list[SellerOrder]:
    return list(
        (
            await db.scalars(
                select(SellerOrder)
                .where(SellerOrder.order_id == order_id)
                .order_by(SellerOrder.id)
            )
        ).all()
    )


def _sync(order: Order, siblings: list[SellerOrder]) -> None:
    """订单两个状态由卖家单汇总（规则见 services/order_state.py）。"""
    st.sync_order(order, siblings)


async def create_order(
    db: AsyncSession, context: AuthContext, payload: OrderCreateRequest
) -> Order:
    sku_ids = [item.sku_id for item in payload.items]
    skus = list(
        (
            await db.scalars(
                select(ProductSku)
                .where(
                    ProductSku.tenant_id == context.tenant.id,
                    ProductSku.id.in_(sku_ids),
                    ProductSku.status == "active",
                )
                .with_for_update()
            )
        ).all()
    )
    sku_map = {item.id: item for item in skus}
    if len(sku_map) != len(set(sku_ids)):
        raise HTTPException(status_code=400, detail="部分 SKU 不存在或已下架")

    # 买家按**卖家**选交付方式（一单可拆多卖家单，可能一个快递一个自提）
    chosen = {item.seller_id: item.delivery_method for item in payload.delivery}

    total = 0
    lines = []
    for item in payload.items:
        sku = sku_map[item.sku_id]
        if sku.stock < item.quantity:
            raise HTTPException(status_code=409, detail=f"SKU {sku.sku_code} 库存不足")
        product = await db.get(Product, sku.product_id)
        if product is None or product.status != "on_sale":
            raise HTTPException(status_code=400, detail="商品已下架")
        seller = await db.get(Seller, sku.seller_id)
        shop = await db.get(Shop, product.shop_id)
        if seller is None or shop is None or seller.status != "active":
            raise HTTPException(status_code=400, detail="卖家或店铺不可用")

        # 交付方式必须在该商品支持范围内（商品可能只支持自提，或两个都支持）
        supported = product.delivery_methods or [EXPRESS]
        method = chosen.get(seller.id) or (
            EXPRESS if EXPRESS in supported else supported[0]
        )
        if method not in supported:
            raise HTTPException(
                status_code=400,
                detail=f"商品「{product.name}」不支持该交付方式",
            )

        subtotal = sku.price_cents * item.quantity
        total += subtotal
        lines.append((sku, product, shop, seller, item.quantity, subtotal, method))

    # 自提单不需要收货地址：只留联系人 + 手机号
    has_express = any(line[6] == EXPRESS for line in lines)
    if has_express and not payload.receiver_address:
        raise HTTPException(status_code=400, detail="物流快递需要填写收货地址")

    # 待支付自动关闭：截止时间**下单时定死**，之后租户改配置不影响这一单
    control = await time_control.resolve(db, context.tenant.id)
    now = datetime.now(UTC)
    expires_at = time_control.unpaid_close_deadline(control, now)

    order = Order(
        tenant_id=context.tenant.id,
        order_no=_order_no("ORD"),
        buyer_id=context.user.id,
        payment_status=st.PAY_UNPAID,
        fulfillment_status=st.FULFILL_AWAITING_PAYMENT,
        total_amount_cents=total,
        payable_amount_cents=total,
        receiver_name=payload.receiver_name,
        receiver_phone=payload.receiver_phone,
        receiver_address=payload.receiver_address,
        remark=payload.remark,
        expires_at=expires_at,
    )
    db.add(order)
    await db.flush()
    if expires_at is not None:
        await jobs_service.schedule(
            db,
            tenant_id=context.tenant.id,
            kind=jobs_service.KIND_CLOSE_UNPAID,
            ref_type="order",
            ref_id=order.id,
            run_at=expires_at,
            meta={
                "rule": "unpaid_close",
                "days": control.unpaid_close_days,
            },
        )

    seller_orders: dict[int, SellerOrder] = {}
    for sku, product, shop, seller, quantity, subtotal, method in lines:
        seller_order = seller_orders.get(seller.id)
        if seller_order is None:
            seller_order = SellerOrder(
                tenant_id=context.tenant.id,
                order_id=order.id,
                seller_id=seller.id,
                shop_id=shop.id,
                seller_order_no=_order_no("SO"),
                payment_status=st.PAY_UNPAID,
                fulfillment_status=st.FULFILL_AWAITING_PAYMENT,
                delivery_method=method,
                goods_amount_cents=0,
                commission_amount_cents=0,
                payable_to_seller_cents=0,
            )
            db.add(seller_order)
            await db.flush()
            seller_orders[seller.id] = seller_order
        seller_order.goods_amount_cents += subtotal
        # 租户向卖家抽佣：商品级比例 > 分类默认 > 系统 10%（比例与来源落快照）
        rate_bps, rate_source = await finance_service.resolve_commission_rate(db, product)
        commission = finance_service.compute_commission(subtotal, rate_bps)
        seller_order.commission_amount_cents += commission
        seller_order.payable_to_seller_cents += subtotal - commission
        db.add(
            OrderItem(
                tenant_id=context.tenant.id,
                order_id=order.id,
                seller_order_id=seller_order.id,
                seller_id=seller.id,
                product_id=product.id,
                sku_id=sku.id,
                product_name=product.name,
                sku_name=sku.name,
                # 类型快照：商品以后改类型也不影响已成交订单的语义
                product_type=product.product_type,
                # 交付方式快照（列表直接展示，不用再回查卖家单）
                delivery_method=method,
                # 订单快照的图取**成交图**（SKU 覆盖图 > 规格值图 > 主图），
                # 与详情页/确认页同一口径，否则买家收到的图和买的对不上
                image=await catalog_media.effective_image(db, product, sku),
                price_cents=sku.price_cents,
                quantity=quantity,
                subtotal_cents=subtotal,
                commission_rate_bps=rate_bps,
                commission_source=rate_source,
            )
        )
        sku.stock -= quantity
        sku.locked_stock += quantity

    await audit_service.record(
        db,
        action=audit_service.ACTION_ORDER_CREATED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="order",
        target_id=order.id,
        after={
            "order_no": order.order_no,
            "payable_amount_cents": order.payable_amount_cents,
            "seller_order_count": len(seller_orders),
            "delivery_methods": ",".join(
                sorted({item.delivery_method for item in seller_orders.values()})
            ),
            "items": [{"sku_id": item.sku_id, "quantity": item.quantity} for item in payload.items],
        },
    )
    await db.commit()
    await db.refresh(order)
    return order


async def mock_pay(db: AsyncSession, context: AuthContext, order_id: int) -> Order:
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    return await mark_order_paid(db, context, order, provider="mock")


async def mark_order_paid(
    db: AsyncSession,
    context: AuthContext,
    order: Order,
    *,
    provider: str = "mock",
    commit: bool = True,
) -> Order:
    """把订单置为已支付。

    **所有支付渠道共用这一段**（余额 / 微信 / 支付宝 / 运营模拟）——
    各写一份的话，库存解锁、台账记账、状态派生迟早有一处漏掉。
    `commit=False` 让调用方（余额支付）把扣款与订单置位放进同一个事务。
    """
    if order.payment_status == st.PAY_PAID:
        return order
    if order.payment_status != st.PAY_UNPAID:
        raise HTTPException(status_code=400, detail="当前订单状态不可支付")
    order.paid_at = datetime.now(UTC)
    # 已付款，待支付关闭任务必须撤掉：否则到了点会把已付款订单关掉
    await jobs_service.cancel(
        db,
        kind=jobs_service.KIND_CLOSE_UNPAID,
        ref_type="order",
        ref_id=order.id,
        reason="订单已支付",
    )
    seller_orders = await _seller_orders(db, order.id)
    for seller_order in seller_orders:
        seller_order.payment_status = st.PAY_PAID
        if seller_order.fulfillment_status == st.FULFILL_AWAITING_PAYMENT:
            seller_order.fulfillment_status = st.FULFILL_TO_SHIP
        await finance_service.record_order_ledger(db, seller_order)
    _sync(order, seller_orders)

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
    for item in items:
        sku = await db.get(ProductSku, item.sku_id)
        if sku is not None and sku.locked_stock >= item.quantity:
            sku.locked_stock -= item.quantity
    # 已有该渠道的 pending 记录就复用（真实支付回调会先建 pending），
    # 否则同一笔支付会留下两行，对账时对不上
    existing_payment = (
        await db.scalars(
            select(Payment)
            .where(
                Payment.order_id == order.id,
                Payment.provider == provider,
                Payment.status == "pending",
            )
            .order_by(Payment.id.desc())
        )
    ).first()
    if existing_payment is not None:
        existing_payment.status = "success"
        existing_payment.paid_at = order.paid_at
        existing_payment.amount_cents = order.payable_amount_cents
    else:
        db.add(
            Payment(
                tenant_id=context.tenant.id,
                order_id=order.id,
                provider=provider,
                provider_trade_no=f"{provider.upper()}-{order.order_no}",
                amount_cents=order.payable_amount_cents,
                status="success",
                paid_at=order.paid_at,
            )
        )
    await audit_service.record(
        db,
        action=audit_service.ACTION_ORDER_PAID,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="order",
        target_id=order.id,
        before={"payment_status": st.PAY_UNPAID},
        after={
            "payment_status": st.PAY_PAID,
            "fulfillment_status": order.fulfillment_status,
            "order_no": order.order_no,
            "amount_cents": order.payable_amount_cents,
            "provider": provider,
        },
    )
    if commit:
        await db.commit()
        await db.refresh(order)
    return order


async def _cancel_unpaid_order(
    db: AsyncSession,
    tenant_id: int,
    order_id: int,
    *,
    actor_id: int | None,
    reason: str,
) -> Order:
    """取消待支付订单（**不 commit**，由调用方决定事务边界）。

    买家手点取消与「超时未支付自动关闭」共用这一段：库存释放、卖家单状态、
    审计都只有一处实现，否则两条路径迟早有一条忘了放库存。
    """
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="订单不存在")
    if order.payment_status != st.PAY_UNPAID:
        raise HTTPException(status_code=400, detail="仅待支付订单可取消")
    previous = (order.payment_status, order.fulfillment_status)
    order.cancelled_at = datetime.now(UTC)
    seller_orders = await _seller_orders(db, order.id)
    for seller_order in seller_orders:
        seller_order.payment_status = st.PAY_CANCELLED
        seller_order.fulfillment_status = st.FULFILL_CANCELLED
    _sync(order, seller_orders)

    items = list(
        (
            await db.scalars(
                select(OrderItem).where(
                    OrderItem.tenant_id == tenant_id,
                    OrderItem.order_id == order.id,
                )
            )
        ).all()
    )
    for item in items:
        sku = await db.get(ProductSku, item.sku_id)
        if sku is not None:
            sku.stock += item.quantity
            sku.locked_stock = max(0, sku.locked_stock - item.quantity)
    # 关闭任务已由调用方处理（买家取消 → 任务没必要再跑；超时关闭 → 就是任务自己）
    await audit_service.record(
        db,
        action=audit_service.ACTION_ORDER_CANCELLED,
        tenant_id=tenant_id,
        actor_id=actor_id,
        target_type="order",
        target_id=order.id,
        before={"payment_status": previous[0], "fulfillment_status": previous[1]},
        after={
            "payment_status": order.payment_status,
            "fulfillment_status": order.fulfillment_status,
            "order_no": order.order_no,
            "reason": reason,
        },
    )
    return order


async def cancel_order(db: AsyncSession, context: AuthContext, order_id: int) -> Order:
    """买家手动取消待支付订单。"""
    order = await _cancel_unpaid_order(
        db,
        context.tenant.id,
        order_id,
        actor_id=context.user.id,
        reason="买家取消订单",
    )
    # 人已经主动取消了，定时关闭任务没有意义
    await jobs_service.cancel(
        db,
        kind=jobs_service.KIND_CLOSE_UNPAID,
        ref_type="order",
        ref_id=order.id,
        reason="订单已取消",
    )
    await db.commit()
    await db.refresh(order)
    return order


async def close_unpaid_order(db: AsyncSession, tenant_id: int, order_id: int) -> bool:
    """定时任务入口：待支付超时 → 关闭并释放库存。返回是否真的关闭了。"""
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != tenant_id:
        return False
    if order.payment_status != st.PAY_UNPAID:
        # 已付款/已取消：任务属于"到点前状态已变"，什么都不做
        return False
    await _cancel_unpaid_order(
        db,
        tenant_id,
        order_id,
        actor_id=None,
        reason="超时未支付，自动关闭",
    )
    await db.commit()
    return True


async def _schedule_auto_complete(
    db: AsyncSession,
    seller_order: SellerOrder,
    *,
    not_before: datetime | None = None,
) -> None:
    """按**租户时间控制**排自动确认收货（快递/自提天数不同）。

    4 个调用点（发货、撤销售后、驳回售后、支付后无需）必须共用这一段：
    各算一份迟早会出现"发货排 7 天、撤销售后却排 90 天"的口径漂移。
    天数 <= 0 = 不自动确认，不排任务。
    """
    if seller_order.shipped_at is None:
        return
    control = await time_control.resolve(
        db, seller_order.tenant_id, await _seller_order_product_type(db, seller_order)
    )
    days = control.auto_confirm_days_for(seller_order.delivery_method)
    if days <= 0:
        # 租户把自动确认关了：撤掉可能存在的旧任务，避免旧配置继续生效
        await jobs_service.cancel(
            db,
            kind=jobs_service.KIND_AUTO_COMPLETE,
            ref_type="seller_order",
            ref_id=seller_order.id,
            reason="租户关闭了自动确认收货",
        )
        return
    run_at = seller_order.shipped_at + timedelta(days=days)
    if not_before is not None:
        run_at = max(run_at, not_before)
    await jobs_service.schedule(
        db,
        tenant_id=seller_order.tenant_id,
        kind=jobs_service.KIND_AUTO_COMPLETE,
        ref_type="seller_order",
        ref_id=seller_order.id,
        run_at=run_at,
        meta={
            "rule": "auto_confirm",
            "days": days,
            "delivery_method": seller_order.delivery_method,
        },
    )


async def _seller_order_product_type(db: AsyncSession, seller_order: SellerOrder) -> str:
    """时间控制按商品类型分组：取该卖家单第一件商品的类型快照。"""
    row = (
        await db.scalars(
            select(OrderItem.product_type).where(
                OrderItem.seller_order_id == seller_order.id
            ).limit(1)
        )
    ).first()
    return row or "physical"


async def _mark_shipped(
    db: AsyncSession,
    seller_order: SellerOrder,
    carrier: str | None,
    tracking_no: str | None,
) -> None:
    """卖家单进入「已发货」：快递写运单，自提只标记备货完成。"""
    if seller_order.fulfillment_status not in st.SHIPPABLE_FULFILLMENTS:
        raise HTTPException(status_code=400, detail="当前卖家订单不可发货")
    seller_order.fulfillment_status = st.FULFILL_SHIPPED
    seller_order.shipped_at = datetime.now(UTC)
    if seller_order.delivery_method == EXPRESS and carrier and tracking_no:
        db.add(
            Shipment(
                tenant_id=seller_order.tenant_id,
                seller_order_id=seller_order.id,
                carrier=carrier,
                tracking_no=tracking_no,
                status="shipped",
            )
        )
    # 发货即入队自动完成：天数来自租户「时间控制」（快递/自提各一个）
    await _schedule_auto_complete(db, seller_order)


async def ship_seller_order(
    db: AsyncSession,
    context: AuthContext,
    seller_order_id: int,
    carrier: str | None,
    tracking_no: str | None,
) -> SellerOrder:
    seller_order = await db.get(SellerOrder, seller_order_id)
    if seller_order is None or seller_order.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="卖家订单不存在")
    if seller_order.delivery_method == EXPRESS and not (carrier and tracking_no):
        raise HTTPException(status_code=400, detail="物流快递必须填写物流公司与运单号")
    await _mark_shipped(db, seller_order, carrier, tracking_no)

    siblings = await _seller_orders(db, seller_order.order_id)
    order = await db.get(Order, seller_order.order_id)
    if order is not None:
        _sync(order, siblings)
    await audit_service.record(
        db,
        action=audit_service.ACTION_SELLER_ORDER_SHIPPED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="seller_order",
        target_id=seller_order.id,
        after={
            "fulfillment_status": seller_order.fulfillment_status,
            "delivery_method": seller_order.delivery_method,
            "carrier": carrier,
            "tracking_no": tracking_no,
            "order_id": seller_order.order_id,
        },
    )
    await db.commit()
    await db.refresh(seller_order)
    return seller_order


async def _complete(db: AsyncSession, order: Order, seller_orders: list[SellerOrder]) -> int:
    """把已发货的卖家单置为完成，并同步订单；返回完成的卖家单数。"""
    now = datetime.now(UTC)
    done = 0
    for seller_order in seller_orders:
        if seller_order.fulfillment_status == st.FULFILL_SHIPPED:
            seller_order.fulfillment_status = st.FULFILL_COMPLETED
            seller_order.completed_at = now
            done += 1
        await jobs_service.cancel(
            db,
            kind=jobs_service.KIND_AUTO_COMPLETE,
            ref_type="seller_order",
            ref_id=seller_order.id,
            reason="已完成，撤销自动收货任务",
        )
    order.completed_at = now
    _sync(order, seller_orders)
    # 账期到期自动把货款划进卖家钱包（复用定时任务；退款/取消会撤销）
    hold_days = await finance_service.hold_days(db, order.tenant_id)
    for seller_order in seller_orders:
        if seller_order.fulfillment_status != st.FULFILL_COMPLETED:
            continue
        await jobs_service.schedule(
            db,
            tenant_id=seller_order.tenant_id,
            kind=jobs_service.KIND_SETTLE_EARNINGS,
            ref_type="seller_order",
            ref_id=seller_order.id,
            run_at=now + timedelta(days=hold_days),
        )
    return done


async def confirm_order(db: AsyncSession, context: AuthContext, order_id: int) -> Order:
    """买家确认收货 / 确认自提。"""
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != context.tenant.id or order.buyer_id != context.user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    if order.fulfillment_status != st.FULFILL_SHIPPED:
        raise HTTPException(status_code=400, detail="当前订单不可确认收货")
    seller_orders = await _seller_orders(db, order.id)
    await _complete(db, order, seller_orders)
    await audit_service.record(
        db,
        action=audit_service.ACTION_ORDER_CONFIRMED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="order",
        target_id=order.id,
        after={
            "fulfillment_status": order.fulfillment_status,
            "order_no": order.order_no,
        },
    )
    await db.commit()
    await db.refresh(order)
    return order


async def auto_complete_seller_order(
    db: AsyncSession, tenant_id: int, seller_order_id: int
) -> bool:
    """定时任务入口：发货超时未确认 → 自动完成。

    与「买家手动确认收货」走**同一个 `_complete()`** —— 两条路径必须行为一致，
    否则会分叉出「自动完成的订单评价不了 / 结算不解锁」这类 bug。
    """
    seller_order = await db.get(SellerOrder, seller_order_id)
    if seller_order is None or seller_order.tenant_id != tenant_id:
        return False
    if seller_order.fulfillment_status != st.FULFILL_SHIPPED:
        # 已被买家确认 / 已退款 / 已取消：任务作废，不算失败
        return False
    order = await db.get(Order, seller_order.order_id)
    if order is None:
        return False
    siblings = await _seller_orders(db, seller_order.order_id)
    await _complete(db, order, siblings)
    await audit_service.record(
        db,
        action=audit_service.ACTION_ORDER_CONFIRMED,
        tenant_id=tenant_id,
        actor_id=None,
        target_type="order",
        target_id=order.id,
        after={
            "fulfillment_status": order.fulfillment_status,
            "order_no": order.order_no,
            "auto": "true",
            "delivery_method": seller_order.delivery_method,
        },
    )
    await db.commit()
    return True


async def request_refund(
    db: AsyncSession, context: AuthContext, order_id: int, reason: str
) -> Order:
    """买家申请售后（整个订单）。

    完成后（`completed`）不再允许 —— 业务口径：确认收货/自提即视为交易结束。
    每个卖家单各生成一条待处理退款，卖家分别审核。
    """
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != context.tenant.id or order.buyer_id != context.user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    # 售后窗口由租户「时间控制」决定：
    #   to_ship / shipped —— 交易未结束，随时可申请；
    #   completed —— 仅当配置了「确认收货后可申请售后 N 天」且未过期。
    control = await time_control.resolve(db, context.tenant.id)
    if not time_control.refund_window_open(
        control, order.fulfillment_status, order.completed_at
    ):
        if order.fulfillment_status == st.FULFILL_COMPLETED:
            raise HTTPException(
                status_code=400,
                detail=(
                    "已超过售后期限"
                    if control.refund_window_days > 0
                    else "该订单已完成，当前不支持申请售后"
                ),
            )
        raise HTTPException(
            status_code=400, detail="该订单当前状态不支持申请售后"
        )
    seller_orders = await _seller_orders(db, order.id)
    applied = 0
    for seller_order in seller_orders:
        if seller_order.payment_status != st.PAY_PAID:
            continue
        seller_order.payment_status = st.PAY_REFUNDING
        db.add(
            Refund(
                tenant_id=context.tenant.id,
                order_id=order.id,
                seller_order_id=seller_order.id,
                amount_cents=seller_order.goods_amount_cents,
                reason=reason,
                status="pending",
            )
        )
        applied += 1
        await jobs_service.cancel(
            db,
            kind=jobs_service.KIND_AUTO_COMPLETE,
            ref_type="seller_order",
            ref_id=seller_order.id,
            reason="申请售后中，暂停自动收货",
        )
    if applied == 0:
        raise HTTPException(status_code=400, detail="该订单没有可申请售后的卖家单")
    _sync(order, seller_orders)
    await audit_service.record(
        db,
        action=audit_service.ACTION_ORDER_REFUND_REQUESTED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="order",
        target_id=order.id,
        after={
            "order_no": order.order_no,
            "reason": reason,
            "seller_order_count": applied,
            "payment_status": order.payment_status,
        },
    )
    await db.commit()
    await db.refresh(order)
    return order


async def cancel_refund_request(
    db: AsyncSession, context: AuthContext, order_id: int
) -> Order:
    """买家撤回售后申请（卖家还没处理时）。

    售后申请是买家自己提的，不能只能进不能退；撤回后：
    * 待处理的退款单置 `cancelled`；
    * 卖家单回到「已支付」；
    * 已发货的卖家单**重新排上自动收货**（撤销售后时那条任务被撤了）。
    """
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != context.tenant.id or order.buyer_id != context.user.id:
        raise HTTPException(status_code=404, detail="订单不存在")

    seller_orders = await _seller_orders(db, order.id)
    cancelled = 0
    for seller_order in seller_orders:
        if seller_order.payment_status != st.PAY_REFUNDING:
            continue
        refund = await _pending_refund(db, seller_order.id)
        if refund is not None:
            refund.status = "cancelled"
        seller_order.payment_status = st.PAY_PAID
        cancelled += 1
        if seller_order.fulfillment_status == st.FULFILL_SHIPPED and seller_order.shipped_at:
            await _schedule_auto_complete(
                db,
                seller_order,
                not_before=datetime.now(UTC) + timedelta(minutes=1),
            )
    if cancelled == 0:
        raise HTTPException(status_code=400, detail="没有可取消的售后申请")

    _sync(order, seller_orders)
    await audit_service.record(
        db,
        action=audit_service.ACTION_ORDER_REFUND_CANCELLED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="order",
        target_id=order.id,
        after={"order_no": order.order_no, "seller_order_count": cancelled},
    )
    await db.commit()
    await db.refresh(order)
    return order


async def _pending_refund(db: AsyncSession, seller_order_id: int) -> Refund | None:
    return (
        await db.scalars(
            select(Refund)
            .where(Refund.seller_order_id == seller_order_id, Refund.status == "pending")
            .order_by(Refund.id.desc())
        )
    ).first()


async def refund_seller_order(
    db: AsyncSession,
    context: AuthContext,
    seller_order_id: int,
    amount_cents: int,
    reason: str,
) -> Refund:
    """卖家/运营退款。买家申请过售后则复用那条 pending 记录（不重复建单）。"""
    seller_order = await db.get(SellerOrder, seller_order_id)
    if seller_order is None or seller_order.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="卖家订单不存在")
    if seller_order.payment_status == st.PAY_REFUNDED:
        raise HTTPException(status_code=400, detail="该卖家订单已退款")
    if amount_cents > seller_order.goods_amount_cents:
        raise HTTPException(status_code=400, detail="退款金额超过订单金额")

    # 这笔钱原来走什么渠道：留痕，否则对账说不清"退的是哪条渠道的钱"
    paid_payment = (
        await db.scalars(
            select(Payment)
            .where(Payment.order_id == seller_order.order_id, Payment.status == "success")
            .order_by(Payment.id)
        )
    ).first()
    provider = paid_payment.provider if paid_payment else None

    refund = await _pending_refund(db, seller_order.id)
    if refund is None:
        refund = Refund(
            tenant_id=context.tenant.id,
            order_id=seller_order.order_id,
            seller_order_id=seller_order.id,
            amount_cents=amount_cents,
            reason=reason,
            provider=provider,
            status="refunded",
        )
        db.add(refund)
    else:
        refund.amount_cents = amount_cents
        refund.reason = reason or refund.reason
        refund.provider = provider
        refund.status = "refunded"

    previous_status = seller_order.payment_status
    previous_commission = seller_order.commission_amount_cents
    seller_order.payment_status = st.PAY_REFUNDED
    await db.flush()
    # Give the goods money *and* the commission back, so the seller ledger nets
    # to zero instead of freezing refunded money forever.
    commission_reversed = await finance_service.record_refund_ledger(
        db, seller_order, refund.id, amount_cents
    )
    siblings = await _seller_orders(db, seller_order.order_id)
    order = await db.get(Order, seller_order.order_id)
    if order is not None:
        _sync(order, siblings)
    await jobs_service.cancel(
        db,
        kind=jobs_service.KIND_AUTO_COMPLETE,
        ref_type="seller_order",
        ref_id=seller_order.id,
        reason="已退款，撤销自动收货任务",
    )
    await jobs_service.cancel(
        db,
        kind=jobs_service.KIND_SETTLE_EARNINGS,
        ref_type="seller_order",
        ref_id=seller_order.id,
        reason="已退款，撤销货款划转任务",
    )
    # 退款退回买家钱包余额（产品口径）：与订单退款同一事务，要么都成要么都不成
    order_for_refund = await db.get(Order, seller_order.order_id)
    if order_for_refund is not None:
        await wallet_service.credit_refund(
            db,
            tenant_id=context.tenant.id,
            buyer_id=order_for_refund.buyer_id,
            refund_id=refund.id,
            amount_cents=amount_cents,
            provider=provider,
        )
    await audit_service.record(
        db,
        action=audit_service.ACTION_SELLER_ORDER_REFUNDED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="seller_order",
        target_id=seller_order.id,
        before={"payment_status": previous_status},
        after={
            "payment_status": st.PAY_REFUNDED,
            "amount_cents": amount_cents,
            "reason": reason,
            "commission_reversed_cents": commission_reversed,
            "commission_amount_cents": previous_commission,
        },
    )
    await db.commit()
    await db.refresh(refund)
    return refund


async def reject_refund(
    db: AsyncSession, context: AuthContext, seller_order_id: int, reason: str
) -> Refund:
    """驳回买家售后申请：卖家单回到「已支付」，任务若已撤销则重新入队。"""
    seller_order = await db.get(SellerOrder, seller_order_id)
    if seller_order is None or seller_order.tenant_id != context.tenant.id:
        raise HTTPException(status_code=404, detail="卖家订单不存在")
    refund = await _pending_refund(db, seller_order.id)
    if refund is None:
        raise HTTPException(status_code=400, detail="没有待处理的退款申请")
    refund.status = "rejected"
    refund.reason = f"{refund.reason}｜驳回：{reason}" if reason else refund.reason
    seller_order.payment_status = st.PAY_PAID
    siblings = await _seller_orders(db, seller_order.order_id)
    order = await db.get(Order, seller_order.order_id)
    if order is not None:
        _sync(order, siblings)
    # 已发货的订单被驳回后，自动收货倒计时需要恢复
    if seller_order.fulfillment_status == st.FULFILL_SHIPPED and seller_order.shipped_at:
        await _schedule_auto_complete(
            db,
            seller_order,
            not_before=datetime.now(UTC) + timedelta(minutes=1),
        )
    await audit_service.record(
        db,
        action=audit_service.ACTION_SELLER_ORDER_REFUND_REJECTED,
        tenant_id=context.tenant.id,
        actor_id=context.user.id,
        target_type="seller_order",
        target_id=seller_order.id,
        after={"reason": reason, "payment_status": seller_order.payment_status},
    )
    await db.commit()
    await db.refresh(refund)
    return refund
