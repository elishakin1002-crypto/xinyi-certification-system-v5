/**
 * 工作日志 / 任务模板 / 不符合项 的服务端读写。
 *
 * ── 为什么补这三个 ────────────────────────────────────────────
 * 这三份数据原来**只存在于每个人自己的浏览器里**（localStorage），
 * 取不到时还会退回代码里的 MOCK 假数据，然后整份数组推回服务器。
 *
 * 两个后果：
 *   ① 一台空浏览器会拿假数据当真数据推上去
 *   ② 各人副本互不相通，谁后推谁说了算 ——
 *      2026-09-02 线上推上来的工作日志是空数组，而表里有 47 行，
 *      只因为「空数组不删表」的保护才没删成
 *
 * 从服务端读之后，大家看的是同一份，整份覆盖的前提就不成立了。
 *
 * ── 三个放一个文件 ────────────────────────────────────────────
 * 它们共用同一套 envelope 解析和开关约定，各自只有几行。
 * 拆成三个文件会让 80% 的行数是重复的样板。
 */
import { AuditIssue, ProjectWorkLog, TaskTemplate } from '../types';

type ApiEnvelope<T> = { ok: boolean; code: number; message: string; data: T };

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const parseJson = async <T,>(res: Response, label: string): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`${label}服务响应异常（HTTP ${res.status}）`);
  if (!res.ok || body.ok === false) throw new Error(String(body.message || `${label}请求失败（HTTP ${res.status}）`));
  return body as ApiEnvelope<T>;
};

const enabled = parseBoolean(import.meta.env.VITE_BATCH5_API_ENABLED, false);
const readEnabled = parseBoolean(import.meta.env.VITE_BATCH5_API_READ_ENABLED, false);

const makeService = <T,>(base: string, single: string, plural: string, label: string) => ({
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,

  list: async (): Promise<T[]> => {
    const res = await fetch(`/api/${base}`, { method: 'GET', credentials: 'include' });
    const body = await parseJson<Record<string, T[]>>(res, label);
    const rows = body.data?.[plural];
    return Array.isArray(rows) ? rows : [];
  },

  create: async (item: T): Promise<T> => {
    const res = await fetch(`/api/${base}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ [single]: item }),
    });
    const body = await parseJson<Record<string, T>>(res, label);
    return body.data[single];
  },

  update: async (id: string, updates: Partial<T>): Promise<T> => {
    const res = await fetch(`/api/${base}/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ [single]: updates }),
    });
    const body = await parseJson<Record<string, T>>(res, label);
    return body.data[single];
  },
});

export const workLogService = makeService<ProjectWorkLog>('work-logs', 'workLog', 'workLogs', '工作日志');
export const taskTemplateService = makeService<TaskTemplate>('task-templates', 'template', 'templates', '任务模板');

/*
 * 不符合项的路由早就有了（batch4），只是前端一直没接。
 * 它跟着 batch4 的开关走，不跟 batch5 —— 开关名对应后端归属，
 * 混在一起以后排查「到底哪个开关关着」会很痛苦。
 */
const auditEnabled = parseBoolean(import.meta.env.VITE_AUDIT_API_ENABLED, false);
const auditReadEnabled = parseBoolean(import.meta.env.VITE_AUDIT_API_READ_ENABLED, false);

export const auditIssueService = {
  isEnabled: () => auditEnabled,
  isReadEnabled: () => auditReadEnabled,
  list: async (): Promise<AuditIssue[]> => {
    const res = await fetch('/api/audit-issues', { method: 'GET', credentials: 'include' });
    const body = await parseJson<{ issues: AuditIssue[] }>(res, '不符合项');
    return Array.isArray(body.data.issues) ? body.data.issues : [];
  },
};
