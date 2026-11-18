"""商品「成交图」唯一口径：SKU 覆盖图 > 规格值图 > 主图。

守的契约（历史上真出过事故）：

1. 只设了**规格值图**（最常见用法）时，详情页、购物车、确认页、订单快照必须显示同一张图；
   过去确认页与订单快照只取 `sku.image_url or main_image`，漏了规格值图 —— 买家看到的
   商品图和订单里的不一致；
2. SKU 覆盖图存在时压过规格值图；
3. 什么都没有才回落到主图。
"""

from __future__ import annotations

from tests.conftest import bearer

# 1x1 PNG：业务写入会校验附件真实存在（`publish_by_public_url`），所以只能传真附件
PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00"
    b"\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def _image(client, token, name: str) -> str:
    """传一张真附件，返回可直接写进业务字段的公开直链。"""
    response = await client.post(
        "/api/v1/attachments/upload",
        headers=bearer(token),
        files={"file": (name, PNG, "image/png")},
        data={"source_module": "pytest"},
    )
    assert response.status_code == 200, response.text
    return f"/api/v1/attachments/public/{response.json()['data']['id']}"


async def _product_with_spec_image(client, operator_token, admin_token) -> dict:
    """建商品（卖家）→ 给规格值挂图 → 上架（运营）。返回带三张直链的上下文。"""
    main_image = await _image(client, operator_token, "main.png")
    spec_image = await _image(client, operator_token, "spec.png")
    sku_image = await _image(client, operator_token, "sku.png")

    created = await client.post(
        "/api/v1/portal/seller/products",
        headers=bearer(operator_token),
        json={
            "name": "成交图口径测试商品",
            "price_cents": 1000,
            "stock": 5,
            "main_image": main_image,
            "delivery_methods": ["express"],
        },
    )
    assert created.status_code == 200, created.text
    product_id = created.json()["data"]["id"]

    saved = await client.put(
        f"/api/v1/admin/products/{product_id}/specs",
        headers=bearer(admin_token),
        json={
            "groups": [
                {"name": "尺码", "values": [{"value": "XL", "image_url": spec_image}]}
            ],
            "skus": [
                {"specs": {"尺码": "XL"}, "price_cents": 1000, "stock": 5}
            ],
        },
    )
    assert saved.status_code == 200, saved.text

    approved = await client.post(
        f"/api/v1/admin/products/{product_id}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )
    assert approved.status_code == 200, approved.text
    return {
        **approved.json()["data"],
        "main_image": main_image,
        "spec_image": spec_image,
        "sku_image": sku_image,
    }


async def _first_sku(client, admin_token, product_id: int) -> dict:
    detail = await client.get(
        f"/api/v1/admin/products/{product_id}", headers=bearer(admin_token)
    )
    assert detail.status_code == 200, detail.text
    # 加规格后，建商品时那条「默认」SKU 会被置为 inactive，只留历史订单用
    skus = [item for item in detail.json()["data"]["skus"] if item["status"] == "active"]
    assert skus, "应该有一个在售 SKU"
    return skus[0]


async def test_cart_and_checkout_preview_use_spec_value_image(
    client, operator_token, admin_token, customer_token
):
    product = await _product_with_spec_image(client, operator_token, admin_token)
    sku = await _first_sku(client, admin_token, product["id"])

    added = await client.post(
        "/api/v1/portal/cart/items",
        headers=bearer(customer_token),
        json={"sku_id": sku["id"], "quantity": 1},
    )
    assert added.status_code == 200, added.text
    cart = await client.get("/api/v1/portal/cart", headers=bearer(customer_token))
    item = next(
        row for row in cart.json()["data"]["items"] if row["sku_id"] == sku["id"]
    )
    assert item["main_image"] == product["spec_image"]

    preview = await client.post(
        "/api/v1/portal/checkout/preview",
        headers=bearer(customer_token),
        json={"mode": "buy", "sku_id": sku["id"], "quantity": 1},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["items"][0]["image"] == product["spec_image"]


async def test_order_snapshot_uses_spec_value_image(
    client, operator_token, admin_token, customer_token
):
    product = await _product_with_spec_image(client, operator_token, admin_token)
    sku = await _first_sku(client, admin_token, product["id"])

    order = await client.post(
        "/api/v1/portal/orders",
        headers=bearer(customer_token),
        json={
            "items": [{"sku_id": sku["id"], "quantity": 1}],
            "receiver_name": "口径测试",
            "receiver_phone": "13900003333",
            "receiver_address": {"detail": "成交图路 1 号"},
        },
    )
    assert order.status_code == 200, order.text
    order_id = order.json()["data"]["id"]

    detail = await client.get(
        f"/api/v1/portal/orders/{order_id}", headers=bearer(customer_token)
    )
    assert detail.status_code == 200, detail.text
    # 订单快照图必须与详情页同一口径（规格值图），否则买家收到图和买的不一样
    assert detail.json()["data"]["items"][0]["image"] == product["spec_image"]


async def test_sku_cover_image_beats_spec_value_image(
    client, operator_token, admin_token, customer_token
):
    product = await _product_with_spec_image(client, operator_token, admin_token)
    saved = await client.put(
        f"/api/v1/admin/products/{product['id']}/specs",
        headers=bearer(admin_token),
        json={
            "groups": [
                {
                    "name": "尺码",
                    "values": [{"value": "XL", "image_url": product["spec_image"]}],
                }
            ],
            "skus": [
                {
                    "specs": {"尺码": "XL"},
                    "price_cents": 1000,
                    "stock": 5,
                    "image_url": product["sku_image"],
                }
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    # 在售商品改规格会被打回待审核，重新上架再验证买家侧
    await client.post(
        f"/api/v1/admin/products/{product['id']}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )
    sku = await _first_sku(client, admin_token, product["id"])

    preview = await client.post(
        "/api/v1/portal/checkout/preview",
        headers=bearer(customer_token),
        json={"mode": "buy", "sku_id": sku["id"], "quantity": 1},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["items"][0]["image"] == product["sku_image"]


async def test_falls_back_to_main_image(
    client, operator_token, admin_token, customer_token
):
    product = await _product_with_spec_image(client, operator_token, admin_token)
    # 把规格值图摘掉 → 应回落到主图
    await client.put(
        f"/api/v1/admin/products/{product['id']}/specs",
        headers=bearer(admin_token),
        json={
            "groups": [{"name": "尺码", "values": [{"value": "XL"}]}],
            "skus": [{"specs": {"尺码": "XL"}, "price_cents": 1000, "stock": 5}],
        },
    )
    await client.post(
        f"/api/v1/admin/products/{product['id']}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )
    sku = await _first_sku(client, admin_token, product["id"])

    preview = await client.post(
        "/api/v1/portal/checkout/preview",
        headers=bearer(customer_token),
        json={"mode": "buy", "sku_id": sku["id"], "quantity": 1},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["items"][0]["image"] == product["main_image"]
