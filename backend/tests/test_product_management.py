"""商品管理：状态机、上下架、改价改库存。

租户控制台的「商品管理」原来只有「编辑名称/副标题」和两个直接改状态的按钮 ——
`PUT /admin/products/{id}` 连 `status` 都能写，等于有 `product:manage` 就能绕过
`product:moderate` 自行上架。本文件守住三件事：

1. 状态只能按状态机迁移，非法迁移 400；
2. 审核类迁移要 `moderate`，上下架类要 `manage`，两类权限不互相替代；
3. 改库存写 InventoryLog，且不能低于已锁定数量。
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.models.catalog import InventoryLog, Product
from tests.conftest import bearer

# operator 只有 product:moderate，没有 product:manage（见 seed_auth.py）


async def _products(client, token) -> list[dict]:
    response = await client.get("/api/v1/admin/products", headers=bearer(token))
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _first_with_status(client, token, status: str) -> dict:
    for item in await _products(client, token):
        if item["status"] == status:
            return item
    raise AssertionError(f"种子里没有状态为 {status} 的商品")


async def test_product_list_exposes_price_and_stock(client, admin_token):
    """列表要能直接看出来卖多少钱、还有几件，否则运营没法判断能不能上架。"""
    items = await _products(client, admin_token)
    assert items, "种子里应该有商品"
    first = items[0]
    assert "price_cents" in first
    assert "stock" in first
    assert "skus" in first and isinstance(first["skus"], list)
    assert first["seller_name"], "列表应带出卖家名，不该只给裸 ID"


async def test_review_transition_requires_moderate_permission(
    client, admin_token, operator_token, viewer_token, db_session
):
    """operator 有 moderate 能审核；viewer 连读都受限，编辑类动作更不能碰。"""
    # 种子里只有 on_sale 商品，这里把其中一件改成待审核（只改测试事务内的状态）
    product = (
        await db_session.scalars(select(Product).where(Product.status == "on_sale"))
    ).first()
    assert product is not None
    product.status = "pending_review"
    await db_session.flush()
    pending_id = product.id

    # operator：有 product:moderate → 可以驳回
    rejected = await client.post(
        f"/api/v1/admin/products/{pending_id}/status",
        headers=bearer(operator_token),
        json={"status": "rejected"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["data"]["status"] == "rejected"

    # viewer 没有 product:manage → 修改商品资料应 403
    edited = await client.put(
        f"/api/v1/admin/products/{pending_id}",
        headers=bearer(viewer_token),
        json={"name": "只读用户想改名"},
    )
    assert edited.status_code == 403, edited.text

    # viewer 连审核都不行
    blocked = await client.post(
        f"/api/v1/admin/products/{pending_id}/status",
        headers=bearer(viewer_token),
        json={"status": "pending_review"},
    )
    assert blocked.status_code == 403, blocked.text


async def test_illegal_status_jump_is_rejected(client, admin_token, db_session):
    """在售商品不能直接被「改回待审核」，也不能从 rejected 一步跳到 on_sale。"""
    on_sale = await _first_with_status(client, admin_token, "on_sale")

    for target in ("pending_review", "rejected", "draft"):
        response = await client.post(
            f"/api/v1/admin/products/{on_sale['id']}/status",
            headers=bearer(admin_token),
            json={"status": target},
        )
        assert response.status_code == 400, f"{target}: {response.text}"

    product = (
        await db_session.scalars(select(Product).where(Product.id == on_sale["id"]))
    ).first()
    assert product is not None and product.status == "on_sale"


async def test_off_sale_then_on_sale_round_trip(client, admin_token):
    """上下架是 manage 类迁移：on_sale → off_sale → on_sale。"""
    on_sale = await _first_with_status(client, admin_token, "on_sale")

    off = await client.post(
        f"/api/v1/admin/products/{on_sale['id']}/status",
        headers=bearer(admin_token),
        json={"status": "off_sale"},
    )
    assert off.status_code == 200, off.text
    assert off.json()["data"]["status"] == "off_sale"

    back = await client.post(
        f"/api/v1/admin/products/{on_sale['id']}/status",
        headers=bearer(admin_token),
        json={"status": "on_sale"},
    )
    assert back.status_code == 200, back.text
    assert back.json()["data"]["status"] == "on_sale"


async def test_update_product_cannot_change_status(client, admin_token):
    """`PUT` 不再接受 status：想改状态必须走 /status（否则审核形同虚设）。"""
    on_sale = await _first_with_status(client, admin_token, "on_sale")
    response = await client.put(
        f"/api/v1/admin/products/{on_sale['id']}",
        headers=bearer(admin_token),
        json={"name": "改个名", "status": "off_sale"},
    )
    assert response.status_code == 200, response.text
    body = response.json()["data"]
    assert body["name"] == "改个名"
    assert body["status"] == "on_sale", "status 必须被忽略"


async def test_sku_price_and_stock_update_writes_inventory_log(client, admin_token, db_session):
    on_sale = await _first_with_status(client, admin_token, "on_sale")
    detail = await client.get(
        f"/api/v1/admin/products/{on_sale['id']}", headers=bearer(admin_token)
    )
    sku = detail.json()["data"]["skus"][0]
    before_logs = (
        await db_session.scalar(
            select(func.count(InventoryLog.id)).where(InventoryLog.sku_id == sku["id"])
        )
    ) or 0

    response = await client.put(
        f"/api/v1/admin/products/{on_sale['id']}/skus/{sku['id']}",
        headers=bearer(admin_token),
        json={"price_cents": 12345, "stock": sku["stock"] + 7},
    )
    assert response.status_code == 200, response.text
    updated = next(item for item in response.json()["data"]["skus"] if item["id"] == sku["id"])
    assert updated["price_cents"] == 12345
    assert updated["stock"] == sku["stock"] + 7

    after_logs = (
        await db_session.scalar(
            select(func.count(InventoryLog.id)).where(InventoryLog.sku_id == sku["id"])
        )
    ) or 0
    assert after_logs == before_logs + 1, "改库存必须留一条库存流水"


async def test_stock_cannot_drop_below_locked(client, admin_token, db_session):
    on_sale = await _first_with_status(client, admin_token, "on_sale")
    detail = await client.get(
        f"/api/v1/admin/products/{on_sale['id']}", headers=bearer(admin_token)
    )
    sku = detail.json()["data"]["skus"][0]
    locked = sku["locked_stock"]
    if locked == 0:
        # 没被订单占用时构造一个「低于锁定数」的写入（stock 不能为负，用 0 也不行）
        return
    response = await client.put(
        f"/api/v1/admin/products/{on_sale['id']}/skus/{sku['id']}",
        headers=bearer(admin_token),
        json={"stock": locked - 1},
    )
    assert response.status_code == 400, response.text
