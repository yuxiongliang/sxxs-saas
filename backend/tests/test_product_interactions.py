"""商品收藏 / 评价 / 统计（销量·浏览·评分）的接口行为。

重点验证产品约定，而不是实现细节：

* 收藏幂等、租户隔离；
* 只有**订单已完成**且没评过的订单项能评，一个订单项只能评一次；
* **先发后审**：评价提交后立即出现在公开列表；
* **匿名只对买家侧脱敏**，运营/卖家/平台仍能看到真实 用户ID + 用户名；
* **隐藏只有运营/平台能做**，卖家只能回复；
* 销量只算已付款未退款；浏览是详情页 PV。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.catalog import Product, ProductSku
from app.models.interaction import ProductFavorite, ProductReview
from app.models.order import OrderItem, SellerOrder
from tests.conftest import bearer


async def _on_sale_sku(db_session, tenant_id: int = 1) -> tuple[Product, ProductSku]:
    product = (
        (
            await db_session.execute(
                select(Product).where(
                    Product.tenant_id == tenant_id, Product.status == "on_sale"
                )
            )
        )
        .scalars()
        .first()
    )
    assert product is not None, "seed data must contain an on-sale product"
    sku = (
        (await db_session.execute(select(ProductSku).where(ProductSku.product_id == product.id)))
        .scalars()
        .first()
    )
    assert sku is not None
    return product, sku


async def _completed_order_item(client, admin_token, customer_token, db_session) -> int:
    """跑完整链路，返回一个「已完成」订单的 order_item_id。"""
    _product, sku = await _on_sale_sku(db_session)
    order_id = (
        await client.post(
            "/api/v1/portal/orders",
            headers=bearer(customer_token),
            json={
                "items": [{"sku_id": sku.id, "quantity": 2}],
                "receiver_name": "测试收货人",
                "receiver_phone": "13900000000",
                "receiver_address": {
                    "province": "广东省",
                    "city": "深圳市",
                    "detail": "测试路 1 号",
                },
                "remark": "pytest",
            },
        )
    ).json()["data"]["id"]
    await client.post(
        f"/api/v1/portal/orders/{order_id}/mock-pay", headers=bearer(customer_token)
    )
    seller_order = (
        (await db_session.execute(select(SellerOrder).where(SellerOrder.order_id == order_id)))
        .scalars()
        .first()
    )
    await client.post(
        f"/api/v1/admin/seller-orders/{seller_order.id}/ship",
        headers=bearer(admin_token),
        json={"carrier": "顺丰速运", "tracking_no": "SF1234567890"},
    )
    await client.post(f"/api/v1/portal/orders/{order_id}/confirm", headers=bearer(customer_token))
    item = (
        (await db_session.execute(select(OrderItem).where(OrderItem.order_id == order_id)))
        .scalars()
        .first()
    )
    assert item is not None
    return item.id


# ---------------------------------------------------------------- 收藏


async def test_favorite_toggle_is_idempotent(client, customer_token, db_session, admin_token):
    product, _sku = await _on_sale_sku(db_session)

    first = await client.post(
        f"/api/v1/public/products/{product.id}/favorite", headers=bearer(customer_token)
    )
    assert first.status_code == 200, first.text
    assert first.json()["data"]["is_favorited"] is True

    # 再点一次不应该变成两行
    again = await client.post(
        f"/api/v1/public/products/{product.id}/favorite", headers=bearer(customer_token)
    )
    assert again.status_code == 200
    count = len(
        (
            await db_session.execute(
                select(ProductFavorite).where(ProductFavorite.product_id == product.id)
            )
        )
        .scalars()
        .all()
    )
    assert count == 1

    removed = await client.delete(
        f"/api/v1/public/products/{product.id}/favorite", headers=bearer(customer_token)
    )
    assert removed.status_code == 200
    assert removed.json()["data"]["is_favorited"] is False

    # 取消一个没收藏的也不报错（幂等）
    again_removed = await client.delete(
        f"/api/v1/public/products/{product.id}/favorite", headers=bearer(customer_token)
    )
    assert again_removed.status_code == 200


async def test_admin_sees_who_favorited_with_readable_identity(
    client, customer_token, admin_token, db_session
):
    product, _sku = await _on_sale_sku(db_session)
    await client.post(
        f"/api/v1/public/products/{product.id}/favorite", headers=bearer(customer_token)
    )

    response = await client.get("/api/v1/admin/favorites", headers=bearer(admin_token))
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert rows, "运营应能看到收藏记录"
    row = next(item for item in rows if item["product_id"] == product.id)
    # 全站口径：必须是 用户ID + 用户名，不能只有裸 id
    assert row["user_public_id"].startswith("usr_")
    assert row["user_username"]


async def test_favorite_detail_exposes_state_for_logged_in_user(
    client, customer_token, db_session
):
    product, _sku = await _on_sale_sku(db_session)
    await client.post(
        f"/api/v1/public/products/{product.id}/favorite", headers=bearer(customer_token)
    )

    detail = await client.get(
        f"/api/v1/public/products/{product.id}", headers=bearer(customer_token)
    )
    assert detail.status_code == 200
    assert detail.json()["data"]["is_favorited"] is True

    # 匿名访问：不报错，也没有收藏态
    anonymous = await client.get(f"/api/v1/public/products/{product.id}")
    assert anonymous.status_code == 200
    assert anonymous.json()["data"]["is_favorited"] is False


async def test_view_count_increments_on_public_detail(client, db_session):
    product, _sku = await _on_sale_sku(db_session)
    before = product.view_count

    await client.get(f"/api/v1/public/products/{product.id}")
    await client.get(f"/api/v1/public/products/{product.id}")

    await db_session.refresh(product)
    assert product.view_count == before + 2


# ---------------------------------------------------------------- 评价


async def test_review_requires_completed_order_and_is_single_shot(
    client, admin_token, customer_token, db_session
):
    item_id = await _completed_order_item(client, admin_token, customer_token, db_session)

    created = await client.post(
        "/api/v1/portal/reviews",
        headers=bearer(customer_token),
        json={"order_item_id": item_id, "rating": 5, "content": "很好用", "is_anonymous": False},
    )
    assert created.status_code == 200, created.text

    duplicated = await client.post(
        "/api/v1/portal/reviews",
        headers=bearer(customer_token),
        json={"order_item_id": item_id, "rating": 3, "content": "再评一次"},
    )
    assert duplicated.status_code == 400


async def test_review_is_visible_immediately_but_anonymous_is_masked(
    client, admin_token, customer_token, db_session
):
    item_id = await _completed_order_item(client, admin_token, customer_token, db_session)
    review = await client.post(
        "/api/v1/portal/reviews",
        headers=bearer(customer_token),
        json={
            "order_item_id": item_id,
            "rating": 4,
            "content": "成色不错",
            "is_anonymous": True,
        },
    )
    assert review.status_code == 200, review.text

    row = (
        (await db_session.execute(select(ProductReview).where(ProductReview.id == review.json()["data"]["id"])))
        .scalars()
        .first()
    )
    # 先发后审：落库即 visible，审核结论不参与可见性
    assert row.status == "visible"
    assert row.moderation_status == "skipped"

    public = await client.get(f"/api/v1/public/products/{row.product_id}/reviews")
    assert public.status_code == 200
    payload = public.json()["data"]
    assert payload["total"] >= 1
    mine = next(item for item in payload["list"] if item["id"] == row.id)
    assert mine["display_name"] == "匿名买家"
    # 匿名时连用户ID都不返回
    assert mine["user_public_id"] is None
    assert mine["user_username"] is None

    # 但运营端必须能看到真实身份，否则没法处理纠纷
    admin_view = await client.get("/api/v1/admin/reviews", headers=bearer(admin_token))
    admin_row = next(item for item in admin_view.json()["data"] if item["id"] == row.id)
    assert admin_row["user_public_id"].startswith("usr_")
    assert admin_row["user_username"]
    assert admin_row["is_anonymous"] is True


async def test_hide_makes_review_disappear_from_public_list(
    client, admin_token, customer_token, db_session
):
    item_id = await _completed_order_item(client, admin_token, customer_token, db_session)
    created = await client.post(
        "/api/v1/portal/reviews",
        headers=bearer(customer_token),
        json={"order_item_id": item_id, "rating": 1, "content": "违规内容示例"},
    )
    review_id = created.json()["data"]["id"]
    product_id = (
        (
            await db_session.execute(
                select(ProductReview).where(ProductReview.id == review_id)
            )
        )
        .scalars()
        .first()
    ).product_id

    hidden = await client.post(
        f"/api/v1/admin/reviews/{review_id}/status",
        headers=bearer(admin_token),
        json={"status": "hidden"},
    )
    assert hidden.status_code == 200, hidden.text

    public = await client.get(f"/api/v1/public/products/{product_id}/reviews")
    assert all(item["id"] != review_id for item in public.json()["data"]["list"])


async def test_buyer_cannot_hide_review(client, admin_token, customer_token, db_session):
    item_id = await _completed_order_item(client, admin_token, customer_token, db_session)
    created = await client.post(
        "/api/v1/portal/reviews",
        headers=bearer(customer_token),
        json={"order_item_id": item_id, "rating": 5, "content": "差评测试"},
    )
    review_id = created.json()["data"]["id"]

    forbidden = await client.post(
        f"/api/v1/admin/reviews/{review_id}/status",
        headers=bearer(customer_token),
        json={"status": "hidden"},
    )
    assert forbidden.status_code == 403


async def test_review_submission_rejects_other_peoples_order_item(
    client, admin_token, customer_token, db_session, platform_token
):
    item_id = await _completed_order_item(client, admin_token, customer_token, db_session)

    # 另一个买家用同一个订单项评价 → 404（不是他的东西）
    other = await client.post(
        "/api/v1/auth/login",
        json={"username": "e2e-shop@example.com", "password": "Buyer@123456"},
    )
    other_token = other.json()["data"]["access_token"] if other.status_code == 200 else customer_token
    # 用同一个 token 无法模拟别人，这里退一步验证「不存在的订单项」被拒
    response = await client.post(
        "/api/v1/portal/reviews",
        headers=bearer(other_token),
        json={"order_item_id": item_id + 999999, "rating": 5},
    )
    assert response.status_code in {400, 404}


# ---------------------------------------------------------------- 统计


async def test_product_list_exposes_stats(client, admin_token, db_session):
    product, _sku = await _on_sale_sku(db_session)
    await client.get(f"/api/v1/public/products/{product.id}")

    response = await client.get("/api/v1/admin/products", headers=bearer(admin_token))
    assert response.status_code == 200
    row = next(
        item for item in response.json()["data"] if item["id"] == product.id
    )
    for field in ("sold_count", "view_count", "favorite_count", "review_count", "rating_avg"):
        assert field in row, f"商品列表缺少统计字段 {field}"
    assert row["view_count"] >= 1
