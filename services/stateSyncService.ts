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
/*
  ── 主动退出登录时不许再拦人（2026-09-15 修）────────────────────────

  这个守卫本身是对的：有没保存的内容就别让人直接关页面。
  但它把**主动退出**也拦住了，而且拦得很隐蔽：

    点「退出登录」→ 清 cookie
    → 队列里那笔防抖写入这时才发出 → 401 Login required
    → failedPayload 置上、红条弹出「有内容尚未保存到服务器」
    → handleLogout 最后的 reload 触发 beforeunload
    → 这里看到 failedPayload，preventDefault，**页面不走了**

  于是人停在原来的工作台上，看着一条看不懂的英文报错。
  后果正是 handleLogout 那段注释当初要防的事故：
  **共用电脑上退不出去，下一个人看到上一个人的数据。**

  真正该做的是在清 cookie **之前**把待写内容落盘（那时还有登录态），
  落完再放行。所以这里加一个显式的 signingOut 开关，
  由 prepareSignOut() 打开 —— 不靠猜「这次 unload 是不是退出」。
*/
let signingOut = false;
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => {
  if (signingOut) return;
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
  if (!res.ok || !parsed.ok) {
    /*
      401 直接把服务端的 'Login required' 抛给界面，人看到的就是一行英文。
      项目规矩：给用户的文案要说清后果和下一步。
    */
    if (res.status === 401) throw new Error('登录已过期，这次没能保存。请重新登录后再试。');
    throw new Error(parsed.message || `保存失败（${res.status}）`);
  }
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
  /**
   * 退出登录前把待写内容落盘，然后放行 unload。
   *
   * **必须在清 cookie 之前调用** —— 那时还有登录态，写得进去。
   * 返回 false 表示有内容没保住，调用方该告诉人，而不是当没发生。
   *
   * 不管成没成，最后都把守卫关掉：人已经按了退出，
   * 再拦着不让走只会让他停在一个登不出去的页面上（2026-09-15 就是这样）。
   */
  prepareSignOut: async (waitMs = 5000): Promise<boolean> => {
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    const deadline = Date.now() + Math.max(0, waitMs);
    while ((inFlight || latestPayload) && Date.now() < deadline) {
      if (!inFlight && latestPayload) await flush();
      else await new Promise(resolve => setTimeout(resolve, 100));
    }
    const saved = !latestPayload && !failedPayload && !inFlight;
    signingOut = true;
    generation++;                       // 还在飞的请求回来时别再动状态
    latestPayload = null; failedPayload = null; baselines.clear(); report('');
    return saved;
  },
  /** 取消退出（人在确认框里点了「取消」）—— 守卫要装回去 */
  cancelSignOut: () => { signingOut = false; },
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
