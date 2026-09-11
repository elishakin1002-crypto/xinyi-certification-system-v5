/// <reference types="vite/client" />

type SyncPayload = {
  datasets: Record<string, unknown>;
  baseDatasets?: Record<string, unknown>;
  source?: string;
  actorUserId?: string;
  clientId?: string;
  appVersion?: string;
};

const parseEnvelope = (raw: any) => {
  const hasCode = Number.isFinite(Number(raw?.code));
  const code = hasCode ? Number(raw.code) : undefined;
  const ok = hasCode ? code === 0 : Boolean(raw?.ok);
  const payload = raw && typeof raw?.data === 'object' ? raw.data : raw;
  const message = String(raw?.message || raw?.error || '');
  return { ok, code, payload, message };
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let latestPayload: SyncPayload | null = null;
let failedPayload: SyncPayload | null = null;
let inFlight = false;
let generation = 0;
const protectedKeys = new Set(['audit_issues_v1', 'project_work_logs_v1', 'task_templates_v1']);
const baselines = new Map<string, unknown>();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let syncError = '';
const listeners = new Set<() => void>();
const report = (message: string) => { syncError = message; listeners.forEach(fn => fn()); };
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => {
  if (inFlight || latestPayload || failedPayload) { event.preventDefault(); event.returnValue = ''; }
});

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const enabled = parseBoolean(import.meta.env.VITE_STATE_SYNC_ENABLED, true);
const readEnabled = parseBoolean(import.meta.env.VITE_STATE_SYNC_READ_ENABLED, false);
const debounceMs = Number(import.meta.env.VITE_STATE_SYNC_DEBOUNCE_MS || 1200);
const canaryUsers = String(import.meta.env.VITE_STATE_SYNC_CANARY_USERS || '')
  .split(',')
  .map((item: string) => item.trim())
  .filter(Boolean);

const isCanaryUser = (userId?: string) => {
  if (!userId) return canaryUsers.length === 0;
  if (canaryUsers.length === 0) return true;
  return canaryUsers.includes(userId);
};

const doSync = async (payload: SyncPayload) => {
  const epoch = generation;
  const datasets: Record<string, unknown> = {};
  const baseDatasets: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload.datasets)) {
    if (protectedKeys.has(key)) {
      if (!baselines.has(key)) throw new Error('数据尚未加载完成，本次未保存。请先导出未保存内容，再重新登录。');
      const base = baselines.get(key);
      if (JSON.stringify(base) === JSON.stringify(value)) continue;
      baseDatasets[key] = clone(base);
    }
    datasets[key] = value;
  }
  if (!Object.keys(datasets).length) return;
  const res = await fetch('/api/state/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, datasets, baseDatasets })
  });
  const body = await res.json();
  const parsed = parseEnvelope(body);
  if (!res.ok || !parsed.ok) throw new Error(parsed.message || `保存失败（${res.status}）`);
  // Keep the browser's own acknowledged view, not unseen remote rows.
  // Otherwise a later save would interpret unseen rows as local deletions.
  if (epoch === generation) for (const key of Object.keys(baseDatasets)) baselines.set(key, clone(datasets[key]));
};

const flush = async () => {
  if (inFlight || !latestPayload || failedPayload) return;
  const current = latestPayload;
  latestPayload = null;
  const epoch = generation;
  inFlight = true;
  try {
    await doSync(current);
    if (epoch === generation) report('');
  } catch (error) {
    if (epoch === generation) {
      failedPayload = current;
      report(error instanceof Error ? error.message : '保存失败，请检查网络后重试。');
    }
  } finally {
    inFlight = false;
    if (latestPayload && !failedPayload) void flush();
  }
};

export const stateSyncService = {
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,
  getCanaryUsers: () => [...canaryUsers],
  shouldUseBackendRead: (userId?: string) => readEnabled && isCanaryUser(userId),
  rememberBaseline: (key: string, value: unknown) => { baselines.set(key, clone(value)); },
  reset: () => {
    generation++;
    if (syncTimer) clearTimeout(syncTimer);
    latestPayload = null; failedPayload = null; baselines.clear(); report('');
  },
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSyncError: () => syncError,
  exportPending: () => clone(latestPayload || failedPayload || { datasets: {} }),
  retry: () => {
    latestPayload = latestPayload || failedPayload;
    failedPayload = null;
    void flush();
  },
  scheduleSync: (payload: SyncPayload) => {
    if (!enabled || !isCanaryUser(payload.actorUserId)) return;
    latestPayload = clone(payload);
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { void flush(); }, Math.max(200, debounceMs));
  },
  fetchState: async (keys: string[]) => {
    const q = keys.length > 0 ? `?keys=${encodeURIComponent(keys.join(','))}` : '';
    const res = await fetch(`/api/state/sync${q}`);
    const text = await res.text();
    if (!text) return { ok: false, datasets: {}, metadata: {}, error: 'empty response', status: res.status };
    try {
      const data = JSON.parse(text);
      const parsed = parseEnvelope(data);
      const payload = parsed.payload || {};
      if (!res.ok || !parsed.ok) {
        return {
          ok: false,
          code: parsed.code,
          datasets: payload?.datasets || {},
          metadata: payload?.metadata || {},
          error: parsed.message || `HTTP ${res.status}`,
          status: res.status,
          message: parsed.message
        };
      }
      return {
        ok: true,
        code: parsed.code,
        datasets: payload?.datasets || {},
        metadata: payload?.metadata || {},
        mode: payload?.mode,
        status: res.status,
        message: parsed.message
      };
    } catch {
      return { ok: false, datasets: {}, metadata: {}, error: 'invalid json response', status: res.status };
    }
  },
  health: async () => {
    const res = await fetch('/api/state/health');
    const text = await res.text();
    if (!text) return { ok: false, error: 'empty response' };
    try {
      const data = JSON.parse(text);
      const parsed = parseEnvelope(data);
      return parsed.ok ? { ok: true, ...(parsed.payload || {}) } : { ok: false, error: parsed.message || 'health failed' };
    } catch {
      return { ok: false, error: 'invalid json response' };
    }
  }
};
