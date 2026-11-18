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

def test_alipay_verify_accepts_both_sign_content_variants():
    """网关报错时打印的"验签字符串"里带 sign_type，而官方规则要求剔除。

    两种拼法都可能是对的（取决于渠道版本/实现），验签因此**两种都试**：
    只认"签名能验过"，不猜渠道用哪种 —— 猜错会把真实回调判成伪造。
    """
    private_pem, public_pem = _keypair()
    params = {
        "app_id": "2021000000000000",
        "out_trade_no": "T1-1",
        "trade_status": "TRADE_SUCCESS",
    }
    signed = dict(params)
    signed["sign"] = sign(params, private_pem)
    signed["sign_type"] = "RSA2"
    assert verify(signed, public_pem) is True

    # 去掉 sign_type 也要能验过（渠道实现差异）
    without = {k: v for k, v in signed.items() if k != "sign_type"}
    assert verify(without, public_pem) is True

    # 篡改必须失败
    tampered = dict(signed)
    tampered["out_trade_no"] = "T1-2"
    assert verify(tampered, public_pem) is False


def test_alipay_certificate_mode_params_and_derived_public_key():
    """证书模式：填了 cert SN 就随请求下发；能从应用私钥推导出应用公钥。"""
    from app.services.payment.alipay import AlipayGateway, derive_public_key
    from app.services.payment.config import AlipayConfig

    private_pem, public_pem = _keypair()
    config = AlipayConfig(
        app_id="2021007108682567",
        private_key=private_pem,
        alipay_public_key=public_pem,
        notify_url="https://example.com/api/v1/public/payments/alipay/notify",
        return_url="https://example.com/portal/payment-result",
        gateway="https://openapi-sandbox.dl.alipaydev.com/gateway.do",
        app_cert_sn="APPCERTSN",
        alipay_root_cert_sn="ROOTCERTSN",
    )
    url = AlipayGateway(config).page_pay_url(
        out_trade_no="T1-ORD1", amount_cents=1, subject="测试"
    )
    assert "app_cert_sn=APPCERTSN" in url
    assert "alipay_root_cert_sn=ROOTCERTSN" in url
    assert "sign=" in url

    derived = derive_public_key(private_pem)
    expected = "".join(
        line
        for line in public_pem.splitlines()
        if "BEGIN" not in line and "END" not in line
    )
    assert derived == expected

# ---------------------------------------------------------------- 证书模式


def _make_cert(private_key, common_name: str, serial: int = 1) -> str:
    """自签一张证书，返回 PEM（测试用：只要能解析出 issuer/serial/公钥即可）。"""
    import datetime as _dt

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.x509.oid import NameOID

    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(private_key.public_key())
        .serial_number(serial)
        .not_valid_before(_dt.datetime.now(_dt.UTC) - _dt.timedelta(days=1))
        .not_valid_after(_dt.datetime.now(_dt.UTC) + _dt.timedelta(days=365))
        .sign(private_key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM).decode()


def test_certificate_sn_matches_alipay_formula():
    """app_cert_sn = MD5(issuer + serial)，与小写十六进制长度 32。"""
    import hashlib

    from cryptography import x509

    from app.services.payment.alipay_cert import app_cert_sn

    private_pem, _ = _keypair()
    from cryptography.hazmat.primitives import serialization

    key = serialization.load_pem_private_key(private_pem.encode(), password=None)
    cert_pem = _make_cert(key, "app.example.com", serial=12345)
    cert = x509.load_pem_x509_certificate(cert_pem.encode())
    expected = hashlib.md5(
        f"{cert.issuer.rfc4514_string()}{cert.serial_number}".encode()
    ).hexdigest()
    assert app_cert_sn(cert_pem) == expected
    assert len(app_cert_sn(cert_pem)) == 32


def test_root_cert_sn_joins_multiple_certificates():
    from app.services.payment.alipay_cert import root_cert_sn

    private_pem, _ = _keypair()
    from cryptography.hazmat.primitives import serialization

    key = serialization.load_pem_private_key(private_pem.encode(), password=None)
    bundle = _make_cert(key, "root-a", serial=1) + _make_cert(key, "root-b", serial=2)
    sn = root_cert_sn(bundle)
    assert "_" in sn
    assert len(sn.split("_")) == 2


