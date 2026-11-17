"""卖家中心也能用「同一套发布向导」：详情 / 规格 / 创建带描述。

守的契约：

1. `GET /portal/seller/products/{id}` 形状与运营端详情**一致**（含 `spec_groups` + `skus`）——
   前端是同一个向导组件，少字段就要写分支；
2. 卖家保存规格：笛卡尔积生成 SKU，**在售商品会重新过审**（运营端保存不回退，卖家必须回退）；
3. 卖家只能动自己的商品（归属校验走 `current_seller()`）；
4. 新建商品能带上描述与富文本 —— 否则向导第 4 步是空转（写了被静默丢弃）。
"""

from __future__ import annotations

import pytest

from tests.conftest import bearer


async def _create(client, token, name: str, **extra) -> dict:
    body = {"name": name, "price_cents": 8800, "stock": 5, **extra}
    response = await client.post(
        "/api/v1/portal/seller/products", headers=bearer(token), json=body
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_seller_product_detail_matches_admin_shape(client, operator_token):
    created = await _create(client, operator_token, "详情形状商品")
    response = await client.get(
        f"/api/v1/portal/seller/products/{created['id']}",
        headers=bearer(operator_token),
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    # 向导回显需要的字段一个都不能少
    for key in (
        "id",
        "name",
        "product_type",
        "description_format",
        "description_doc",
        "main_image",
        "video_url",
        "category_id",
        "spec_groups",
        "skus",
    ):
        assert key in data, f"卖家详情缺字段 {key}"
    assert data["spec_groups"] == []
    assert len(data["skus"]) == 1


async def test_seller_specs_save_generates_skus(client, operator_token):
    created = await _create(client, operator_token, "多规格商品")
    response = await client.put(
        f"/api/v1/portal/seller/products/{created['id']}/specs",
        headers=bearer(operator_token),
        json={
            "groups": [
                {"name": "尺码", "values": [{"value": "S"}, {"value": "M"}]},
            ],
            "skus": [
                {"specs": {"尺码": "S"}, "price_cents": 9900, "stock": 3},
                {"specs": {"尺码": "M"}, "price_cents": 10900, "stock": 4},
            ],
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    active = [sku for sku in data["skus"] if sku["status"] == "active"]
    assert len(active) == 2
    assert {sku["price_cents"] for sku in active} == {9900, 10900}


async def test_seller_specs_save_bounces_on_sale_product(
    client, operator_token, admin_token
):
    """卖家改在售商品的规格必须重新过审（运营端不回退是内部纠错，不能套用到卖家）。"""
    created = await _create(client, operator_token, "上架后改规格")
    pid = created["id"]
    # 走完审核上架
    await client.post(
        f"/api/v1/admin/products/{pid}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )

    response = await client.put(
        f"/api/v1/portal/seller/products/{pid}/specs",
        headers=bearer(operator_token),
        json={
            "groups": [{"name": "颜色", "values": [{"value": "红"}]}],
            "skus": [{"specs": {"颜色": "红"}, "price_cents": 8800, "stock": 2}],
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["bounced_to_review"] is True
    assert data["status"] == "pending_review"


async def test_seller_cannot_touch_others_product(client, operator_token, customer_token):
    created = await _create(client, operator_token, "别人的商品")
    # 买家不是卖家：拿不到 current_seller → 404 或 403
    response = await client.get(
        f"/api/v1/portal/seller/products/{created['id']}",
        headers=bearer(customer_token),
    )
    assert response.status_code in (400, 403, 404)


async def test_create_product_persists_description(client, operator_token):
    """向导第 4 步写的详情必须落库，不能像以前那样被静默丢弃。"""
    created = await _create(
        client,
        operator_token,
        "带详情的商品",
        description="纯文本兜底",
    )
    detail = await client.get(
        f"/api/v1/portal/seller/products/{created['id']}",
        headers=bearer(operator_token),
    )
    assert detail.json()["data"]["description"] == "纯文本兜底"


async def test_seller_categories_endpoint(client, operator_token):
    response = await client.get(
        "/api/v1/portal/seller/categories", headers=bearer(operator_token)
    )
    assert response.status_code == 200, response.text
    assert isinstance(response.json()["data"], list)
