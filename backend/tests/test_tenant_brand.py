"""租户站点品牌：匿名可读、租户可改、权限受控。"""

from __future__ import annotations

from tests.conftest import bearer


async def test_public_brand_falls_back_to_name(client):
    response = await client.get("/api/v1/public/brand?tenant=demo")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["slug"] == "demo"
    # 没设置 display_name 时必须回落到 name，而不是返回空串
    assert data["display_name"]
    assert data["display_name"] == data["name"]


async def test_public_brand_rejects_unknown_tenant(client):
    response = await client.get("/api/v1/public/brand?tenant=no-such-tenant")
    assert response.status_code == 404, response.text


async def test_tenant_can_update_own_brand_and_public_endpoint_reflects_it(client, admin_token):
    saved = await client.put(
        "/api/v1/tenant/brand",
        headers=bearer(admin_token),
        json={
            "display_name": "我的租赁站",
            "site_description": "社区闲置交易，同城可自提",
            "logo_url": "/api/v1/attachments/public/1",
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["display_name"] == "我的租赁站"
    assert saved.json()["data"]["site_description"] == "社区闲置交易，同城可自提"

    public = await client.get("/api/v1/public/brand?tenant=demo")
    assert public.json()["data"]["display_name"] == "我的租赁站"
    assert public.json()["data"]["site_description"] == "社区闲置交易，同城可自提"
    assert public.json()["data"]["logo_url"] == "/api/v1/attachments/public/1"
    # 主题色已从产品上移除：接口不应该再把它回吐给前端
    assert "theme_color" not in public.json()["data"]


async def test_site_description_blank_is_stored_as_null(client, admin_token):
    """全空白当「没填」，别存一串空格让前端以为有内容、在页脚渲染出一行空白。"""
    await client.put(
        "/api/v1/tenant/brand",
        headers=bearer(admin_token),
        json={"site_description": "   "},
    )
    brand = await client.get("/api/v1/tenant/brand", headers=bearer(admin_token))
    assert brand.json()["data"]["site_description"] is None


async def test_site_description_length_is_capped(client, admin_token):
    response = await client.put(
        "/api/v1/tenant/brand",
        headers=bearer(admin_token),
        json={"site_description": "很" * 301},
    )
    assert response.status_code == 422


async def test_buyer_cannot_update_brand(client, customer_token):
    response = await client.put(
        "/api/v1/tenant/brand",
        headers=bearer(customer_token),
        json={"display_name": "抢站名"},
    )
    assert response.status_code == 403, response.text


async def test_saving_attachment_logo_makes_the_public_link_resolvable(client, admin_token):
    """从附件中心选图当 logo 后，`/attachments/public/{id}` 必须真能取到图。

    附件中心上传出来的附件默认 `visibility=tenant`，而 public 直链只放行 public。
    不在保存品牌时把它标成 public，管理员选完图保存，logo 依旧 404。
    """
    images = (
        await client.get(
            "/api/v1/attachments",
            headers=bearer(admin_token),
            params={"category": "image", "pageSize": 10},
        )
    ).json()["data"]["list"]
    assert images, "开发/测试种子库里应该有图片附件"
    attachment_id = images[0]["id"]
    public_path = f"/api/v1/attachments/public/{attachment_id}"

    before = await client.get(public_path)
    assert before.status_code == 404, before.text

    saved = await client.put(
        "/api/v1/tenant/brand",
        headers=bearer(admin_token),
        json={"logo_url": public_path},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["logo_url"] == public_path

    after = await client.get(public_path)
    assert after.status_code == 200, after.text
    assert after.content, "公开直链应该返回图片内容"


async def test_logo_cannot_reference_another_tenants_attachment(
    client, admin_token, platform_token
):
    """拿别人的附件 id 当 logo 要 400，不能借保存品牌把别人的图变成公开。"""

    attachment = (
        await client.get(
            "/api/v1/attachments",
            headers=bearer(admin_token),
            params={"category": "image", "pageSize": 1},
        )
    ).json()["data"]["list"][0]

    response = await client.put(
        "/api/v1/tenant/brand",
        headers=bearer(admin_token),
        json={"logo_url": f"/api/v1/attachments/public/{attachment['id'] + 9999}"},
    )
    assert response.status_code == 400, response.text
    assert "附件" in response.text
