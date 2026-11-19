"""Audit trail for the order / payment / settlement chain.

Design rules:

* **Same transaction as the change.** ``record()`` only stages an ``AuditLog`` row;
  the caller's ``commit()`` persists it together with the business change, so an
  audited mutation can never commit without its audit row (or vice versa).
* **Tenant scoped.** Every row carries ``tenant_id``; reads are filtered by the
  caller's tenant and only a platform-wide role may look across tenants.
* **Append only.** There is no update/delete helper — the trail is immutable.
"""

from __future__ import annotations

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.request_context import get_request_meta
from app.models.audit import AuditLog
from app.models.catalog import Product, ProductSku
from app.models.finance import Payout, SettlementBatch
from app.models.order import Order, SellerOrder
from app.models.role import Role
from app.models.seller import Seller
from app.models.tenant import Tenant
from app.models.user import User
from app.services.auth import AuthContext

logger = structlog.get_logger(__name__)

# Centralised action names so the trail stays queryable and greppable.
ACTION_ORDER_CREATED = "order.created"
ACTION_ORDER_PAID = "order.paid"
ACTION_ORDER_CANCELLED = "order.cancelled"
ACTION_ORDER_CONFIRMED = "order.confirmed"
ACTION_SELLER_ORDER_SHIPPED = "seller_order.shipped"
ACTION_SELLER_ORDER_REFUNDED = "seller_order.refunded"
# 买家申请售后 / 卖家驳回售后：售后闭环的两端，都要能在审计里查
ACTION_ORDER_REFUND_REQUESTED = "order.refund_requested"
#: 买家撤回售后申请
ACTION_ORDER_REFUND_CANCELLED = "order.refund_cancelled"
ACTION_SELLER_ORDER_REFUND_REJECTED = "seller_order.refund_rejected"
# 定时任务的人工操作（立即执行 / 取消）：改的是"系统自动行为"，必须留痕
ACTION_JOB_RUN = "job.run"
ACTION_JOB_CANCELLED = "job.cancelled"
ACTION_SELLER_APPLIED = "seller.applied"
ACTION_SELLER_APPROVED = "seller.approved"
ACTION_PRODUCT_CREATED = "product.created"
ACTION_PRODUCT_DELETED = "product.deleted"
ACTION_PRODUCT_REVIEWED = "product.reviewed"
ACTION_PRODUCT_UPDATED = "product.updated"
ACTION_PAYOUT_REQUESTED = "payout.requested"
ACTION_PAYOUT_APPROVED = "payout.approved"
ACTION_PAYOUT_REJECTED = "payout.rejected"
ACTION_PAYOUT_PAID = "payout.paid"
ACTION_SETTLEMENT_CREATED = "settlement_batch.created"
ACTION_SETTLEMENT_CONFIRMED = "settlement_batch.confirmed"
ACTION_SETTLEMENT_PAID = "settlement_batch.paid"
ACTION_COMMISSION_RULE_CREATED = "commission_rule.created"
ACTION_COMMISSION_RULE_UPDATED = "commission_rule.updated"
ACTION_COMMISSION_RULE_DELETED = "commission_rule.deleted"
ACTION_IM_MESSAGE_MODERATED = "im.message.moderated"
ACTION_TENANT_SUSPENDED = "tenant.suspended"
ACTION_TENANT_RESUMED = "tenant.resumed"
ACTION_TENANT_UPDATED = "tenant.updated"
ACTION_ROLE_PERMISSIONS_UPDATED = "role.permissions_updated"
ACTION_USER_ROLE_CHANGED = "user.role_changed"
# ---- 本人自助操作（/auth/me*）：改资料 / 改密码 / 换绑定 ----
ACTION_PROFILE_UPDATED = "user.profile_updated"
ACTION_PASSWORD_CHANGED = "user.password_changed"
ACTION_CONTACT_UPDATED = "user.contact_updated"
ACTION_SUBSCRIPTION_RENEWED = "subscription.renewed"
ACTION_SUBSCRIPTION_PAST_DUE = "subscription.past_due"
ACTION_SUBSCRIPTION_CANCELLED = "subscription.cancelled"
ACTION_SUBSCRIPTION_DOWNGRADED = "subscription.downgraded"
ACTION_SETTING_UPDATED = "setting.updated"
ACTION_PLATFORM_SETTING_UPDATED = "platform.setting.update"
ACTION_PLATFORM_PASSWORD_CHANGED = "platform.password.changed"
# ---- 钱包：钱的动作必须每一笔都能追 ----
ACTION_WALLET_RECHARGE = "wallet.recharge"
ACTION_WALLET_PAY = "wallet.pay"
ACTION_WALLET_TRANSFER = "wallet.transfer"
ACTION_WALLET_WITHDRAW_REQUEST = "wallet.withdraw_request"
ACTION_WALLET_WITHDRAW_REVIEW = "wallet.withdraw_review"

