"""商品软删除：status='deleted' 而不是物理删。

守的契约：

1. 卖家删自己的商品 → 卖家列表、买家商城、确认页、收藏都不再出现；
2. **软**删：订单快照 / 收藏 / 评价 / 审计仍引用这条商品，物理删会产生孤儿数据；
3. 已删除的商品不能再编辑、上下架、重新提审（否则删了还能复活，语义混乱）；
4. 删除留审计（`product.deleted`），运营端显式筛「已删除」还能查到。
"""

from __future__ import annotations

from tests.conftest import bearer


async def _create_and_publish(client, operator_token, admin_token, name: str) -> dict:
    created = await client.post(
        "/api/v1/portal/seller/products",
        headers=bearer(operator_token),
        json={
            "name": name,
            "price_cents": 1500,
            "stock": 4,
            "delivery_methods": ["express"],
        },
    )
    assert created.status_code == 200, created.text
    product = created.json()["data"]
    approved = await client.post(
        f"/api/v1/admin/products/{product['id']}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )
    assert approved.status_code == 200, approved.text
    return approved.json()["data"]


async def test_seller_soft_deletes_product(client, operator_token, admin_token):
    product = await _create_and_publish(
        client, operator_token, admin_token, "要被删掉的商品"
    )

    deleted = await client.delete(
        f"/api/v1/portal/seller/products/{product['id']}",
        headers=bearer(operator_token),
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["data"]["status"] == "deleted"

    # 卖家列表不再出现
    rows = await client.get(
        "/api/v1/portal/seller/products", headers=bearer(operator_token)
    )
    ids = [row["id"] for row in rows.json()["data"]]
    assert product["id"] not in ids

    # 买家商城不再出现
    public = await client.get("/api/v1/public/products", params={"keyword": "要被删掉"})
    assert public.status_code == 200, public.text
    names = [item["name"] for item in public.json()["data"]["list"]]
    assert "要被删掉的商品" not in names

    # 已删除商品不能再操作
    detail = await client.get(
        f"/api/v1/portal/seller/products/{product['id']}",
        headers=bearer(operator_token),
    )
    assert detail.status_code == 404
    restatus = await client.post(
        f"/api/v1/portal/seller/products/{product['id']}/status",
        headers=bearer(operator_token),
        json={"status": "pending_review"},
    )
    assert restatus.status_code == 404


async def test_delete_leaves_audit_record(client, operator_token, admin_token):
    product = await _create_and_publish(
        client, operator_token, admin_token, "删除要留痕"
    )
    await client.delete(
        f"/api/v1/portal/seller/products/{product['id']}",
        headers=bearer(operator_token),
    )
    logs = await client.get(
        "/api/v1/audit-logs",
        headers=bearer(admin_token),
        params={"action": "product.deleted", "target_type": "product"},
    )
    assert logs.status_code == 200, logs.text
    records = logs.json()["data"]["list"]
    assert any(str(row.get("target_id")) == str(product["id"]) for row in records)


async def test_deleted_product_disappears_from_cart_favorites_and_checkout(
    client, operator_token, admin_token, customer_token
):
    product = await _create_and_publish(
        client, operator_token, admin_token, "已删除商品的三处残留"
    )
    detail = await client.get(
        f"/api/v1/admin/products/{product['id']}", headers=bearer(admin_token)
    )
    sku_id = next(
        item["id"] for item in detail.json()["data"]["skus"] if item["status"] == "active"
    )

    await client.post(
        "/api/v1/portal/cart/items",
        headers=bearer(customer_token),
        json={"sku_id": sku_id, "quantity": 1},
    )
    await client.post(
        f"/api/v1/public/products/{product['id']}/favorite",
        headers=bearer(customer_token),
    )

    await client.delete(
        f"/api/v1/portal/seller/products/{product['id']}",
        headers=bearer(operator_token),
    )

    # 购物车行还在（用户自己删），但标记失效且名字说清原因
    cart = await client.get("/api/v1/portal/cart", headers=bearer(customer_token))
    row = next(
        item for item in cart.json()["data"]["items"] if item["sku_id"] == sku_id
    )
    assert row["available"] is False
    assert row["product_name"] == "商品已删除"

    # 收藏列表不再展示
    favorites = await client.get(
        "/api/v1/portal/favorites", headers=bearer(customer_token)
    )
    ids = [item["product_id"] for item in favorites.json()["data"]]
    assert product["id"] not in ids

    # 确认页给出准确原因
    preview = await client.post(
        "/api/v1/portal/checkout/preview",
        headers=bearer(customer_token),
        json={"mode": "buy", "sku_id": sku_id, "quantity": 1},
    )
    assert preview.status_code == 200, preview.text
    assert any("已被删除" in issue for issue in preview.json()["data"]["issues"])


async def test_operator_can_delete_and_still_filter_by_deleted_status(
    client, operator_token, admin_token
):
    """运营端也能删；列表默认不显示，显式筛 status=deleted 才查得到（便于追溯）。"""
    product = await _create_and_publish(
        client, operator_token, admin_token, "运营删除的商品"
    )
    response = await client.post(
        f"/api/v1/admin/products/{product['id']}/status",
        headers=bearer(admin_token),
        json={"status": "deleted"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "deleted"

    default_list = await client.get(
        "/api/v1/admin/products", headers=bearer(admin_token)
    )
    assert product["id"] not in [row["id"] for row in default_list.json()["data"]]

    filtered = await client.get(
        "/api/v1/admin/products",
        headers=bearer(admin_token),
        params={"status": "deleted"},
    )
    assert product["id"] in [row["id"] for row in filtered.json()["data"]]
