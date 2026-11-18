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


_PEM_CERT_BLOCK = re.compile(
    r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", re.S
)

#: RSA 签名算法 OID 前缀（sha1WithRSA / sha256WithRSA / sha384 / sha512 …）
_RSA_SIG_OID_PREFIX = "1.2.840.113549.1.1"

_OID_TO_NAME = {
    "2.5.4.3": "CN",
    "2.5.4.11": "OU",
    "2.5.4.10": "O",
    "2.5.4.6": "C",
    "2.5.4.7": "L",
    "2.5.4.8": "ST",
    "2.5.4.5": "SERIALNUMBER",
    "1.2.840.113549.1.9.1": "emailAddress",
}


def _friendly(reason: str) -> ValueError:
    """把底层解析器的报错翻译成运营看得懂的话。"""
    return ValueError(
        f"证书无法解析（{reason}）。请粘贴证书文件 .crt 的完整内容；"
        "根证书含多张证书时要整段粘贴（保留每张的 BEGIN/END 行）"
    )


def _split_der_sequences(data: bytes) -> list[bytes]:
    """把「多张 DER 证书首尾相接」的字节切成单张（按 ASN.1 DER 长度头）。"""
    blocks: list[bytes] = []
    offset = 0
    while offset < len(data):
        if data[offset] != 0x30:  # SEQUENCE
            break
        if offset + 2 > len(data):
            break
        first = data[offset + 1]
        if first < 0x80:
            length = first
            header_end = offset + 2
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
    return blocks if offset == len(data) and len(blocks) > 1 else []


def _decode_base64_blob(body: str) -> bytes:
    """解「多张证书 base64 首尾相接」的主体。

    每张证书的 base64 各自带 `=` 填充，直接整体解码会报
    `Excess data after padding`（或只解出第一张）。
    按 4 字符一组扫描，遇到含 `=` 的组就切一刀。
    """
    import base64

    groups = [body[i : i + 4] for i in range(0, len(body), 4)]
    ders: list[bytes] = []
    current: list[str] = []
    for group in groups:
        current.append(group)
        if "=" in group:
            try:
                ders.append(base64.b64decode("".join(current)))
            except Exception as exc:  # noqa: BLE001
                raise _friendly("base64 内容不合法") from exc
            current = []
    if current:
        try:
            ders.append(base64.b64decode("".join(current), validate=False))
        except Exception as exc:  # noqa: BLE001
            raise _friendly("base64 内容不合法") from exc
    if not ders:
        raise _friendly("没有可解析的证书内容")
    return b"".join(ders)


def _pem_blocks(text: str) -> list[str]:
    """把粘贴内容切成 PEM 块。

    支持：PEM（单/多张） → 纯 base64 主体（单张或多张 DER 首尾相接）→ PKCS#7。
    根证书文件常见"多张 + 无头 base64"，少一种就会报看不懂的 asn1 错误。
    """
    import base64

    text = (text or "").strip().replace("\\n", "\n")
    blocks = _PEM_CERT_BLOCK.findall(text)
    if blocks:
        return [block.replace("\r\n", "\n") for block in blocks]

    body = "".join(
        line.strip() for line in text.splitlines() if "-----" not in line and line.strip()
    )
    if not body:
        return []
    parts = _split_der_sequences(_decode_base64_blob(body))
    return [
        "-----BEGIN CERTIFICATE-----\n"
        + "\n".join(
            base64.b64encode(part).decode()[i : i + 64]
            for i in range(0, len(base64.b64encode(part).decode()), 64)
        )
        + "\n-----END CERTIFICATE-----"
        for part in parts
    ]


def _der_of(pem_block: str) -> bytes:
    import base64

    body = "".join(line for line in pem_block.splitlines() if "-----" not in line)
    return base64.b64decode(body)


