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


def _split_der_sequences(data: bytes) -> list[bytes]:
    """把「多张 DER 证书首尾相接」的字节切成单张。

    支付宝根证书常见这种情况：把 .crt 的 base64 主体直接粘过来（不带 BEGIN/END），
    里面其实是好几张 DER 连在一起 —— cryptography 只会读第一张，然后报
    `ExtraData ... tbs_cert.signature_alg`（就是用户看到的那条）。
    这里按 ASN.1 DER 的长度头逐段切开。
    """
    blocks: list[bytes] = []
    offset = 0
    while offset < len(data):
        if data[offset] != 0x30:  # SEQUENCE
            break
        header_end = offset + 2
        if header_end > len(data):
            break
        first = data[offset + 1]
        if first < 0x80:
            length = first
        else:
            length_bytes = first & 0x7F
            if length_bytes == 0 or offset + 2 + length_bytes > len(data):
                break
            length = int.from_bytes(data[offset + 2 : offset + 2 + length_bytes], "big")
            header_end = offset + 2 + length_bytes
        total = header_end + length
        if total > len(data):
            break
        blocks.append(data[offset:total])
        offset = total
    return blocks if offset == len(data) and blocks else []


def _friendly(reason: str) -> ValueError:
    return ValueError(
        "证书无法解析（"
        + reason
        + "）。请确认粘贴的是证书文件 .crt 的完整内容；"
        "根证书含多张证书时要整段粘贴（保留每张的 BEGIN/END 行），"
        "不要只贴 base64 主体、也不要贴私钥或 .p7b 之外的其他文件"
    )


def _parse_pem_block(block: str) -> x509.Certificate:
    try:
        return x509.load_pem_x509_certificate(block.encode())
    except Exception as exc:  # noqa: BLE001 - 解析失败一律转成可读原因
        raise _friendly(f"PEM 内容不完整或被改写过：{type(exc).__name__}") from exc


def _load_certificates(pem_text: str) -> list[x509.Certificate]:
    """从粘贴内容里取出全部证书。

    依次尝试：PEM（单张/多张） → 纯 base64 单张 → 多张 DER 首尾相接 → PKCS#7 (.p7b)。
    这是运营真实会粘进来的四种形态，少一种就会把配置错误显示成"看不懂的报错"。
    """
    import base64

    text = (pem_text or "").strip().replace("\\n", "\n")
    blocks = _PEM_CERT.findall(text)
    if blocks:
        return [_parse_pem_block(block) for block in blocks]

    body = "".join(
        line.strip() for line in text.splitlines() if "-----" not in line and line.strip()
    )
    if not body:
        return []
    try:
        der = base64.b64decode(body, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise _friendly("既不是 PEM，也不是合法 base64") from exc

    # 1) 单张 DER
    try:
        return [x509.load_der_x509_certificate(der)]
    except Exception:  # noqa: BLE001 - 失败后继续尝试其他形态
        pass

    # 2) 多张 DER 首尾相接（用户看到的那条 ExtraData 报错就是这种）
    parts = _split_der_sequences(der)
    if len(parts) > 1:
        certs: list[x509.Certificate] = []
        for part in parts:
            try:
                certs.append(x509.load_der_x509_certificate(part))
            except Exception as exc:  # noqa: BLE001
                raise _friendly("多张证书拼接里有一段不是合法证书") from exc
        return certs

    # 3) PKCS#7（.p7b）
    try:
        from cryptography.hazmat.primitives.serialization import pkcs7

        certs = pkcs7.load_der_pkcs7_certificates(der)
        if certs:
            return list(certs)
    except Exception:  # noqa: BLE001
        pass

    raise _friendly("内容不是 X.509 证书（可能是私钥、CSR 或被截断的文件）")


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
