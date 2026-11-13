import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/system/types';

export interface AuthTenant {
  id: number;
  name: string;
  slug: string;
  status: string;
  roles: string[];
}

export interface AuthUser {
  id: number;
  /** 对外用户编号（随机 20 位），个人设置页展示、报障对账时用 */
  public_id: string;
  username: string;
  /** 展示名，由管理员在「用户管理」维护；个人设置页不提供输入框 */
  nickname: string;
  email: string;
  phone?: string | null;
  gender?: 'male' | 'female' | 'other' | 'unknown' | null;
  birthday?: string | null;
  last_login_at?: string | null;
  has_password?: boolean;
  avatar?: string | null;
}

export interface AuthSession {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
  tenants: AuthTenant[];
  current_tenant: AuthTenant;
  roles: string[];
  permissions: string[];
  permission_version: number;
}

export interface MeSession {
  user: AuthUser;
  tenants: AuthTenant[];
  current_tenant: AuthTenant;
  roles: string[];
  permissions: string[];
  permission_version: number;
}

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const response = await promise;
  if (response.code !== 200) throw new Error(response.message || '请求失败');
  return response.data;
}

export async function login(data: {
  username: string;
  password: string;
  tenant_id?: number;
}) {
  return unwrap<AuthSession>(
    request('/api/v1/auth/login', { method: 'POST', data }),
  );
}

export async function me() {
  return unwrap<MeSession>(request('/api/v1/auth/me', { method: 'GET' }));
}

export async function logout() {
  return unwrap<null>(request('/api/v1/auth/logout', { method: 'POST' }));
}

/** 改性别/生日。用户名与用户ID不可改，邮箱/手机走 `updateContact`。 */
export async function updateProfile(data: {
  gender?: string | null;
  birthday?: string | null;
}) {
  return unwrap<MeSession>(
    request('/api/v1/auth/me', { method: 'PATCH', data }),
  );
}

/** 改密码：后端验旧密码，成功后需要重新登录。 */
export async function changePassword(data: {
  old_password: string;
  new_password: string;
}) {
  return unwrap<null>(
    request('/api/v1/auth/me/password', { method: 'POST', data }),
  );
}

/** 换手机 / 换邮箱：必须带当前密码。 */
export async function updateContact(data: {
  phone?: string;
  email?: string;
  password: string;
}) {
  return unwrap<MeSession>(
    request('/api/v1/auth/me/contact', { method: 'PUT', data }),
  );
}

export interface NotificationChannelSetting {
  channel: 'sms' | 'email';
  enabled: boolean;
}

export interface NotificationCategorySetting {
  category: string;
  label: string;
  channels: NotificationChannelSetting[];
}

export interface NotificationPrefs {
  categories: NotificationCategorySetting[];
  /** 站内信是强制渠道，只能展示不能关 */
  mandatory_channel: string;
  contact: { email: string | null; phone: string | null };
}

export async function getNotificationPrefs() {
  return unwrap<NotificationPrefs>(
    request('/api/v1/auth/me/notification-prefs', { method: 'GET' }),
  );
}

export async function saveNotificationPref(data: {
  category: string;
  channel: string;
  enabled: boolean;
}) {
  return unwrap<{ category: string; channel: string; enabled: boolean }>(
    request('/api/v1/auth/me/notification-prefs', { method: 'PUT', data }),
  );
}
