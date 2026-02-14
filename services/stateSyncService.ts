/// <reference types="vite/client" />

type SyncPayload = {
  datasets: Record<string, unknown>;
  source?: string;
  actorUserId?: string;
  clientId?: string;
  appVersion?: string;
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
      if (!res.ok) {
        return {
          ok: false,
          datasets: data?.datasets || {},
          metadata: data?.metadata || {},
          error: data?.error || `HTTP ${res.status}`,
          status: res.status
        };
      }
      return { ...data, status: res.status };
    } catch {
      return { ok: false, datasets: {}, metadata: {}, error: 'invalid json response', status: res.status };
    }
  },
  health: async () => {
    const res = await fetch('/api/state/health');
    const text = await res.text();
    if (!text) return { ok: false, error: 'empty response' };
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: 'invalid json response' };
    }
  }
};
