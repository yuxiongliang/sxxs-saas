"""平台管理员自助改密码。

守的契约：

1. 必须验**当前密码**（平台只有账号密码这一把钥匙，没有短信/邮件兜底）；
2. 改完 `token_version + 1`，旧 access token 立刻失效 —— 否则"改了密码旧会话还能用"；
3. 留平台审计（`platform.password.changed`）。
"""

from __future__ import annotations

from app.core.security import hash_password
from tests.conftest import bearer

#: 平台根账号的种子密码（见 docs/PROJECT-STATE.md 的账号表）
ROOT_USERNAME = "root"
ROOT_PASSWORD = "Sxxs@Platform2026"


async def _platform_login(client) -> str:
    response = await client.post(
        "/api/v1/platform/auth/login",
        json={"username": ROOT_USERNAME, "password": ROOT_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["access_token"]


async def test_platform_admin_changes_password_and_old_token_dies(
    client, db_session
):
    from sqlalchemy import select

    from app.models.user import User

    token = await _platform_login(client)
    changed = await client.post(
        "/api/v1/platform/auth/password",
        headers=bearer(token),
        json={
            "old_password": ROOT_PASSWORD,
            "new_password": "Sxxs@Platform2026-new",
        },
    )
    assert changed.status_code == 200, changed.text

    # 旧 token 立即失效
    me = await client.get("/api/v1/platform/auth/me", headers=bearer(token))
    assert me.status_code == 401

    # 新密码能登录
    relogin = await client.post(
        "/api/v1/platform/auth/login",
        json={"username": ROOT_USERNAME, "password": "Sxxs@Platform2026-new"},
    )
    assert relogin.status_code == 200, relogin.text

    # 还原密码，避免污染后续用例/本地环境
    user = (
        await db_session.execute(select(User).where(User.username == ROOT_USERNAME))
    ).scalar_one()
    user.password_hash = hash_password(ROOT_PASSWORD)
    await db_session.commit()


async def test_wrong_old_password_is_rejected(client):
    token = await _platform_login(client)
    response = await client.post(
        "/api/v1/platform/auth/password",
        headers=bearer(token),
        json={"old_password": "not-the-password", "new_password": "Whatever@123456"},
    )
    assert response.status_code == 400
    assert "当前密码不正确" in response.text
