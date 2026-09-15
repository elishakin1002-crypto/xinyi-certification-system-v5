/**
 * 开机自检：配置里写的模型，厂商那边到底还在不在。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-09-15）
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来在战略管理点「让 AI 读这些数字」，转 60 秒，得到
 *     「AI 模型配置有误（指定的模型不存在）。请联系系统管理员。」
 *
 * 真因：`.env.local` 里 KIMI_MODEL=kimi-k2.5，而 Moonshot 早就下架了
 * 这个型号（现在是 kimi-k3 / k2.6 / k2.7-code*）。
 *
 * 最难受的地方在于：2026-09-03 已经在 services/aiService.ts 里把默认值
 * 从 k2.5 改成 k3 了，注释还写着「不再写死 kimi-k2.5」——
 * 但代码是 `envModel || 'kimi-k3'`，**配置里有值就轮不到兜底**。
 * 改的是代码，生效的还是配置里那个死型号。
 *
 * ── 为什么做成开机自检，而不是写进部署文档 ────────────────────
 *
 * CLAUDE.md 二点五第 2 条：「有个脚本可以跑」等于没有。
 * 模型会被厂商下架，这件事不受我们控制，也不会有人定期去查。
 * 唯一可靠的办法是**服务起来的时候自己问一句**，
 * 不可用就在启动日志里喊出来 —— 而不是等用户点一次、转 60 秒、
 * 再来问「AI 又坏了」。
 *
 * 自检只发一次最小请求（max_tokens 极小），成本可以忽略。
 * 它**不会**让服务起不来：模型坏了系统其它部分照常能用，
 * 拦着不让启动反而是更大的事故。
 */

/** 发一个最小的请求确认这个型号还能用。返回 { ok, reason } */
const probeModel = async ({ baseUrl, apiKey, model, timeoutMs = 15000 }) => {
  if (!apiKey) return { ok: false, reason: '没有配 API Key' };
  if (!model) return { ok: false, reason: '没有配型号' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
    });
    if (res.ok) return { ok: true };
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = (body && body.error && body.error.message) || detail;
    } catch { /* 厂商没回 JSON，保留 HTTP 状态码 */ }
    return { ok: false, reason: detail };
  } catch (e) {
    // 超时和网络不通不算"型号不存在" —— 别把临时故障报成配置错误
    return { ok: false, reason: e.name === 'AbortError' ? `${timeoutMs / 1000}s 内没响应` : e.message };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 检查所有配置了 Key 的厂商。只打日志，不抛异常、不阻止启动。
 *
 * 型号不可用是**要人去改配置**的事，不是"系统坏了"——
 * 其它功能照常能用，所以绝不能因为这个让服务起不来。
 */
const checkConfiguredModels = async ({ log = console } = {}) => {
  const targets = [
    {
      name: 'Moonshot(Kimi)',
      baseUrl: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
      apiKey: process.env.KIMI_API_KEY,
      model: process.env.KIMI_MODEL,
      envKey: 'KIMI_MODEL'
    },
    {
      name: 'DeepSeek',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL,
      envKey: 'DEEPSEEK_MODEL'
    }
  ].filter(t => t.apiKey);

  if (targets.length === 0) return [];

  const results = await Promise.all(targets.map(async (t) => {
    const r = await probeModel(t);
    return { ...t, ...r };
  }));

  for (const r of results) {
    if (r.ok) {
      log.info?.(`[模型自检] ${r.name} ${r.model} 可用`);
    } else {
      /*
        写清"改哪个键"而不是只说不行 —— 项目规矩：
        给用户的文案要说清后果和下一步，给运维的日志也一样。
      */
      log.warn?.(
        `[模型自检] ${r.name} 的 ${r.model || '(未配置)'} 不可用：${r.reason}\n` +
        `            改 .env.local 的 ${r.envKey}。用到这个模型的功能会报「模型配置有误」，\n` +
        `            其它功能不受影响。可用型号问厂商的 /models 接口。`
      );
    }
  }
  return results;
};

module.exports = { probeModel, checkConfiguredModels };