def _asn1_certificate(pem_block: str):
    """纯 ASN.1 解析（能读国密/EC 证书，cryptography 读不了）。

    解析失败一律翻译成运营看得懂的话，不要把 asn1crypto 的英文堆栈甩出去。
    """
    from asn1crypto import x509 as asn1x509

    try:
        return asn1x509.Certificate.load(_der_of(pem_block))
    except Exception as exc:  # noqa: BLE001
        raise _friendly(f"证书内容不完整或被改写过（{type(exc).__name__}）") from exc


def _issuer_string(name) -> str:
    """RFC4514 渲染，与 cryptography 的 `rfc4514_string()` 逐字一致（已对真实证书比对过）。"""
    parts = []
    for rdn in reversed(name.chosen):
        for attr in rdn:
            oid = attr["type"].dotted
            parts.append(f"{_OID_TO_NAME.get(oid, oid)}={attr['value'].native}")
    return ",".join(parts)


def _certificate_sn(pem_block: str) -> str:
    """MD5(issuer + serial)，小写十六进制 —— 与支付宝 SDK 的算法一致。

    用纯 ASN.1 解析而不是 cryptography：根证书里的国密（SM2）证书
    cryptography 读不了，但它的 issuer/serial 用 asn1crypto 完全能读。
    """
    cert = _asn1_certificate(pem_block)
    tbs = cert["tbs_certificate"]
    text = f"{_issuer_string(tbs['issuer'])}{tbs['serial_number'].native}"
    return hashlib.md5(text.encode()).hexdigest()  # noqa: S324 - 支付宝规定的算法


def is_rsa_signed(pem_block: str) -> bool:
    cert = _asn1_certificate(pem_block)
    oid = cert["signature_algorithm"]["algorithm"].dotted
    return oid.startswith(_RSA_SIG_OID_PREFIX)


def certificate_sn(pem_block: str) -> str:
    """给单张证书（PEM 块）算 SN —— 供外部按需使用。"""
    return _certificate_sn(pem_block)


def app_cert_sn(app_cert_pem: str) -> str:
    """应用公钥证书（`appCertPublicKey_*.crt`）→ app_cert_sn。"""
    blocks = _pem_blocks(app_cert_pem)
    if not blocks:
        raise _friendly("应用公钥证书为空")
    return _certificate_sn(blocks[0])


def root_cert_sn(root_cert_pem: str) -> str:
    """支付宝根证书（多张）→ alipay_root_cert_sn。

    **只算 RSA 签名的证书**：支付宝根证书文件里混有 SM2 国密证书，
    支付宝 SDK 计算时按签名算法过滤，国密那张不参与拼接。
    """
    blocks = _pem_blocks(root_cert_pem)
    if not blocks:
        raise _friendly("支付宝根证书为空")
    sns = [
        _certificate_sn(block) for block in blocks if _safe_is_rsa(block)
    ]
    if not sns:
        raise _friendly("根证书里没有可用的 RSA 证书")
    return "_".join(sns)


def _safe_is_rsa(pem_block: str) -> bool:
    try:
        return is_rsa_signed(pem_block)
    except Exception:  # noqa: BLE001 - 连 ASN.1 都读不了说明这一块是坏的
        return False


def public_key_from_certificate(cert_pem: str) -> str:
    """从「支付宝公钥证书」取出 PEM 公钥，用于回调验签。

    文件里可能不止一张（通常第一张是支付宝业务证书，后面跟中间 CA），取第一张。
    """
    from cryptography import x509
    from cryptography.hazmat.primitives import serialization

    blocks = _pem_blocks(cert_pem)
    if not blocks:
        raise _friendly("支付宝公钥证书为空")
    for block in blocks:
        try:
            cert = x509.load_pem_x509_certificate(block.encode())
        except Exception:  # noqa: BLE001 - 遇到非 RSA 证书就跳过，继续找可用的
            continue
        return (
            cert.public_key()
            .public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            .decode()
        )
    raise _friendly("支付宝公钥证书里没有可用的 RSA 证书")
