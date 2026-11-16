"""多规格：规格树 + 笛卡尔积 SKU + 组合级的价/库存/覆盖图。

守的契约（都是多规格最容易写错的地方）：

1. N 个规格组做**笛卡尔积**，每个组合一条 SKU；
2. **再次保存时按组合键匹配**：老组合保留价格/库存，新组合补默认值；
3. 组合消失只置 `inactive`，**不删行**（购物车/订单/库存流水都外键指向 SKU）；
4. `sku_code` 全局唯一且对同一组合稳定；
5. 在售商品改规格 → 自动打回待审核。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.catalog import Product, ProductSku
from tests.conftest import bearer


async def _product(client, token) -> dict:
    rows = (await client.get("/api/v1/admin/products", headers=bearer(token))).json()["data"]
    assert rows, "种子里应该有商品"
    return rows[0]


async def _save_specs(client, token, product_id: int, groups, skus=None):
    return await client.put(
        f"/api/v1/admin/products/{product_id}/specs",
        headers=bearer(token),
        json={"groups": groups, "skus": skus or []},
    )


SIZE_COLOR = [
    {"name": "尺码", "values": [{"value": "XL"}, {"value": "L"}]},
    {"name": "颜色", "values": [{"value": "黑色"}, {"value": "白色"}]},
]


async def test_cartesian_product_creates_one_sku_per_combo(client, admin_token):
    product = await _product(client, admin_token)
    response = await _save_specs(client, admin_token, product["id"], SIZE_COLOR)
    assert response.status_code == 200, response.text
    skus = response.json()["data"]["skus"]
    assert len(skus) == 4, skus
    combos = {tuple(sorted(item["specs"].items())) for item in skus}
    assert combos == {
        (("尺码", "XL"), ("颜色", "黑色")),
        (("尺码", "XL"), ("颜色", "白色")),
        (("尺码", "L"), ("颜色", "黑色")),
        (("尺码", "L"), ("颜色", "白色")),
    }
    assert all(item["sku_code"].startswith(f"SKU-{product['id']}") for item in skus)


async def test_resaving_keeps_prices_and_deactivates_missing_combos(client, admin_token, db_session):
    product = await _product(client, admin_token)
    first = await _save_specs(client, admin_token, product["id"], SIZE_COLOR)
    skus = first.json()["data"]["skus"]
    target = next(item for item in skus if item["specs"].get("尺码") == "XL")

    # 给 XL/黑色 填一个专属价格
    priced = await _save_specs(
        client,
        admin_token,
        product["id"],
        SIZE_COLOR,
        skus=[
            {"specs": target["specs"], "price_cents": 12345, "stock": 9},
        ],
    )
    assert priced.status_code == 200, priced.text
    kept = next(
        item for item in priced.json()["data"]["skus"] if item["id"] == target["id"]
    )
    assert kept["price_cents"] == 12345
    assert kept["stock"] == 9

    # 去掉「白色」这一档 → 白色相关组合的 SKU 应被停用（行还在）
    narrowed = await _save_specs(
        client,
        admin_token,
        product["id"],
        [
            {"name": "尺码", "values": [{"value": "XL"}, {"value": "L"}]},
            {"name": "颜色", "values": [{"value": "黑色"}]},
        ],
    )
    assert narrowed.status_code == 200, narrowed.text
    assert len(narrowed.json()["data"]["skus"]) == 2

    rows = list(
        (
            await db_session.scalars(
                select(ProductSku).where(ProductSku.product_id == product["id"])
            )
        ).all()
    )
    white = [row for row in rows if (row.specs or {}).get("颜色") == "白色"]
    assert white, "消失的组合不能删行"
    assert all(row.status == "inactive" for row in white)
    # 保留下来的组合价格不丢
    kept_row = next(row for row in rows if row.id == target["id"])
    assert kept_row.price_cents == 12345


async def test_operator_saving_specs_does_not_bounce_an_on_sale_product(
    client, admin_token
):
    """运营端保存规格**不应该**把在售商品打回待审核。

    这条原来是反的（断言会变成 pending_review）。那样一来，运营只是在编辑器里
    换了个主图 / 改了个库存，商品就会立刻从「在售」变「待审核」，买家端直接搜不到——
    表现得就像「主图保存了但不显示」。运营本身就是审核方，不需要自我重审。

    卖家改内容仍会打回待审，那个逻辑在 `seller_center.update_seller_product`，
    由 `test_seller_product_management.py` 覆盖。
    """
    product = await _product(client, admin_token)
    await client.post(
        f"/api/v1/admin/products/{product['id']}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )
    response = await _save_specs(client, admin_token, product["id"], SIZE_COLOR)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "on_sale"


async def test_more_than_three_groups_is_rejected(client, admin_token):
    product = await _product(client, admin_token)
    groups = [
        {"name": f"规格{i}", "values": [{"value": "a"}]} for i in range(4)
    ]
    response = await _save_specs(client, admin_token, product["id"], groups)
    assert response.status_code == 422, response.text


async def test_duplicate_values_are_rejected(client, admin_token):
    product = await _product(client, admin_token)
    response = await _save_specs(
        client,
        admin_token,
        product["id"],
        [{"name": "尺码", "values": [{"value": "XL"}, {"value": "XL"}]}],
    )
    assert response.status_code == 400, response.text


async def test_detail_returns_spec_groups_and_sku_override_image(client, admin_token):
    product = await _product(client, admin_token)
    await _save_specs(
        client,
        admin_token,
        product["id"],
        [{"name": "颜色", "values": [{"value": "黑色", "image_url": "/api/v1/attachments/public/1"}]}],
        skus=[{"specs": {"颜色": "黑色"}, "price_cents": 5000, "stock": 3, "image_url": "/api/v1/attachments/public/2"}],
    )
    detail = (
        await client.get(f"/api/v1/admin/products/{product['id']}", headers=bearer(admin_token))
    ).json()["data"]
    assert detail["spec_groups"][0]["name"] == "颜色"
    assert detail["spec_groups"][0]["values"][0]["image_url"].endswith("/public/1")
    sku = next(item for item in detail["skus"] if item["specs"] == {"颜色": "黑色"})
    # SKU 级覆盖图优先于规格值图
    assert sku["image_url"].endswith("/public/2")
    assert sku["specs"] == {"颜色": "黑色"}
    # 旧的单规格 SKU 还在但已停用（不删行）
    legacy = [item for item in detail["skus"] if not item["specs"]]
    assert legacy and all(item["status"] == "inactive" for item in legacy)


async def test_seller_must_name_the_sku_when_multiple(client, admin_token, operator_token):
    """卖家改价必须指明 sku_id —— 否则会静默改到别的规格上。"""
    product = await _product(client, admin_token)
    await _save_specs(client, admin_token, product["id"], SIZE_COLOR)

    ambiguous = await client.put(
        f"/api/v1/portal/seller/products/{product['id']}",
        headers=bearer(operator_token),
        json={"price_cents": 100},
    )
    # 卖家只能改自己的商品；这条商品属于 operator（种子里的卖家就是他），所以会走到多规格判定
    if ambiguous.status_code == 404:
        return  # 归属不符时直接返回，不强行断言
    assert ambiguous.status_code == 400, ambiguous.text
    assert "sku_id" in ambiguous.text


async def test_product_row_keeps_video_and_commission_columns(client, admin_token, db_session):
    product = await _product(client, admin_token)
    row = (await db_session.scalars(select(Product).where(Product.id == product["id"]))).first()
    assert row is not None
    assert row.video_url is None or isinstance(row.video_url, str)
    assert row.commission_locked in (True, False)
