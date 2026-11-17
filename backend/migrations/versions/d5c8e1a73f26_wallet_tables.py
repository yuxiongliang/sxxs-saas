"""钱包三表 + refunds.provider

* `wallet_accounts`   —— 一个用户在每个租户一个账户（租户间资金不互通）
* `wallet_transactions` —— append-only 流水，`(type, ref_type, ref_id)` 唯一 = 幂等
* `wallet_withdrawals`  —— 提现申请，租户运营审核
* `refunds.provider`   —— 记下这笔退款原本走什么渠道（余额/微信/支付宝），
  本期退款统一退回余额，但要留痕，否则对账说不清"退的是哪个渠道的钱"
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5c8e1a73f26"
down_revision: str | None = "f1b8c4d29e70"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "wallet_accounts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("balance_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("frozen_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_wallet_account"),
    )
    op.create_index("ix_wallet_accounts_tenant_id", "wallet_accounts", ["tenant_id"])
    op.create_index("ix_wallet_accounts_user_id", "wallet_accounts", ["user_id"])

    op.create_table(
        "wallet_transactions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "account_id", sa.Integer(), sa.ForeignKey("wallet_accounts.id"), nullable=False
        ),
        sa.Column("type", sa.String(length=24), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("balance_after", sa.Integer(), nullable=False),
        sa.Column("ref_type", sa.String(length=32), nullable=False),
        sa.Column("ref_id", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("remark", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("type", "ref_type", "ref_id", name="uq_wallet_tx_ref"),
        sa.UniqueConstraint("idempotency_key", name="uq_wallet_tx_idempotency"),
    )
    op.create_index("ix_wallet_transactions_tenant_id", "wallet_transactions", ["tenant_id"])
    op.create_index("ix_wallet_transactions_account_id", "wallet_transactions", ["account_id"])
    op.create_index("ix_wallet_transactions_type", "wallet_transactions", ["type"])

    op.create_table(
        "wallet_withdrawals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "account_id", sa.Integer(), sa.ForeignKey("wallet_accounts.id"), nullable=False
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False, server_default="alipay"),
        sa.Column("account_name", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("account_no", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_wallet_withdrawals_tenant_id", "wallet_withdrawals", ["tenant_id"])
    op.create_index("ix_wallet_withdrawals_account_id", "wallet_withdrawals", ["account_id"])
    op.create_index("ix_wallet_withdrawals_user_id", "wallet_withdrawals", ["user_id"])
    op.create_index("ix_wallet_withdrawals_status", "wallet_withdrawals", ["status"])

    op.add_column(
        "refunds", sa.Column("provider", sa.String(length=16), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("refunds", "provider")
    op.drop_index("ix_wallet_withdrawals_status", table_name="wallet_withdrawals")
    op.drop_index("ix_wallet_withdrawals_user_id", table_name="wallet_withdrawals")
    op.drop_index("ix_wallet_withdrawals_account_id", table_name="wallet_withdrawals")
    op.drop_index("ix_wallet_withdrawals_tenant_id", table_name="wallet_withdrawals")
    op.drop_table("wallet_withdrawals")
    op.drop_index("ix_wallet_transactions_type", table_name="wallet_transactions")
    op.drop_index("ix_wallet_transactions_account_id", table_name="wallet_transactions")
    op.drop_index("ix_wallet_transactions_tenant_id", table_name="wallet_transactions")
    op.drop_table("wallet_transactions")
    op.drop_index("ix_wallet_accounts_user_id", table_name="wallet_accounts")
    op.drop_index("ix_wallet_accounts_tenant_id", table_name="wallet_accounts")
    op.drop_table("wallet_accounts")
