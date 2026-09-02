import { Settlement } from '../types';

type ApiEnvelope<T> = { ok: boolean; code: number; message: string; data: T };

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const enabled = parseBoolean(import.meta.env.VITE_SETTLEMENTS_API_ENABLED, false);
const readEnabled = parseBoolean(import.meta.env.VITE_SETTLEMENTS_API_READ_ENABLED, false);

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`结算服务响应异常（HTTP ${res.status}）`);
  if (!res.ok || body.ok === false) throw new Error(String(body.message || `结算请求失败（HTTP ${res.status}）`));
  return body as ApiEnvelope<T>;
};

export const settlementService = {
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,

  listSettlements: async (): Promise<Settlement[]> => {
    const res = await fetch('/api/settlements', { method: 'GET', credentials: 'include' });
    const body = await parseJson<{ settlements: Settlement[] }>(res);
    return Array.isArray(body.data.settlements) ? body.data.settlements : [];
  },

  updateStatus: async (id: string, status: Settlement['status']): Promise<Settlement> => {
    const res = await fetch(`/api/settlements/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ settlement: { status } }),
    });
    const body = await parseJson<{ settlement: Settlement }>(res);
    return body.data.settlement;
  },

  upsertMany: async (settlements: Settlement[]): Promise<number> => {
    const res = await fetch('/api/settlements/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ settlements }),
    });
    const body = await parseJson<{ written: number }>(res);
    return body.data.written;
  },
};
