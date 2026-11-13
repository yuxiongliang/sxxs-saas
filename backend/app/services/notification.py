import asyncio
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dao import notification as notification_dao
from app.models.notification import Notification
from app.models.notification_pref import TenantNotificationPref, UserNotificationPref
from app.models.notification_template import NotificationTemplate
from app.models.permission import MemberRole
from app.models.role import Role
from app.models.tenant import Tenant, TenantDomain, TenantMember
from app.models.user import User
from app.schemas.notification import NotificationCreate, NotificationStats
from app.services import notification_template as template_service
from app.services import setting_resolver


def _audience_role_code(audience: str) -> str | None:
    """`role:admin` → `admin`；`all` / `custom` → None（不按角色过滤）。"""
    if audience.startswith("role:"):
        return audience.split(":", 1)[1] or None
    return None


async def resolve_recipients(db: AsyncSession, tenant_id: int, audience: str) -> list[User]:
    """把 audience 展开成**真实**收件人。

    旧实现用 `AUDIENCE_SIZE` 硬编码字典（all=1280 等）编数字，导致
    「成功率」和收件人偏好都无从谈起。现在以租户成员表为准：只有
    `tenant_members` 和 `users` 都 active 的人算收件人。
    """
    stmt = (
        select(User)
        .join(TenantMember, TenantMember.user_id == User.id)
        .where(
            TenantMember.tenant_id == tenant_id,
            TenantMember.status == "active",
            User.status == "active",
        )
    )
    role_code = _audience_role_code(audience)
    if role_code:
        stmt = (
            stmt.join(MemberRole, MemberRole.member_id == TenantMember.id)
            .join(Role, Role.id == MemberRole.role_id)
            .where(Role.code == role_code)
        )
    return list((await db.scalars(stmt.distinct())).all())


async def _tenant_channel_enabled(db: AsyncSession, tenant_id: int, channel: str) -> bool:
    """租户自己的渠道开关（运营意志）。缺行 = 开启。"""
    if channel == "inbox":
        return True
    row = (
        await db.scalars(
            select(TenantNotificationPref).where(
                TenantNotificationPref.tenant_id == tenant_id,
                TenantNotificationPref.channel == channel,
            )
        )
    ).first()
    return True if row is None else bool(row.enabled)


async def _users_opted_out(
    db: AsyncSession, tenant_id: int, category: str, channel: str
) -> set[int]:
    """用户自己在「个人设置 → 新消息通知」里关掉这个分类的人。"""
    if channel == "inbox":
        return set()
    rows = await db.scalars(
        select(UserNotificationPref.user_id).where(
            UserNotificationPref.tenant_id == tenant_id,
            UserNotificationPref.category == category,
            UserNotificationPref.channel == channel,
            UserNotificationPref.enabled.is_(False),
        )
    )
    return set(rows.all())


async def list_notifications(
    db: AsyncSession,
    current: int,
    page_size: int,
    channel: str | None = None,
    status: str | None = None,
    tenant_id: int = 1,
) -> tuple[list[Notification], int]:
    return await notification_dao.list_notifications(
        db, current, page_size, channel, status, tenant_id
    )


async def _primary_domain(db: AsyncSession, tenant_id: int) -> str:
    """租户已生效的域名（B6）；没绑定时返回空串。"""
    host = (
        await db.scalars(
            select(TenantDomain.host)
            .where(
                TenantDomain.tenant_id == tenant_id,
                TenantDomain.status == "active",
            )
            .order_by(TenantDomain.id)
        )
    ).first()
    return host or ""


