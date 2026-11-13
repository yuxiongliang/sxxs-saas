"""自助账号服务：个人资料 / 密码 / 账号绑定 / 通知偏好。

这些动作**只作用于当前登录用户自己**，所以不挂权限码 —— 能登录就应该能改自己的
资料。越权风险由调用方式保证：所有函数只接 `AuthContext`，从不接受外部传入的
`user_id`，查询条件里永远是 `context.user.id`。

和 `services/user.py` 的分工：

* `user.py` 是**管理员**视角（`user:write`），能改别人、能改角色/状态/部门；
* 本模块是**本人**视角，能改的字段是白名单，且改登录凭据（邮箱/手机）必须验密码。
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.dao import user as user_dao
from app.models.notification_pref import UserNotificationPref
from app.models.user import User
from app.schemas.auth import ContactUpdate, PasswordChange, ProfileUpdate
from app.services import audit as audit_service
from app.services.auth import AuthContext

# 通知分类：与 `Notification.category`、前端「新消息通知」开关一一对应。
# 新增分类时三处一起加（常量 / 前端 CATEGORIES / 文档），不会自动出现。
NOTIFICATION_CATEGORIES: tuple[tuple[str, str], ...] = (
    ("transaction", "交易动态"),
    ("finance", "结算与账单"),
    ("im", "消息提醒"),
    ("system", "系统与安全"),
    ("marketing", "营销活动"),
)
CATEGORY_CODES = tuple(code for code, _ in NOTIFICATION_CATEGORIES)

# 用户可自行关闭的渠道。inbox（站内信）不在其中：欠费/安全/合规必须送达，
# 这条约定和租户级开关（`api/v1/notifications.py` 的 MANDATORY_CHANNELS）一致。
OPTIONAL_CHANNELS = ("sms", "email")


def _mask(value: str | None) -> str | None:
    """脱敏展示：138****8293 / a***@example.com。"""
    if not value:
        return None
    if "@" in value:
        name, _, domain = value.partition("@")
        head = name[:1] if name else ""
        return f"{head}***@{domain}"
    if len(value) <= 7:
        return f"{value[:2]}****"
    return f"{value[:3]}****{value[-4:]}"


async def update_profile(db: AsyncSession, context: AuthContext, payload: ProfileUpdate) -> User:
    """改性别/生日。字段白名单在 schema 层，这里只落库 + 留痕。"""
    user = context.user
    data = payload.model_dump(exclude_unset=True)
    changed = {key: value for key, value in data.items() if getattr(user, key) != value}
    if not changed:
        # 没真改就不写审计：否则每次点「保存」都多一条 before == after 的噪声。
        return user
    before = {key: getattr(user, key) for key in changed}
    for key, value in changed.items():
        setattr(user, key, value)
    await audit_service.record(
        db,
        action=audit_service.ACTION_PROFILE_UPDATED,
        tenant_id=context.tenant.id,
        actor_id=user.id,
        target_type="user",
        target_id=user.id,
        before={k: str(v) if v is not None else None for k, v in before.items()},
        after={k: str(v) if v is not None else None for k, v in changed.items()},
    )
    await db.commit()
    await db.refresh(user)
    return user


async def change_password(
    db: AsyncSession, context: AuthContext, payload: PasswordChange
) -> None:
    """改密码：验当前密码 → 换 hash → 会话代次 +1。

    `token_version` +1 会同时作废：
    * 其它标签页/设备的 access token（`context_from_payload` 每次请求比对）；
    * Redis 里的 refresh token（刷新时比对），最长 7 天的续期窗口因此封死。
    """
    user = context.user
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="该账号没有密码，无法自助修改")
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")
    user.password_hash = hash_password(payload.new_password)
    # 让本人已有的 access / refresh token 全部作废（其它标签页、其它设备）。
    user.token_version = (user.token_version or 0) + 1
    await audit_service.record(
        db,
        action=audit_service.ACTION_PASSWORD_CHANGED,
        tenant_id=context.tenant.id,
        actor_id=user.id,
        target_type="user",
        target_id=user.id,
        before=None,
        after=None,
    )
    await db.commit()


async def update_contact(db: AsyncSession, context: AuthContext, payload: ContactUpdate) -> User:
    """换手机 / 换邮箱：验当前密码 → 唯一性校验 → 落库留痕。"""
    user = context.user
    if not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=400, detail="密码不正确")

    before: dict[str, str | None] = {}
    changed: dict[str, str | None] = {}

    if payload.email is not None and payload.email != user.email:
        exists = await user_dao.get_by_email(db, payload.email)
        if exists is not None and exists.id != user.id:
            raise HTTPException(status_code=409, detail="该邮箱已被其他账号使用")
        before["email"] = _mask(user.email)
        changed["email"] = _mask(payload.email)
        # 自助注册的账号 `username == email`（见 `services.auth.register`），而登录
        # 只认 username。不同步的话，界面说「用新邮箱登录」实际会 401。
        if user.username == user.email:
            taken = await user_dao.get_by_username(db, payload.email)
            if taken is not None and taken.id != user.id:
                raise HTTPException(status_code=409, detail="该邮箱已被其他账号用作登录名")
            before["username"] = user.username
            changed["username"] = payload.email
            user.username = payload.email
        user.email = payload.email

    if payload.phone is not None and payload.phone != (user.phone or ""):
        # phone 没有唯一约束（历史原因），这里只能给个「别撞号」的软校验。
        taken = (
            await db.scalars(
                select(User).where(User.phone == payload.phone, User.id != user.id)
            )
        ).first()
        if taken is not None:
            raise HTTPException(status_code=409, detail="该手机号已被其他账号使用")
        before["phone"] = _mask(user.phone)
        changed["phone"] = _mask(payload.phone)
        user.phone = payload.phone

    if not changed:
        return user

    await audit_service.record(
        db,
        action=audit_service.ACTION_CONTACT_UPDATED,
        tenant_id=context.tenant.id,
        actor_id=user.id,
        target_type="user",
        target_id=user.id,
        before=before,
        after=changed,
    )
    await db.commit()
    await db.refresh(user)
    return user


async def _pref_rows(db: AsyncSession, user_id: int, tenant_id: int) -> dict[tuple[str, str], bool]:
    rows = list(
        (
            await db.scalars(
                select(UserNotificationPref).where(
                    UserNotificationPref.user_id == user_id,
                    UserNotificationPref.tenant_id == tenant_id,
                )
            )
        ).all()
    )
    return {(row.category, row.channel): bool(row.enabled) for row in rows}


async def notification_prefs(db: AsyncSession, context: AuthContext) -> dict:
    """返回分类 × 渠道的开关矩阵。

    缺行按**开启**解释（新分类不必回填），前端因此可以直接渲染。
    """
    explicit = await _pref_rows(db, context.user.id, context.tenant.id)
    return {
        "categories": [
            {
                "category": code,
                "label": label,
                "channels": [
                    {
                        "channel": channel,
                        "enabled": explicit.get((code, channel), True),
                    }
                    for channel in OPTIONAL_CHANNELS
                ],
            }
            for code, label in NOTIFICATION_CATEGORIES
        ],
        "mandatory_channel": "inbox",
        "contact": {
            "email": _mask(context.user.email),
            "phone": _mask(context.user.phone),
        },
    }


async def save_notification_pref(
    db: AsyncSession,
    context: AuthContext,
    *,
    category: str,
    channel: str,
    enabled: bool,
) -> dict:
    if category not in CATEGORY_CODES:
        raise HTTPException(status_code=400, detail="不支持的通知分类")
    if channel not in OPTIONAL_CHANNELS:
        raise HTTPException(status_code=400, detail="站内信是强制渠道，不能关闭")

    row = (
        await db.scalars(
            select(UserNotificationPref).where(
                UserNotificationPref.user_id == context.user.id,
                UserNotificationPref.tenant_id == context.tenant.id,
                UserNotificationPref.category == category,
                UserNotificationPref.channel == channel,
            )
        )
    ).first()
    if row is None:
        row = UserNotificationPref(
            user_id=context.user.id,
            tenant_id=context.tenant.id,
            category=category,
            channel=channel,
            enabled=enabled,
        )
        db.add(row)
    else:
        row.enabled = enabled
    await db.commit()
    return {"category": category, "channel": channel, "enabled": row.enabled}
