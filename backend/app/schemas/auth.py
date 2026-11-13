from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

Gender = Literal["male", "female", "other", "unknown"]


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    tenant_id: int | None = None


class RegisterRequest(BaseModel):
    tenant_slug: str = Field(min_length=1, max_length=64)
    email: str = Field(min_length=3, max_length=128)
    nickname: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class TenantSummary(BaseModel):
    id: int
    name: str
    slug: str
    status: str
    roles: list[str] = Field(default_factory=list)


class AuthUser(BaseModel):
    """当前登录用户（`/auth/login` 与 `/auth/me` 共用）。

    `public_id` / `username` 是**身份**（不可自助修改），`nickname` 是管理员在
    建号时定的展示名。个人设置页把前两个只读展示出来 —— 用户在报障、对账、
    提工单时报的就是它们。
    """

    id: int
    public_id: str
    username: str
    nickname: str
    email: str
    phone: str | None = None
    gender: Gender | None = None
    birthday: date | None = None
    last_login_at: datetime | None = None
    # 上一次登录（本次登录前的那个时间）：安全设置用它看异常登录
    previous_login_at: datetime | None = None
    has_password: bool = True
    # 前端模板一直读 avatar，但 users 表没有这一列；保留字段是为了不打断既有类型，
    # 永远是 None。真要做头像需要先加列 + 上传归属，那是独立一件事。
    avatar: str | None = None


class ProfileUpdate(BaseModel):
    """自助改个人资料：只放行性别/生日。

    用户名与用户ID是身份，不能自助改；邮箱/手机号是**登录凭据**，改它们要走
    `/auth/me/contact`（需要当前密码确认）；昵称由管理员在「用户管理」维护。
    """

    gender: Gender | None = None
    birthday: date | None = None


class PasswordChange(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ContactUpdate(BaseModel):
    """账号绑定：换手机/换邮箱必须用**当前密码**确认。

    没有短信/邮件验证码通道（`services/setting.py` 的测试连接也是演示态），
    密码确认是当下唯一能真正验证「是本人」的手段。
    """

    phone: str | None = Field(default=None, max_length=32, pattern=r"^\+?[0-9][0-9\- ]{5,31}$")
    email: EmailStr | None = None
    password: str = Field(min_length=1, max_length=128)


class NotificationPrefUpdate(BaseModel):
    """用户级通知开关。用模型而不是裸 dict：`bool("false")` 是 True，
    直接 `payload.get()` 会把「关」存成「开」。"""

    category: str = Field(min_length=1, max_length=32)
    channel: str = Field(min_length=1, max_length=16)
    enabled: bool


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: AuthUser
    tenants: list[TenantSummary]
    current_tenant: TenantSummary
    roles: list[str]
    permissions: list[str]
    permission_version: int


class MeResponse(BaseModel):
    user: AuthUser
    tenants: list[TenantSummary]
    current_tenant: TenantSummary
    roles: list[str]
    permissions: list[str]
    permission_version: int


class SwitchTenantRequest(BaseModel):
    tenant_id: int
