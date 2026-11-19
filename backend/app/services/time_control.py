"""时间控制：订单链路上所有「等多久自动做什么」的唯一口径。

租户在「系统设置 → 基础设置 → 时间控制」里按**商品类型**配置四项：

| 字段 | 含义 | 0 / 空 |
| --- | --- | --- |
| `ship_days` | 卖家发货时限（**只提醒，不自动取消**） | 不限 |
| `auto_confirm_days` | 快递发货后多少天自动确认收货 | 不自动确认 |
| `pickup_auto_confirm_days` | 自提发货后多少天自动确认（自提没有物流签收，需要兜底） | 不自动确认 |
| `refund_window_days` | 确认收货后多少天内可申请售后 | 确认后不可申请 |
| `unpaid_close_days` | 待支付订单多少天后自动关闭 | 不自动关闭 |

设计要点：

1. **配置读的是生效值**（`setting_resolver.resolve`），平台「跟随系统 / 锁定」语义天然可用；
2. **缺省回落现行常量**（7 / 90 / 0 / 不关闭 / 不限），所以上线不改任何既有行为；
3. **改配置只影响之后新排的任务**：已产生的订单/任务沿用入队时的快照
   （`orders.expires_at`、`scheduled_jobs.meta`），不会因为改设置让历史倒计时跳变。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import setting_resolver

CATEGORY = "time_control"

#: 已开放的商品类型（与前端 `OPEN_PRODUCT_TYPES` 保持一致；加类型时这里也要加）
PRODUCT_TYPES = ("physical",)

#: 缺省值 = 上线前的硬编码行为（快递 7 天、自提 90 天、不自动关闭、售后仅限未完成）
DEFAULT_CONTROL: dict[str, int] = {
    "ship_days": 0,
    "auto_confirm_days": 7,
    "pickup_auto_confirm_days": 90,
    "refund_window_days": 0,
    "unpaid_close_days": 0,
}

MAX_DAYS = 365

FIELD_LABELS = {
    "ship_days": "卖家发货时限",
    "auto_confirm_days": "快递自动确认收货",
    "pickup_auto_confirm_days": "自提自动确认收货",
    "refund_window_days": "确认收货后可申请售后",
    "unpaid_close_days": "待支付自动关闭",
}


@dataclass(frozen=True)
class TimeControl:
    """某一商品类型生效的时间控制（天数；0 表示"不启用"）。"""

    product_type: str = "physical"
    ship_days: int = 0
    auto_confirm_days: int = 7
    pickup_auto_confirm_days: int = 90
    refund_window_days: int = 0
    unpaid_close_days: int = 0

    def auto_confirm_days_for(self, delivery_method: str | None) -> int:
        """自提单走独立配置：自提没有"物流签收"，时效和快递完全不同。"""
        return (
            self.pickup_auto_confirm_days
            if delivery_method == "pickup"
            else self.auto_confirm_days
        )


def normalize_config(config: dict | None) -> dict[str, dict[str, int]]:
    """校验 + 归一化（保存时用）。

    * 只认已开放的商品类型；
    * 数值必须是 0..365 的整数（空 / null 视为 0）；
    * 未知字段直接拒绝 —— 静默忽略只会让人以为"保存了"。
    """
    if config is None:
        return {}
    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="时间控制配置必须是对象")
    result: dict[str, dict[str, int]] = {}
    for product_type, values in config.items():
        if product_type not in PRODUCT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"未知的商品类型：{product_type}",
            )
        if not isinstance(values, dict):
            raise HTTPException(status_code=400, detail="时间控制配置必须是对象")
        normalized: dict[str, int] = {}
        for key, raw in values.items():
            if key not in DEFAULT_CONTROL:
                raise HTTPException(
                    status_code=400, detail=f"未知的时间控制字段：{key}"
                )
            if raw is None or raw == "":
                days = 0
            else:
                try:
                    days = int(raw)
                except (TypeError, ValueError) as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{FIELD_LABELS.get(key, key)}必须是整数天数",
                    ) from exc
            if days < 0 or days > MAX_DAYS:
                raise HTTPException(
                    status_code=400,
                    detail=f"{FIELD_LABELS.get(key, key)}必须在 0-{MAX_DAYS} 天之间",
                )
            normalized[key] = days
        result[product_type] = {**DEFAULT_CONTROL, **normalized}
    return result


async def resolve(
    db: AsyncSession, tenant_id: int, product_type: str = "physical"
) -> TimeControl:
    """读生效配置。**所有算时间的地方都必须走这里**，别各自读 setting。"""
    config = await setting_resolver.resolve_for_runtime(db, tenant_id, CATEGORY)
    merged = {**DEFAULT_CONTROL, **(config.get(product_type) or {})}
    return TimeControl(
        product_type=product_type,
        ship_days=int(merged["ship_days"] or 0),
        auto_confirm_days=int(merged["auto_confirm_days"] or 0),
        pickup_auto_confirm_days=int(merged["pickup_auto_confirm_days"] or 0),
        refund_window_days=int(merged["refund_window_days"] or 0),
        unpaid_close_days=int(merged["unpaid_close_days"] or 0),
    )


def unpaid_close_deadline(control: TimeControl, created_at: datetime) -> datetime | None:
    """待支付自动关闭的截止时间；0 天 = 不自动关闭。"""
    if control.unpaid_close_days <= 0:
        return None
    return created_at + timedelta(days=control.unpaid_close_days)


def auto_confirm_deadline(control: TimeControl, shipped_at: datetime, delivery_method: str | None) -> datetime | None:
    """自动确认收货时间；0 天 = 不自动确认。"""
    days = control.auto_confirm_days_for(delivery_method)
    if days <= 0:
        return None
    return shipped_at + timedelta(days=days)


def refund_deadline(control: TimeControl, completed_at: datetime | None) -> datetime | None:
    """售后申请截止时间；0 天 = 确认收货后不再受理。"""
    if completed_at is None or control.refund_window_days <= 0:
        return None
    return completed_at + timedelta(days=control.refund_window_days)


def ship_deadline(control: TimeControl, paid_at: datetime | None) -> datetime | None:
    """卖家发货时限（**只用于提醒**，不自动取消）。0 天 = 不限。"""
    if paid_at is None or control.ship_days <= 0:
        return None
    return paid_at + timedelta(days=control.ship_days)


def refund_window_open(
    control: TimeControl,
    fulfillment_status: str,
    completed_at: datetime | None,
    *,
    now: datetime | None = None,
) -> bool:
    """买家此刻能不能申请售后。

    * `to_ship` / `shipped`：可以（交易还没结束）；
    * `completed`：仅当配置了售后窗口且未超过截止时间；
    * 其它状态：不行。
    """
    if fulfillment_status in ("to_ship", "shipped"):
        return True
    if fulfillment_status != "completed":
        return False
    if control.refund_window_days <= 0:
        return False
    # 历史订单可能没有 completed_at（拆双状态之前的数据）：无法判断是否过期，
    # 保守放行，让买家还能申请（不给旧数据制造"永远申请不了"的死角）。
    if completed_at is None:
        return True
    deadline = completed_at + timedelta(days=control.refund_window_days)
    return (now or datetime.now(UTC)) <= deadline


async def resolve_many(
    db: AsyncSession, tenant_id: int, product_types: set[str]
) -> dict[str, TimeControl]:
    """一次解析多个商品类型（列表页一次请求里商品类型可能不止一种）。"""
    result: dict[str, TimeControl] = {}
    for product_type in product_types or {"physical"}:
        result[product_type] = await resolve(db, tenant_id, product_type)
    return result


def deadlines_for_order(
    control: TimeControl,
    *,
    payment_status: str,
    fulfillment_status: str,
    paid_at: datetime | None,
    completed_at: datetime | None,
    expires_at: datetime | None,
    shipped_at_list: list[tuple[datetime | None, str | None]],
) -> dict:
    """订单级时间口径（买家列表/详情用）。

    `shipped_at_list` 是该订单各卖家单的 (shipped_at, delivery_method)：
    一张订单可拆多个卖家单，自动确认时间取**最后一个**（全部到齐才算整单完成）。
    """
    auto_confirm: datetime | None = None
    if fulfillment_status == "shipped" and shipped_at_list:
        windows = [
            auto_confirm_deadline(control, shipped_at, method)
            for shipped_at, method in shipped_at_list
            if shipped_at is not None
        ]
        # 任一个卖家单关闭了自动确认（0 天）→ 整单不给"预计自动确认"的承诺
        auto_confirm = None if any(w is None for w in windows) or not windows else max(windows)
    return {
        "expires_at": expires_at.isoformat() if expires_at else None,
        "ship_deadline_at": (
            ship_deadline(control, paid_at).isoformat()
            if fulfillment_status == "to_ship" and ship_deadline(control, paid_at)
            else None
        ),
        "auto_confirm_at": auto_confirm.isoformat() if auto_confirm else None,
        "refund_deadline_at": (
            refund_deadline(control, completed_at).isoformat()
            if refund_deadline(control, completed_at)
            else None
        ),
        "can_request_refund": refund_window_open(
            control, fulfillment_status, completed_at
        ),
    }
