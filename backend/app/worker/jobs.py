"""延时任务执行器（**常驻进程**，pm2 管理）。

    python -m app.worker.jobs            # 常驻：循环取任务
    python -m app.worker.jobs --once     # 跑一批就退出（运维补跑 / 测试 / e2e）

## 为什么是常驻而不是 cron 一次性
业务上要求"发货 7 天自动收货"必须准时落地。常驻进程能保证秒级响应；
代价是**进程活着但卡死**这类故障不易发现，所以这里做了四件事：

1. **心跳**：每 30 秒 upsert `worker_heartbeats`，管理页据此判断 worker 是否还在干活；
2. **僵尸回收**：`running` 超过 5 分钟的任务回到 `pending`（进程被杀时不丢任务）；
3. **失败退避**：1min / 5min / 30min，超过 3 次置 `failed` 并在管理页飘红；
4. **优雅停机**：SIGTERM 时跑完当前批再退出，pm2 restart 不会留下半截任务。

多实例安全：取任务用 `FOR UPDATE SKIP LOCKED`，起 2 个 worker 也不会重复执行。
"""

from __future__ import annotations

import asyncio
import os
import signal
import socket
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models.job import ScheduledJob, WorkerHeartbeat
from app.services import jobs as jobs_service
from app.worker.handlers import HANDLERS

logger = structlog.get_logger(__name__)

INSTANCE_ID = f"{socket.gethostname()}-{os.getpid()}"
BATCH_SIZE = 50
HEARTBEAT_EVERY = timedelta(seconds=30)
ZOMBIE_AFTER = timedelta(minutes=5)
IDLE_MIN, IDLE_MAX = 1.0, 10.0

_stop = asyncio.Event()


async def _reclaim_zombies(db: AsyncSession) -> int:
    """进程被杀会留下 `running` 孤儿，超时后回 pending 重试。"""
    threshold = datetime.now(UTC) - ZOMBIE_AFTER
    result = await db.execute(
        update(ScheduledJob)
        .where(
            ScheduledJob.status == jobs_service.STATUS_RUNNING,
            ScheduledJob.started_at.is_not(None),
            ScheduledJob.started_at < threshold,
        )
        .values(
            status=jobs_service.STATUS_PENDING,
            attempts=ScheduledJob.attempts + 1,
            last_error="执行进程超时未回报，已回收重试",
        )
    )
    await db.commit()
    return result.rowcount or 0


async def _claim_batch(db: AsyncSession) -> list[ScheduledJob]:
    """取一批到期任务并置 running（SKIP LOCKED：多实例不重复）。"""
    now = datetime.now(UTC)
    rows = list(
        (
            await db.scalars(
                select(ScheduledJob)
                .where(
                    ScheduledJob.status == jobs_service.STATUS_PENDING,
                    ScheduledJob.run_at <= now,
                )
                .order_by(ScheduledJob.run_at)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        ).all()
    )
    for row in rows:
        row.status = jobs_service.STATUS_RUNNING
        row.started_at = now
    await db.commit()
    return rows


async def _run_one(db: AsyncSession, job: ScheduledJob) -> bool:
    handler = HANDLERS.get(job.kind)
    if handler is None:
        job.status = jobs_service.STATUS_FAILED
        job.last_error = f"未知任务类型 {job.kind}"
        job.finished_at = datetime.now(UTC)
        await db.commit()
        return False

    try:
        note = await handler(db, job)
        job.status = jobs_service.STATUS_DONE
        job.finished_at = datetime.now(UTC)
        job.last_error = note if note.startswith("skipped") else None
        await db.commit()
        logger.info("job.done", job_id=job.id, kind=job.kind, note=note)
        return True
    except Exception as exc:  # noqa: BLE001 —— 单条任务失败不能拖垮整批
        await db.rollback()
        job = await db.get(ScheduledJob, job.id)
        if job is None:
            return False
        job.attempts += 1
        job.last_error = str(exc)[:2000]
        if job.attempts >= jobs_service.MAX_ATTEMPTS:
            job.status = jobs_service.STATUS_FAILED
            job.finished_at = datetime.now(UTC)
        else:
            job.status = jobs_service.STATUS_PENDING
            job.run_at = datetime.now(UTC) + jobs_service.backoff_delay(job.attempts)
        await db.commit()
        logger.warning(
            "job.failed", job_id=job.id, kind=job.kind, attempts=job.attempts, error=str(exc)
        )
        return False


async def _heartbeat(db: AsyncSession, jobs_done: int, offset: int) -> int:
    row = (
        await db.scalars(
            select(WorkerHeartbeat).where(WorkerHeartbeat.instance_id == INSTANCE_ID)
        )
    ).first()
    total = (row.jobs_done if row else 0) + jobs_done
    if row is None:
        db.add(
            WorkerHeartbeat(
                instance_id=INSTANCE_ID,
                version=settings.version if hasattr(settings, "version") else None,
                jobs_done=total,
                last_seen_at=datetime.now(UTC),
            )
        )
    else:
        row.jobs_done = total
        row.last_seen_at = datetime.now(UTC)
        row.version = settings.version if hasattr(settings, "version") else row.version
    await db.commit()
    return total


def _fmt_seconds(value: float) -> str:
    return f"{value:.0f}s"


async def run(once: bool = False) -> None:
    engine = create_async_engine(
        settings.database_url,
        # 独立小池：不和 API 抢连接
        pool_size=2,
        max_overflow=2,
        pool_pre_ping=True,
    )
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    idle = IDLE_MIN
    processed_since_beat = 0
    last_beat = datetime.now(UTC) - HEARTBEAT_EVERY

    logger.info("worker.start", instance=INSTANCE_ID, once=once)
    try:
        while not _stop.is_set():
            async with sessionmaker() as db:
                reclaimed = await _reclaim_zombies(db)
                if reclaimed:
                    logger.warning("worker.reclaimed", count=reclaimed)
                jobs = await _claim_batch(db)
                for job in jobs:
                    if await _run_one(db, job):
                        processed_since_beat += 1

                if processed_since_beat or datetime.now(UTC) - last_beat >= HEARTBEAT_EVERY:
                    await _heartbeat(db, processed_since_beat, 0)
                    processed_since_beat = 0
                    last_beat = datetime.now(UTC)

            if once:
                break
            if jobs:
                idle = IDLE_MIN
            else:
                # 空队列时退避，避免 1 秒一次把 DB 打满
                idle = min(idle * 2, IDLE_MAX)
            try:
                await asyncio.wait_for(_stop.wait(), timeout=idle)
            except TimeoutError:
                pass
    finally:
        await engine.dispose()
        logger.info("worker.stop", instance=INSTANCE_ID)


def _install_signal_handlers() -> None:
    loop = asyncio.get_event_loop()

    def _shutdown() -> None:
        # 置位后当前批跑完即退出，pm2 restart 不会留下半截任务
        _stop.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _shutdown)
        except NotImplementedError:  # pragma: no cover - Windows
            signal.signal(sig, lambda *_: _shutdown())


def main() -> None:
    once = "--once" in os.sys.argv
    _install_signal_handlers()
    asyncio.run(run(once=once))


if __name__ == "__main__":
    main()
