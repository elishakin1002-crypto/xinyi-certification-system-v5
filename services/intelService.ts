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
  droppedGeo?: number;
  droppedGeoConflict?: number;
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

const buildApiBaseCandidates = () => {
  const configured = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  const configuredPort = Number(import.meta.env.VITE_API_PORT || 0);
  const enableLocalFallbacks = /^(1|true|yes|on)$/i.test(
    String(import.meta.env.VITE_INTEL_LOCAL_FALLBACKS_ENABLED || '').trim()
  );
  const list = [
    '',
    configured,
    configuredPort > 0 ? `http://127.0.0.1:${configuredPort}` : '',
    ...(enableLocalFallbacks ? ['http://127.0.0.1:3101', 'http://127.0.0.1:3001'] : [])
  ].filter(Boolean);
  return Array.from(new Set(list));
};

const joinApiUrl = (base: string, path: string) => {
  if (!base) return path;
  return `${base.replace(/\/+$/, '')}${path}`;
};

const isLikelyWrongBackend = (res: Response, raw: any, parseError?: string) => {
  if ([404, 405, 502, 503, 504].includes(res.status)) return true;
  if (parseError) return true;
  const hasEnvelope = Number.isFinite(Number(raw?.code)) || typeof raw?.ok === 'boolean';
  return !hasEnvelope;
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

const parseEnvelope = (raw: any) => {
  const hasCode = Number.isFinite(Number(raw?.code));
  const code = hasCode ? Number(raw.code) : undefined;
  const payload = raw && typeof raw?.data === 'object' ? raw.data : raw;
  const ok = hasCode ? code === 0 : Boolean(raw?.ok);
  const message = String(raw?.message || raw?.error || '');
  return { ok, code, payload, message };
};

export const intelService = {
  fetchDailySignals: async (config: IntelFetchConfig): Promise<IntelFetchResult> => {
    const timeoutMs = Number(import.meta.env.VITE_INTEL_FETCH_TIMEOUT_MS || 30000);
    const candidates = buildApiBaseCandidates();
    try {
      let lastError = '抓取失败';
      for (const base of candidates) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(5000, timeoutMs));
        try {
          const res = await fetch(joinApiUrl(base, '/api/intel/fetch'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: controller.signal,
            body: JSON.stringify({
              regions: config.regions,
              industries: config.industries,
              limit: config.limit ?? 20
            })
          });
          const { data, error } = await safeReadJson(res);
          if (!data) {
            lastError = `${error || '后端返回异常'}（HTTP ${res.status}）`;
            if (isLikelyWrongBackend(res, null, error)) continue;
            return { ok: false, signals: [], source: 'server', error: lastError };
          }
          const parsed = parseEnvelope(data);
          const payload = parsed.payload || {};
          const signals = Array.isArray(payload?.signals) ? payload.signals : [];
          if (!res.ok || !parsed.ok) {
            lastError = parsed.message || `抓取失败（HTTP ${res.status}）`;
            if (isLikelyWrongBackend(res, data)) continue;
            return {
              ok: false,
              signals,
              source: payload?.source === 'cache' ? 'cache' : 'server',
              stale: Boolean(payload?.stale),
              error: lastError,
              droppedStale: Number(payload?.droppedStale || 0),
              droppedUndated: Number(payload?.droppedUndated || 0),
              rescuedUndated: Number(payload?.rescuedUndated || 0),
              droppedGeo: Number(payload?.droppedGeo || 0),
              droppedGeoConflict: Number(payload?.droppedGeoConflict || 0)
            };
          }
          return {
            ok: true,
            signals,
            source: payload?.source === 'cache' ? 'cache' : 'server',
            stale: Boolean(payload?.stale),
            droppedStale: Number(payload?.droppedStale || 0),
            droppedUndated: Number(payload?.droppedUndated || 0),
            rescuedUndated: Number(payload?.rescuedUndated || 0),
            droppedGeo: Number(payload?.droppedGeo || 0),
            droppedGeoConflict: Number(payload?.droppedGeoConflict || 0),
            freshnessPolicy: payload?.freshnessPolicy
          };
        } finally {
          clearTimeout(timeout);
        }
      }
      return { ok: false, signals: [], source: 'server', error: lastError };
    } catch (e) {
      return { ok: false, signals: [], source: 'server', error: normalizeFetchError(e) };
    }
  },
  fetchLatestSignals: async (): Promise<{ ok: boolean; lastRunAt?: string; regions?: string[]; industries?: string[]; signals: MarketSignal[]; error?: string }> => {
    try {
      const candidates = buildApiBaseCandidates();
      let lastError = '拉取失败';
      for (const base of candidates) {
        const res = await fetch(joinApiUrl(base, '/api/intel/latest'), { credentials: 'include' });
        const { data, error } = await safeReadJson(res);
        if (!data) {
          lastError = error || `拉取失败（HTTP ${res.status}）`;
          if (isLikelyWrongBackend(res, null, error)) continue;
          return { ok: false, signals: [], error: lastError };
        }
        const parsed = parseEnvelope(data);
        if (!res.ok || !parsed.ok) {
          lastError = parsed.message || `拉取失败（HTTP ${res.status}）`;
          if (isLikelyWrongBackend(res, data)) continue;
          return { ok: false, signals: [], error: lastError };
        }
        const payload = parsed.payload || {};
        const signals = Array.isArray(payload?.signals) ? payload.signals : [];
        return { ok: true, signals, lastRunAt: payload?.lastRunAt || '', regions: payload?.regions || [], industries: payload?.industries || [] };
      }
      return { ok: false, signals: [], error: lastError };
    } catch (e) {
      return { ok: false, signals: [], error: normalizeFetchError(e) };
    }
  },
  
};
