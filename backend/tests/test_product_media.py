"""商品主图 / 视频 / SKU 媒体的保存与「公开可见」链路。

这一组都在防同一类事故：**运营在编辑器里选了图，保存后前台却是破图**。
原因只有两个，必须同时成立才行：

1. 字段真的写进了库（`video_url` 曾经整条链路都没接，选了白选）；
2. 引用的附件被标成 `public`（上传默认是 `tenant` 可见，`/public/{id}` 不放行）。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.attachment import Attachment
from app.models.catalog import Product, ProductSku
from tests.conftest import bearer

# 1x1 PNG
PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00"
    b"\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def _upload(client, token, name: str, content: bytes, mime: str, module="pytest"):
    response = await client.post(
        "/api/v1/attachments/upload",
        headers=bearer(token),
        files={"file": (name, content, mime)},
        data={"source_module": module},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _public_url(client, attachment_id: int) -> int:
    """匿名访问公开直链，返回状态码。"""
    response = await client.get(f"/api/v1/attachments/public/{attachment_id}")
    return response.status_code


async def _product_id(client, token) -> int:
    rows = (await client.get("/api/v1/admin/products", headers=bearer(token))).json()["data"]
    assert rows, "需要至少一个商品"
    return rows[0]["id"]


async def test_operator_can_save_product_video_and_it_becomes_public(
    client, admin_token, db_session
):
    """`video_url` 以前在 schema / 可编辑字段 / 前端请求里全线缺失，选了也白选。"""
    attachment = await _upload(client, admin_token, "clip.png", PNG, "image/png")
    product_id = await _product_id(client, admin_token)

    response = await client.put(
        f"/api/v1/admin/products/{product_id}",
        headers=bearer(admin_token),
        json={"video_url": f"/api/v1/attachments/public/{attachment['id']}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["video_url"] == f"/api/v1/attachments/public/{attachment['id']}"

    product = (
        await db_session.execute(select(Product).where(Product.id == product_id))
    ).scalars().first()
    assert product.video_url

    # 附件必须被发布，否则匿名访客拿到的是 404（前台就是破图）
    assert await _public_url(client, attachment["id"]) == 200


async def test_operator_main_image_save_publishes_the_attachment(
    client, admin_token, db_session
):
    attachment = await _upload(client, admin_token, "main.png", PNG, "image/png")
    product_id = await _product_id(client, admin_token)

    saved = await client.put(
        f"/api/v1/admin/products/{product_id}",
        headers=bearer(admin_token),
        json={"main_image": f"/api/v1/attachments/public/{attachment['id']}"},
    )
    assert saved.status_code == 200, saved.text
    assert await _public_url(client, attachment["id"]) == 200

    # 公开详情也要能拿到这张图，否则买家侧还是空的
    detail = await client.get(f"/api/v1/public/products/{product_id}")
    assert detail.json()["data"]["main_image"] == f"/api/v1/attachments/public/{attachment['id']}"


async def test_saving_specs_publishes_sku_media(client, admin_token, db_session):
    """SKU 图 / 规格值图以前从不发布，前台一律破图。"""
    attachment = await _upload(client, admin_token, "sku.png", PNG, "image/png")
    public_url = f"/api/v1/attachments/public/{attachment['id']}"
    product_id = await _product_id(client, admin_token)

    saved = await client.put(
        f"/api/v1/admin/products/{product_id}/specs",
        headers=bearer(admin_token),
        json={
            "groups": [
                {
                    "name": "颜色",
                    "values": [{"value": "白色", "image_url": public_url}],
                }
            ],
            "skus": [
                {
                    "specs": {"颜色": "白色"},
                    "price_cents": 9900,
                    "stock": 5,
                    "image_url": public_url,
                }
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    assert await _public_url(client, attachment["id"]) == 200

    sku = (
        await db_session.execute(
            select(ProductSku).where(
                ProductSku.product_id == product_id,
                ProductSku.status == "active",
            )
        )
    ).scalars().first()
    assert sku is not None
    assert sku.image_url == public_url


async def test_seller_can_create_product_with_main_image(client, operator_token, db_session):
    """卖家中心原来根本不收主图字段，新建的商品永远只有占位图。"""
    attachment = await _upload(client, operator_token, "seller.png", PNG, "image/png")
    public_url = f"/api/v1/attachments/public/{attachment['id']}"

    response = await client.post(
        "/api/v1/portal/seller/products",
        headers=bearer(operator_token),
        json={
            "name": f"带主图的商品-{attachment['id']}",
            "price_cents": 12300,
            "stock": 3,
            "delivery_methods": ["express"],
            "main_image": public_url,
        },
    )
    assert response.status_code == 200, response.text

    product = (
        await db_session.execute(
            select(Product).where(Product.id == response.json()["data"]["id"])
        )
    ).scalars().first()
    assert product.main_image == public_url
    assert await _public_url(client, attachment["id"]) == 200


async def test_attachment_stays_tenant_scoped_until_used(client, admin_token, db_session):
    """没人引用的附件不会因为上传就变 public —— 发布只发生在被业务字段引用时。"""
    attachment = await _upload(client, admin_token, "lonely.png", PNG, "image/png")
    record = (
        await db_session.execute(select(Attachment).where(Attachment.id == attachment["id"]))
    ).scalars().first()
    assert record.visibility == "tenant"
    assert await _public_url(client, attachment["id"]) == 404
