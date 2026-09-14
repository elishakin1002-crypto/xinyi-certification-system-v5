import { Reminder } from '../types';

type ApiEnvelope<T> = { ok: boolean; code: number; message: string; data: T };

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const enabled = parseBoolean(import.meta.env.VITE_REMINDERS_API_ENABLED, false);
const readEnabled = parseBoolean(import.meta.env.VITE_REMINDERS_API_READ_ENABLED, false);

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`提醒服务响应异常（HTTP ${res.status}）`);
  if (!res.ok || body.ok === false) throw new Error(String(body.message || `提醒请求失败（HTTP ${res.status}）`));
  return body as ApiEnvelope<T>;
};

export const reminderService = {
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,

  listReminders: async (): Promise<Reminder[]> => {
    const res = await fetch('/api/reminders', { method: 'GET', credentials: 'include' });
    const body = await parseJson<{ reminders: Reminder[] }>(res);
    return Array.isArray(body.data.reminders) ? body.data.reminders : [];
  },

  createReminder: async (reminder: Reminder): Promise<Reminder> => {
    const res = await fetch('/api/reminders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ reminder }),
    });
    const body = await parseJson<{ reminder: Reminder }>(res);
    return body.data.reminder;
  },

  markRead: async (id: string): Promise<void> => {
    const res = await fetch(`/api/reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ reminder: { isRead: true } }),
    });
    await parseJson<{ reminder: Reminder }>(res);
  },

  removeReminder: async (id: string): Promise<void> => {
    const res = await fetch(`/api/reminders/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
    await parseJson<{ ok: boolean }>(res);
  },

  /*
    「办完了」——和「已读」是两回事，这一点是这次改动的核心。

      已读 = 我看见了（看一眼就算）
      办完 = 这件事处理完了（该收的款收了、该整改的改了）

    生产上 228 条提醒**一条都没人标已读**，原因就在这里：
    标了既不代表事情做了，也不让它从待办里消失，标它没有任何意义。
    只有「办完」才让它离开待办栏，人才有动力去点。
  */
  resolveReminder: async (id: string): Promise<void> => {
    const res = await fetch(`/api/reminders/${encodeURIComponent(id)}/resolve`, {
      method: 'POST', credentials: 'include'
    });
    await parseJson<{ reminder: Reminder }>(res);
  },
};
