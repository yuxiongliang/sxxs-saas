"""Audit trail read API (`audit:read`)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_context, get_db, require_permission
from app.core.response import ok, page_data
from app.schemas.common import ApiResponse
from app.services import audit as audit_service
from app.services.auth import AuthContext

router = APIRouter(prefix="/audit-logs", tags=["审计日志"])


@router.get(
    "",
    response_model=ApiResponse[dict],
    dependencies=[Depends(require_permission("audit:read"))],
)
async def list_audit_logs(
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    action: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    keyword: str | None = Query(default=None, max_length=64),
    actor_id: int | None = None,
    tenant_id: int | None = None,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    rows, total = await audit_service.list_logs(
        db,
        context,
        current=current,
        page_size=pageSize,
        action=action,
        target_type=target_type,
        target_id=target_id,
        keyword=keyword,
        actor_id=actor_id,
        tenant_id=tenant_id,
    )
    items = []
    actors = await audit_service.actor_directory(db, rows)
    targets = await audit_service.target_directory(db, rows)
    for row in rows:
        username, public_id = actors.get(row.actor_id or 0, (None, None))
        target_type_text, target_label = targets.get(row.id, ("-", ""))
        items.append(
            {
                "id": row.id,
                "tenant_id": row.tenant_id,
                "actor_id": row.actor_id,
                # 裸 actor_id 对运营没有可读性：直接给出用户名与对外用户编号。
                # 用户被删就保持 None，前端显示 '-'。
                "actor_username": username,
                "actor_public_id": public_id,
                "action": row.action,
                "action_label": audit_service.action_label(row.action),
                "action_label": audit_service.action_label(row.action),
                "target_type": row.target_type,
                # 界面上不再拼 `#id`：直接给中文类型 + 人能读的标签
                # （订单号 / 商品名 / 用户ID+用户名 / 角色名…）
                "target_type_label": target_type_text,
                "target_label": target_label,
                "target_id": row.target_id,
                "before": row.before,
                "after": row.after,
                "ip": row.ip,
                "trace_id": row.trace_id,
                "created_at": row.created_at,
            }
        )
    return ok(page_data(items, total, current, pageSize))


@router.get(
    "/actions",
    response_model=ApiResponse[list[dict]],
    dependencies=[Depends(require_permission("audit:read"))],
)
async def list_audit_actions(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    """筛选下拉用：直接给中文名，前端不用自己维护一份 code→中文 的映射。"""
    codes = await audit_service.distinct_actions(db, context)
    return ok(
        [
            {"value": code, "label": audit_service.action_label(code)}
            for code in codes
        ]
    )
