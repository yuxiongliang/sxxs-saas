"""评价内容的自动审核 —— **当前为预留接口，未接入大模型**。

产品口径（2026-11 定）：**先发后审**。
评价落库即 `status='visible'` 立即可见；本模块只负责给出一个「审核结论」
写进 `moderation_status`，**永远不参与可见性判断**，也不会阻塞买家发布。

接入真实模型时**只改 `evaluate_review` 的实现**，调用方（`services/reviews.create_review`）
和前端筛选都无需改动：

```python
async def evaluate_review(...) -> Verdict:
    ...调用平台侧配置的模型接口...
```

平台端 `/settings` 里的「评论审核」开关现在是 **空转**：打开只代表
「接口已就绪」，不代表内容真的被模型看过 —— UI 上必须这么写，不能伪装成可用。
"""

from __future__ import annotations

import structlog
from pydantic import BaseModel

logger = structlog.get_logger(__name__)

# 与 ProductReview.moderation_status 的取值一一对应
ACTION_PASS = "passed"
ACTION_FLAG = "flagged"
ACTION_BLOCK = "blocked"
ACTION_SKIPPED = "skipped"


class Verdict(BaseModel):
    """审核结论。`action` 直接写进 `product_reviews.moderation_status`。"""

    action: str = ACTION_SKIPPED
    reason: str = ""
    provider: str = "stub"


async def evaluate_review(
    *, content: str | None, rating: int, tenant_id: int
) -> Verdict:
    """对一条评价做自动审核。

    当前实现：**空转**，一律返回 skipped。
    刻意不做「关键词黑名单」之类的本地假审核 —— 那会让人误以为已经有审核能力，
    反而掩盖「还没接模型」这个事实。
    """
    logger.debug(
        "review_moderation.stub",
        tenant_id=tenant_id,
        rating=rating,
        content_length=len(content or ""),
    )
    return Verdict(action=ACTION_SKIPPED, reason="未接入审核模型（接口预留）", provider="stub")
