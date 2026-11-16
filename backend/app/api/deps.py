from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.security import decode_access_token
from app.services.auth import AuthContext, context_from_payload
from app.services.platform_auth import (
    PLATFORM_AUDIENCE,
    PlatformContext,
    platform_context_from_payload,
)

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    """租户控制台上下文。只接受 aud=admin 的 token。"""
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        payload = decode_access_token(credentials.credentials, audience="admin")
    except PyJWTError as exc:
        raise HTTPException(status_code=401, detail="登录已过期") from exc
    return await context_from_payload(db, payload)


async def get_optional_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext | None:
    """公开接口用的「能登就登」。

    公开商品/评价等接口对匿名访客开放，但戴着有效 token 访问时要能返回
    **与本人相关** 的字段（如 `is_favorited`）。token 无效或缺失一律当匿名，
    不报 401 —— 否则收藏态这种装饰性字段会把整个页面拖成登录页。
    """
    if credentials is None:
        return None
    try:
        payload = decode_access_token(credentials.credentials, audience="admin")
        return await context_from_payload(db, payload)
    except (PyJWTError, HTTPException):
        return None


async def get_platform_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> PlatformContext:
    """平台管理端上下文。只接受 aud=platform 的 token。

    租户 token 的 aud 是 admin，在这里会被 JWT 校验直接判 401；
    平台 token 去调租户接口同理。两套身份因此无法互相越界。
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        payload = decode_access_token(credentials.credentials, audience=PLATFORM_AUDIENCE)
    except PyJWTError as exc:
        raise HTTPException(status_code=401, detail="登录已过期") from exc
    return await platform_context_from_payload(db, payload)


def require_permission(code: str):
    async def dependency(context: AuthContext = Depends(get_current_context)) -> AuthContext:
        # 租户侧不再有「平台角色直通所有权限」的旁路：权限必须逐个显式授予。
        if code not in context.permissions:
            raise HTTPException(status_code=403, detail="无权限")
        return context

    return dependency


def require_platform_permission(code: str):
    async def dependency(
        context: PlatformContext = Depends(get_platform_context),
    ) -> PlatformContext:
        if code not in context.permissions:
            raise HTTPException(status_code=403, detail="无权限")
        return context

    return dependency


__all__ = [
    "AsyncGenerator",
    "AsyncSession",
    "get_current_context",
    "get_db",
    "get_platform_context",
    "require_permission",
    "require_platform_permission",
]