# 动作 code 是给机器看的（稳定、可 grep、可筛选），界面上直接显示 `product.updated`
# 对运营没可读性。中文名就放在**定义这些常量的地方**，租户端和平台端都用同一份，
# 不在前端各自维护一份容易漂移的拷贝。
ACTION_LABELS: dict[str, str] = {
    ACTION_ORDER_CREATED: "创建订单",
    ACTION_ORDER_PAID: "订单支付",
    ACTION_ORDER_CANCELLED: "取消订单",
    ACTION_ORDER_CONFIRMED: "确认收货",
    ACTION_SELLER_ORDER_SHIPPED: "卖家发货",
    ACTION_SELLER_ORDER_REFUNDED: "子订单退款",
    ACTION_ORDER_REFUND_REQUESTED: "买家申请售后",
    ACTION_ORDER_REFUND_CANCELLED: "买家撤销售后",
    ACTION_SELLER_ORDER_REFUND_REJECTED: "驳回售后申请",
    ACTION_JOB_RUN: "手动执行定时任务",
    ACTION_JOB_CANCELLED: "取消定时任务",
    ACTION_SELLER_APPLIED: "卖家入驻申请",
    ACTION_SELLER_APPROVED: "卖家审核通过",
    ACTION_PRODUCT_CREATED: "创建商品",
    ACTION_PRODUCT_DELETED: "删除商品",
    ACTION_PRODUCT_REVIEWED: "商品审核",
    ACTION_PRODUCT_UPDATED: "修改商品",
    ACTION_PAYOUT_REQUESTED: "提现申请",
    ACTION_PAYOUT_APPROVED: "提现审核通过",
    ACTION_PAYOUT_REJECTED: "提现驳回",
    ACTION_PAYOUT_PAID: "提现打款",
    ACTION_SETTLEMENT_CREATED: "创建结算批次",
    ACTION_SETTLEMENT_CONFIRMED: "结算批次确认",
    ACTION_SETTLEMENT_PAID: "结算批次打款",
    # 佣金规则已下线，但历史审计行仍存在，仍要能读懂
    ACTION_COMMISSION_RULE_CREATED: "创建佣金规则（已下线）",
    ACTION_COMMISSION_RULE_UPDATED: "修改佣金规则（已下线）",
    ACTION_COMMISSION_RULE_DELETED: "删除佣金规则（已下线）",
    ACTION_IM_MESSAGE_MODERATED: "站内信内容治理",
    ACTION_TENANT_SUSPENDED: "租户停用",
    ACTION_TENANT_RESUMED: "租户恢复",
    ACTION_TENANT_UPDATED: "修改租户",
    ACTION_ROLE_PERMISSIONS_UPDATED: "修改角色权限",
    ACTION_USER_ROLE_CHANGED: "修改用户角色",
    ACTION_PROFILE_UPDATED: "修改个人资料",
    ACTION_PASSWORD_CHANGED: "修改密码",
    ACTION_CONTACT_UPDATED: "修改联系方式",
    ACTION_SUBSCRIPTION_RENEWED: "订阅续费",
    ACTION_SUBSCRIPTION_PAST_DUE: "订阅逾期",
    ACTION_SUBSCRIPTION_CANCELLED: "订阅取消",
    ACTION_SUBSCRIPTION_DOWNGRADED: "订阅降级",
    ACTION_SETTING_UPDATED: "修改系统设置",
    ACTION_PLATFORM_SETTING_UPDATED: "修改平台配置",
    ACTION_PLATFORM_PASSWORD_CHANGED: "平台账号修改密码",
    ACTION_WALLET_RECHARGE: "钱包充值",
    ACTION_WALLET_PAY: "余额支付",
    ACTION_WALLET_TRANSFER: "货款转入钱包",
    ACTION_WALLET_WITHDRAW_REQUEST: "申请提现",
    ACTION_WALLET_WITHDRAW_REVIEW: "审核提现",
}


