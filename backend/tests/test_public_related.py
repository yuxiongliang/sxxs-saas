"""详情页「猜你喜欢」：相似商品分页流。

要盯住三件事：
1. **不推荐自己**；
2. 分层排序（同分类 → 同卖家 → 全站兜底），不会因为候选不足而空掉；
3. 分页稳定：同分商品有 id tiebreaker，翻页不重复不遗漏。
"""

from __future__ import annotations

from tests.conftest import bearer


async def _on_sale_ids(client, admin_token) -> list[int]:
    rows = (await client.get("/api/v1/admin/products", headers=bearer(admin_token))).json()["data"]
    return [row["id"] for row in rows if row["status"] == "on_sale"]


async def test_related_excludes_the_current_product(client, admin_token):
    ids = await _on_sale_ids(client, admin_token)
    assert ids, "需要至少一个在售商品"
    current = ids[0]

    data = (
        await client.get(f"/api/v1/public/products/{current}/related?page_size=24")
    ).json()["data"]
    returned = [item["id"] for item in data["list"]]
    assert current not in returned
    # total 应该在售商品数 - 1（当前商品）
    assert data["total"] == len(ids) - 1


async def test_related_payload_matches_list_card_shape(client, admin_token):
    ids = await _on_sale_ids(client, admin_token)
    data = (
        await client.get(f"/api/v1/public/products/{ids[0]}/related?page_size=24")
    ).json()["data"]
    if not data["list"]:
        return
    item = data["list"][0]
    # 与列表卡片同一套字段，否则「猜你喜欢」的卡片会缺价格/热度
    for field in (
        "price_min_cents",
        "sku_count",
        "in_stock",
        "sold_count",
        "favorite_count",
        "view_count",
    ):
        assert field in item, f"相似商品缺少列表卡片字段 {field}"


async def test_related_pagination_is_disjoint(client, admin_token):
    ids = await _on_sale_ids(client, admin_token)
    current = ids[0]
    first = (
        await client.get(f"/api/v1/public/products/{current}/related?page=1&page_size=1")
    ).json()["data"]
    if first["total"] <= 1:
        return
    second = (
        await client.get(f"/api/v1/public/products/{current}/related?page=2&page_size=1")
    ).json()["data"]
    assert first["list"][0]["id"] != second["list"][0]["id"]


async def test_related_unknown_product_returns_404(client):
    response = await client.get("/api/v1/public/products/99999999/related")
    assert response.status_code == 404
