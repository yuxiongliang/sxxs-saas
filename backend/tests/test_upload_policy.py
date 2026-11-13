"""上传限制：SaaS 管理端统一按「角色 × 文件类型」管控体积与格式。

守的契约：

1. 不在白名单里的扩展名直接 400（拦在写盘之前）；
2. 平台端改配置后**立刻生效**（读的是 platform_settings，不是硬编码）；
3. 没配置时回落到内置默认，而不是"不限"。
"""

from __future__ import annotations

from tests.conftest import bearer


def _payload(b) -> dict[str, str]:
    return {"source_module": "pytest"}


async def _upload(client, token, name: str, content: bytes, mime: str, module="pytest"):
    return await client.post(
        "/api/v1/attachments/upload",
        headers=bearer(token),
        files={"file": (name, content, mime)},
        data={"source_module": module},
    )


async def test_disallowed_extension_is_rejected(client, admin_token):
    """伪装成图片的 .exe：归类到 image 后扩展名不在白名单，必须拒。"""
    response = await _upload(
        client, admin_token, "evil.exe", b"MZ\x00\x00", "image/png"
    )
    assert response.status_code == 400, response.text
    assert "格式" in response.text


async def test_other_category_is_size_limited_but_format_open(client, admin_token):
    """`other` 类不限格式（内置默认 formats 为空），但仍受体积限制。"""
    response = await _upload(
        client, admin_token, "note.bin", b"\x00\x01\x02", "application/octet-stream"
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["category"] == "other"


async def test_allowed_image_passes(client, admin_token):
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 128
    response = await _upload(client, admin_token, "ok.png", png, "image/png")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["category"] == "image"


async def test_platform_policy_change_takes_effect(client, admin_token, platform_token):
    """平台把租户图片上限改成 1MB 后，1.5MB 的图应该 413。"""
    current = (
        await client.get("/api/v1/platform/settings/upload", headers=bearer(platform_token))
    ).json()["data"]
    config = current["config"]
    config["tenant"]["image"]["max_mb"] = 1

    saved = await client.put(
        "/api/v1/platform/settings/upload",
        headers=bearer(platform_token),
        json={"enabled": True, "config": config},
    )
    assert saved.status_code == 200, saved.text

    big = b"\x89PNG\r\n\x1a\n" + b"0" * (1536 * 1024)
    response = await _upload(client, admin_token, "big.png", big, "image/png")
    assert response.status_code == 413, response.text
    assert "大小限制" in response.text


async def test_upload_setting_is_a_known_category(client, platform_token):
    response = await client.get(
        "/api/v1/platform/settings/upload", headers=bearer(platform_token)
    )
    assert response.status_code == 200, response.text
    config = response.json()["data"]["config"]
    assert set(config) == {"tenant", "seller", "buyer"}
    assert set(config["tenant"]) == {"image", "video", "document", "other"}


async def test_tenant_cannot_read_platform_upload_setting(client, admin_token):
    response = await client.get(
        "/api/v1/platform/settings/upload", headers=bearer(admin_token)
    )
    assert response.status_code == 401, response.text
