import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/system/types';

/** 后端统一响应包一层 {code,message,data} */
const unwrap = async <T,>(promise: Promise<ApiResponse<T>>): Promise<T> => {
  const body = await promise;
  return body.data;
};

export type WalletTransactionRow = {
  id: number;
  type: string;
  amount_cents: number;
  balance_after: number;
  remark?: string | null;
  created_at?: string | null;
};

export type WalletWithdrawalRow = {
  id: number;
  amount_cents: number;
  method: string;
  account_name: string;
  account_no: string;
  status: string;
  note?: string | null;
  created_at?: string | null;
};

export type WalletOverview = {
  account_id: number;
  balance_cents: number;
  frozen_cents: number;
  available_cents: number;
  transactions: WalletTransactionRow[];
  withdrawals: WalletWithdrawalRow[];
};

/** 我的钱包（按租户隔离：一个租户一个钱包账户） */
export async function getWallet() {
  return unwrap<WalletOverview>(request('/api/v1/wallet', { method: 'GET' }));
}

/** 模拟充值。真实接微信/支付宝时，这里换成"创建支付单 + 回调入账"。 */
export async function rechargeWallet(amount_cents: number, client_txn_id: string) {
  return unwrap<{ balance_cents: number; duplicated: boolean }>(
    request('/api/v1/wallet/recharge', {
      method: 'POST',
      data: { amount_cents, client_txn_id },
    }),
  );
}

/** 申请提现：收款信息本期就是文本（收款方式 + 账号 + 姓名）。 */
export async function requestWithdrawal(data: {
  amount_cents: number;
  method: 'alipay' | 'wechat' | 'bank';
  account_name: string;
  account_no: string;
}) {
  return unwrap<{ id: number; status: string }>(
    request('/api/v1/wallet/withdrawals', { method: 'POST', data }),
  );
}

/** 租户运营：资金审核列表（用户ID + 用户名） */
export async function listWithdrawalsForReview(status?: string) {
  return unwrap<
    Array<
      WalletWithdrawalRow & {
        user_id: number;
        user_public_id?: string | null;
        user_username?: string | null;
      }
    >
  >(
    request('/api/v1/admin/finance/withdrawals', {
      method: 'GET',
      params: { status },
    }),
  );
}

export async function reviewWithdrawal(
  id: number,
  approve: boolean,
  note: string,
) {
  return unwrap<{ id: number; status: string }>(
    request(`/api/v1/admin/finance/withdrawals/${id}/review`, {
      method: 'POST',
      data: { approve, note },
    }),
  );
}
