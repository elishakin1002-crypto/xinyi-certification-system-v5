/// <reference types="vite/client" />

type SyncPayload = {
  datasets: Record<string, unknown>;
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
  const res = await fetch('/api/state/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `state sync failed: HTTP ${res.status}`);
  }
};

export const stateSyncService = {
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,
  getCanaryUsers: () => [...canaryUsers],
  shouldUseBackendRead: (userId?: string) => readEnabled && isCanaryUser(userId),
  scheduleSync: (payload: SyncPayload) => {
    if (!enabled) return;
    if (!isCanaryUser(payload.actorUserId)) return;
    latestPayload = payload;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      if (!latestPayload) return;
      const current = latestPayload;
      latestPayload = null;
      try {
        await doSync(current);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[StateSync] sync failed', msg);
      }
    }, Math.max(200, debounceMs));
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