def action_label(action: str | None) -> str:
    """未知动作原样返回：后端新增动作时页面不会空白，也一眼能看出还没起中文名。"""
    if not action:
        return "-"
    return ACTION_LABELS.get(action, action)


async def record(
    db: AsyncSession,
    *,
    action: str,
    tenant_id: int | None = None,
    actor_id: int | None = None,
    target_type: str = "",
    target_id: str | int | None = "",
    before: dict | None = None,
    after: dict | None = None,
) -> AuditLog:
    """Stage an audit row on the current session (committed by the caller)."""
    meta = get_request_meta()
    entry = AuditLog(
        tenant_id=tenant_id,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else "",
        before=before,
        after=after,
        ip=meta.ip or None,
        trace_id=meta.trace_id or None,
    )
    db.add(entry)
    await db.flush()
    return entry


def is_platform_viewer(context: AuthContext) -> bool:
    """Platform-wide read access.

    Checked by *permission* rather than role name: the demo superuser holds the
    legacy ``admin`` role (not ``platform_admin``) yet must be able to audit
    across tenants.
    """
    return "platform_admin" in context.roles or "platform:tenant:read" in context.permissions


async def actor_directory(
    db: AsyncSession, rows: list[AuditLog]
) -> dict[int, tuple[str, str]]:
    """把 `actor_id` 批量解析成 `(username, public_id)`。

    审计表只存 actor_id（不存冗余名字）：改了名字应该显示新名字，而不是当时的快照。
    用户被删/不存在时查不到，调用方要能容忍缺失（前端显示 `-`）。
    """
    ids = {row.actor_id for row in rows if row.actor_id}
    if not ids:
        return {}
    users = (await db.scalars(select(User).where(User.id.in_(ids)))).all()
    return {user.id: (user.username, user.public_id) for user in users}


# ``target_type`` 是给机器和接口筛选用的英文标识，界面上不能直接拿它拼 ``#id``。
# 「对象」列要的是人能读的东西：订单号 / 商品名 / 用户名 / 角色名……
TARGET_TYPE_LABELS: dict[str, str] = {
    "order": "订单",
    "seller_order": "子订单",
    "product": "商品",
    "product_specs": "商品规格",
    "product_sku": "商品 SKU",
    "seller": "卖家",
    "user": "用户",
    "role": "角色",
    "tenant": "租户",
    "subscription": "订阅",
    "payout": "提现",
    "settlement_batch": "结算批次",
    "platform_setting": "平台配置",
    "im_message": "站内信",
    "scheduled_job": "定时任务",
    "wallet": "钱包",
    "wallet_withdrawal": "提现申请",
}

target_type_label = TARGET_TYPE_LABELS.get

# `platform_setting` 的 target_id 存的是设置分类名（platform / upload / notification …），
# 界面上给中文，否则对象列会直接爆出 `platform` 这种内部词。
PLATFORM_SETTING_LABELS: dict[str, str] = {
    "platform": "平台基础配置",
    "upload": "上传限制",
    "notification": "通知配置",
    "commission": "佣金配置",
    "security": "安全策略",
}


def target_type_text(target_type: str | None) -> str:
    """未知类型也别把英文扔给运营：退化成原值而不是空。"""
    if not target_type:
        return "-"
    return TARGET_TYPE_LABELS.get(target_type, target_type)


