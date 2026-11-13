import json
from dataclasses import dataclass
from datetime import UTC, datetime

import structlog
from fastapi import HTTPException
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import redis_client
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.dao import user as user_dao
from app.models.permission import MemberRole, Permission, RolePermission
from app.models.role import Role
from app.models.tenant import Tenant, TenantMember
from app.models.user import User

logger = structlog.get_logger(__name__)


@dataclass
class AuthContext:
    db: AsyncSession
    user: User
    tenant: Tenant
    member: TenantMember
    roles: list[str]
    permissions: list[str]
    permission_version: int


def _auth_user(user: User) -> dict:
    return {
        "id": user.id,
        "public_id": user.public_id,
        "username": user.username,
        "nickname": user.nickname,
        "email": user.email,
        "phone": user.phone,
        "gender": user.gender,
        "birthday": user.birthday,
        "last_login_at": user.last_login_at,
        "previous_login_at": user.previous_login_at,
        "has_password": bool(user.password_hash),
        "avatar": None,
    }


def _tenant_summary(tenant: Tenant, roles: list[str]) -> dict:
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "status": tenant.status,
        "roles": roles,
    }


async def _roles_for_member(db: AsyncSession, member_id: int) -> list[str]:
    rows = (
        await db.execute(
            select(Role.code)
            .join(MemberRole, MemberRole.role_id == Role.id)
            .where(MemberRole.member_id == member_id, Role.status == "active")
        )
    ).all()
    return [row[0] for row in rows]


async def _permissions_for_roles(
    db: AsyncSession, tenant: Tenant, member_id: int, user_id: int, roles: list[str]
) -> list[str]:
    if "platform_admin" in roles:
        rows = (await db.execute(select(Permission.code))).all()
        return sorted(row[0] for row in rows)

    cache_key = f"perm:{tenant.id}:{user_id}:v{tenant.permission_version}"
    try:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except RedisError as exc:
        logger.warning("permission_cache_read_failed", error=str(exc))
        cached = None

    rows = (
        await db.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .join(Role, Role.id == RolePermission.role_id)
            .join(MemberRole, MemberRole.role_id == Role.id)
            .where(MemberRole.member_id == member_id, Role.status == "active")
            .distinct()
        )
    ).all()
    permissions = sorted(row[0] for row in rows)
    try:
        await redis_client.setex(cache_key, 60, json.dumps(permissions))
    except RedisError as exc:
        logger.warning("permission_cache_write_failed", error=str(exc))
    return permissions


async def _memberships(db: AsyncSession, user_id: int) -> list[tuple[TenantMember, Tenant]]:
    rows = (
        await db.execute(
            select(TenantMember, Tenant)
            .join(Tenant, Tenant.id == TenantMember.tenant_id)
            .where(
                TenantMember.user_id == user_id,
                TenantMember.status == "active",
                Tenant.status == "active",
            )
            .order_by(Tenant.id.asc())
        )
    ).all()
    return [(row[0], row[1]) for row in rows]


async def build_context(
    db: AsyncSession, user: User, member: TenantMember, tenant: Tenant
) -> AuthContext:
    roles = await _roles_for_member(db, member.id)
    permissions = await _permissions_for_roles(db, tenant, member.id, user.id, roles)
    return AuthContext(
        db=db,
        user=user,
        tenant=tenant,
        member=member,
        roles=roles,
        permissions=permissions,
        permission_version=tenant.permission_version,
    )


def token_is_stale(payload: dict, user: User) -> bool:
    """token 里的会话代次与库里不一致 → 改过密码，旧 token 作废。

    缺这个 claim 的老 token 按过期处理：access token 只有 30 分钟寿命，
    代价只是上线后需要重新登录一次，换来的是「改密码能踢掉其它标签页/设备」。
    """
    try:
        return int(payload.get("token_version", -1)) != int(user.token_version or 0)
    except (TypeError, ValueError):
        return True


async def context_from_payload(db: AsyncSession, payload: dict) -> AuthContext:
    try:
        user_id = int(payload.get("sub", 0))
        tenant_id = int(payload.get("tenant_id", 0))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="登录凭证无效") from exc
    user = await user_dao.get_user(db, user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=401, detail="用户不存在或已停用")
    if token_is_stale(payload, user):
        # 改过密码 / 被重置过：上一代 token 一律不认。
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    member = (
        await db.scalars(
            select(TenantMember).where(
                TenantMember.tenant_id == tenant_id,
                TenantMember.user_id == user_id,
            )
        )
    ).first()
    if member is None or member.status != "active":
        raise HTTPException(status_code=403, detail="没有该租户的访问权限")
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.status != "active":
        raise HTTPException(status_code=403, detail="租户不可用")
    return await build_context(db, user, member, tenant)


async def _issue_tokens(context: AuthContext) -> tuple[str, str]:
    access_token = create_access_token(
        user_id=context.user.id,
        tenant_id=context.tenant.id,
        audience="admin",
        roles=context.roles,
        permission_version=context.permission_version,
        token_version=context.user.token_version,
    )
    refresh_token = create_refresh_token()
    try:
        await redis_client.setex(
            f"refresh:{refresh_token}",
            settings.refresh_token_expire_days * 86400,
            json.dumps(
                {
                    "user_id": context.user.id,
                    "tenant_id": context.tenant.id,
                    "token_version": context.user.token_version,
                }
            ),
        )
    except RedisError as exc:
        raise HTTPException(status_code=503, detail="会话服务不可用") from exc
    return access_token, refresh_token


