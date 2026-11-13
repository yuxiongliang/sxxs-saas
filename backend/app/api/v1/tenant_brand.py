"""租户自助维护站点品牌（全站名称 / logo / favicon）。

为什么放在 tenants 表而不是 system_settings：
登录页、邮件模板、404 页在「配置还没加载」时就要用到品牌，
依赖 settings 会出现首屏空白。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_context, get_db, require_permission
from app.core.response import ok
from app.models.attachment import Attachment
from app.models.tenant import Tenant
from app.schemas.common import ApiResponse
from app.schemas.tenant_brand import TenantBrandOut, TenantBrandUpdate
from app.services.auth import AuthContext

router = APIRouter(prefix="/tenant/brand", tags=["租户品牌"])

# 附件中心里选中图片后，logo_url 存的就是这个稳定直链（相对路径，跟着站点域名走）。
PUBLIC_ATTACHMENT_PREFIX = "/api/v1/attachments/public/"


def _serialize(record: Tenant) -> TenantBrandOut:
    return TenantBrandOut(
        tenant_id=record.id,
        slug=record.slug,
        name=record.name,
        display_name=record.display_name or record.name,
        logo_url=record.logo_url,
        favicon_url=record.favicon_url,
    )


async def _publish_logo_attachment(
    db: AsyncSession, tenant_id: int, logo_url: str | None
) -> None:
    """把选中的附件标成 public。

    附件中心上传出来的附件默认 `visibility=tenant`，而 `/attachments/public/{id}`
    只放行 public —— 不把这一步做掉，管理员选完图保存，logo 依旧 404。
    只允许发布**本租户自己的**附件，避免拿别人的 id 去探。
    """
    if not logo_url or not logo_url.startswith(PUBLIC_ATTACHMENT_PREFIX):
        return
    raw_id = logo_url[len(PUBLIC_ATTACHMENT_PREFIX) :].strip("/")
    try:
        attachment_id = int(raw_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Logo 链接格式不正确") from exc
    record = await db.get(Attachment, attachment_id)
    if record is None or record.tenant_id != tenant_id:
        raise HTTPException(status_code=400, detail="附件不存在或不属于当前租户")
    if record.visibility != "public":
        record.visibility = "public"


@router.get("", response_model=ApiResponse[TenantBrandOut])
async def get_brand(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    record = await db.get(Tenant, context.tenant.id)
    if record is None:
        raise HTTPException(status_code=404, detail="租户不存在")
    return ok(_serialize(record))


@router.put("", response_model=ApiResponse[TenantBrandOut])
async def save_brand(
    payload: TenantBrandUpdate,
    _context=Depends(require_permission("tenant:brand:manage")),
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    record = await db.get(Tenant, context.tenant.id)
    if record is None:
        raise HTTPException(status_code=404, detail="租户不存在")
    if payload.display_name is not None:
        record.display_name = payload.display_name or None
    if payload.logo_url is not None:
        record.logo_url = payload.logo_url or None
        await _publish_logo_attachment(db, context.tenant.id, record.logo_url)
    if payload.favicon_url is not None:
        record.favicon_url = payload.favicon_url or None
    await db.commit()
    await db.refresh(record)
    return ok(_serialize(record), "品牌已保存")
