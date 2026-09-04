// 系统管理员总览：运维视角要看的东西，一个接口取全。
//
// ── 为什么单独做一个接口，而不是让前端拼 ──────────────────────
// 这些数字来自六七张表和几个健康检查。前端逐个去拉的话，
// 首屏要发七八个请求，任何一个慢都会让整块看板卡住。
// 而这块看板的用途是**扫一眼有没有事**，慢就等于没用。
//
// 每一块都独立 try/catch：一张表出问题不能让整块看板空白 ——
// 那时候最需要的恰恰是看到「哪一块坏了」。
const express = require('express');
const pool = require('../db/pool');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');

const router = express.Router();

/*
  只给总经理和系统管理员。

  守卫写在路由内部，**不能用 app.use(中间件, 路由) 的形式挂** ——
  那样中间件会作用在所有走到这一层的请求上，不只是这个路由，
  等于把整站都锁成「只有管理员能访问」。
  这个错第一版就犯了，靠读代码才发现，跑起来会是全站 403。

  这块数据里有在线会话、来源 IP、AI 花费 —— 都不该给普通同事看。
*/
const requireOpsRole = (req, res, next) => {
  const roles = (Array.isArray(req.authUser?.roles) ? req.authUser.roles : [])
    .map((r) => String(r || '').toUpperCase());
  if (!req.authUser) {
    return sendFail(res, ERROR_CODES.NOT_LOGIN, 'Login required', {}, 401);
  }
  if (!roles.some((r) => r === 'ADMIN' || r === 'SYS_ADMIN')) {
    return sendFail(res, ERROR_CODES.NO_PERMISSION, '仅总经理与系统管理员可查看运维总览', {}, 403);
  }
  return next();
};

/** 单块失败不影响其他块。返回 null 表示这块取不到，前端显示「暂不可用」。 */
const safe = async (fn, label) => {
  try { return await fn(); }
  catch (e) { console.warn(`[sysadminOverview] ${label} 取数失败:`, e?.message || e); return null; }
};

const one = async (sql, params = []) => {
  const r = await pool.query(sql, params);
  return r.rows?.[0] || {};
};
const all = async (sql, params = []) => {
  const r = await pool.query(sql, params);
  return r.rows || [];
};

router.get('/api/admin/sysadmin-overview', requireOpsRole, async (req, res) => {
  if (!pool.isEnabled()) return sendFail(res, ERROR_CODES.SERVER_ERROR, '数据库未启用', {}, 500);

  try {
    const [errors, ai, security, data, versionInfo] = await Promise.all([
      // ── 前端错误 ───────────────────────────────────────────
      safe(async () => ({
        today: await one(`
          SELECT COALESCE(COUNT(*), 0)::int AS kinds,
                 COALESCE(SUM(count), 0)::int AS occurrences,
                 COALESCE(COUNT(*) FILTER (WHERE status = 'new'), 0)::int AS unhandled
            FROM client_errors WHERE day = CURRENT_DATE`),
        top: await all(`
          SELECT kind, message, route, count,
                 COALESCE(array_length(user_ids, 1), 0) AS affected, status
            FROM client_errors
           WHERE day >= CURRENT_DATE - 7 AND status = 'new'
           ORDER BY affected DESC, count DESC LIMIT 5`),
      }), '前端错误'),

      // ── AI 用量 ────────────────────────────────────────────
      safe(async () => ({
        month: await one(`
          SELECT COUNT(*)::int AS calls,
                 COUNT(*) FILTER (WHERE NOT ok)::int AS failures,
                 COALESCE(SUM(total_tokens), 0)::bigint AS tokens
            FROM ai_usage_log
           WHERE created_at >= date_trunc('month', NOW())`),
        today: await one(`
          SELECT COUNT(*)::int AS calls, COALESCE(SUM(total_tokens), 0)::bigint AS tokens
            FROM ai_usage_log WHERE created_at >= CURRENT_DATE`),
        /*
          按天分布（近 7 天）。

          2026-09-04 管理员问「昨天 AI 花了多少」，AI 只能答「没有这个口径」——
          它没编，这是对的，但**「昨天花了多少」本来就是个合理的问题**，
          答不上来是数据缺口，不是提问方式不对。

          顺带解决另一件更重要的事：**判断异常要看趋势，不是看总量。**
          「本月 ¥180」说明不了什么，「今天是平时的 8 倍」才是要立刻查的信号。
        */
        byDay: await all(`
          SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD') AS day,
                 COUNT(*)::int AS calls,
                 COALESCE(SUM(total_tokens), 0)::bigint AS tokens
            FROM ai_usage_log
           WHERE created_at >= CURRENT_DATE - 6
           GROUP BY 1 ORDER BY 1 DESC`),
        byUser: await all(`
          SELECT COALESCE(NULLIF(actor_name, ''), '(未知)') AS name,
                 COUNT(*)::int AS calls, COALESCE(SUM(total_tokens), 0)::bigint AS tokens
            FROM ai_usage_log WHERE created_at >= date_trunc('month', NOW())
           GROUP BY 1 ORDER BY 3 DESC LIMIT 8`),
      }), 'AI 用量'),

      // ── 安全 ───────────────────────────────────────────────
      safe(async () => ({
        sessions: await all(`
          SELECT u.name, u.username,
                 CASE WHEN s.ip = '' THEN '(未记录)' ELSE s.ip END AS ip,
                 s.created_at, s.last_seen_at
            FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
           WHERE s.expires_at > NOW()
           ORDER BY s.created_at DESC LIMIT 20`),
        accounts: await one(`
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE must_change_password)::int AS pending_password,
                 COUNT(*) FILTER (WHERE status = 'disabled')::int AS disabled,
                 COUNT(*) FILTER (WHERE account_expires_at IS NOT NULL
                                    AND account_expires_at < CURRENT_DATE)::int AS expired`),
        // 被服务端授权拦下来的请求：突然变多说明要么有人在试探，要么权限配错了
        deniedRecent: await one(`
          SELECT COUNT(*)::int AS n FROM business_events
           WHERE created_at >= NOW() - INTERVAL '7 days'
             AND (event_type ILIKE '%denied%' OR event_type ILIKE '%forbidden%')`),
      }), '安全'),

      // ── 数据规模 ───────────────────────────────────────────
      safe(async () => ({
        size: (await one(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`)).size,
        rows: await all(`
          SELECT relname AS table, n_live_tup::int AS rows
            FROM pg_stat_user_tables WHERE n_live_tup > 0
           ORDER BY n_live_tup DESC LIMIT 8`),
      }), '数据规模'),

      // ── 版本与迁移 ─────────────────────────────────────────
      safe(async () => ({
        applied: (await one(`SELECT COUNT(*)::int AS n FROM schema_migrations`)).n,
        latest: (await one(`SELECT MAX(id) AS id FROM schema_migrations`)).id,
      }), '迁移'),
    ]);

    return sendSuccess(res, {
      errors, ai, security, data,
      version: {
        app: 'v5.0',
        node: process.version,
        // 进程跑了多久：频繁重启说明在崩溃循环，而看板上不写就发现不了
        uptimeHours: Math.round((process.uptime() / 3600) * 10) / 10,
        migrations: versionInfo,
      },
      generatedAt: new Date().toISOString(),
    }, 'success');
  } catch (error) {
    return sendFail(res, ERROR_CODES.SERVER_ERROR, error?.message || '总览取数失败', {}, 500);
  }
});

module.exports = router;
