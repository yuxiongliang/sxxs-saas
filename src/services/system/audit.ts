import { request } from '@umijs/max';
import type { ApiResponse } from './types';

export interface AuditLogRecord {
  id: number;
  tenant_id?: number | null;
  actor_id?: number | null;
  /** 操作人用户名（后端 join 出来；用户已删时为空） */
  actor_username?: string | null;
  /** 操作人对外用户编号（随机 20 位） */
  actor_public_id?: string | null;
  action: string;
  /** 动作中文名（后端给；未知动作原样返回 code） */
  action_label?: string | null;
  target_type: string;
  /** 对象类型的中文名（后端给；未知类型退回原值） */
  target_type_label?: string | null;
  /** 对象的可读标签：订单号 / 商品名 / 用户ID+用户名 / 角色名… 目标已删时为空 */
  target_label?: string | null;
  target_id: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  trace_id?: string | null;
  created_at: string;
}

export interface AuditLogQuery {
  current?: number;
  pageSize?: number;
  action?: string;
  target_type?: string;
  /** 关键词：商品名 / 订单号 / 用户名 / 用户ID / 店铺名 */
  keyword?: string;
  target_id?: string;
  actor_id?: number;
  tenant_id?: number;
}

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const response = await promise;
  if (response.code !== 200) throw new Error(response.message || '请求失败');
  return response.data;
}

export async function listAuditLogs(params: AuditLogQuery) {
  return unwrap<{ list: AuditLogRecord[]; total: number; current: number; pageSize: number }>(
    request('/api/v1/audit-logs', { method: 'GET', params }),
  );
}

export async function listAuditActions() {
  return unwrap<{ value: string; label: string }[]>(
    request('/api/v1/audit-logs/actions', { method: 'GET' }),
  );
}