async def send_notification(
    db: AsyncSession, payload: NotificationCreate, tenant_id: int = 1
) -> Notification:
    if payload.channel not in {"sms", "email", "inbox"}:
        raise HTTPException(status_code=400, detail="不支持的触达渠道")
    now = datetime.now(UTC)

    # 先展开真实收件人：`total` 从创建那一刻就是真实人数，不再是写死的 1280。
    recipients = await resolve_recipients(db, tenant_id, payload.audience)

    title = payload.title
    content = payload.content
    if payload.template:
        candidates = list(
            (
                await db.scalars(
                    select(NotificationTemplate).where(
                        NotificationTemplate.scope.in_(template_service.TENANT_SCOPES),
                        NotificationTemplate.code == payload.template,
                        NotificationTemplate.enabled.is_(True),
                    )
                )
            ).all()
        )
        if not candidates:
            raise HTTPException(
                status_code=400,
                detail=f"通知模板不存在或已停用：{payload.template}",
            )
        if len(candidates) > 1:
            # 买家/卖家各有一份同 code 模板时不猜：猜错就是把卖家邮件发给买家
            raise HTTPException(
                status_code=400,
                detail=(
                    f"模板 {payload.template} 同时存在于 "
                    f"{'、'.join(sorted(row.scope for row in candidates))}，请按作用域分别命名"
                ),
            )
        template = candidates[0]
        tenant = await db.get(Tenant, tenant_id)
        tenant_name = (tenant.display_name or tenant.name) if tenant else ""
        context = {
            "tenant_name": tenant_name,
            "tenant_domain": await _primary_domain(db, tenant_id),
            "buyer_name": payload.audience or "",
            "order_no": "",
            "amount": "",
            "site_url": "",
            "support_email": "",
        }
        # 渲染会校验变量：缺失直接 400，不会把 {{...}} 原样发出去
        content = template_service.render(template.body, context)
        if template.subject:
            title = template_service.render(template.subject, context)

    status = "pending" if payload.scheduled_at and payload.scheduled_at > now else "sending"
    record = await notification_dao.create_notification(
        db,
        {
            "tenant_id": tenant_id,
            "title": title,
            "channel": payload.channel,
            "template": payload.template,
            "audience": payload.audience,
            "category": payload.category,
            "content": content,
            "status": status,
            "scheduled_at": payload.scheduled_at,
            "total": len(recipients),
            "success_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
        },
    )
    await db.commit()

    if status == "pending":
        await db.refresh(record)
        return record

    return await _deliver(db, record)


async def _deliver(db: AsyncSession, record: Notification) -> Notification:
    """按「渠道可用 → 租户开关 → 用户偏好」三层算能发给谁。

    真实投递（SMTP / 短信网关）仍未接入 —— 这个函数决定的是「多少人**会**收到」，
    不是「已送达」。三个数字各有含义，不要混用：

    * `total`   — 命中 audience 的真实成员数；
    * `failed`  — **渠道本身不可用**（未配置/被租户关闭），全员未发；
    * `skipped` — 渠道可用，但这些人**本人**关掉了这个分类（只算第 3 层）。

    因此 `skipped` 不包含「租户关渠道」的人，那种情况整条记录就是 `failed`。
    """
    # 保留一点延迟：前端拿到的是“已处理完”的结果，少一个轮询分支。
    await asyncio.sleep(0.35)

    recipients = await resolve_recipients(db, record.tenant_id, record.audience)
    record.total = len(recipients)

    failure: str | None = None
    if record.channel in {"sms", "email"}:
        # 走 resolver：跟随系统的租户要用**平台**的启用状态，
        # 直接读 system_settings 拿不到继承后的结果。
        resolved = await setting_resolver.resolve(db, record.tenant_id, record.channel)
        if not resolved.enabled:
            failure = f"{record.channel} 渠道未启用"
        elif not await _tenant_channel_enabled(db, record.tenant_id, record.channel):
            failure = f"{record.channel} 渠道已被租户关闭"

    if failure:
        record.status = "failed"
        record.success_count = 0
        record.failed_count = len(recipients)
        record.skipped_count = 0
        record.error_message = failure
        record.sent_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(record)
        return record

    opted_out = await _users_opted_out(
        db, record.tenant_id, record.category or "system", record.channel
    )
    skipped = sum(1 for user in recipients if user.id in opted_out)
    record.status = "success"
    record.success_count = len(recipients) - skipped
    record.failed_count = 0
    record.skipped_count = skipped
    record.error_message = None
    record.sent_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(record)
    return record


async def retry_notification(
    db: AsyncSession, notification_id: int, tenant_id: int = 1
) -> Notification:
    record = await notification_dao.get_notification(db, notification_id, tenant_id)
    if record is None:
        raise HTTPException(status_code=404, detail="通知记录不存在")
    if record.status == "success":
        return record
    if record.status == "pending":
        # 定时发送的通知还没到点，直接「重试」等于提前群发。
        raise HTTPException(status_code=400, detail="定时通知尚未到发送时间，不能重试")
    # 重试不再“直接标成功”：按当前收件人与偏好重新算一次，
    # 否刚关掉短信的租户点一下重试就看到全员成功。
    return await _deliver(db, record)


async def get_stats(db: AsyncSession, tenant_id: int = 1) -> NotificationStats:
    return NotificationStats(**await notification_dao.notification_stats(db, tenant_id))
