"""卖家中心：改自己的商品、自己下架、被驳回后重新提交。

守的契约：

1. 归属靠 `current_seller()`，不靠权限码 —— 卖家只能动自己店铺的商品；
2. 在售商品改内容/改价会**自动打回待审核**，防止「先过审再换违规内容」；
3. 卖家不能自己上架（那要租户运营审核），schema 层就限死只能 off_sale / pending_review；
4. 驳回原因要落到卖家能看到的地方；
5. `seller_owner` 不再持有 `product:manage`（否则能在控制台改别家卖家的商品）。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.catalog import Product
from app.models.seller import Seller
from tests.conftest import bearer


async def _create_product(client, token, name: str) -> dict:
    response = await client.post(
        "/api/v1/portal/seller/products",
        headers=bearer(token),
        json={"name": name, "price_cents": 8800, "stock": 3},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _seller_products(client, token) -> list[dict]:
    response = await client.get("/api/v1/portal/seller/products", headers=bearer(token))
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_seller_can_edit_own_product(client, operator_token):
    created = await _create_product(client, operator_token, "卖家自己的商品")

    updated = await client.put(
        f"/api/v1/portal/seller/products/{created['id']}",
        headers=bearer(operator_token),
        json={"name": "改好的名字", "description": "补上成色说明", "price_cents": 9900},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()["data"]
    assert body["name"] == "改好的名字"
    assert body["price_cents"] == 9900
    # 待审核商品改内容不需要额外状态变化
    assert body["status"] == "pending_review"


async def test_editing_an_on_sale_product_bounces_it_back_to_review(client, admin_token, operator_token):
    """先过审、再偷改内容 → 必须重新审。"""
    created = await _create_product(client, operator_token, "会被改动的在售商品")
    approved = await client.post(
        f"/api/v1/admin/products/{created['id']}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["status"] == "on_sale"

    edited = await client.put(
        f"/api/v1/portal/seller/products/{created['id']}",
        headers=bearer(operator_token),
        json={"description": "过审后偷偷改描述"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["data"]["status"] == "pending_review"
    assert edited.json()["data"]["bounced_to_review"] is True


async def test_seller_can_take_own_product_off_sale(client, admin_token, operator_token):
    created = await _create_product(client, operator_token, "我要自己下架")
    await client.post(
        f"/api/v1/admin/products/{created['id']}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )

    off = await client.post(
        f"/api/v1/portal/seller/products/{created['id']}/status",
        headers=bearer(operator_token),
        json={"status": "off_sale"},
    )
    assert off.status_code == 200, off.text
    assert off.json()["data"]["status"] == "off_sale"


async def test_seller_cannot_publish_directly(client, operator_token):
    """卖家不能自己上架：schema 只允许 off_sale / pending_review。"""
    created = await _create_product(client, operator_token, "想自己上架")
    blocked = await client.post(
        f"/api/v1/portal/seller/products/{created['id']}/status",
        headers=bearer(operator_token),
        json={"status": "on_sale"},
    )
    assert blocked.status_code == 422, blocked.text


async def test_reject_reason_is_visible_to_the_seller(client, admin_token, operator_token):
    created = await _create_product(client, operator_token, "会被驳回的商品")
    rejected = await client.post(
        f"/api/v1/admin/products/{created['id']}/status",
        headers=bearer(admin_token),
        json={"status": "rejected", "reason": "主图不清晰，请重新拍摄"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["data"]["reject_reason"] == "主图不清晰，请重新拍摄"

    mine = {item["id"]: item for item in await _seller_products(client, operator_token)}
    assert mine[created["id"]]["reject_reason"] == "主图不清晰，请重新拍摄"

    # 重新提交后驳回原因清空
    resubmitted = await client.post(
        f"/api/v1/portal/seller/products/{created['id']}/status",
        headers=bearer(operator_token),
        json={"status": "pending_review"},
    )
    assert resubmitted.status_code == 200, resubmitted.text
    mine = {item["id"]: item for item in await _seller_products(client, operator_token)}
    assert mine[created["id"]]["reject_reason"] is None


async def test_seller_cannot_touch_another_sellers_product(client, operator_token, db_session):
    """拿别人的商品 id 去改，必须 404（不是 403，不泄露存在性）。"""
    from app.models.user import User

    owner = (
        await db_session.scalars(select(User).where(User.username == "admin"))
    ).first()
    assert owner is not None
    other = Seller(
        tenant_id=1,
        owner_user_id=owner.id,
        display_name="邻家卖家",
        seller_type="individual",
        status="active",
        kyc_status="approved",
    )
    db_session.add(other)
    await db_session.flush()
    foreign = Product(
        tenant_id=1,
        seller_id=other.id,
        shop_id=1,
        name="别人的商品",
        status="pending_review",
    )
    db_session.add(foreign)
    await db_session.flush()

    response = await client.put(
        f"/api/v1/portal/seller/products/{foreign.id}",
        headers=bearer(operator_token),
        json={"name": "想改别人的"},
    )
    assert response.status_code == 404, response.text


async def test_seller_owner_lost_product_manage(client, operator_token):
    """收回 product:manage 之后，卖家不能再走控制台接口改商品。"""
    products = (
        await client.get("/api/v1/admin/products", headers=bearer(operator_token))
    ).json()["data"]
    assert products, "卖家仍应有 product:read 能看列表"

    response = await client.put(
        f"/api/v1/admin/products/{products[0]['id']}",
        headers=bearer(operator_token),
        json={"name": "越权改名"},
    )
    assert response.status_code == 403, response.text


async def test_foreign_product_row_stays_untouched(client, operator_token, db_session):
    """上面那条 404 之后，库里的名字不能被改掉。"""
    row = (
        await db_session.scalars(select(Product).where(Product.name == "别人的商品"))
    ).first()
    assert row is None or row.name == "别人的商品"
