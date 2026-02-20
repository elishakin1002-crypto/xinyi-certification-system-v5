import { MarketSignal } from '../types';

export interface IntelFetchConfig {
  regions: string[];
  industries: string[];
  limit?: number;
}

export interface IntelFetchResult {
  ok: boolean;
  signals: MarketSignal[];
  source: 'server' | 'cache';
  error?: string;
  stale?: boolean;
  droppedStale?: number;
  droppedUndated?: number;
  rescuedUndated?: number;
  freshnessPolicy?: {
    policy: number;
    tender: number;
    standard: number;
    industry: number;
    company: number;
    event: number;
  };
}

const normalizeFetchError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e || '抓取失败');
  if (e instanceof DOMException && e.name === 'AbortError') {
    return '抓取超时：联网检索耗时过长，已取消本次请求。';
  }
  if (msg === 'Failed to fetch' || msg.toLowerCase().includes('networkerror')) {
    return '无法连接后端：请确认后端已启动（端口 3001），且前端代理 `/api -> http://localhost:3001` 可用。';
  }
  return msg;
};

const safeReadJson = async (res: Response): Promise<{ data: any | null; error?: string }> => {
  const text = await res.text();
  if (!text) return { data: null, error: '后端返回空响应（通常是后端未启动/端口不通导致代理失败）' };
  try {
    return { data: JSON.parse(text) };
  } catch (e) {
    return { data: null, error: '后端返回非 JSON 响应' };
  }
};

export const intelService = {
  fetchDailySignals: async (config: IntelFetchConfig): Promise<IntelFetchResult> => {
    const timeoutMs = Number(import.meta.env.VITE_INTEL_FETCH_TIMEOUT_MS || 30000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(5000, timeoutMs));
    try {
      const res = await fetch('/api/intel/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          regions: config.regions,
          industries: config.industries,
          limit: config.limit ?? 20
        })
      });
      const { data, error } = await safeReadJson(res);
      if (!data) {
        return {
          ok: false,
          signals: [],
          source: 'server',
          error: `${error || '后端返回异常'}（HTTP ${res.status}）`
        };
      }
      const ok = Boolean(data?.ok);
      const signals = Array.isArray(data?.signals) ? data.signals : [];
      if (!ok) {
        return {
          ok: false,
          signals,
          source: data?.source === 'cache' ? 'cache' : 'server',
          stale: Boolean(data?.stale),
          error: data?.error || `抓取失败（HTTP ${res.status}）`,
          droppedStale: Number(data?.droppedStale || 0),
          droppedUndated: Number(data?.droppedUndated || 0),
          rescuedUndated: Number(data?.rescuedUndated || 0)
        };
      }
      return {
        ok: true,
        signals,
        source: 'server',
        stale: false,
        droppedStale: Number(data?.droppedStale || 0),
        droppedUndated: Number(data?.droppedUndated || 0),
        rescuedUndated: Number(data?.rescuedUndated || 0),
        freshnessPolicy: data?.freshnessPolicy
      };
    } catch (e) {
      return { ok: false, signals: [], source: 'server', error: normalizeFetchError(e) };
    } finally {
      clearTimeout(timeout);
    }
  },
  fetchLatestSignals: async (): Promise<{ ok: boolean; lastRunAt?: string; regions?: string[]; industries?: string[]; signals: MarketSignal[]; error?: string }> => {
    try {
      const res = await fetch('/api/intel/latest');
      if (!res.ok) return { ok: false, signals: [], error: `拉取失败（HTTP ${res.status}）` };
      const { data, error } = await safeReadJson(res);
      if (!data) return { ok: false, signals: [], error: error || '后端返回异常' };
      const signals = Array.isArray(data?.signals) ? data.signals : [];
      return { ok: true, signals, lastRunAt: data?.lastRunAt || '', regions: data?.regions || [], industries: data?.industries || [] };
    } catch (e) {
      return { ok: false, signals: [], error: normalizeFetchError(e) };
    }
  }
};
