"""延时任务的存储与状态机（队列表）。

设计取舍：

* **任务落库而不是放 Redis** —— 你要求"看得见、改得动、能重跑"，
  Redis 无查询、会被淘汰，做不到；本项目的 Redis 只用于 IM 广播和限流。
* **不引入 Celery/RQ** —— 现在只有一两类延时任务，多一套 broker + worker + 监控
  是纯负担。加新任务 = 加一个 kind 常量 + 一个 handler。
* `(kind, ref_type, ref_id)` 在 `pending` 状态下唯一 —— 重复发货/重复入队不会产生两条。
* 取消用 `cancelled` 而不是删除：要能回溯"为什么没执行"。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import ScheduledJob

KIND_AUTO_COMPLETE = "auto_complete"
#: 账期到期，把卖家货款划进钱包
KIND_SETTLE_EARNINGS = "settle_earnings"
#: 支付对账：渠道回调到不了（本地/内网/回调配置未生效）时，主动查询补状态
KIND_PAYMENT_SYNC = "payment_sync"
#: 待支付超时自动关闭（天数来自租户「时间控制」，0 天 = 不排这个任务）
KIND_CLOSE_UNPAID = "close_unpaid"

STATUS_PENDING = "pending"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

#: **缺省**自动确认时效（真正的天数由租户「时间控制」决定，见 services/time_control.py）。
#: 保留这两个常量是为了"没配过时间控制的租户"与历史测试仍按原行为跑。
#: 快递单：发货后 7 天买家未确认 → 自动完成
AUTO_COMPLETE_EXPRESS = timedelta(days=7)
#: 自提单：没有"物流签收"，但仍要有个兜底，否则订单永远挂着占结算与待办
AUTO_COMPLETE_PICKUP = timedelta(days=90)

MAX_ATTEMPTS = 3


async def schedule(
    db: AsyncSession,
    *,
    tenant_id: int,
    kind: str,
    ref_type: str,
    ref_id: int,
    run_at: datetime,
    meta: dict | None = None,
) -> ScheduledJob | None:
    """入队（幂等）：同一条业务对象已有 pending 任务时不再重复插入。

    `meta` 是**任务依据快照**（例：`{"rule": "auto_confirm", "days": 7}`）。
    平台端据此解释"为什么是这个时间执行"；配置后来改了也不影响历史任务的解释。
    """
    existing = (
        await db.scalars(
            select(ScheduledJob).where(
                ScheduledJob.kind == kind,
                ScheduledJob.ref_type == ref_type,
                ScheduledJob.ref_id == ref_id,
                ScheduledJob.status == STATUS_PENDING,
            )
        )
    ).first()
    if existing is not None:
        existing.run_at = run_at
        if meta is not None:
            existing.meta = meta
        return existing
    job = ScheduledJob(
        tenant_id=tenant_id,
        kind=kind,
        ref_type=ref_type,
        ref_id=ref_id,
        run_at=run_at,
        status=STATUS_PENDING,
        attempts=0,
        meta=meta,
    )
    db.add(job)
    await db.flush()
    return job


async def cancel(
    db: AsyncSession,
    *,
    kind: str,
    ref_type: str,
    ref_id: int,
    reason: str = "",
) -> int:
    """撤销该业务对象的待执行任务（买家确认收货 / 退款 / 取消订单时调）。"""
    rows = list(
        (
            await db.scalars(
                select(ScheduledJob).where(
                    ScheduledJob.kind == kind,
                    ScheduledJob.ref_type == ref_type,
                    ScheduledJob.ref_id == ref_id,
                    ScheduledJob.status == STATUS_PENDING,
                )
            )
        ).all()
    )
    for row in rows:
        row.status = STATUS_CANCELLED
        row.last_error = reason or "业务已处理，任务撤销"
        row.finished_at = datetime.now(UTC)
    await db.flush()
    return len(rows)


def backoff_delay(attempts: int) -> timedelta:
    """失败退避：1 分钟 → 5 分钟 → 30 分钟，超过 3 次置 failed。"""
    return {
        1: timedelta(minutes=1),
        2: timedelta(minutes=5),
    }.get(attempts, timedelta(minutes=30))
