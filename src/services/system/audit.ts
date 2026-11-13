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
  target_type: string;
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
  return unwrap<string[]>(request('/api/v1/audit-logs/actions', { method: 'GET' }));
}
