"""富文本：服务端清洗 + 纯文本抽取 + 体积校验。

**安全边界在这里**：卖家/运营写的富文本会被**匿名买家**看到，租户还能绑自己的域名，
所以一律「先用 nh3（Rust ammonia）白名单清洗，再落库」，渲染端只认清洗后的 HTML。

三条铁律：

1. 只放行固定标签/属性/`style` 子集；`script`/`iframe`/`on*`/`class`/`id` 一律剥掉。
2. 图片 `src` **只允许站内公开直链** `/api/v1/attachments/public/` —— 否则等于开放任意外链图片。
3. 链接只允许 http(s)，并强制补 `rel="noopener noreferrer nofollow"`。

`bleach` 已停止维护，这里用 `nh3`。
"""

from __future__ import annotations

import json
import re

from fastapi import HTTPException

# 富文本 doc 的体积上限（JSON 字符数）。商品描述不是文档系统，256KB 足够，
# 超过这个量级基本是粘贴了整篇 HTML 或恶意撑库。
MAX_DOC_BYTES = 256 * 1024
MAX_HTML_CHARS = 400_000

PUBLIC_ATTACHMENT_PREFIX = "/api/v1/attachments/public/"

# ---- 允许的标签（Tiptap 全量能力的对应集合）----
ALLOWED_TAGS: set[str] = {
    "p",
    "br",
    "hr",
    "span",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "del",
    "sub",
    "sup",
    "code",
    "pre",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    # 表格
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "colgroup",
    "col",
    "caption",
    # 任务清单
    "input",
}

ALLOWED_ATTRIBUTES: dict[str, set[str]] = {
    "*": {"style", "class"},
    # 注意：`rel` 不能自己放行 —— nh3 在 `link_rel=` 模式下由它托管，
    # 同时声明会直接报 ValueError
    "a": {"href", "target", "title"},
    "img": {"src", "alt", "title", "width", "height"},
    "ol": {"start", "type"},
    "ul": {"type"},
    "li": {"data-checked", "data-type"},
    "input": {"type", "checked", "disabled"},
    "table": {"colspan", "rowspan", "width"},
    "td": {"colspan", "rowspan", "colwidth", "width"},
    "th": {"colspan", "rowspan", "colwidth", "width"},
    "col": {"width", "span"},
    "code": {"class"},
    "pre": {"class"},
}

# 只放行这几个 style 属性（Tiptap 的对齐 / 颜色 / 字号 / 行高 / 高亮都落在这里）
ALLOWED_STYLE_PROPERTIES: set[str] = {
    "text-align",
    "color",
    "background-color",
    "font-size",
    "font-family",
    "line-height",
}

ALLOWED_URL_SCHEMES: set[str] = {"http", "https"}


def _validate_doc(doc: object) -> dict:
    """校验 doc 是合法的 ProseMirror 文档，并卡体积。"""
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        raise HTTPException(status_code=400, detail="富文本内容格式不正确")
    try:
        raw = json.dumps(doc, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="富文本内容无法序列化") from exc
    if len(raw.encode("utf-8")) > MAX_DOC_BYTES:
        raise HTTPException(status_code=400, detail="富文本内容过大（上限 256KB）")
    return doc


def sanitize_html(html: str | None) -> str | None:
    """白名单清洗。空内容归一成 None。"""
    import nh3

    if html is None:
        return None
    source = html.strip()
    if not source:
        return None
    if len(source) > MAX_HTML_CHARS:
        raise HTTPException(status_code=400, detail="富文本内容过大")

    # nh3 的 link_rel 会自动给 <a> 补 rel，避免 target=_blank 的 opener 泄漏
    cleaned = nh3.clean(
        source,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        url_schemes=ALLOWED_URL_SCHEMES,
        link_rel="noopener noreferrer nofollow",
        strip_comments=True,
        # ★ 必须显式限死 style 子集：只放行 attributes 里的 `style` 而不限属性名，
        #   等于允许 `position:fixed` / `background:url(...)` 这类 CSS 注入。
        filter_style_properties=ALLOWED_STYLE_PROPERTIES,
    )
    cleaned = _enforce_internal_images(cleaned)
    return cleaned.strip() or None


_IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc\s*=\s*")([^"]*)(")', re.IGNORECASE)


def _enforce_internal_images(html: str) -> str:
    """图片只允许站内公开直链；外链去掉整张图（不留破图占位）。"""

    def _replace(match: re.Match[str]) -> str:
        src = match.group(2).strip()
        if src.startswith(PUBLIC_ATTACHMENT_PREFIX):
            return f"{match.group(1)}{src}{match.group(3)}"
        return match.group(1) + "" + match.group(3)

    cleaned = _IMG_SRC_RE.sub(_replace, html)
    # src 被清空的 img 标签没意义，整条删掉
    return re.sub(r"<img\b[^>]*\bsrc\s*=\s*\"\"[^>]*>", "", cleaned)


_TAG_RE = re.compile(r"<[^>]+>")
_BLOCK_RE = re.compile(r"</(p|div|h[1-6]|li|tr|blockquote|pre)>", re.IGNORECASE)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)


def extract_text(html: str | None) -> str | None:
    """从清洗后的 HTML 抽出纯文本，只给搜索用。

    块级结束补换行、`<br>` 补换行，避免「两段黏成一个词」导致搜索命中率下降。
    """
    if not html:
        return None
    text = _BR_RE.sub("\n", html)
    text = _BLOCK_RE.sub("\n", text)
    text = _TAG_RE.sub("", text)
    # 反转义最常见的几个实体
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or None


def prepare_payload(doc: object | None, html: str | None) -> tuple[dict | None, str | None, str | None]:
    """校验 doc → 清洗 html → 抽纯文本。返回 (doc, html, text)。"""
    if doc is None and not html:
        return None, None, None
    validated = _validate_doc(doc) if doc is not None else None
    cleaned = sanitize_html(html)
    return validated, cleaned, extract_text(cleaned)


def summarize(value: object, limit: int = 200) -> str:
    """审计里记摘要，不把整份富文本灌进审计表。"""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else f"{text[:limit]}…（共 {len(text)} 字符）"


def image_urls(html: str | None) -> list[str]:
    """抽出富文本里引用的图片直链（用于把附件发布成 public）。"""
    if not html:
        return []
    return [
        src.strip()
        for src in re.findall(r'<img\b[^>]*?\bsrc\s*=\s*"([^"]+)"', html, re.IGNORECASE)
        if src.strip().startswith(PUBLIC_ATTACHMENT_PREFIX)
    ]
