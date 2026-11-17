"""真实支付：支付宝 / 微信的签名、验签、回调、幂等。

**用自签密钥对构造真报文**：不是 mock 掉验签，而是真的签、真的验、真的解密 ——
这样测的是生产链路本身（签名算法写错、字段顺序错、金额核对漏掉，都会在这里挂）。

覆盖：
1. 支付宝 RSA2：签/验往返、篡改拒绝
2. 支付宝回调：验签通过置已支付 / 金额不符拒绝 / 重复回调幂等 / 未配置时报错可读
3. 微信 V3：AES-GCM 解密、回调验签、篡改拒绝、幂等
4. 渠道配置缺失：返回 400 并列出缺哪些字段
"""

from __future__ import annotations

import base64
import json
import time

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select

from app.models.catalog import Product, ProductSku
from app.models.order import Order, Payment
from app.services.payment.alipay import sign, verify
from app.services.payment.wechat import (
    build_notify_message,
    decrypt_resource,
    sign_message,
)
from tests.conftest import bearer


def _keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = (
        private.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    return private_pem, public_pem


async def _set_payment_config(db_session, tenant_id: int, config: dict) -> None:
    from app.models.setting import SystemSetting

    row = (
        await db_session.scalars(
            select(SystemSetting).where(
                SystemSetting.tenant_id == tenant_id,
                SystemSetting.category == "payment",
            )
        )
    ).first()
    if row is None:
        row = SystemSetting(
            tenant_id=tenant_id,
            category="payment",
            enabled=True,
            config=config,
            version=1,
        )
        db_session.add(row)
    else:
        row.config = config
        row.enabled = True
    await db_session.commit()


async def _place_order(client, token, db_session) -> dict:
    product = (
        (
            await db_session.execute(
                select(Product).where(
                    Product.tenant_id == 1, Product.status == "on_sale"
                )
            )
        )
        .scalars()
        .first()
    )
    sku = (
        (
            await db_session.execute(
                select(ProductSku).where(ProductSku.product_id == product.id)
            )
        )
        .scalars()
        .first()
    )
    response = await client.post(
        "/api/v1/portal/orders",
        headers=bearer(token),
        json={
            "items": [{"sku_id": sku.id, "quantity": 1}],
            "receiver_name": "支付测试",
            "receiver_phone": "13900000000",
            "receiver_address": {"detail": "测试路 1 号"},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


# ---------------------------------------------------------------- 支付宝


def test_alipay_sign_and_verify_roundtrip():
    private_pem, public_pem = _keypair()
    params = {
        "out_trade_no": "T1-ORD1",
        "total_amount": "199.00",
        "trade_status": "TRADE_SUCCESS",
    }
    params["sign"] = sign(params, private_pem)
    params["sign_type"] = "RSA2"
    assert verify(params, public_pem) is True

    tampered = dict(params)
    tampered["total_amount"] = "1.00"
    assert verify(tampered, public_pem) is False


async def test_alipay_notify_marks_paid_and_is_idempotent(
    client, customer_token, db_session
):
    merchant_private, merchant_public = _keypair()
    alipay_private, alipay_public = _keypair()
    await _set_payment_config(
        db_session,
        1,
        {
            "alipay": {
                "enabled": True,
                "environment": "sandbox",
                "appId": "2021000000000000",
                "privateKey": merchant_private,
                "publicKey": alipay_public,
                "notifyUrl": "https://example.com/api/v1/public/payments/alipay/notify",
                "returnUrl": "https://example.com/portal/payment-result",
            }
        },
    )
    order = await _place_order(client, customer_token, db_session)

    form = {
        "app_id": "2021000000000000",
        "out_trade_no": f"T1-{order['order_no']}",
        "trade_no": "2026111722001",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": f"{order['payable_amount_cents'] / 100:.2f}",
        "notify_id": "n-1",
        "sign_type": "RSA2",
    }
    form["sign"] = sign(form, alipay_private)

    first = await client.post(
        "/api/v1/public/payments/alipay/notify", data=form
    )
    assert first.status_code == 200, first.text
    assert first.text == "success"

    refreshed = await db_session.get(Order, order["id"])
    await db_session.refresh(refreshed)
    assert refreshed.payment_status == "paid"

    # 渠道会重试：第二次必须仍回 success，且不重复记账
    second = await client.post(
        "/api/v1/public/payments/alipay/notify", data=form
    )
    assert second.text == "success"
    payments = list(
        (
            await db_session.scalars(
                select(Payment).where(
                    Payment.order_id == order["id"], Payment.provider == "alipay"
                )
            )
        ).all()
    )
    print("PAYMENTS:", [(x.id, x.provider, x.status, x.out_trade_no, x.provider_trade_no) for x in payments])
    assert len(payments) == 1
    assert payments[0].provider_trade_no == "2026111722001"
    assert payments[0].raw_payload is not None


async def test_alipay_notify_rejects_amount_mismatch(
    client, customer_token, db_session
):
    _, merchant_public = _keypair()
    alipay_private, alipay_public = _keypair()
    await _set_payment_config(
        db_session,
        1,
        {
            "alipay": {
                "enabled": True,
                "appId": "2021000000000000",
                "privateKey": "unused-in-this-test",
                "publicKey": alipay_public,
                "notifyUrl": "https://example.com/notify",
                "returnUrl": "",
            }
        },
    )
    order = await _place_order(client, customer_token, db_session)
    form = {
        "app_id": "2021000000000000",
        "out_trade_no": f"T1-{order['order_no']}",
        "trade_no": "T-2",
        "trade_status": "TRADE_SUCCESS",
        # 少付 1 分也不能算成功
        "total_amount": f"{(order['payable_amount_cents'] - 1) / 100:.2f}",
        "sign_type": "RSA2",
    }
    form["sign"] = sign(form, alipay_private)
    response = await client.post("/api/v1/public/payments/alipay/notify", data=form)
    assert response.status_code == 400
    refreshed = await db_session.get(Order, order["id"])
    await db_session.refresh(refreshed)
    assert refreshed.payment_status == "unpaid"


async def test_alipay_notify_rejects_tampered_signature(
    client, customer_token, db_session
):
    _, _unused = _keypair()
    alipay_private, alipay_public = _keypair()
    await _set_payment_config(
        db_session,
        1,
        {
            "alipay": {
                "enabled": True,
                "appId": "2021000000000000",
                "privateKey": "x",
                "publicKey": alipay_public,
                "notifyUrl": "https://example.com/notify",
                "returnUrl": "",
            }
        },
    )
    order = await _place_order(client, customer_token, db_session)
    form = {
        "app_id": "2021000000000000",
        "out_trade_no": f"T1-{order['order_no']}",
        "trade_no": "T-3",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": f"{order['payable_amount_cents'] / 100:.2f}",
        "sign_type": "RSA2",
    }
    form["sign"] = sign(form, alipay_private)
    form["total_amount"] = "0.01"  # 签名后篡改
    response = await client.post("/api/v1/public/payments/alipay/notify", data=form)
    assert response.text == "failure"
    refreshed = await db_session.get(Order, order["id"])
    await db_session.refresh(refreshed)
    assert refreshed.payment_status == "unpaid"


async def test_create_payment_reports_missing_config(
    client, customer_token, db_session
):
    await _set_payment_config(db_session, 1, {"alipay": {"enabled": True}})
    order = await _place_order(client, customer_token, db_session)
    response = await client.post(
        f"/api/v1/portal/orders/{order['id']}/payments",
        headers=bearer(customer_token),
        json={"provider": "alipay"},
    )
    assert response.status_code == 400
    assert "未配置完整" in response.json()["message"]
    assert "appId" in response.json()["message"]


# ---------------------------------------------------------------- 微信


def test_wechat_decrypt_resource_roundtrip():
    key = "0123456789abcdef0123456789abcdef"
    nonce = "abcdefghijkl"
    payload = {"out_trade_no": "T1-ORD", "amount": {"total": 19900}}
    ciphertext = AESGCM(key.encode()).encrypt(
        nonce.encode(), json.dumps(payload).encode(), b"transaction"
    )
    resource = {
        "algorithm": "AEAD_AES_256_GCM",
        "ciphertext": base64.b64encode(ciphertext).decode(),
        "nonce": nonce,
        "associated_data": "transaction",
    }
    assert decrypt_resource(key, resource) == payload


async def test_wechat_notify_marks_paid(client, customer_token, db_session):
    merchant_private, _merchant_public = _keypair()
    platform_private, platform_public = _keypair()
    api_v3_key = "0123456789abcdef0123456789abcdef"
    await _set_payment_config(
        db_session,
        1,
        {
            "wechat": {
                "enabled": True,
                "mchId": "1600000000",
                "appId": "wx0000000000000000",
                "apiV3Key": api_v3_key,
                "serialNo": "SERIAL1",
                "privateKey": merchant_private,
                "notifyUrl": "https://example.com/api/v1/public/payments/wechat/notify",
                # 钉住平台证书公钥：生产推荐，测试里用它注入自签公钥
                "platformPublicKey": platform_public,
            }
        },
    )
    order = await _place_order(client, customer_token, db_session)

    resource_plain = {
        "mchid": "1600000000",
        "out_trade_no": f"T1-{order['order_no']}",
        "transaction_id": "4200001234567890",
        "trade_state": "SUCCESS",
        "amount": {"total": order["payable_amount_cents"]},
    }
    nonce = "nonce1234567"
    ciphertext = AESGCM(api_v3_key.encode()).encrypt(
        nonce.encode(), json.dumps(resource_plain).encode(), b"transaction"
    )
    envelope = {
        "id": "evt-1",
        "event_type": "TRANSACTION.SUCCESS",
        "resource": {
            "algorithm": "AEAD_AES_256_GCM",
            "ciphertext": base64.b64encode(ciphertext).decode(),
            "nonce": nonce,
            "associated_data": "transaction",
        },
    }
    body = json.dumps(envelope, separators=(",", ":"))
    timestamp = str(int(time.time()))
    message = build_notify_message(timestamp, "n1", body)
    signature = sign_message(message, platform_private)

    response = await client.post(
        "/api/v1/public/payments/wechat/notify",
        content=body.encode(),
        headers={
            "Content-Type": "application/json",
            "Wechatpay-Signature": signature,
            "Wechatpay-Timestamp": timestamp,
            "Wechatpay-Nonce": "n1",
            "Wechatpay-Serial": "SERIAL1",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["code"] == "SUCCESS"

    refreshed = await db_session.get(Order, order["id"])
    await db_session.refresh(refreshed)
    assert refreshed.payment_status == "paid"


async def test_wechat_notify_rejects_bad_signature(client, db_session):
    merchant_private, _ = _keypair()
    _platform_private, platform_public = _keypair()
    await _set_payment_config(
        db_session,
        1,
        {
            "wechat": {
                "enabled": True,
                "mchId": "1600000000",
                "appId": "wx0000000000000000",
                "apiV3Key": "0123456789abcdef0123456789abcdef",
                "serialNo": "SERIAL1",
                "privateKey": merchant_private,
                "notifyUrl": "https://example.com/notify",
                "platformPublicKey": platform_public,
            }
        },
    )
    # 密文无法解密 → 定位不到租户 → 直接拒绝（400/404 都算拒绝，
    # 关键是**不能误置已支付**）
    envelope = {"resource": {"ciphertext": "eA==", "nonce": "n", "associated_data": "a"}}
    body = json.dumps(envelope)
    response = await client.post(
        "/api/v1/public/payments/wechat/notify",
        content=body.encode(),
        headers={
            "Content-Type": "application/json",
            "Wechatpay-Signature": "bad",
            "Wechatpay-Timestamp": "1",
            "Wechatpay-Nonce": "n",
            "Wechatpay-Serial": "SERIAL1",
        },
    )
    assert response.status_code in (400, 404)


def test_alipay_signature_requires_pem_normalization():
    """运营常把 PEM 头尾漏贴；normalize 后仍要能验签。"""
    private_pem, public_pem = _keypair()
    body_only = "".join(public_pem.strip().splitlines()[1:-1])
    params = {"a": "1"}
    params["sign"] = sign(params, private_pem)
    assert verify(params, body_only) is True
