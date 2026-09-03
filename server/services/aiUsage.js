// AI 用量计量与配额（待办 P0-10）。
//
// ── 这个模块防的是什么 ────────────────────────────────────────
// **不是**限制正常使用。10 个人的公司，正常用量根本到不了任何上限。
// 防的是「程序跑飞」：某个页面写出循环、某个重试没有退避、
// 有人反复点一个按钮——这类事故的特征是量级异常，不是稍微多用了点。
//
// 所以上限定得很宽（顾问一天 30 万 tokens，约正常用量的 7 倍），宽到正常人碰不到、
// 而循环跑起来几分钟就撞上。定得太紧的配额会被绕过或者被要求关掉，
// 那时它就一点用都没有了。
//
// ── 记录和拦截是两件事 ────────────────────────────────────────
// 记录**永不失败**：计量写不进去不该让 AI 功能不可用。
// 拦截会失败：撞上限就是撞上限，明确告诉用户还剩多少、什么时候恢复。
//
// ── 取不到 token 数时如实记 NULL ──────────────────────────────
// provider 返回体里有 usage 就用真实值，没有就存空。
// **不要用字符数估算冒充**——中英文混排能差出几倍，
// 假的精确比明说不知道更危险，尤其这个数字是拿来做预算判断的。
const crypto = require('node:crypto');
const pool = require('../db/pool');

/**
 * 每人每天的 token 上限。取角色里最宽的一个。
 *
 * ── 为什么从「调用次数」改成「token」（2026-09-03）──────────────
 * 原来数的是 count(*)：一次问「在吗」和一次扔进 30 页合同 PDF 都算 1 次，
 * 而两者的成本差几十倍。**按次数限额根本管不住钱**——
 * 200 次闲聊可能花一毛，20 次合同解析可能花十块。
 *
 * ── 这个上限的定位是「熔断」，不是「配给」────────────────────
 * 按线上实测：一次对话中位数约 1200 tokens，最大 2134。
 * 一个人一天认真用 30 次也就 4 万 tokens。
 * 下面给的额度是这个量的 5 倍以上 —— **正常干活永远碰不到**。
 *
 * 它防的是另一件事：**程序 bug 打成死循环、或者有人反复拖同一份大文件**。
 * 那种情况一晚上能烧掉一个月的预算，而且没人会发现。
 *
 * 所以：额度定得宽，宁可漏也不要误伤 ——
 * 一个同事因为「怕超额」而不敢用 AI，损失远大于省下的那几块钱。
 *
 * ── 价格参考（2026-09，每百万 token，美元）────────────────────
 *   deepseek-v4-pro    输入 0.66~1.32（谷/峰）  输出 1.98~3.96
 *   deepseek-v4-flash  输入 0.22~0.44          输出 0.66~1.32
 *   kimi-k3            输入 3.00               输出 15.00
 * 20 万 tokens 走 DeepSeek 峰时大约 ¥3，走 Kimi 大约 ¥15。
 */
const DAILY_TOKEN_LIMIT_BY_ROLE = {
  // 总经理和系统管理员不设限。上线期要能随便测，
  // 卡住这两个账号省下的钱，远不如「因为怕超额而不敢用」的损失大。
  ADMIN: Infinity,
  SYS_ADMIN: Infinity,
  MANAGER: 400_000,
  SALES: 300_000,
  CONSULTANT: 300_000,
  FINANCE: 200_000,
};

/*
  没有会话的内部调用（情报雷达定时抓取、月度复盘）。

  给得比人宽：它一次要读几十条情报，单次 token 量本来就大，
  而且它是无人值守跑的 —— 卡住了没人知道，第二天才发现情报没更新。
*/
const SYSTEM_DAILY_TOKEN_LIMIT = 1_000_000;

/*
  全公司一天的总上限。**这才是真正的熔断闸**。

  单人额度防不住「所有人同时出问题」，也防不住系统调用失控。
  这一条是最后一道：无论谁在用、用什么，一天烧到这个数就全停。

  按上面的价格，200 万 tokens 走 DeepSeek 峰时约 ¥30 ——
  一天烧掉 30 块说明肯定出事了，停下来查是对的。
*/
const COMPANY_DAILY_TOKEN_LIMIT = Number(process.env.AI_COMPANY_DAILY_TOKENS || 2_000_000);

