import { RoleID, UserProfile } from '../types';

type AuthEnvelope<T> = {
  ok: boolean;
  code: number;
  message: string;
  data: T;
};

export type AuthUser = UserProfile & {
  email?: string;
  username?: string;
  status?: 'active' | 'disabled';
  mustChangePassword?: boolean;
};

type AuthPayload = {
  user: AuthUser;
  expiresAt: string;
};

export type EmployeeAccount = AuthUser & {
  email: string;
  username: string;
  status: 'active' | 'disabled';
};

export type EmployeeAccountInput = {
  email?: string;
  username?: string;
  name: string;
  password?: string;
  roles: RoleID[];
  activeRole: RoleID;
  positionTags?: string[];
  reportsToUserId?: string;
  status?: 'active' | 'disabled';
  /** 在角色默认之外额外给的动作 */
  extraActions?: string[];
  /** 显式收走的动作，优先级最高 */
  deniedActions?: string[];
  /** 账号有效期 YYYY-MM-DD，空 = 永久 */
  accountExpiresAt?: string;
};

export type AuthAuditLog = {
  id: string;
  actorUserId: string;
  actorName: string;
  action: string;
  targetUserId: string;
  targetName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const parseJson = async <T,>(res: Response): Promise<AuthEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new Error(`认证服务响应异常（HTTP ${res.status}）`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message || `认证请求失败（HTTP ${res.status}）`));
  }
  return body as AuthEnvelope<T>;
};

export const authService = {
  login: async (account: string, password: string): Promise<AuthPayload> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ account, password })
    });
    const body = await parseJson<AuthPayload>(res);
    return body.data;
  },
  me: async (): Promise<AuthPayload | null> => {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include'
    });
    if (res.status === 401) return null;
    const body = await parseJson<AuthPayload>(res);
    return body.data;
  },
  logout: async (): Promise<void> => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  },
  listUsers: async (): Promise<EmployeeAccount[]> => {
    const res = await fetch('/api/auth/users', {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ users: EmployeeAccount[] }>(res);
    return body.data.users;
  },
  createUser: async (payload: EmployeeAccountInput): Promise<EmployeeAccount> => {
    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const body = await parseJson<{ user: EmployeeAccount }>(res);
    return body.data.user;
  },
  updateUser: async (userId: string, payload: Partial<EmployeeAccountInput>): Promise<EmployeeAccount> => {
    const res = await fetch(`/api/auth/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const body = await parseJson<{ user: EmployeeAccount }>(res);
    return body.data.user;
  },
  resetPassword: async (userId: string, password: string): Promise<EmployeeAccount> => {
    const res = await fetch(`/api/auth/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password })
    });
    const body = await parseJson<{ user: EmployeeAccount }>(res);
    return body.data.user;
  },
  changePassword: async (currentPassword: string, newPassword: string): Promise<AuthPayload> => {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const body = await parseJson<AuthPayload>(res);
    return body.data;
  },
  listAuditLogs: async (limit = 100): Promise<AuthAuditLog[]> => {
    const res = await fetch(`/api/auth/audit-logs?limit=${encodeURIComponent(String(limit))}`, {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ logs: AuthAuditLog[] }>(res);
    return body.data.logs;
  }
};
