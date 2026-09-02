import { MarketSignal, Project } from '../types';

type ApiEnvelope<T> = { ok: boolean; code: number; message: string; data: T };

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const enabled = parseBoolean(import.meta.env.VITE_SIGNALS_API_ENABLED, false);
const readEnabled = parseBoolean(import.meta.env.VITE_SIGNALS_API_READ_ENABLED, false);

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`情报服务响应异常（HTTP ${res.status}）`);
  if (!res.ok || body.ok === false) throw new Error(String(body.message || `情报请求失败（HTTP ${res.status}）`));
  return body as ApiEnvelope<T>;
};

export const signalService = {
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,

  listSignals: async (): Promise<MarketSignal[]> => {
    const res = await fetch('/api/signals', { method: 'GET', credentials: 'include' });
    const body = await parseJson<{ signals: MarketSignal[] }>(res);
    return Array.isArray(body.data.signals) ? body.data.signals : [];
  },

  updateSignal: async (id: string, updates: Partial<MarketSignal>): Promise<MarketSignal> => {
    const res = await fetch(`/api/signals/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ signal: updates }),
    });
    const body = await parseJson<{ signal: MarketSignal }>(res);
    return body.data.signal;
  },

  // 情报→跟进项目 转化（后端原子级联：建 intel/followup 项目 + 回写 signal.status=converted）。
  // 唯一业务权威路径；already=true 表示幂等命中已存在的转化项目。校验失败后端返回 409。
  convert: async (
    id: string,
    opts?: { manager?: string }
  ): Promise<{ ok: boolean; projectId?: string; already?: boolean; project?: Project }> => {
    const res = await fetch(`/api/signals/${encodeURIComponent(id)}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ manager: opts?.manager }),
    });
    const body = await parseJson<{ ok: boolean; projectId?: string; already?: boolean; project?: Project }>(res);
    return body.data;
  },

  upsertSignals: async (signals: MarketSignal[]): Promise<number> => {
    const res = await fetch('/api/signals/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ signals }),
    });
    const body = await parseJson<{ written: number }>(res);
    return body.data.written;
  },
};