const limitFor = (roles = []) => {
  const list = Array.isArray(roles) ? roles : [];
  if (list.length === 0) return DAILY_TOKEN_LIMIT_BY_ROLE.CONSULTANT;
  return Math.max(...list.map((r) => DAILY_TOKEN_LIMIT_BY_ROLE[String(r).toUpperCase()] ?? 0));
};

/** 从 express 的 req 上认出调用人。没有会话就算系统调用 */
const actorFrom = (req) => {
  const u = req?.authUser;
  if (!u) return { userId: '', name: '(系统)', roles: [], kind: 'system' };
  return {
    userId: String(u.id || ''),
    name: String(u.name || u.username || u.email || ''),
    roles: Array.isArray(u.roles) ? u.roles : [],
    kind: 'user',
  };
};

/** 取用量表里的 usage。各家 provider 的 OpenAI 兼容响应都是这个形状 */
const usageFrom = (raw) => {
  const u = raw?.usage;
  if (!u || typeof u !== 'object') return { prompt: null, completion: null, total: null };
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
  return { prompt: num(u.prompt_tokens), completion: num(u.completion_tokens), total: num(u.total_tokens) };
};

/**
 * 今天用了多少次。
 * 用 PG 的 CURRENT_DATE 而不是 JS 的当天——服务器时区和进程时区可能不一致，
 * 两边各算各的会导致「配额在午夜前后跳来跳去」。
 */
const usedToday = async (actor) => {
  if (!pool.isEnabled()) return 0;
  const where = actor.kind === 'system'
    ? { sql: "actor_kind = 'system'", params: [] }
    : { sql: 'actor_user_id = $1', params: [actor.userId] };
  /*
    统计 token 不是次数。

    COALESCE 到 0：拿不到 token 的调用（上游没返回 usage）算 0 而不是跳过整行——
    宁可少算也不能因为一条 NULL 让整个 SUM 变成 NULL，
    那会让额度检查静默失效，而且是往「无限放行」的方向失效。
  */
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(total_tokens, 0)), 0)::bigint n FROM ai_usage_log
      WHERE ${where.sql} AND created_at >= CURRENT_DATE AND ok = TRUE`, where.params);
  return Number(rows[0]?.n || 0);
};

/** 全公司今天用掉的 token。最后一道熔断闸靠它。 */
const companyUsedToday = async () => {
  if (!pool.isEnabled()) return 0;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(total_tokens, 0)), 0)::bigint n FROM ai_usage_log
      WHERE created_at >= CURRENT_DATE AND ok = TRUE`);
  return Number(rows[0]?.n || 0);
};

/**
 * 配额检查。返回 { allowed, used, limit, message }。
 *
 * **数据库不可用时一律放行。** 计量是保护措施，不是业务功能——
 * 让一个辅助设施的故障去阻断主功能，那是在用小问题制造大问题。
 */
const checkQuota = async (req) => {
  const actor = actorFrom(req);
  const limit = actor.kind === 'system' ? SYSTEM_DAILY_TOKEN_LIMIT : limitFor(actor.roles);
  if (!Number.isFinite(limit)) return { allowed: true, used: 0, limit: Infinity, actor };

  let used = 0;
  try {
    used = await usedToday(actor);
  } catch (e) {
    console.warn('[aiUsage] 配额查询失败，放行:', e?.message || e);
    return { allowed: true, used: 0, limit, actor, degraded: true };
  }

  if (used >= limit) {
    return {
      allowed: false,
      used,
      limit,
      actor,
      message: `今天的 AI 用量已达上限（${Math.round(used / 1000)}k/${Math.round(limit / 1000)}k tokens）。`
        + `这个上限是用来兜底防止程序异常的，正常使用碰不到——`
        + `如果你确实需要，请找系统管理员放开。明天零点恢复。`,
    };
  }

  /*
    全公司总闸。放在个人额度之后：个人超了先说个人的，信息更具体。
    这一道防的是「所有人同时出问题」和系统调用失控 ——
    单人额度对这两种情况都无能为力。
  */
  try {
    const companyUsed = await companyUsedToday();
    if (companyUsed >= COMPANY_DAILY_TOKEN_LIMIT) {
      return {
        allowed: false,
        used,
        limit,
        actor,
        message: `全公司今天的 AI 用量已达上限（${Math.round(companyUsed / 1000)}k tokens）。`
          + `这通常意味着系统出了异常（比如某个功能在反复调用），`
          + `已自动暂停以免继续产生费用。请联系系统管理员。`,
      };
    }
  } catch (e) {
    // 总闸查不到就放行——它是保护措施，不能反过来把业务卡死
    console.warn('[aiUsage] 公司总额度查询失败，放行:', e?.message || e);
  }

  return { allowed: true, used, limit, actor };
};