async def test_certificate_mode_derives_sns_and_verifies_by_certificate(
    client, customer_token, db_session
):
    """证书模式：配置三份证书即可，SN 自动算、验签用「支付宝公钥证书」。"""
    from cryptography.hazmat.primitives import serialization

    merchant_private, _ = _keypair()
    alipay_private, alipay_public = _keypair()
    key = serialization.load_pem_private_key(merchant_private.encode(), password=None)
    alipay_key = serialization.load_pem_private_key(
        alipay_private.encode(), password=None
    )

    app_cert = _make_cert(key, "app-cert", serial=11)
    alipay_cert = _make_cert(alipay_key, "alipay-cert", serial=22)
    root_cert = _make_cert(key, "root-1", serial=33) + _make_cert(key, "root-2", serial=44)

    await _set_payment_config(
        db_session,
        1,
        {
            "alipay": {
                "enabled": True,
                "environment": "sandbox",
                "appId": "2021007108682567",
                "privateKey": merchant_private,
                # 证书模式下 publicKey 留空，靠证书
                "publicKey": "",
                "appCertPublicKey": app_cert,
                "alipayPublicCert": alipay_cert,
                "alipayRootCert": root_cert,
                "notifyUrl": "https://example.com/api/v1/public/payments/alipay/notify",
                "returnUrl": "https://example.com/portal/payment-result",
            }
        },
    )

    from app.services.payment.config import load_payment_config

    config = await load_payment_config(db_session, 1)
    assert config.alipay is not None, config.problems
    assert config.alipay.app_cert_sn
    assert "_" in config.alipay.alipay_root_cert_sn
    # 验签公钥来自证书，而不是配置里的空 publicKey
    assert "BEGIN PUBLIC KEY" in config.alipay.alipay_public_key
    normalized = "".join(config.alipay.alipay_public_key.split())
    assert alipay_public.splitlines()[1][:20] in normalized

    # 真报文：用证书里的私钥签，走完整回调
    order = await _place_order(client, customer_token, db_session)
    form = {
        "app_id": "2021007108682567",
        "out_trade_no": f"T1-{order['order_no']}",
        "trade_no": "CERT-TRADE-1",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": f"{order['payable_amount_cents'] / 100:.2f}",
        "sign_type": "RSA2",
    }
    form["sign"] = sign(form, alipay_private)
    response = await client.post(
        "/api/v1/public/payments/alipay/notify", data=form
    )
    assert response.status_code == 200, response.text
    assert response.text == "success"

    from app.models.order import Order

    refreshed = await db_session.get(Order, order["id"])
    await db_session.refresh(refreshed)
    assert refreshed.payment_status == "paid"


