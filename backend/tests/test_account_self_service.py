"""个人设置（`/auth/me*`）与用户级通知偏好：必须真落库、真影响发送。

覆盖三件事：

1. `/auth/me` 把身份（用户ID/用户名）和最近登录时间吐出来 —— 个人设置页要展示；
2. 自助改资料 / 改密码 / 换绑定都走**本人**，且改凭据必须验密码；
3. 「新消息通知」的开关不是装饰：关掉某人某分类的短信后，群发的
   `success_count` 要真的少一个，`skipped_count` 要真的多一个。
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.notification_pref import UserNotificationPref
from app.models.permission import MemberRole
from app.models.role import Role
from app.models.tenant import Tenant, TenantMember
from app.models.user import User
from tests.conftest import bearer

DEMO_TENANT_ID = 1


async def _enable_sms(client, admin_token) -> None:
    response = await client.put(
        "/api/v1/settings/sms",
        headers=bearer(admin_token),
        json={"source": "override", "enabled": True},
    )
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# /auth/me：身份字段
# ---------------------------------------------------------------------------


async def test_me_exposes_public_id_username_and_last_login(client, admin_token):
    me = (await client.get("/api/v1/auth/me", headers=bearer(admin_token))).json()["data"]
    user = me["user"]

    assert user["public_id"].startswith("usr"), user
    assert user["username"] == "admin"
    assert user["has_password"] is True
    # 登录会回写 last_login_at：个人设置页的「本次登录」不能永远是空
    assert user["last_login_at"] is not None


async def test_previous_login_at_holds_the_previous_login(client, admin_token):
    """「上次登录」必须是**上一个**时间，而不是刚刚这次。

    只存一个 last_login_at 时，安全设置页显示的时间永远等于当前时间，
    这一行的意义（发现异常登录）就没了。
    """
    first = (
        await client.get("/api/v1/auth/me", headers=bearer(admin_token))
    ).json()["data"]["user"]
    first_login_at = first["last_login_at"]
    assert first_login_at is not None

    second_login = await client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "ant.design"}
    )
    assert second_login.status_code == 200, second_login.text
    token = second_login.json()["data"]["access_token"]
    second = (
        await client.get("/api/v1/auth/me", headers=bearer(token))
    ).json()["data"]["user"]

    assert second["previous_login_at"] == first_login_at
    assert second["last_login_at"] != first_login_at


async def test_patch_me_updates_profile_and_ignores_identity_fields(client, admin_token):
    response = await client.patch(
        "/api/v1/auth/me",
        headers=bearer(admin_token),
        json={
            "gender": "female",
            "birthday": "1990-05-06",
            # 身份字段不在白名单里：不能通过这个端点改名或改用户名
            "username": "hacker",
            "nickname": "改个名",
        },
    )
    assert response.status_code == 200, response.text
    user = response.json()["data"]["user"]
    assert user["gender"] == "female"
    assert user["birthday"] == "1990-05-06"
    assert user["username"] == "admin"
    assert user["nickname"] != "改个名"


# ---------------------------------------------------------------------------
# 改密码
# ---------------------------------------------------------------------------


async def test_change_password_requires_old_password(client, admin_token):
    wrong = await client.post(
        "/api/v1/auth/me/password",
        headers=bearer(admin_token),
        json={"old_password": "not-my-password", "new_password": "NewPass@123456"},
    )
    assert wrong.status_code == 400, wrong.text

    changed = await client.post(
        "/api/v1/auth/me/password",
        headers=bearer(admin_token),
        json={"old_password": "ant.design", "new_password": "NewPass@123456"},
    )
    assert changed.status_code == 200, changed.text

    login_new = await client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "NewPass@123456"}
    )
    assert login_new.status_code == 200, login_new.text
    login_old = await client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "ant.design"}
    )
    assert login_old.status_code == 401


async def test_change_password_rejects_same_password(client, admin_token):
    response = await client.post(
        "/api/v1/auth/me/password",
        headers=bearer(admin_token),
        json={"old_password": "ant.design", "new_password": "ant.design"},
    )
    assert response.status_code == 400, response.text


async def test_change_password_kills_other_sessions(client, admin_token):
    """改完密码，旧 access token 必须立刻失效（其它标签页/设备）。

    没有 token_version 时，B 浏览器能靠 HttpOnly 的 refresh cookie
    最长再续 7 天 —— 那就不叫「改密码」了。
    """
    stale = admin_token
    changed = await client.post(
        "/api/v1/auth/me/password",
        headers=bearer(stale),
        json={"old_password": "ant.design", "new_password": "NewPass@123456"},
    )
    assert changed.status_code == 200, changed.text

    rejected = await client.get("/api/v1/auth/me", headers=bearer(stale))
    assert rejected.status_code == 401, rejected.text


# ---------------------------------------------------------------------------
# 账号绑定：换手机 / 换邮箱
# ---------------------------------------------------------------------------


async def test_update_contact_requires_password(client, admin_token):
    wrong = await client.put(
        "/api/v1/auth/me/contact",
        headers=bearer(admin_token),
        json={"phone": "13900000001", "password": "nope"},
    )
    assert wrong.status_code == 400, wrong.text

    ok = await client.put(
        "/api/v1/auth/me/contact",
        headers=bearer(admin_token),
        json={"phone": "13900000001", "password": "ant.design"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["data"]["user"]["phone"] == "13900000001"


async def test_update_contact_rejects_taken_email(client, admin_token):
    others = (
        await client.get("/api/v1/users", headers=bearer(admin_token), params={"pageSize": 5})
    ).json()["data"]["list"]
    taken = next(item["email"] for item in others if item["username"] != "admin")

    response = await client.put(
        "/api/v1/auth/me/contact",
        headers=bearer(admin_token),
        json={"email": taken, "password": "ant.design"},
    )
    assert response.status_code == 409, response.text


# ---------------------------------------------------------------------------
# 用户级通知偏好
# ---------------------------------------------------------------------------


async def test_notification_prefs_default_on_and_persisted(client, admin_token):
    initial = (
        await client.get("/api/v1/auth/me/notification-prefs", headers=bearer(admin_token))
    ).json()["data"]
    assert {item["category"] for item in initial["categories"]} == {
        "transaction",
        "finance",
        "im",
        "system",
        "marketing",
    }
    marketing = next(item for item in initial["categories"] if item["category"] == "marketing")
    assert all(channel["enabled"] for channel in marketing["channels"])

    saved = await client.put(
        "/api/v1/auth/me/notification-prefs",
        headers=bearer(admin_token),
        json={"category": "marketing", "channel": "sms", "enabled": False},
    )
    assert saved.status_code == 200, saved.text

    again = (
        await client.get("/api/v1/auth/me/notification-prefs", headers=bearer(admin_token))
    ).json()["data"]
    marketing = next(item for item in again["categories"] if item["category"] == "marketing")
    sms = next(channel for channel in marketing["channels"] if channel["channel"] == "sms")
    assert sms["enabled"] is False


@pytest.mark.parametrize(
    ("payload", "status"),
    [
        ({"category": "marketing", "channel": "inbox", "enabled": False}, 400),
        ({"category": "not-a-category", "channel": "sms", "enabled": False}, 400),
    ],
)
async def test_notification_prefs_rejects_bad_input(client, admin_token, payload, status):
    response = await client.put(
        "/api/v1/auth/me/notification-prefs", headers=bearer(admin_token), json=payload
    )
    assert response.status_code == status, response.text


async def test_prefs_actually_reduce_the_audience(client, admin_token, db_session):
    """关掉自己的营销短信后，同一批群发的收件人数必须少一个。

    这条是「新消息通知不是摆设」的唯一硬证据：如果开关没接进发送链路，
    success_count 不会变，测试就会红。
    """
    await _enable_sms(client, admin_token)

    first = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "双十一预热",
            "channel": "sms",
            "audience": "all",
            "category": "marketing",
            "content": "活动周五开始",
        },
    )
    assert first.status_code == 200, first.text
    before = first.json()["data"]
    assert before["status"] == "success", before
    assert before["total"] > 0
    assert before["skipped_count"] == 0

    await client.put(
        "/api/v1/auth/me/notification-prefs",
        headers=bearer(admin_token),
        json={"category": "marketing", "channel": "sms", "enabled": False},
    )

    second = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "双十一预热（第二波）",
            "channel": "sms",
            "audience": "all",
            "category": "marketing",
            "content": "活动周五开始",
        },
    )
    assert second.status_code == 200, second.text
    after = second.json()["data"]
    assert after["total"] == before["total"]
    assert after["skipped_count"] == before["skipped_count"] + 1
    assert after["success_count"] == before["success_count"] - 1

    rows = (
        await db_session.scalars(
            select(UserNotificationPref).where(
                UserNotificationPref.category == "marketing",
                UserNotificationPref.channel == "sms",
                UserNotificationPref.enabled.is_(False),
            )
        )
    ).all()
    assert len(rows) == 1


async def test_tenant_channel_switch_blocks_sending(client, admin_token):
    """租户关掉短信后，群发必须失败 —— 租户级开关原来只落库、不参与判定。"""
    await _enable_sms(client, admin_token)
    off = await client.put(
        "/api/v1/notifications/prefs",
        headers=bearer(admin_token),
        json={"channel": "sms", "enabled": False},
    )
    assert off.status_code == 200, off.text

    response = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "验证码告警",
            "channel": "sms",
            "audience": "all",
            "category": "system",
            "content": "短信通道波动",
        },
    )
    assert response.status_code == 200, response.text
    record = response.json()["data"]
    assert record["status"] == "failed"
    assert "租户关闭" in (record["error_message"] or "")


async def test_audience_uses_real_members_not_a_constant(client, admin_token, db_session):
    """`total` 必须是真实成员数，不再是 `AUDIENCE_SIZE` 里的 1280。"""
    member_count = (
        await db_session.scalar(
            select(func.count(TenantMember.id))
            .join(User, User.id == TenantMember.user_id)
            .where(
                TenantMember.tenant_id == DEMO_TENANT_ID,
                TenantMember.status == "active",
                User.status == "active",
            )
        )
    ) or 0
    response = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "系统公告",
            "channel": "inbox",
            "audience": "all",
            "category": "system",
            "content": "维护通知",
        },
    )
    assert response.status_code == 200, response.text
    record = response.json()["data"]
    assert record["total"] == member_count
    assert record["total"] != 1280


async def test_password_change_is_audited(client, admin_token):
    """改密码要留痕：`user.password_changed`，而且旧 token 不能再回来查。"""
    await client.post(
        "/api/v1/auth/me/password",
        headers=bearer(admin_token),
        json={"old_password": "ant.design", "new_password": "Another@123456"},
    )
    # 改密之后旧 token 已作废，用新密码重新登录再查审计
    fresh = (
        await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "Another@123456"},
        )
    ).json()["data"]["access_token"]
    logs = (
        await client.get(
            "/api/v1/audit-logs",
            headers=bearer(fresh),
            params={"pageSize": 50},
        )
    ).json()["data"]["list"]
    assert any(item["action"] == "user.password_changed" for item in logs), logs


async def test_user_row_keeps_nickname_column(client, admin_token, db_session):
    """昵称仍由管理员维护（个人设置页只是不再提供输入框），别把它删了。"""
    user = (await db_session.scalars(select(User).where(User.username == "admin"))).first()
    assert user is not None
    assert user.nickname


# ---------------------------------------------------------------------------
# 换邮箱 = 换登录名（自助注册账号）
# ---------------------------------------------------------------------------


async def test_email_change_syncs_login_name_for_self_registered(client, customer):
    """自助注册的账号 `username == email`，换邮箱必须同步登录名。

    否则界面说「用新邮箱登录」但登录只认 username，用户会直接 401。
    """
    token = customer["access_token"]
    old_email = customer["user"]["email"]
    assert customer["user"]["username"] == old_email

    changed = await client.put(
        "/api/v1/auth/me/contact",
        headers=bearer(token),
        json={"email": "pytest-customer-renamed@example.com", "password": "Buyer@123456"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["user"]["username"] == "pytest-customer-renamed@example.com"

    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "pytest-customer-renamed@example.com", "password": "Buyer@123456"},
    )
    assert login.status_code == 200, login.text


async def test_email_change_keeps_username_for_admin_created_user(client, admin_token):
    """管理员创建的账号（username 与 email 不同）换邮箱时不能顺手改掉登录名。"""
    response = await client.put(
        "/api/v1/auth/me/contact",
        headers=bearer(admin_token),
        json={"email": "admin-renamed@example.com", "password": "ant.design"},
    )
    assert response.status_code == 200, response.text
    user = response.json()["data"]["user"]
    assert user["email"] == "admin-renamed@example.com"
    assert user["username"] == "admin"


# ---------------------------------------------------------------------------
# audience 展开 / 租户隔离 / 运营可见性
# ---------------------------------------------------------------------------


async def test_role_audience_expands_to_members_with_that_role(client, admin_token, db_session):
    """`role:admin` 必须真的按角色过滤，而不是退化到全员。"""
    all_send = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "全员公告",
            "channel": "inbox",
            "audience": "all",
            "category": "system",
            "content": "维护通知",
        },
    )
    assert all_send.status_code == 200, all_send.text
    all_total = all_send.json()["data"]["total"]

    admin_send = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "仅管理员",
            "channel": "inbox",
            "audience": "role:admin",
            "category": "system",
            "content": "内部提醒",
        },
    )
    assert admin_send.status_code == 200, admin_send.text
    admin_total = admin_send.json()["data"]["total"]

    expected = (
        await db_session.scalar(
            select(func.count(func.distinct(User.id)))
            .join(TenantMember, TenantMember.user_id == User.id)
            .join(MemberRole, MemberRole.member_id == TenantMember.id)
            .join(Role, Role.id == MemberRole.role_id)
            .where(
                TenantMember.tenant_id == DEMO_TENANT_ID,
                TenantMember.status == "active",
                User.status == "active",
                Role.code == "admin",
            )
        )
    ) or 0
    assert admin_total == expected
    assert 0 < admin_total < all_total


async def test_notification_pref_is_scoped_to_tenant(client, admin_token, db_session):
    """别的租户里的同名开关不能影响本租户的发送。"""
    other = Tenant(name="Pytest 邻居租户", slug="pytest-neighbor", status="active")
    db_session.add(other)
    await db_session.flush()
    admin = (await db_session.scalars(select(User).where(User.username == "admin"))).first()
    assert admin is not None
    db_session.add(
        UserNotificationPref(
            tenant_id=other.id,
            user_id=admin.id,
            category="marketing",
            channel="inbox",
            enabled=False,
        )
    )
    await db_session.flush()

    await _enable_sms(client, admin_token)
    sent = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "跨租户隔离",
            "channel": "sms",
            "audience": "all",
            "category": "marketing",
            "content": "活动",
        },
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["data"]["skipped_count"] == 0


async def test_skipped_count_is_visible_in_the_list(client, admin_token):
    """运营看的是列表接口，跳过人数必须能从那里读到。"""
    await _enable_sms(client, admin_token)
    await client.put(
        "/api/v1/auth/me/notification-prefs",
        headers=bearer(admin_token),
        json={"category": "marketing", "channel": "sms", "enabled": False},
    )
    sent = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "列表可见性",
            "channel": "sms",
            "audience": "all",
            "category": "marketing",
            "content": "活动",
        },
    )
    assert sent.status_code == 200, sent.text

    rows = (
        await client.get(
            "/api/v1/notifications",
            headers=bearer(admin_token),
            params={"pageSize": 10},
        )
    ).json()["data"]["list"]
    record = next(item for item in rows if item["title"] == "列表可见性")
    assert record["category"] == "marketing"
    assert record["skipped_count"] == 1


@pytest.mark.parametrize("audience", ["custom", "role:", "everyone", ""])
async def test_unknown_audience_is_rejected(client, admin_token, audience):
    """认不出的受众不能静默退化成「全员」。"""
    response = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "受众校验",
            "channel": "inbox",
            "audience": audience,
            "category": "system",
            "content": "x",
        },
    )
    assert response.status_code == 422, response.text


# ---------------------------------------------------------------------------
# 重试语义
# ---------------------------------------------------------------------------


async def test_retry_of_pending_notification_is_refused(client, admin_token):
    """定时通知还没到点，点「重试」不等于可以提前群发。"""
    created = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "定时公告",
            "channel": "inbox",
            "audience": "all",
            "category": "system",
            "content": "六点发",
            "scheduled_at": "2099-01-01T00:00:00Z",
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["data"]["status"] == "pending"

    retried = await client.post(
        f"/api/v1/notifications/{created.json()['data']['id']}/retry",
        headers=bearer(admin_token),
    )
    assert retried.status_code == 400, retried.text


async def test_retry_does_not_fake_success_when_channel_is_off(client, admin_token):
    """渠道还关着，重试不能把记录直接标成功。"""
    await client.put(
        "/api/v1/notifications/prefs",
        headers=bearer(admin_token),
        json={"channel": "sms", "enabled": False},
    )
    created = await client.post(
        "/api/v1/notifications/send",
        headers=bearer(admin_token),
        json={
            "title": "重试语义",
            "channel": "sms",
            "audience": "all",
            "category": "system",
            "content": "x",
        },
    )
    assert created.status_code == 200, created.text
    record = created.json()["data"]
    assert record["status"] == "failed"

    retried = await client.post(
        f"/api/v1/notifications/{record['id']}/retry", headers=bearer(admin_token)
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["data"]["status"] == "failed"
    assert "仍未发出" in retried.json()["message"]

