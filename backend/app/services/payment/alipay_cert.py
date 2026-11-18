"""支付宝证书模式：从证书算 SN、用「支付宝公钥证书」验签。

## 为什么必须支持证书模式

新创建的应用默认就是**公钥证书模式**。此时：
* 请求要带 `app_cert_sn`（应用公钥证书序列号）与 `alipay_root_cert_sn`（根证书序列号）；
* 异步通知的验签公钥来自**支付宝公钥证书**，而不是控制台里那段「支付宝公钥」。

配成公钥模式却按证书模式续签，支付宝直接回 `invalid-signature` —— 这是最常见的坑。

## SN 不让人手填

`app_cert_sn = MD5(cert.issuer + cert.serialNumber)`，根证书是**多张证书**各自算一遍再用 `_` 连接。
手抄必错、而且证书一换就失效；直接从证书内容算，才是"顺藤摸瓜"的做法。
"""

from __future__ import annotations

import hashlib
import re

from cryptography import x509

_PEM_CERT = re.compile(
    r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", re.S
)


def _load_certificates(pem_text: str) -> list[x509.Certificate]:
    """从一个 PEM 文件里取出全部证书（根证书文件通常是多张）。"""
    text = (pem_text or "").strip().replace("\\n", "\n")
    blocks = _PEM_CERT.findall(text)
    if not blocks:
        # 允许用户只贴 base64 主体
        body = "\n".join(
            line for line in text.splitlines() if "-----" not in line and line.strip()
        )
        if not body:
            return []
        chunks = [body[i : i + 64] for i in range(0, len(body), 64)]
        blocks = [
            "-----BEGIN CERTIFICATE-----\n" + "\n".join(chunks) + "\n-----END CERTIFICATE-----"
        ]
    return [x509.load_pem_x509_certificate(block.encode()) for block in blocks]


def certificate_sn(cert: x509.Certificate) -> str:
    """支付宝的 SN 算法：MD5(issuer 字符串 + 序列号)，小写十六进制。"""
    issuer = cert.issuer.rfc4514_string()
    serial = cert.serial_number
    digest = hashlib.md5(f"{issuer}{serial}".encode()).hexdigest()  # noqa: S324 - 阿里规定的算法
    return digest


def app_cert_sn(app_cert_pem: str) -> str:
    """应用公钥证书（`appCertPublicKey_*.crt`）→ app_cert_sn。"""
    certs = _load_certificates(app_cert_pem)
    if not certs:
        raise ValueError("应用公钥证书解析失败：请粘贴 appCertPublicKey_*.crt 的完整内容")
    return certificate_sn(certs[0])


def root_cert_sn(root_cert_pem: str) -> str:
    """支付宝根证书（`alipayRootCert.crt`，可能多张）→ alipay_root_cert_sn。

    根证书文件里含多张证书时，各算一遍再按 `_` 连接。
    """
    certs = _load_certificates(root_cert_pem)
    if not certs:
        raise ValueError("支付宝根证书解析失败：请粘贴 alipayRootCert.crt 的完整内容")
    return "_".join(certificate_sn(cert) for cert in certs)


def public_key_from_certificate(cert_pem: str) -> str:
    """从「支付宝公钥证书」取出 PEM 公钥，用于回调验签。"""
    certs = _load_certificates(cert_pem)
    if not certs:
        raise ValueError("支付宝公钥证书解析失败：请粘贴 alipayCertPublicKey_RSA2.crt 的完整内容")
    from cryptography.hazmat.primitives import serialization

    return (
        certs[0]
        .public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
