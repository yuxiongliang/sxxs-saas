"""公开商品橱窗接口（站点根页「商品」内页用）。

这是项目里唯一对**匿名访客**开放的业务数据接口，因此断言集中在三件事：

1. 不带任何凭证也能读到；
2. 只返回 on_sale 商品，且不含卖家/用户等内部字段；
3. 不存在的租户与停用租户都返回 404（不泄露存在性）。
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.catalog import Product
from app.models.tenant import Tenant
from tests.conftest import bearer


async def test_anonymous_visitor_can_read_products(client):
    """不带 Authorization 头也要能拿到数据 —— 这是公开落地页的前提。"""
    response = await client.get("/api/v1/public/products")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    # 分页结构：有 total 才能做分页，也便于前端显示「共 N 件」
    assert set(data) == {"list", "total", "page", "pageSize"}
    assert isinstance(data["list"], list)
    assert data["list"], "演示租户应当有在售商品"
    assert data["total"] >= len(data["list"])


async def test_only_on_sale_products_are_exposed(client, db_session):
    # 自己造一个「待审」商品，不依赖种子数据的分布
    existing = (
        (
            await db_session.execute(
                select(Product).where(Product.tenant_id == 1, Product.status == "on_sale")
            )
        )
        .scalars()
        .first()
    )
    assert existing is not None
    draft = Product(
        tenant_id=1,
        seller_id=existing.seller_id,
        shop_id=existing.shop_id,
        category_id=existing.category_id,
        name="待审商品（不应出现在公开橱窗）",
        status="pending_review",
    )
    db_session.add(draft)
    await db_session.flush()

    items = (await client.get("/api/v1/public/products?page_size=60")).json()["data"]["list"]
    assert all(item["status"] == "on_sale" for item in items)
    assert draft.id not in {item["id"] for item in items}, "非在售商品被公开了"


async def test_response_is_whitelisted(client):
    """只暴露展示字段，不能带出卖家状态、KYC、用户等信息。"""
    item = (await client.get("/api/v1/public/products")).json()["data"]["list"][0]
    allowed = {
        "id",
        "seller_id",
        "shop_id",
        "name",
        "status",
        "main_image",
        "shop_name",
        "seller_name",
        "sku",
        # 多规格：列表卡片用起售价 + 是否有货 + 规格数
        "price_min_cents",
        "price_max_cents",
        "sku_count",
        "in_stock",
        # 卡片上的社会证明：已售件数 / 收藏数 / 评分与评价数
        "sold_count",
        "favorite_count",
        "rating_avg",
        "review_count",
        # 卡片上的热度展示：浏览数（详情页 PV）
        "view_count",
    }
    assert set(item) == allowed
    assert set(item["sku"] or {}) <= {"id", "name", "price_cents", "stock"}


async def test_unknown_tenant_returns_404(client):
    response = await client.get("/api/v1/public/products?tenant=no-such-market")
    assert response.status_code == 404


async def test_suspended_tenant_returns_404(client, db_session):
    tenant = await db_session.get(Tenant, 1)
    tenant.status = "suspended"
    await db_session.flush()
    response = await client.get("/api/v1/public/products?tenant=demo")
    assert response.status_code == 404


@pytest.mark.parametrize("query", ["page_size=0", "page_size=999"])
async def test_page_size_is_bounded(client, query):
    response = await client.get(f"/api/v1/public/products?{query}")
    assert response.status_code == 422


async def test_page_size_is_respected(client):
    items = (await client.get("/api/v1/public/products?page_size=1")).json()["data"]["list"]
    assert len(items) <= 1


async def test_logged_in_user_sees_the_same_catalogue(client, customer_token):
    """公开接口与登录态无关，避免出现两套商品数据。"""
    anon = (await client.get("/api/v1/public/products")).json()["data"]["list"]
    authed = (
        (await client.get("/api/v1/public/products", headers=bearer(customer_token)))
        .json()["data"]["list"]
    )
    assert [item["id"] for item in anon] == [item["id"] for item in authed]


async def test_anonymous_can_read_product_detail(client):
    """商品详情也要匿名可读 —— 站点前台的 /products/:id 依赖它。"""
    items = (await client.get("/api/v1/public/products?page_size=1")).json()["data"]["list"]
    assert items, "需要至少一个在售商品"
    product_id = items[0]["id"]

    response = await client.get(f"/api/v1/public/products/{product_id}")
    assert response.status_code == 200, response.text
    detail = response.json()["data"]
    assert detail["id"] == product_id
    assert detail["status"] == "on_sale"
    assert isinstance(detail["skus"], list) and detail["skus"], "详情应带 SKU 列表"
    assert set(detail["skus"][0]) == {
        "id",
        "sku_code",
        "name",
        "price_cents",
        "stock",
        "specs",
        "image_url",
        "video_url",
    }
    # 多规格选择器要能拿到规格树
    assert isinstance(detail["spec_groups"], list)


async def test_product_detail_hides_off_shelf_items(client, db_session):
    """下架商品对匿名访客必须 404，不能因为知道 id 就绕过。"""
    existing = (
        (
            await db_session.execute(
                select(Product).where(Product.tenant_id == 1, Product.status == "on_sale")
            )
        )
        .scalars()
        .first()
    )
    assert existing is not None
    draft = Product(
        tenant_id=1,
        seller_id=existing.seller_id,
        shop_id=existing.shop_id,
        category_id=existing.category_id,
        name="下架商品（详情不应可读）",
        status="off_sale",
    )
    db_session.add(draft)
    await db_session.flush()

    response = await client.get(f"/api/v1/public/products/{draft.id}")
    assert response.status_code == 404


async def test_unknown_product_detail_returns_404(client):
    response = await client.get("/api/v1/public/products/99999999")
    assert response.status_code == 404


async def test_product_detail_is_tenant_scoped(client, admin_token, platform_token):
    """别的租户拿不到 demo 的商品详情。"""
    await client.post(
        "/api/v1/platform/tenants",
        headers=bearer(platform_token),
        json={
            "name": "Detail Other Tenant",
            "slug": "detail-other",
            "email": "detail-other@example.com",
            "nickname": "Other",
            "password": "Other@123456",
        },
    )
    items = (await client.get("/api/v1/public/products?page_size=1")).json()["data"]["list"]
    product_id = items[0]["id"]
    response = await client.get(f"/api/v1/public/products/{product_id}?tenant=detail-other")
    assert response.status_code == 404


# ---------------------------------------------------------------- 搜索 / 筛选 / 排序 / 分页


async def test_keyword_matches_product_name(client):
    hit = (await client.get("/api/v1/public/products?keyword=键盘")).json()["data"]
    assert hit["total"] >= 1
    assert any("键盘" in item["name"] for item in hit["list"])

    miss = (await client.get("/api/v1/public/products?keyword=zzz-不存在-zzz")).json()["data"]
    assert miss["total"] == 0
    assert miss["list"] == []


async def test_keyword_also_matches_shop_name(client):
    """搜索要能按卖家/店铺搜，否则买家搜不到自己熟悉的店。"""
    data = (await client.get("/api/v1/public/products?keyword=李思")).json()["data"]
    assert data["total"] >= 1


async def test_price_range_filters_out_everything_above_the_cap(client):
    data = (await client.get("/api/v1/public/products?max_price_cents=1")).json()["data"]
    assert data["total"] == 0
    assert data["list"] == []


async def test_price_sort_is_monotonic(client):
    asc = (await client.get("/api/v1/public/products?sort=price_asc&page_size=60")).json()["data"][
        "list"
    ]
    prices = [item["price_min_cents"] for item in asc if item["price_min_cents"] is not None]
    assert prices == sorted(prices)

    desc = (
        (await client.get("/api/v1/public/products?sort=price_desc&page_size=60"))
        .json()["data"]["list"]
    )
    desc_prices = [item["price_min_cents"] for item in desc if item["price_min_cents"] is not None]
    assert desc_prices == sorted(desc_prices, reverse=True)


async def test_unknown_sort_falls_back_instead_of_erroring(client):
    """链接被人手改过不应该白屏，回落到综合排序即可。"""
    response = await client.get("/api/v1/public/products?sort=whatever")
    assert response.status_code == 200
    assert "list" in response.json()["data"]


async def test_pagination_returns_disjoint_pages(client):
    first = (await client.get("/api/v1/public/products?page_size=1&page=1")).json()["data"]
    assert len(first["list"]) == 1
    assert first["page"] == 1
    if first["total"] > 1:
        second = (await client.get("/api/v1/public/products?page_size=1&page=2")).json()["data"]
        assert len(second["list"]) == 1
        assert first["list"][0]["id"] != second["list"][0]["id"]


async def test_public_categories_only_exposes_id_name_slug(client):
    response = await client.get("/api/v1/public/categories")
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert isinstance(rows, list)
    for row in rows:
        # 白名单：不暴露 tenant_id / 抽佣比例等内部字段
        assert set(row) == {"id", "name", "slug"}