/**
 * 记一笔用量。**永不抛异常**——计量写失败不该让 AI 功能挂掉。
 */
const record = async ({ req, actor, endpoint, feature, modelRequested, modelUsed, raw, ok = true, errorCode = '', durationMs = 0 }) => {
  if (!pool.isEnabled()) return;
  const who = actor || actorFrom(req);
  const u = usageFrom(raw);
  try {
    await pool.query(
      `INSERT INTO ai_usage_log (
         id, actor_user_id, actor_name, actor_roles, actor_kind,
         endpoint, feature, model_requested, model_used,
         prompt_tokens, completion_tokens, total_tokens, ok, error_code, duration_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        `AIU-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        who.userId || null, who.name || null, (who.roles || []).join(',') || null, who.kind || 'user',
        endpoint || null, feature || null, modelRequested || null, modelUsed || null,
        u.prompt, u.completion, u.total,
        Boolean(ok), errorCode || null, Math.round(durationMs) || 0,
      ]);
  } catch (e) {
    console.warn('[aiUsage] 记账失败（不影响 AI 调用）:', e?.message || e);
  }
};

/** 用量汇总。给老板看「这个月花在哪了」 */
const summary = async ({ days = 30 } = {}) => {
  if (!pool.isEnabled()) return { enabled: false };
  const since = `NOW() - INTERVAL '${Math.max(1, Math.min(365, Number(days) || 30))} days'`;

  const [byUser, byFeature, byDay, totals] = await Promise.all([
    pool.query(`SELECT coalesce(actor_name,'(未知)') AS name, count(*)::int calls,
                       coalesce(sum(total_tokens),0)::bigint tokens
                  FROM ai_usage_log WHERE created_at >= ${since}
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    pool.query(`SELECT coalesce(nullif(feature,''), endpoint, '(未标注)') AS feature, count(*)::int calls,
                       coalesce(sum(total_tokens),0)::bigint tokens
                  FROM ai_usage_log WHERE created_at >= ${since}
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    pool.query(`SELECT to_char(created_at,'YYYY-MM-DD') AS day, count(*)::int calls,
                       coalesce(sum(total_tokens),0)::bigint tokens
                  FROM ai_usage_log WHERE created_at >= ${since}
                 GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT count(*)::int calls,
                       count(*) FILTER (WHERE NOT ok)::int failures,
                       coalesce(sum(total_tokens),0)::bigint tokens,
                       count(*) FILTER (WHERE total_tokens IS NULL)::int unmetered
                  FROM ai_usage_log WHERE created_at >= ${since}`),
  ]);

  return {
    enabled: true,
    days,
    totals: {
      calls: totals.rows[0].calls,
      failures: totals.rows[0].failures,
      tokens: Number(totals.rows[0].tokens),
      // provider 没返回 usage 的调用数。**要显示出来**，
      // 否则「总 token」看起来精确，实际上漏了一部分而没人知道
      unmetered: totals.rows[0].unmetered,
    },
    byUser: byUser.rows.map((r) => ({ ...r, tokens: Number(r.tokens) })),
    byFeature: byFeature.rows.map((r) => ({ ...r, tokens: Number(r.tokens) })),
    byDay: byDay.rows.map((r) => ({ ...r, tokens: Number(r.tokens) })),
  };
};

module.exports = {
  checkQuota, record, summary, actorFrom, usageFrom, limitFor,
  DAILY_TOKEN_LIMIT_BY_ROLE, COMPANY_DAILY_TOKEN_LIMIT, companyUsedToday,
};
