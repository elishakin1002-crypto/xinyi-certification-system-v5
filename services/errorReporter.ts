/**
 * 前端错误自动上报。
 *
 * ── 为什么要有 ────────────────────────────────────────────────
 * 同事踩了 bug 基本不会说。不是不配合：
 *   ① 他不确定这算 bug 还是自己不会用
 *   ② 说清楚要费半天口舌，还不一定说得明白
 *   ③ 手上有活要干，绕过去比报告快
 * 结果是问题一直在，而技术这边一无所知。
 *
 * 所以采集必须**完全自动，不要求人做任何事**。
 * 让同事「遇到问题请截图发我」这种方案，实践中等于没有方案。
 *
 * ── 几条不能破的规矩 ──────────────────────────────────────────
 *
 * 1）**上报本身绝不能影响用户**。
 *    所有失败静默吞掉。因为「错误上报失败」而弹一个错给用户，
 *    是这套东西最荒唐的失败方式。
 *
 * 2）**攒一批再发，不是每条一个请求**。
 *    错误常常是连续爆发的（渲染循环里每秒几十次），
 *    一条一个请求会把浏览器和服务器一起拖垮。
 *
 * 3）**本地也要去重**。同一个错误在一个批次里只留一条并计数，
 *    这样服务端收到的量级从「几千」降到「几条」。
 *
 * 4）**页面关掉之前要把攒着的发出去**。
 *    否则最有价值的那类错误 —— 导致用户直接关页面走人的 ——
 *    恰好是永远收不到的那类。
 */

type ClientErrorKind = 'js' | 'promise' | 'api' | 'render';

interface PendingError {
  kind: ClientErrorKind;
  message: string;
  source: string;
  stack: string;
  route: string;
  appVersion: string;
  count: number;
}

const APP_VERSION = 'v5.0';
const FLUSH_DELAY_MS = 5000;
const MAX_PENDING = 20;

const pending = new Map<string, PendingError>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

const currentRoute = () => {
  try {
    // HashRouter：真正的页面在 # 后面，location.pathname 永远是 /
    return String(window.location.hash || window.location.pathname || '').slice(0, 200);
  } catch {
    return '';
  }
};

/** 本地去重键。和服务端的指纹算法保持一致的思路：数字换占位符。 */
const keyOf = (kind: string, message: string, source: string) =>
  `${kind}|${message.replace(/\d+/g, 'N').slice(0, 200)}|${source.slice(0, 200)}`;

const flush = () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pending.size === 0) return;

  const errors = [...pending.values()];
  pending.clear();

  /*
    用 keepalive：页面正在卸载时普通 fetch 会被浏览器直接掐掉。
    而「让用户关掉页面走人」的那类错误恰恰是最该被看见的。
  */
  try {
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify({ errors }),
    }).catch(() => { /* 静默：上报失败不能变成用户的问题 */ });
  } catch { /* 同上 */ }
};

const scheduleFlush = () => {
  if (pending.size >= MAX_PENDING) { flush(); return; }
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
};

export const reportClientError = (
  kind: ClientErrorKind,
  message: string,
  options: { source?: string; stack?: string } = {},
) => {
  try {
    const msg = String(message || '').slice(0, 500);
    if (!msg) return;
    const source = String(options.source || '').slice(0, 300);
    const key = keyOf(kind, msg, source);
    const hit = pending.get(key);
    if (hit) { hit.count += 1; return; }
    pending.set(key, {
      kind,
      message: msg,
      source,
      stack: String(options.stack || '').slice(0, 2000),
      route: currentRoute(),
      appVersion: APP_VERSION,
      count: 1,
    });
    scheduleFlush();
  } catch { /* 采集自身出错就放弃这一条，绝不向上抛 */ }
};

/** 在应用入口调用一次。重复调用是安全的。 */
export const installErrorReporter = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    // 图片/脚本加载失败也会走到这里，它们没有 error 对象
    const err = (event as ErrorEvent).error;
    reportClientError('js', (event as ErrorEvent).message || String(err || '未知错误'), {
      source: `${(event as ErrorEvent).filename || ''}:${(event as ErrorEvent).lineno || 0}:${(event as ErrorEvent).colno || 0}`,
      stack: err?.stack || '',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    /*
      没被 catch 的 Promise。这类最容易漏 ——
      它不会让页面白屏，只是某个操作**悄无声息地没生效**，
      而用户多半以为是自己没点对。
    */
    const reason: any = (event as PromiseRejectionEvent).reason;
    reportClientError('promise', reason?.message || String(reason || '未处理的 Promise 拒绝'), {
      stack: reason?.stack || '',
    });
  });

  // 页面藏起来时先发一批。比 unload 可靠：手机上切走 App 往往不触发 unload
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
};

/** 给 fetch 失败的地方手动调用：接口报错是最能说明问题的一类。 */
export const reportApiError = (path: string, status: number, message: string) => {
  // 401 不报：那是「登录过期」，是正常流程不是 bug，报了只会淹没真正的问题
  if (status === 401) return;
  reportClientError('api', `${status} ${message || ''}`.trim(), { source: path });
};
