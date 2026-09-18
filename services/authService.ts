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

export interface LoginSession {
  id: string;
  userId: string;
  userName: string;
  account: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ip: string;
  userAgent: string;
  /** 登录时勾了「这台电脑我常用」 */
  remembered: boolean;
  /** 就是你现在正在用的这一个 */
  isCurrent?: boolean;
}

export const authService = {
  /**
   * remember：勾了「这台电脑我常用」→ 14 天免登录；不勾 → 12 小时。
   * 公用电脑必须不勾，否则下一个坐下来的人直接进得去。
   */
  login: async (account: string, password: string, remember = false): Promise<AuthPayload> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ account, password, remember })
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
  /**
   * 花名册。管理角色拿完整账号信息（含账号有效期），其他人只拿通讯录。
   *
   * ── 为什么不再「先试再降级」（2026-09-18）──────────────────────
   *
   * 原来的写法是：先请求 /api/auth/users，**403 了再**去要 /api/auth/directory。
   * 功能是对的（降级确实生效），但代价是：
   * **每一个顾问、每一次刷新、每一个页面，控制台都留一条红色 403。**
   *
   * 这个项目自己写过这条规矩：
   * 「一个永远消不掉的红，会让人不再信任所有的红。」
   * 真出事那天，那条真的报错会被埋在一堆常驻 403 里。
   *
   * 改成**先问自己有没有权限**（调用方传 canViewEmployees），
   * 没权限就直接走通讯录 —— 一次请求，零噪音。
   * 仍然保留 403 兜底：权限判断和服务端万一不一致时不能把功能弄丢
   * （这个项目权限有三份定义，不一致是发生过的）。
   */
  listAssignableUsers: async (canViewEmployees = false): Promise<AuthUser[]> => {
    const endpoint = canViewEmployees ? '/api/auth/users' : '/api/auth/directory';
    let res = await fetch(endpoint, { credentials: 'include' });
    // 兜底：三份权限定义万一对不上，宁可多一次请求也不能让花名册空掉
    if (res.status === 403 && canViewEmployees) {
      res = await fetch('/api/auth/directory', { credentials: 'include' });
    }
    const body = await parseJson<{ users: AuthUser[] }>(res);
    return body.data.users;
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
  /**
   * 删除账号。服务端只放行「从没产生过任何记录」的账号 ——
   * 有历史的会返回 409 和一句说明，这里把那句话原样抛给界面。
   */
  deleteUser: async (userId: string): Promise<void> => {
    const res = await fetch(`/api/auth/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    await parseJson<{ deleted: string }>(res);
  },
  listSessions: async (all = false): Promise<{ sessions: LoginSession[]; canSeeAll: boolean }> => {
    const res = await fetch(`/api/auth/sessions${all ? '?scope=all' : ''}`, { credentials: 'include' });
    const body = await parseJson<{ sessions: LoginSession[]; canSeeAll: boolean }>(res);
    return body.data;
  },
  revokeSession: async (id: string): Promise<void> => {
    const res = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE', credentials: 'include'
    });
    await parseJson<{ revoked: string }>(res);
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
