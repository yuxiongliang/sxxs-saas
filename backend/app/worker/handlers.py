"""延时任务 handler 注册表。

加新任务 = 这里加一个函数 + `services/jobs` 里加一个 kind 常量。
handler 必须**自己校验业务状态**（幂等）：队列只是"提醒",真相在业务表里。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import ScheduledJob
from app.services import jobs as jobs_service
from app.services import order as order_service
from app.services import payment as payment_service
from app.services import wallet as wallet_service


async def auto_complete(db: AsyncSession, job: ScheduledJob) -> str:
    """发货超时未确认 → 自动完成（快递 7 天 / 自提 90 天）。

    与「买家手动确认收货」共用 `order._complete()`，两条路径行为必须一致 ——
    否则会分叉出「自动完成的订单评价不了 / 结算不解锁」这类 bug。
    """
    done = await order_service.auto_complete_seller_order(
        db, job.tenant_id or 0, job.ref_id
    )
    return "completed" if done else "skipped:state_changed"


async def settle_earnings(db: AsyncSession, job: ScheduledJob) -> str:
    """账期到期：货款划进卖家钱包，并写负数 skill ledger 防止重复提现。"""
    done = await wallet_service.transfer_seller_earnings(
        db, job.tenant_id or 0, job.ref_id
    )
    return "transferred" if done else "skipped:not_settleable"


async def payment_sync(db: AsyncSession, job: ScheduledJob) -> str:
    """支付对账：主动查渠道，把"钱付了但回调没到"的订单补成已支付。

    返回 `pending` 时**抛异常让任务重试**（渠道可能还没回调到成功）；
    订单已支付或已取消则直接结束，不浪费重试次数。
    """
    from app.models.order import Order

    order = await db.get(Order, job.ref_id)
    if order is None:
        return "skipped:no_order"
    if order.payment_status != "unpaid":
        return "skipped:already_final"
    provider = await _payment_provider_of(db, order.id)
    result = await payment_service.sync_pending_payment(
        db,
        tenant_id=job.tenant_id or 0,
        order_id=order.id,
        provider=provider,
    )
    if result == "pending":
        raise RuntimeError("渠道仍未支付成功，稍后重试")
    return result


async def _payment_provider_of(db: AsyncSession, order_id: int) -> str:
    """对账要按**订单实际用的渠道**查：订单上挂着哪条 pending 支付记录就查哪个。"""
    from sqlalchemy import select as sa_select

    from app.models.order import Payment

    row = (
        await db.scalars(
            sa_select(Payment)
            .where(Payment.order_id == order_id, Payment.status == "pending")
            .order_by(Payment.id.desc())
        )
    ).first()
    return row.provider if row is not None else "alipay"


HANDLERS: dict[str, Callable[[AsyncSession, ScheduledJob], Awaitable[str]]] = {
    jobs_service.KIND_AUTO_COMPLETE: auto_complete,
    jobs_service.KIND_SETTLE_EARNINGS: settle_earnings,
    jobs_service.KIND_PAYMENT_SYNC: payment_sync,
}