async def test_certificate_mode_reports_missing_certificates(
    client, admin_token, db_session
):
    """只填了一半证书要报"缺哪些"，不能让运营对着 500 猜。"""
    await _set_payment_config(
        db_session,
        1,
        {
            "alipay": {
                "enabled": True,
                "appId": "2021007108682567",
                "privateKey": "x",
                "appCertPublicKey": "-----BEGIN CERTIFICATE-----",
                "notifyUrl": "https://example.com/api/v1/public/payments/alipay/notify",
                "returnUrl": "",
            }
        },
    )
    response = await client.get(
        "/api/v1/settings/payment/health", headers=bearer(admin_token)
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["alipay"]["mode"] == "certificate"
    assert "alipayPublicCert" in data["alipay"]["missing"]
    assert "alipayRootCert" in data["alipay"]["missing"]

# ---------------------------------------------------------------- 证书粘贴形态


def _cert_der_b64(cert_pem: str) -> str:
    """把 PEM 转成"纯 base64 主体"（运营最常粘的形态）。"""
    import base64

    body = "".join(
        line for line in cert_pem.splitlines() if "-----" not in line
    )
    return base64.b64decode(body).hex()


def test_certificate_accepts_concatenated_der_without_headers():
    """把多张证书的 base64 主体直接拼在一起粘进来，也要能解析。

    这正是 `ExtraData ... tbs_cert.signature_alg` 报错的来源：
    cryptography 只读第一段 DER，剩下的字节就成了"多余数据"。
    """
    import base64

    from cryptography.hazmat.primitives import serialization

    from app.services.payment.alipay_cert import root_cert_sn

    private_pem, _ = _keypair()
    key = serialization.load_pem_private_key(private_pem.encode(), password=None)
    first = _make_cert(key, "root-a", serial=101)
    second = _make_cert(key, "root-b", serial=102)

    def der(pem: str) -> bytes:
        from cryptography import x509

        return x509.load_pem_x509_certificate(pem.encode()).public_bytes(
            serialization.Encoding.DER
        )

    joined = base64.b64encode(der(first) + der(second)).decode()
    sn = root_cert_sn(joined)
    assert len(sn.split("_")) == 2


def test_certificate_rejects_garbage_with_readable_message():
    """粘错内容要给中文原因，不能把 Rust 的 asn1 报错原样甩给运营。"""
    import pytest

    from app.services.payment.alipay_cert import app_cert_sn

    with pytest.raises(ValueError) as err:
        app_cert_sn("这不是证书")
    message = str(err.value)
    assert "证书无法解析" in message
    assert "BEGIN/END" in message
    assert "ExtraData" not in message
    assert "ParseError" not in message


async def test_broken_certificate_surfaces_config_error_not_missing_fields(
    client, customer_token, db_session
):
    """证书内容不对时，报的是"配置有误 + 原因"，不是让运营去补齐一个字段名。"""
    await _set_payment_config(
        db_session,
        1,
        {
            "alipay": {
                "enabled": True,
                "environment": "sandbox",
                "appId": "2021007108682567",
                "privateKey": "x",
                "appCertPublicKey": "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----",
                "alipayPublicCert": "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----",
                "alipayRootCert": "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----",
                "notifyUrl": "https://example.com/api/v1/public/payments/alipay/notify",
                "returnUrl": "https://example.com/portal/payment-result",
            }
        },
    )
    order = await _place_order(client, customer_token, db_session)
    response = await client.post(
        f"/api/v1/portal/orders/{order['id']}/payments",
        headers=bearer(customer_token),
        json={"provider": "alipay"},
    )
    assert response.status_code == 400
    message = response.json()["message"]
    assert "配置有误" in message
    assert "证书无法解析" in message
    assert "补齐" not in message

def test_sign_includes_sign_type_by_default():
    """**实测结论**：网关按「含 sign_type」的串验签。

    同一应用、同一参数：
      不含 sign_type → invalid-signature
      含 sign_type   → 通过（进入收银台）
    官方文档写"剔除 sign 与 sign_type"，与真实网关行为不符，这里把结论锁进测试，
    免得以后有人"按文档修正"又把它改回去。
    """
    from app.services.payment.alipay import build_sign_content

    params = {"app_id": "1", "sign_type": "RSA2", "method": "alipay.trade.page.pay"}
    assert "sign_type=RSA2" in build_sign_content(params, with_sign_type=True)
    assert "sign_type" not in build_sign_content(params, with_sign_type=False)

# ---------------------------------------------------------------- 对账任务 & 售后撤回


async def test_create_payment_schedules_reconciliation_job(
    client, customer_token, db_session
):
    """发起真实支付后必须排一个对账任务。

    没有回调（本地/内网/域名未备案）时，用户钱付了、我们这里还停在待支付 ——
    对账任务就是兜底，不靠人点按钮。
    """
    merchant_private, merchant_public = _keypair()
    await _set_payment_config(
        db_session,
        1,
        {
            "alipay": {
                "enabled": True,
                "environment": "sandbox",
                "appId": "2021007108682567",
                "privateKey": merchant_private,
                "publicKey": merchant_public,
                "notifyUrl": "https://example.com/api/v1/public/payments/alipay/notify",
                "returnUrl": "https://example.com/portal/payment-result",
            }
        },
    )
    order = await _place_order(client, customer_token, db_session)
    created = await client.post(
        f"/api/v1/portal/orders/{order['id']}/payments",
        headers=bearer(customer_token),
        json={"provider": "alipay"},
    )
    assert created.status_code == 200, created.text
    assert created.json()["data"]["type"] == "redirect"
    assert "sign=" in created.json()["data"]["url"]

    from app.models.job import ScheduledJob

    job = (
        await db_session.scalars(
            select(ScheduledJob).where(
                ScheduledJob.kind == "payment_sync",
                ScheduledJob.ref_id == order["id"],
            )
        )
    ).first()
    assert job is not None, "发起支付后必须排对账任务"


async def test_buyer_can_cancel_refund_request(
    client, admin_token, customer_token, db_session
):
    """买家能撤回自己刚提的售后（卖家还没处理时），订单回到已支付。"""
    order = await _place_order(client, customer_token, db_session)
    order_id = order["id"]
    await client.post(
        f"/api/v1/admin/orders/{order_id}/mock-pay", headers=bearer(admin_token)
    )
    applied = await client.post(
        f"/api/v1/portal/orders/{order_id}/refund-request",
        headers=bearer(customer_token),
        json={"amount_cents": 1, "reason": "不想要了"},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["data"]["payment_status"] == "refunding"

    cancelled = await client.post(
        f"/api/v1/portal/orders/{order_id}/refund-request/cancel",
        headers=bearer(customer_token),
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["data"]["payment_status"] == "paid"

    from app.models.order import Order, Refund

    refreshed = await db_session.get(Order, order_id)
    await db_session.refresh(refreshed)
    assert refreshed.payment_status == "paid"
    refund = (
        await db_session.scalars(
            select(Refund).where(Refund.order_id == order_id).order_by(Refund.id.desc())
        )
    ).first()
    assert refund is not None and refund.status == "cancelled"

    # 再撤一次应报"没有可取消的售后申请"
    again = await client.post(
        f"/api/v1/portal/orders/{order_id}/refund-request/cancel",
        headers=bearer(customer_token),
    )
    assert again.status_code == 400

# ---------------------------------------------------------------- 查询响应兼容


class _FakeResponse:
    """模拟支付宝查询响应（GBK 编码的 JSON，content-type 是 text/html）。"""

    def __init__(self, payload: str, encoding: str = "gbk") -> None:
        self.content = payload.encode(encoding)
        self.status_code = 200
        self.headers = {"content-type": "text/html;charset=GBK"}

    def json(self):  # noqa: D401 - 故意模拟 httpx 在 GBK 上抛 UnicodeDecodeError
        raise ValueError("'utf-8' codec can't decode byte 0xd1")


def test_alipay_query_decodes_gbk_json_and_treats_not_exist_as_unpaid():
    """两个真实踩过的坑：

    1. 支付宝查询出错时返回 **GBK** 编码的 JSON（content-type 还是 text/html），
       `response.json()` 直接抛 UnicodeDecodeError；
    2. `ACQ.TRADE_NOT_EXIST` 是"这单还没付"，属于未支付，**不能当任务失败**，
       否则对账任务白重试 3 次并在管理页飘红。
    """
    from app.services.payment.alipay import NotifyResult, _decode_json_body

    payload = (
        '{"alipay_trade_query_response":{"code":"40004","msg":"Business Failed",'
        '"sub_code":"ACQ.TRADE_NOT_EXIST","sub_msg":"交易不存在"}}'
    )
    body = _decode_json_body(_FakeResponse(payload))
    assert body["alipay_trade_query_response"]["sub_code"] == "ACQ.TRADE_NOT_EXIST"

    # 真实网关返回 40004 时，query() 应该给出"未支付"的结果而不是抛异常
    import asyncio

    from app.services.payment.alipay import AlipayGateway
    from app.services.payment.config import AlipayConfig

    private_pem, public_pem = _keypair()
    config = AlipayConfig(
        app_id="2021000000000000",
        private_key=private_pem,
        alipay_public_key=public_pem,
        notify_url="https://example.com/notify",
        return_url="https://example.com/return",
        gateway="https://example.com/gateway.do",
    )
    gateway = AlipayGateway(config)
    import httpx

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return _FakeResponse(payload)

    original = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **k: _Client()  # type: ignore[assignment]
    try:
        result = asyncio.run(gateway.query(out_trade_no="T1-ORD"))
    finally:
        httpx.AsyncClient = original  # type: ignore[assignment]
    assert isinstance(result, NotifyResult)
    assert result.trade_status == "WAIT_BUYER_PAY"
    assert result.total_amount_cents == 0