async def _response(context: AuthContext) -> dict:
    access_token, refresh_token = await _issue_tokens(context)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": _auth_user(context.user),
        "tenants": [],
        "current_tenant": _tenant_summary(context.tenant, context.roles),
        "roles": context.roles,
        "permissions": context.permissions,
        "permission_version": context.permission_version,
    }


async def register(
    db: AsyncSession, tenant_slug: str, email: str, nickname: str, password: str
) -> dict:
    tenant = (
        await db.scalars(
            select(Tenant).where(Tenant.slug == tenant_slug, Tenant.status == "active")
        )
    ).first()
    if tenant is None:
        raise HTTPException(status_code=404, detail="租户不存在")
    if await user_dao.get_by_email(db, email) is not None:
        raise HTTPException(status_code=409, detail="邮箱已注册")
    user = User(
        username=email,
        nickname=nickname,
        email=email,
        role="customer",
        status="active",
        password_hash=hash_password(password),
    )
    db.add(user)
    await db.flush()
    member = TenantMember(tenant_id=tenant.id, user_id=user.id, status="active")
    db.add(member)
    await db.flush()
    customer_role = (await db.scalars(select(Role).where(Role.code == "customer"))).first()
    if customer_role is not None:
        db.add(MemberRole(member_id=member.id, role_id=customer_role.id))
    await db.commit()
    context = await build_context(db, user, member, tenant)
    result = await _response(context)
    result["tenants"] = [
        _tenant_summary(item[1], await _roles_for_member(db, item[0].id))
        for item in await _memberships(db, user.id)
    ]
    return result


async def login(
    db: AsyncSession, username: str, password: str, tenant_id: int | None = None
) -> dict:
    user = await user_dao.get_by_username(db, username)
    if user is None or not user.password_hash or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="用户已停用")
    memberships = await _memberships(db, user.id)
    if not memberships:
        raise HTTPException(status_code=403, detail="没有可用的租户")
    selected = None
    if tenant_id is not None:
        selected = next((item for item in memberships if item[1].id == tenant_id), None)
        if selected is None:
            raise HTTPException(status_code=403, detail="没有该租户的访问权限")
    elif len(memberships) == 1:
        selected = memberships[0]
    else:
        raise HTTPException(status_code=400, detail="请选择要登录的租户")
    member, tenant = selected
    # 登录成功才回写：旧值先挤到 previous_login_at，页面上的「上次登录」
    # 才真的是**上一次**，而不是刚刚这次（否刚永远看不出异常登录）。
    user.previous_login_at = user.last_login_at
    user.last_login_at = datetime.now(UTC)
    await db.commit()
    context = await build_context(db, user, member, tenant)
    result = await _response(context)
    result["tenants"] = [
        _tenant_summary(item[1], await _roles_for_member(db, item[0].id)) for item in memberships
    ]
    return result


async def me(context: AuthContext) -> dict:
    memberships = await _memberships_db(context)
    return {
        "user": _auth_user(context.user),
        "tenants": memberships,
        "current_tenant": _tenant_summary(context.tenant, context.roles),
        "roles": context.roles,
        "permissions": context.permissions,
        "permission_version": context.permission_version,
    }


async def _memberships_db(context: AuthContext) -> list[dict]:
    db = context.db
    result = []
    for member, tenant in await _memberships(db, context.user.id):
        result.append(_tenant_summary(tenant, await _roles_for_member(db, member.id)))
    return result


async def refresh(
    db: AsyncSession, refresh_token: str, expected_tenant_id: int | None = None
) -> dict:
    """用 refresh token 换新的 access token。

    expected_tenant_id：当前请求 Host 解析出的租户（解析不出来时为 None）。
    两者不一致一律 401 —— 否则 A 站拿到的 refresh cookie 被搬到 B 站域下就能续出
    B 站的会话。提示语刻意与「过期」相同，不告诉对方被拒绝的真实原因。
    """
    try:
        raw = await redis_client.get(f"refresh:{refresh_token}")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="会话服务不可用") from exc
    if not raw:
        raise HTTPException(status_code=401, detail="登录已过期")
    try:
        data = json.loads(raw)
        user_id = int(data["user_id"])
        tenant_id = int(data["tenant_id"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="登录已过期") from exc
    if expected_tenant_id is not None and tenant_id != expected_tenant_id:
        # 同一个 refresh token 只能在自己的站点域名下续期。
        raise HTTPException(status_code=401, detail="登录已过期")
    user = await user_dao.get_user(db, user_id)
    tenant = await db.get(Tenant, tenant_id)
    if user is None or tenant is None:
        raise HTTPException(status_code=401, detail="登录已过期")
    if int(data.get("token_version", -1)) != int(user.token_version or 0):
        # 改过密码：这枚 refresh token 属于上一代会话，不再续期。
        raise HTTPException(status_code=401, detail="登录已过期")
    member = (
        await db.scalars(
            select(TenantMember).where(
                TenantMember.tenant_id == tenant.id,
                TenantMember.user_id == user.id,
            )
        )
    ).first()
    if member is None or member.status != "active":
        raise HTTPException(status_code=403, detail="没有该租户的访问权限")
    context = await build_context(db, user, member, tenant)
    try:
        await redis_client.delete(f"refresh:{refresh_token}")
    except RedisError as exc:
        logger.warning("refresh_token_delete_failed", error=str(exc))
    result = await _response(context)
    result["tenants"] = [
        _tenant_summary(item[1], await _roles_for_member(db, item[0].id))
        for item in await _memberships(db, user.id)
    ]
    return result


async def logout(refresh_token: str | None) -> None:
    if refresh_token:
        try:
            await redis_client.delete(f"refresh:{refresh_token}")
        except RedisError as exc:
            logger.warning("logout_token_delete_failed", error=str(exc))
