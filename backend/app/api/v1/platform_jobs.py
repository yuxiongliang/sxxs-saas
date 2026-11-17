"""平台端：定时任务管理（延时任务队列 + worker 心跳）。

平台运维要能回答三个问题，这个模块就是给这三个问题的：

1. **现在有没有任务在排队？** —— 列表 + 筛选（类型 / 状态 / 到期待执行）
2. **worker 还活着吗？** —— `worker_heartbeats` 的心跳时间
3. **跑挂了怎么办？** —— 单条「立即执行 / 重试 / 取消」，失败任务计数飘红

写操作都要留审计：改的是"系统自动行为"，出问题必须能回溯是谁改的。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_platform_permission
from app.core.response import ok
from app.models.job import ScheduledJob, WorkerHeartbeat
from app.models.order import SellerOrder
from app.schemas.common import ApiResponse
from app.services import audit as audit_service
from app.services import jobs as jobs_service
from app.worker.handlers import HANDLERS

router = APIRouter(prefix="/platform/jobs", tags=["平台定时任务"])

PLATFORM_READ = "platform:tenant:read"
PLATFORM_WRITE = "platform:tenant:manage"

#: 心跳超过这个时间没更新，就认为 worker 掉线（心跳每 30 秒一次）
HEARTBEAT_STALE_SECONDS = 120


async def _seller_order_nos(db: AsyncSession, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = (
        await db.scalars(
            select(SellerOrder).where(SellerOrder.id.in_(ids))
        )
    ).all()
    return {row.id: row.seller_order_no for row in rows}


@router.get(
    "",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_platform_permission(PLATFORM_READ))],
)
async def list_jobs(
    kind: str | None = Query(default=None, max_length=32),
    status: str | None = Query(default=None, max_length=16),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ScheduledJob)
    if kind:
        stmt = stmt.where(ScheduledJob.kind == kind)
    if status:
        stmt = stmt.where(ScheduledJob.status == status)
    rows = list(
        (await db.scalars(stmt.order_by(ScheduledJob.run_at.desc()).limit(limit))).all()
    )
    order_nos = await _seller_order_nos(
        db, [row.ref_id for row in rows if row.ref_type == "seller_order"]
    )

    # 心跳：worker 是不是还在干活（常驻进程最大的坑是"活着但卡死"）
    heartbeats = list((await db.scalars(select(WorkerHeartbeat))).all())
    now = datetime.now(UTC)
    workers = [
        {
            "instance_id": row.instance_id,
            "version": row.version,
            "jobs_done": row.jobs_done,
            "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
            "alive": bool(
                row.last_seen_at
                and (now - row.last_seen_at).total_seconds() <= HEARTBEAT_STALE_SECONDS
            ),
        }
        for row in heartbeats
    ]

    failed = (
        await db.scalar(
            select(func.count(ScheduledJob.id)).where(
                ScheduledJob.status == jobs_service.STATUS_FAILED
            )
        )
    ) or 0
    pending = (
        await db.scalar(
            select(func.count(ScheduledJob.id)).where(
                ScheduledJob.status == jobs_service.STATUS_PENDING
            )
        )
    ) or 0

    return ok(
        {
            "list": [
                {
                    "id": row.id,
                    "kind": row.kind,
                    "ref_type": row.ref_type,
                    "ref_id": row.ref_id,
                    "ref_no": order_nos.get(row.ref_id),
                    "run_at": row.run_at.isoformat() if row.run_at else None,
                    "status": row.status,
                    "attempts": row.attempts,
                    "last_error": row.last_error,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "finished_at": row.finished_at.isoformat() if row.finished_at else None,
                }
                for row in rows
            ],
            "workers": workers,
            "summary": {"pending": pending, "failed": failed},
            "kinds": sorted(HANDLERS.keys()),
        }
    )


async def _load(db: AsyncSession, job_id: int) -> ScheduledJob:
    job = await db.get(ScheduledJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job


@router.post(
    "/{job_id}/run",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_platform_permission(PLATFORM_WRITE))],
)
async def run_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """立即执行一次（不等到点）。失败的任务会重新排队重试。"""
    job = await _load(db, job_id)
    handler = HANDLERS.get(job.kind)
    if handler is None:
        raise HTTPException(status_code=400, detail=f"未知任务类型 {job.kind}")
    job.status = jobs_service.STATUS_RUNNING
    job.started_at = datetime.now(UTC)
    await db.commit()
    try:
        note = await handler(db, job)
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        job = await _load(db, job_id)
        job.attempts += 1
        job.last_error = str(exc)[:2000]
        job.status = jobs_service.STATUS_FAILED
        job.finished_at = datetime.now(UTC)
        await db.commit()
        raise HTTPException(status_code=400, detail=f"执行失败：{exc}") from exc

    job = await _load(db, job_id)
    job.status = jobs_service.STATUS_DONE
    job.finished_at = datetime.now(UTC)
    job.last_error = note if note.startswith("skipped") else None
    await audit_service.record(
        db,
        action=audit_service.ACTION_JOB_RUN,
        actor_id=None,
        target_type="scheduled_job",
        target_id=job.id,
        after={"kind": job.kind, "ref_id": str(job.ref_id), "note": note},
    )
    await db.commit()
    return ok({"id": job.id, "status": job.status, "note": note}, "已执行")


@router.post(
    "/{job_id}/cancel",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_platform_permission(PLATFORM_WRITE))],
)
async def cancel_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """取消任务：置 cancelled 而不是删除，事后能查"为什么没执行"。"""
    job = await _load(db, job_id)
    if job.status not in (jobs_service.STATUS_PENDING, jobs_service.STATUS_FAILED):
        raise HTTPException(status_code=400, detail="只有待执行/失败的任务可以取消")
    job.status = jobs_service.STATUS_CANCELLED
    job.finished_at = datetime.now(UTC)
    job.last_error = "人工取消"
    await audit_service.record(
        db,
        action=audit_service.ACTION_JOB_CANCELLED,
        actor_id=None,
        target_type="scheduled_job",
        target_id=job.id,
        after={"kind": job.kind, "ref_id": str(job.ref_id)},
    )
    await db.commit()
    return ok({"id": job.id, "status": job.status}, "已取消")


@router.post(
    "/{job_id}/retry",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_platform_permission(PLATFORM_WRITE))],
)
async def retry_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """重试失败任务：清零尝试次数，立刻到点。"""
    job = await _load(db, job_id)
    if job.status != jobs_service.STATUS_FAILED:
        raise HTTPException(status_code=400, detail="只有失败的任务需要重试")
    job.status = jobs_service.STATUS_PENDING
    job.attempts = 0
    job.run_at = datetime.now(UTC)
    job.last_error = None
    job.finished_at = None
    await audit_service.record(
        db,
        action=audit_service.ACTION_JOB_RUN,
        actor_id=None,
        target_type="scheduled_job",
        target_id=job.id,
        after={"kind": job.kind, "ref_id": str(job.ref_id), "retry": "true"},
    )
    await db.commit()
    return ok({"id": job.id, "status": job.status}, "已重新排队")
