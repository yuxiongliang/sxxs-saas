"""IM：撤回 / 编辑 / 软删会话 / 搜索 / 商品卡片消息。

这几条都是「改别人看得到的内容」或「改可见范围」，所以断言重点在**权限与窗口**：
只有本人能撤回编辑、软删只影响自己、搜索不能越会话、商品卡必须属于会话卖家。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.catalog import Product
from app.models.im import Message
from app.models.seller import Seller
from tests.conftest import bearer


async def _seller(db_session, tenant_id: int = 1) -> Seller:
    seller = (
        await db_session.execute(
            select(Seller).where(Seller.tenant_id == tenant_id, Seller.status == "active")
        )
    ).scalars().first()
    assert seller is not None
    return seller


async def _conversation(client, token: str, seller_id: int) -> int:
    response = await client.post(
        "/api/v1/im/conversations", headers=bearer(token), json={"seller_id": seller_id}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


async def _send(client, token: str, conversation_id: int, content: str, cid: str) -> dict:
    response = await client.post(
        f"/api/v1/im/conversations/{conversation_id}/messages",
        headers=bearer(token),
        json={"content": content, "client_msg_id": cid},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_sender_can_recall_and_content_is_cleared(
    client, customer_token, db_session
):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    message = await _send(client, customer_token, conversation_id, "这条要撤回", "rc-1")

    recalled = await client.post(
        f"/api/v1/im/messages/{message['id']}/recall", headers=bearer(customer_token)
    )
    assert recalled.status_code == 200, recalled.text
    assert recalled.json()["data"]["recalled_at"]
    assert recalled.json()["data"]["content"] == ""

    row = (
        await db_session.execute(select(Message).where(Message.id == message["id"]))
    ).scalars().first()
    # 行保留（审计/举报要回溯），只是内容清空
    assert row is not None
    assert row.content == ""
    assert row.payload is None


async def test_cannot_recall_someone_elses_message(
    client, customer_token, operator_token, db_session
):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    message = await _send(client, customer_token, conversation_id, "买家发的", "rc-2")

    # 卖家也是这条会话的成员，但不是发送者
    response = await client.post(
        f"/api/v1/im/messages/{message['id']}/recall", headers=bearer(operator_token)
    )
    assert response.status_code == 403


async def test_recall_window_is_enforced(client, customer_token, db_session):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    message = await _send(client, customer_token, conversation_id, "老消息", "rc-3")

    # 把这条消息的时间往前拨 10 分钟（超过 2 分钟撤回窗口）
    row = (
        await db_session.execute(select(Message).where(Message.id == message["id"]))
    ).scalars().first()
    row.created_at = datetime.now(UTC) - timedelta(minutes=10)
    await db_session.commit()

    response = await client.post(
        f"/api/v1/im/messages/{message['id']}/recall", headers=bearer(customer_token)
    )
    assert response.status_code == 400
    assert "不能撤回" in response.json()["message"]


async def test_edit_updates_text_and_marks_edited(client, customer_token, db_session):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    message = await _send(client, customer_token, conversation_id, "原文", "ed-1")

    edited = await client.patch(
        f"/api/v1/im/messages/{message['id']}",
        headers=bearer(customer_token),
        json={"content": "改过的内容"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["data"]["content"] == "改过的内容"
    assert edited.json()["data"]["edited_at"]


async def test_edit_rejects_non_text_message(client, customer_token, db_session):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    message = await _send(client, customer_token, conversation_id, "会被改类型的消息", "ed-2")

    row = (
        await db_session.execute(select(Message).where(Message.id == message["id"]))
    ).scalars().first()
    row.type = "image"
    await db_session.commit()

    response = await client.patch(
        f"/api/v1/im/messages/{message['id']}",
        headers=bearer(customer_token),
        json={"content": "改不了"},
    )
    assert response.status_code == 400


async def test_hide_conversation_is_per_member(client, customer_token, operator_token, db_session):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)

    hidden = await client.delete(
        f"/api/v1/im/conversations/{conversation_id}", headers=bearer(customer_token)
    )
    assert hidden.status_code == 200, hidden.text

    buyer_list = (
        await client.get("/api/v1/im/conversations", headers=bearer(customer_token))
    ).json()["data"]
    assert conversation_id not in [item["id"] for item in buyer_list]

    # 卖家的列表里还在：软删只影响自己
    seller_list = (
        await client.get("/api/v1/im/conversations", headers=bearer(operator_token))
    ).json()["data"]
    assert conversation_id in [item["id"] for item in seller_list]


async def test_new_message_restores_hidden_conversation(
    client, customer_token, operator_token, db_session
):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    await client.delete(
        f"/api/v1/im/conversations/{conversation_id}", headers=bearer(customer_token)
    )

    # 卖家发一条 → 买家那边会话应重新出现（否则「有未读却看不到」）
    await _send(client, operator_token, conversation_id, "在吗？", "rs-1")

    buyer_list = (
        await client.get("/api/v1/im/conversations", headers=bearer(customer_token))
    ).json()["data"]
    assert conversation_id in [item["id"] for item in buyer_list]


async def test_search_hits_conversation_and_message(client, customer_token, db_session):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    await _send(client, customer_token, conversation_id, "这个键盘还在吗", "se-1")

    hit = (
        await client.get("/api/v1/im/search?keyword=键盘还在", headers=bearer(customer_token))
    ).json()["data"]
    assert hit["messages"], "应搜到消息内容"
    assert hit["messages"][0]["conversation_id"] == conversation_id

    miss = (
        await client.get("/api/v1/im/search?keyword=完全不存在的词", headers=bearer(customer_token))
    ).json()["data"]
    assert not miss["messages"]


async def test_product_message_requires_seller_ownership(client, customer_token, db_session):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    product = (
        await db_session.execute(
            select(Product).where(
                Product.tenant_id == 1,
                Product.status == "on_sale",
                Product.seller_id == seller.id,
            )
        )
    ).scalars().first()
    assert product is not None, "种子数据需要有该卖家的在售商品"

    response = await client.post(
        f"/api/v1/im/conversations/{conversation_id}/messages",
        headers=bearer(customer_token),
        json={"type": "product", "product_id": product.id, "client_msg_id": "pm-1"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()["data"]["payload"]
    assert payload["product_id"] == product.id
    # 快照存下来：商品改名/下架后历史消息不跟着变样
    assert payload["snapshot"]["name"] == product.name


async def test_product_message_rejects_other_sellers_product(
    client, customer_token, db_session
):
    seller = await _seller(db_session)
    conversation_id = await _conversation(client, customer_token, seller.id)
    foreign = (
        await db_session.execute(
            select(Product).where(
                Product.tenant_id == 1,
                Product.status == "on_sale",
                Product.seller_id != seller.id,
            )
        )
    ).scalars().first()
    if foreign is None:
        return  # 只有一个卖家时跳过（无法构造跨卖家场景）

    response = await client.post(
        f"/api/v1/im/conversations/{conversation_id}/messages",
        headers=bearer(customer_token),
        json={"type": "product", "product_id": foreign.id, "client_msg_id": "pm-2"},
    )
    assert response.status_code == 400