async def target_directory(
    db: AsyncSession, rows: list[AuditLog]
) -> dict[int, tuple[str, str]]:
    """把 ``(target_type, target_id)`` 批量解析成 ``(中文类型, 可读标签)``。

    审计表只存 id（不存快照），所以一律**读时解析**：订单号改了、商品改名了、
    用户换用户名了，历史记录也跟着显示新值。目标被删就查不到，标签为空字符串，
    前端退回 ``-``。
    """
    if not rows:
        return {}

    # 按类型分桶，每类一条 IN 查询，避免 N+1
    buckets: dict[str, list[int]] = {}
    for row in rows:
        raw = str(row.target_id or "")
        if raw.isdigit():
            buckets.setdefault(row.target_type or "", []).append(int(raw))

    # target_type 分组 -> (模型, 取值函数)
    resolvers = [
        (("product", "product_specs"), Product, lambda p: p.name),
        (("product_sku",), ProductSku, lambda s: s.sku_code or s.name),
        (("order",), Order, lambda o: o.order_no),
        (("seller_order",), SellerOrder, lambda o: o.seller_order_no),
        (("seller",), Seller, lambda s: s.display_name),
        (("user",), User, lambda u: f"{u.public_id} / {u.username}"),
        (("role",), Role, lambda r: r.name),
        (("tenant",), Tenant, lambda t: t.name),
        (("settlement_batch",), SettlementBatch, lambda b: b.batch_no),
        (("payout",), Payout, lambda p: f"¥{p.amount_cents / 100:.2f}"),
    ]
    resolved: dict[tuple[str, int], str] = {}
    for types, model, render in resolvers:
        ids: list[int] = []
        for target_type in types:
            ids.extend(buckets.get(target_type, []))
        if not ids:
            continue
        found = (await db.scalars(select(model).where(model.id.in_(ids)))).all()
        for item in found:
            label = render(item)
            if label:
                resolved[(model.__tablename__, item.id)] = label

    table_of = {t: model.__tablename__ for types, model, _ in resolvers for t in types}
    out: dict[int, tuple[str, str]] = {}
    for row in rows:
        raw = str(row.target_id or "")
        label = ""
        if raw.isdigit():
            label = resolved.get((table_of.get(row.target_type or "", ""), int(raw)), "")
        elif raw:
            # 非数字目标：`platform_setting` 的 target_id 存的是设置分类名
            if row.target_type == "platform_setting":
                label = PLATFORM_SETTING_LABELS.get(raw, raw)
            else:
                label = raw
        out[row.id] = (target_type_text(row.target_type), label)
    return out


async def _target_ids_matching(db: AsyncSession, keyword: str) -> list[str]:
    """把可读关键词（商品名 / 订单号 / 用户名 / 用户ID / 店铺名 / 角色名）
    在各业务表里解析成 `target_id` 候选值。

    审计行的 `target_id` 是存字符串的，所以统一转成 str 再比对。
    """
    like = f"%{keyword.strip()}%"
    if like == "%%":
        return []
    ids: set[str] = set()

    for model, column in (
        (Product, Product.name),
        (ProductSku, ProductSku.sku_code),
        (Order, Order.order_no),
        (SellerOrder, SellerOrder.seller_order_no),
        (Seller, Seller.display_name),
        (Role, Role.name),
        (Tenant, Tenant.name),
        (SettlementBatch, SettlementBatch.batch_no),
    ):
        rows = (await db.scalars(select(model.id).where(column.ilike(like)))).all()
        ids.update(str(item) for item in rows)

    users = (
        await db.scalars(
            select(User.id).where(
                User.username.ilike(like) | User.public_id.ilike(like)
            )
        )
    ).all()
    ids.update(str(item) for item in users)

    # 非数字目标（平台配置的分类名）也能被搜到：`平台配置` -> platform
    needle = keyword.strip()
    for key, label in PLATFORM_SETTING_LABELS.items():
        if needle in label or needle in key:
            ids.add(key)
    return sorted(ids)


