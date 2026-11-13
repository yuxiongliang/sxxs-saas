from fastapi import APIRouter, Cookie, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_context, get_db
from app.core.config import settings
from app.core.response import ok
from app.schemas.auth import (
    AuthResponse,
    ContactUpdate,
    LoginRequest,
    MeResponse,
    NotificationPrefUpdate,
    PasswordChange,
    ProfileUpdate,
    RegisterRequest,
)
from app.schemas.common import ApiResponse
from app.services import account as account_service
from app.services import auth as auth_service
from app.services import tenant_domains
from app.services.auth import AuthContext

router = APIRouter(prefix="/auth", tags=["认证"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
    )


@router.post("/register", response_model=ApiResponse[AuthResponse])
async def register(
    payload: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await auth_service.register(
        db, payload.tenant_slug, payload.email, payload.nickname, payload.password
    )
    refresh_token = result.pop("refresh_token")
    _set_refresh_cookie(response, refresh_token)
    return ok(AuthResponse.model_validate(result), "注册成功")


@router.post("/login", response_model=ApiResponse[AuthResponse])
async def login(
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await auth_service.login(db, payload.username, payload.password, payload.tenant_id)
    refresh_token = result.pop("refresh_token")
    _set_refresh_cookie(response, refresh_token)
    return ok(AuthResponse.model_validate(result), "登录成功")


@router.get("/me", response_model=ApiResponse[MeResponse])
async def me(context=Depends(get_current_context)):
    return ok(MeResponse.model_validate(await auth_service.me(context)))


# ---------------------------------------------------------------------------
# 自助账号：只作用于当前登录用户自己，因此不挂权限码（能登录就能改自己的资料）
# ---------------------------------------------------------------------------


@router.patch("/me", response_model=ApiResponse[MeResponse])
async def update_me(
    payload: ProfileUpdate,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    await account_service.update_profile(db, context, payload)
    return ok(MeResponse.model_validate(await auth_service.me(context)), "个人资料已更新")


@router.post("/me/password", response_model=ApiResponse[None])
async def change_password(
    payload: PasswordChange,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    await account_service.change_password(db, context, payload)
    # 前端拿到这行提示后主动清 token 重新登录：当前 access token 还没过期，
    # 但换密码之后继续用旧会话不符合直觉。
    return ok(None, "密码已修改，请重新登录")


@router.put("/me/contact", response_model=ApiResponse[MeResponse])
async def update_contact(
    payload: ContactUpdate,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    await account_service.update_contact(db, context, payload)
    return ok(MeResponse.model_validate(await auth_service.me(context)), "绑定信息已更新")


@router.get("/me/notification-prefs", response_model=ApiResponse[dict])
async def get_notification_prefs(
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return ok(await account_service.notification_prefs(db, context))


@router.put("/me/notification-prefs", response_model=ApiResponse[dict])
async def save_notification_pref(
    payload: NotificationPrefUpdate,
    context: AuthContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return ok(
        await account_service.save_notification_pref(
            db,
            context,
            category=payload.category,
            channel=payload.channel,
            enabled=payload.enabled,
        ),
        "通知设置已保存",
    )


@router.post("/refresh", response_model=ApiResponse[AuthResponse])
async def refresh(
    request: Request,
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias="antd_pro_refresh"),
    db: AsyncSession = Depends(get_db),
):
    if not refresh_token:
        raise auth_service.HTTPException(status_code=401, detail="登录已过期")
    # B6：refresh token 只能在它自己的站点域名下续期（Host 解析不出来时不限制）
    host_tenant = await tenant_domains.tenant_by_host(
        db, tenant_domains.normalize_request_host(request.headers.get("host"))
    )
    result = await auth_service.refresh(
        db, refresh_token, expected_tenant_id=host_tenant.id if host_tenant else None
    )
    new_token = result.pop("refresh_token")
    _set_refresh_cookie(response, new_token)
    return ok(AuthResponse.model_validate(result), "已刷新")


@router.post("/logout", response_model=ApiResponse[None])
async def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias="antd_pro_refresh"),
):
    await auth_service.logout(refresh_token)
    response.delete_cookie(settings.refresh_cookie_name, path="/")
    return ok(None, "已退出登录")
