"""用户钱包（按租户隔离）。

一套账户服务所有角色：买家充值/余额支付/退款入账、卖家货款到期划转入账、
两者共用同一个提现出口（租户运营审核）。

**账本原则**：`wallet_transactions` 是不可变的真相（append-only，带 `balance_after`）；
`wallet_accounts.balance_cents` 只是缓存值，只能由流水驱动 —— 任何地方直接改余额都会
让对账失去意义。
"""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class WalletAccount(Base, TimestampMixin):
    __tablename__ = "wallet_accounts"
    # 一个用户在**每个租户**一个钱包：租户之间资金不互通（A 店充的钱不能到 B 店花）
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_wallet_account"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    balance_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 提现审核中的冻结额：不冻结的话用户申请完还能把钱花掉，审核通过时余额不够
    frozen_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class WalletTransaction(Base):
    """钱包流水（append-only）。

    `UNIQUE(type, ref_type, ref_id)` 是幂等的核心：支付回调重试、任务重跑、
    退款补记，都不会把同一笔钱记两次。
    """

    __tablename__ = "wallet_transactions"
    __table_args__ = (
        UniqueConstraint("type", "ref_type", "ref_id", name="uq_wallet_tx_ref"),
        UniqueConstraint("idempotency_key", name="uq_wallet_tx_idempotency"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("wallet_accounts.id"), index=True
    )
    # recharge 充值 / pay 余额支付 / refund 退款入账 / transfer_in 货款划转
    # withdraw 提现成功 / withdraw_reject 提现驳回解冻
    type: Mapped[str] = mapped_column(String(24), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    ref_type: Mapped[str] = mapped_column(String(32))
    ref_id: Mapped[int] = mapped_column(Integer)
    # 非业务单据型流水（如充值）用客户端幂等键去重：
    # 用哈希塞进 ref_id 会溢出 int32，这里给独立列 + 唯一约束
    idempotency_key: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WalletWithdrawal(Base, TimestampMixin):
    """钱包提现申请。收款信息本期就是文本（收款方式 + 账号 + 姓名）。"""

    __tablename__ = "wallet_withdrawals"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("wallet_accounts.id"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    # server_default 必须与迁移完全一致：test_migrations 会逐列比对
    method: Mapped[str] = mapped_column(
        String(16), default="alipay", server_default="alipay"
    )
    account_name: Mapped[str] = mapped_column(
        String(64), default="", server_default=""
    )
    account_no: Mapped[str] = mapped_column(
        String(128), default="", server_default=""
    )
    # pending / paid / rejected
    status: Mapped[str] = mapped_column(
        String(16), default="pending", server_default="pending", index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
