"""支付编排：下单 → 回调 → 主动查询。

统一规则（两条渠道共用，避免两边各写一套）：

1. `out_trade_no = T{tenant_id}-{order_no}` —— 回调靠它反查租户与订单；
2. 回调必须满足：**验签通过 + 金额等于订单应付 + 商户号/app_id 匹配**，才置已支付；
3. 幂等：已支付的订单重复回调直接回成功（渠道会重试，不能报错否则会一直重发）；
4. 回调原始报文进 `payments.raw_payload`，对账/排查时能还原现场。
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order, Payment
from app.services import audit as audit_service
from app.services import order as order_service
from app.services.auth import AuthContext
from app.services.payment import config as payment_config
from app.services.payment.alipay import AlipayError, AlipayGateway
from app.services.payment.config import PaymentConfigError
from app.services.payment.wechat import WechatError, WechatGateway

PROVIDER_ALIPAY = "alipay"
PROVIDER_WECHAT = "wechat"
REAL_PROVIDERS = (PROVIDER_ALIPAY, PROVIDER_WECHAT)


def out_trade_no(tenant_id: int, order_no: str) -> str:
    return f"T{tenant_id}-{order_no}"


async def _pending_payment(db: AsyncSession, order_id: int, provider: str) -> Payment | None:
    return (
        await db.scalars(
            select(Payment)
            .where(
                Payment.order_id == order_id,
                Payment.provider == provider,
                Payment.status == "pending",
            )
            .order_by(Payment.id.desc())
        )
    ).first()


async def create_payment(
    db: AsyncSession, context: AuthContext, order: Order, provider: str
) -> dict:
    """创建渠道支付单，返回前端需要的东西（跳转 URL / 二维码链接）。"""
    if provider not in REAL_PROVIDERS:
        raise HTTPException(status_code=400, detail="不支持的支付渠道")
    if order.payment_status == "paid":
        return {"type": "already_paid"}
    if order.payment_status != "unpaid":
        raise HTTPException(status_code=400, detail="当前订单状态不可支付")

    config = await payment_config.load_payment_config(db, context.tenant.id)
    number = out_trade_no(context.tenant.id, order.order_no)
    subject = f"订单 {order.order_no}"

    try:
        if provider == PROVIDER_ALIPAY:
            gateway = AlipayGateway(payment_config.require_alipay(config))
            url = gateway.page_pay_url(
                out_trade_no=number,
                amount_cents=order.payable_amount_cents,
                subject=subject,
            )
            result = {"type": "redirect", "url": url}
            environment = "sandbox" if "alipaydev" in url else "production"
        else:
            gateway = WechatGateway(payment_config.require_wechat(config))
            code_url = await gateway.native_pay(
                out_trade_no=number,
                amount_cents=order.payable_amount_cents,
                subject=subject,
            )
            result = {"type": "qrcode", "code_url": code_url}
            environment = "production"
    except PaymentConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (AlipayError, WechatError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # 每次发起支付都记一条 pending 记录：渠道侧可能有多个未支付单，能对得上账
    existing = await _pending_payment(db, order.id, provider)
    if existing is None:
        db.add(
            Payment(
                tenant_id=context.tenant.id,
                order_id=order.id,
                provider=provider,
                out_trade_no=number,
                environment=environment,
                amount_cents=order.payable_amount_cents,
                status="pending",
            )
        )
        await db.flush()

    # 排一个对账任务：回调到不了时（本地/内网/回调未登记）靠主动查询把状态补上。
    # 1 分钟后第一次查，失败按 1/5/30 分钟退避重试。
    from datetime import UTC, datetime, timedelta

    from app.services import jobs as jobs_service

    await jobs_service.schedule(
        db,
        tenant_id=context.tenant.id,
        kind=jobs_service.KIND_PAYMENT_SYNC,
        ref_type="order",
        ref_id=order.id,
        run_at=datetime.now(UTC) + timedelta(seconds=60),
    )
    await db.commit()

    return {
        "type": result["type"],
        "url": result.get("url"),
        "code_url": result.get("code_url"),
        "out_trade_no": number,
        "amount_cents": order.payable_amount_cents,
    }


async def _find_order_by_out_trade_no(
    db: AsyncSession, number: str
) -> tuple[Order, int] | tuple[None, None]:
    """`T{tenant_id}-{order_no}` → 订单。解析失败说明不是我们发出的单。"""
    if not number.startswith("T") or "-" not in number:
        return None, None
    tenant_part, _, order_no = number.partition("-")
    try:
        tenant_id = int(tenant_part[1:])
    except ValueError:
        return None, None
    order = (
        await db.scalars(
            select(Order).where(
                Order.tenant_id == tenant_id, Order.order_no == order_no
            )
        )
    ).first()
    return (order, tenant_id) if order is not None else (None, None)


async def settle_paid_order(
    db: AsyncSession,
    *,
    order: Order,
    tenant_id: int,
    provider: str,
    trade_no: str,
    amount_cents: int,
    raw: dict,
    environment: str = "production",
) -> None:
    """金额核对通过后把订单置为已支付（**幂等**）。

    **支付记录只有一处创建者**：`order.mark_order_paid()`。这里不自己 new Payment ——
    两边都建就会给同一笔支付留下两行（对账时对不上）。
    """
    if amount_cents != order.payable_amount_cents:
        raise HTTPException(
            status_code=400,
            detail=(
                f"支付金额与订单不一致：回调 {amount_cents / 100:.2f} 元，"
                f"订单应付 {order.payable_amount_cents / 100:.2f} 元"
            ),
        )

    class _TenantContext:
        """回调没有登录态，但订单状态机只用到 tenant_id / user.id。"""

        def __init__(self, tenant_id: int, buyer_id: int) -> None:
            self.tenant = type("T", (), {"id": tenant_id})()
            self.user = type("U", (), {"id": buyer_id})()
            self.permissions: set[str] = set()

    already_paid = order.payment_status == "paid"
    if not already_paid:
        await order_service.mark_order_paid(
            db,
            _TenantContext(tenant_id, order.buyer_id),
            order,
            provider=provider,
            commit=False,
        )

    # 统一在这里补渠道侧信息（商户单号/交易号/原始报文）
    payment = (
        await db.scalars(
            select(Payment)
            .where(Payment.order_id == order.id, Payment.provider == provider)
            .order_by(Payment.id.desc())
        )
    ).first()
    if payment is None:
        payment = Payment(
            tenant_id=tenant_id,
            order_id=order.id,
            provider=provider,
            amount_cents=amount_cents,
            status="success",
        )
        db.add(payment)
    payment.out_trade_no = payment.out_trade_no or out_trade_no(
        tenant_id, order.order_no
    )
    payment.environment = payment.environment or environment
    payment.provider_trade_no = trade_no or payment.provider_trade_no
    payment.raw_payload = raw
    payment.status = "success"
    payment.paid_at = payment.paid_at or order.paid_at

    if already_paid:
        # 渠道会重试回调：已支付就只补记录，不重复记账
        await db.commit()
        return

    await audit_service.record(
        db,
        action=audit_service.ACTION_ORDER_PAID,
        tenant_id=tenant_id,
        actor_id=None,
        target_type="order",
        target_id=order.id,
        after={
            "provider": provider,
            "trade_no": trade_no,
            "amount_cents": amount_cents,
            "channel": "notify",
            "order_no": order.order_no,
        },
    )
    await db.commit()


async def sync_pending_payment(
    db: AsyncSession, *, tenant_id: int, order_id: int, provider: str
) -> str:
    """主动查询渠道并同步状态。返回 `paid` / `pending` / `skipped`。

    worker 与「刷新支付状态」按钮都走这里 —— 逻辑只有一份。
    """
    order = await db.get(Order, order_id)
    if order is None or order.tenant_id != tenant_id:
        return "skipped"
    if order.payment_status == "paid":
        return "paid"

    config = await payment_config.load_payment_config(db, tenant_id)
    number = out_trade_no(tenant_id, order.order_no)
    try:
        if provider == PROVIDER_ALIPAY:
            gateway = AlipayGateway(payment_config.require_alipay(config))
            notice = await gateway.query(out_trade_no=number)
            paid = notice.trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED")
            trade_no, amount, raw = notice.trade_no, notice.total_amount_cents, notice.raw
        elif provider == PROVIDER_WECHAT:
            gateway = WechatGateway(payment_config.require_wechat(config))
            notice = await gateway.query(out_trade_no=number)
            paid = notice.trade_state == "SUCCESS"
            trade_no, amount, raw = notice.transaction_id, notice.amount_cents, notice.raw
        else:
            return "skipped"
    except (PaymentConfigError, AlipayError, WechatError):
        # 让任务重试：渠道可能只是抖了一下，不能把"查询失败"当成"没支付"
        raise

    if not paid:
        return "pending"
    await settle_paid_order(
        db,
        order=order,
        tenant_id=tenant_id,
        provider=provider,
        trade_no=trade_no,
        amount_cents=amount,
        raw=raw,
    )
    return "paid"


async def handle_alipay_notify(db: AsyncSession, form: dict[str, str]) -> str:
    """返回给支付宝的响应文本（必须是裸 `success`，不能包 JSON）。"""
    order, tenant_id = await _find_order_by_out_trade_no(
        db, form.get("out_trade_no", "")
    )
    if order is None:
        return "failure"
    config = await payment_config.load_payment_config(db, tenant_id)
    try:
        gateway = AlipayGateway(payment_config.require_alipay(config))
    except PaymentConfigError:
        return "failure"
    try:
        notice = gateway.parse_notify(form)
    except AlipayError:
        return "failure"

    if notice.trade_status not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        # 非成功状态（如 WAIT_BUYER_PAY）也要回 success，否则支付宝会一直重发
        return "success"

    await settle_paid_order(
        db,
        order=order,
        tenant_id=tenant_id,
        provider=PROVIDER_ALIPAY,
        trade_no=notice.trade_no,
        amount_cents=notice.total_amount_cents,
        raw=notice.raw,
        environment="sandbox" if "alipaydev" in gateway.config.gateway else "production",
    )
    return "success"


async def handle_wechat_notify(
    db: AsyncSession, headers: dict[str, str], body: str
) -> dict:
    """微信要求返回 JSON；验签失败返回 4xx 让它重试。"""
    try:
        envelope = __import__("json").loads(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="报文不是合法 JSON") from exc

    resource = envelope.get("resource") or {}
    # 解密前拿不到 out_trade_no，先从密文里取不了；用 header 的 serial 无法定位租户，
    # 所以微信回调走**单租户默认**：配置里 notifyUrl 每个租户不同，
    # 真实部署时按 Host 或路径前缀分流（见 docs 上线清单）。
    tenant_id = await _tenant_from_wechat_envelope(db, envelope)
    if tenant_id is None:
        raise HTTPException(status_code=404, detail="未匹配到租户配置")

    config = await payment_config.load_payment_config(db, tenant_id)
    try:
        gateway = WechatGateway(payment_config.require_wechat(config))
        notice = await gateway.parse_notify(headers, body)
    except (PaymentConfigError, WechatError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    order, resolved_tenant = await _find_order_by_out_trade_no(db, notice.out_trade_no)
    if order is None or resolved_tenant != tenant_id:
        raise HTTPException(status_code=404, detail="订单不存在")

    if notice.trade_state != "SUCCESS":
        return {"code": "SUCCESS", "message": "非成功状态，忽略"}

    await settle_paid_order(
        db,
        order=order,
        tenant_id=tenant_id,
        provider=PROVIDER_WECHAT,
        trade_no=notice.transaction_id,
        amount_cents=notice.amount_cents,
        raw=notice.raw,
    )
    return {"code": "SUCCESS", "message": "OK"}


async def _tenant_from_wechat_envelope(
    db: AsyncSession, envelope: dict
) -> int | None:
    """从回调里定位租户。

    微信 V3 回调外层没有租户标识；这里用 `resource.original_type` + 报文里的
    `mchid` **在解密后**才能判断，所以先按"能解密成功"试探：逐个租户试解 resource，
    第一个解开的即为目标租户（APIv3 密钥不同，错密钥必然解不开）。
    租户数量级别很小（单平台几十个），代价可接受，且不需要改变回调 URL。
    """
    from sqlalchemy import select as sa_select

    from app.models.setting import SystemSetting

    rows = list(
        (
            await db.scalars(
                sa_select(SystemSetting).where(SystemSetting.category == "payment")
            )
        ).all()
    )
    from app.services.payment.wechat import WechatError, decrypt_resource

    for row in rows:
        config = (row.config or {}).get("wechat") or {}
        key = str(config.get("apiV3Key") or "").strip()
        if len(key) != 32:
            continue
        try:
            decrypt_resource(key, (envelope.get("resource") or {}))
        except WechatError:
            continue
        return row.tenant_id
    return None


async def query_and_sync(
    db: AsyncSession, context: AuthContext, order: Order, provider: str
) -> dict:
    """主动查询渠道状态（回调丢失时兜底）。"""
    config = await payment_config.load_payment_config(db, context.tenant.id)
    number = out_trade_no(context.tenant.id, order.order_no)
    try:
        if provider == PROVIDER_ALIPAY:
            gateway = AlipayGateway(payment_config.require_alipay(config))
            notice = await gateway.query(out_trade_no=number)
            paid = notice.trade_status in ("TRADE_SUCCESS", "TRADE_FINISHED")
            trade_no = notice.trade_no
            amount = notice.total_amount_cents
            raw = notice.raw
        elif provider == PROVIDER_WECHAT:
            gateway = WechatGateway(payment_config.require_wechat(config))
            notice = await gateway.query(out_trade_no=number)
            paid = notice.trade_state == "SUCCESS"
            trade_no = notice.transaction_id
            amount = notice.amount_cents
            raw = notice.raw
        else:
            raise HTTPException(status_code=400, detail="不支持的支付渠道")
    except PaymentConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (AlipayError, WechatError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if paid:
        await settle_paid_order(
            db,
            order=order,
            tenant_id=context.tenant.id,
            provider=provider,
            trade_no=trade_no,
            amount_cents=amount,
            raw=raw,
        )
        await db.refresh(order)
    return {
        "paid": paid,
        "payment_status": order.payment_status,
        "fulfillment_status": order.fulfillment_status,
        "trade_no": trade_no,
    }
