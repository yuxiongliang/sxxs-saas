"""平台审计：跨租户查看平台侧操作（tenant_id 为空的行）。"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_platform_permission
from app.core.response import ok, page_data
from app.schemas.common import ApiResponse
from app.services import audit as audit_service

router = APIRouter(prefix="/platform/audit", tags=["平台审计"])


@router.get("", response_model=ApiResponse[dict])
async def list_platform_audit(
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    _context=Depends(require_platform_permission("platform:setting:read")),
    db: AsyncSession = Depends(get_db),
):
    rows, total = await audit_service.list_platform_logs(db, current, pageSize)
    items = []
    actors = await audit_service.actor_directory(db, rows)
    for row in rows:
        username, public_id = actors.get(row.actor_id or 0, (None, None))
        items.append(
            {
                "id": row.id,
                "actor_id": row.actor_id,
                "actor_username": username,
                "actor_public_id": public_id,
                "action": row.action,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "before": row.before,
                "after": row.after,
                "created_at": row.created_at,
            }
        )
    return ok(page_data(items, total, current, pageSize))