async def list_logs(
    db: AsyncSession,
    context: AuthContext,
    *,
    current: int = 1,
    page_size: int = 20,
    action: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    actor_id: int | None = None,
    tenant_id: int | None = None,
    keyword: str | None = None,
) -> tuple[list[AuditLog], int]:
    """Query the trail. A tenant only ever sees its own rows."""
    stmt = select(AuditLog)
    count_stmt = select(func.count(AuditLog.id))

    if not is_platform_viewer(context):
        stmt = stmt.where(AuditLog.tenant_id == context.tenant.id)
        count_stmt = count_stmt.where(AuditLog.tenant_id == context.tenant.id)
    elif tenant_id is not None:
        stmt = stmt.where(AuditLog.tenant_id == tenant_id)
        count_stmt = count_stmt.where(AuditLog.tenant_id == tenant_id)

    if action:
        stmt = stmt.where(AuditLog.action == action)
        count_stmt = count_stmt.where(AuditLog.action == action)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
        count_stmt = count_stmt.where(AuditLog.target_type == target_type)
    if keyword:
        # 运营搜的是「那个人 / 那个商品 / 那个订单号」，不是内部自增 id。
        # 先把关键词在各个业务表里解析成一批 id，再用 IN 过滤审计行。
        candidates = await _target_ids_matching(db, keyword)
        if not candidates:
            return [], 0
        stmt = stmt.where(AuditLog.target_id.in_(candidates))
        count_stmt = count_stmt.where(AuditLog.target_id.in_(candidates))
    if target_id:
        stmt = stmt.where(AuditLog.target_id == str(target_id))
        count_stmt = count_stmt.where(AuditLog.target_id == str(target_id))
    if actor_id is not None:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
        count_stmt = count_stmt.where(AuditLog.actor_id == actor_id)

    total = int(await db.scalar(count_stmt) or 0)
    rows = list(
        (
            await db.scalars(
                stmt.order_by(AuditLog.id.desc()).offset((current - 1) * page_size).limit(page_size)
            )
        ).all()
    )
    return rows, total


async def distinct_actions(db: AsyncSession, context: AuthContext) -> list[str]:
    stmt = select(AuditLog.action).distinct()
    if not is_platform_viewer(context):
        stmt = stmt.where(AuditLog.tenant_id == context.tenant.id)
    return sorted(row for row in (await db.scalars(stmt)).all() if row)


async def record_platform(
    db: AsyncSession,
    *,
    actor_id: int | None,
    action: str,
    target_type: str = "",
    target_id: str = "",
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    """记录一条平台级审计。

    用 `tenant_id IS NULL` 表示平台操作 —— 这样不需要新增列，
    而租户侧查询永远带 tenant_id 过滤，天然看不到平台行。
    """
    db.add(
        AuditLog(
            tenant_id=None,
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            before=before,
            after=after,
        )
    )
    await db.flush()


async def list_platform_logs(
    db: AsyncSession,
    current: int = 1,
    page_size: int = 20,
    keyword: str | None = None,
    action: str | None = None,
) -> tuple[list[AuditLog], int]:
    """平台审计：只看 tenant_id 为空的行。

    筛选口径和租户端一致：`keyword` 搜的是人能读的对象（商品名 / 订单号 / 用户名…），
    不是内部自增 id。
    """
    stmt = select(AuditLog).where(AuditLog.tenant_id.is_(None))
    count_stmt = select(func.count(AuditLog.id)).where(AuditLog.tenant_id.is_(None))
    if action:
        stmt = stmt.where(AuditLog.action == action)
        count_stmt = count_stmt.where(AuditLog.action == action)
    if keyword:
        candidates = await _target_ids_matching(db, keyword)
        if not candidates:
            return [], 0
        stmt = stmt.where(AuditLog.target_id.in_(candidates))
        count_stmt = count_stmt.where(AuditLog.target_id.in_(candidates))
    total = int(await db.scalar(count_stmt) or 0)
    stmt = stmt.order_by(AuditLog.id.desc()).offset((current - 1) * page_size).limit(page_size)
    return list((await db.scalars(stmt)).all()), total
