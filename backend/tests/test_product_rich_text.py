"""商品富文本描述：服务端清洗 / 纯文本抽取 / 搜索 / 图片发布。

安全边界都在这里断言：卖家写的富文本会展示给**匿名买家**，而且租户能绑自己的域名，
所以「清洗」不是锦上添花，是硬门槛。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.catalog import Product
from app.services import rich_text
from tests.conftest import bearer

SAFE_DOC = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"level": 2},
            "content": [{"type": "text", "text": "成色说明"}],
        },
        {"type": "paragraph", "content": [{"type": "text", "text": "九成新，仅拆封试用。"}]},
    ],
}


def test_sanitize_strips_scripts_and_external_images():
    cleaned = rich_text.sanitize_html(
        '<p>ok</p><script>alert(1)</script>'
        '<img src="https://evil.example/x.png">'
        '<img src="/api/v1/attachments/public/12">'
        '<a href="javascript:alert(1)">x</a>'
    )
    assert cleaned is not None
    assert "<script" not in cleaned
    assert "evil.example" not in cleaned
    assert "/api/v1/attachments/public/12" in cleaned
    assert "javascript:" not in cleaned
    # nh3 会自动给外链补 rel
    assert 'rel="noopener noreferrer nofollow"' in cleaned


def test_sanitize_keeps_allowed_style_subset_only():
    cleaned = rich_text.sanitize_html(
        '<p style="text-align:center;position:fixed;background:url(x)">居中</p>'
    )
    assert cleaned is not None
    assert "text-align" in cleaned
    assert "position" not in cleaned
    assert "url(" not in cleaned


def test_extract_text_flattens_blocks_for_search():
    text = rich_text.extract_text("<p>第一段</p><p>第二段</p>")
    assert text == "第一段\n第二段"


async def test_admin_can_save_rich_description_and_buyer_sees_clean_html(
    client, admin_token, db_session
):
    rows = (await client.get("/api/v1/admin/products", headers=bearer(admin_token))).json()["data"]
    product_id = rows[0]["id"]

    html = (
        '<h2>成色说明</h2><p style="text-align:center">九成新</p>'
        "<ul><li>键帽无油</li></ul><script>alert(1)</script>"
    )
    saved = await client.put(
        f"/api/v1/admin/products/{product_id}",
        headers=bearer(admin_token),
        json={"description_doc": SAFE_DOC, "description_html": html},
    )
    assert saved.status_code == 200, saved.text
    data = saved.json()["data"]
    assert data["description_format"] == "doc"
    assert data["description_html"] and "<script" not in data["description_html"]

    # 买家端拿到的必须是清洗后的 HTML
    public = await client.get(f"/api/v1/public/products/{product_id}")
    pub = public.json()["data"]
    assert pub["description_format"] == "doc"
    assert "<script" not in (pub["description_html"] or "")
    assert "键帽无油" in (pub["description_html"] or "")

    # 落库的纯文本供搜索
    product = (
        await db_session.execute(select(Product).where(Product.id == product_id))
    ).scalars().first()
    assert product.description_text and "键帽无油" in product.description_text


async def test_product_search_hits_description_text(client, admin_token):
    rows = (await client.get("/api/v1/admin/products", headers=bearer(admin_token))).json()["data"]
    product_id = rows[0]["id"]
    await client.put(
        f"/api/v1/admin/products/{product_id}",
        headers=bearer(admin_token),
        json={
            "description_doc": SAFE_DOC,
            "description_html": "<p>这句里有个独特词：蜗牛快递测试词</p>",
        },
    )

    hit = (await client.get("/api/v1/public/products?keyword=蜗牛快递测试词")).json()["data"]
    assert hit["total"] >= 1

    miss = (await client.get("/api/v1/public/products?keyword=蜗牛快递不存在")).json()["data"]
    assert miss["total"] == 0


async def test_oversized_doc_is_rejected(client, admin_token):
    rows = (await client.get("/api/v1/admin/products", headers=bearer(admin_token))).json()["data"]
    product_id = rows[0]["id"]
    huge = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "啊" * 200_000}]}
        ],
    }
    response = await client.put(
        f"/api/v1/admin/products/{product_id}",
        headers=bearer(admin_token),
        json={"description_doc": huge, "description_html": "<p>x</p>"},
    )
    assert response.status_code == 400


async def test_plain_text_description_still_renders_as_text(client, admin_token):
    """老商品（format=text）不能被富文本改造搞坏。"""
    rows = (await client.get("/api/v1/admin/products", headers=bearer(admin_token))).json()["data"]
    plain = next((row for row in rows if row.get("description_format") != "doc"), None)
    if plain is None:
        return  # 全量都已是富文本时跳过
    detail = await client.get(f"/api/v1/public/products/{plain['id']}")
    data = detail.json()["data"]
    assert data["description_format"] == "text"
    assert data["description_html"] in (None, "")
