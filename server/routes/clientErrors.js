// 前端错误上报接收端。
//
// ── 设计上的几个硬约束 ────────────────────────────────────────
//
// 1）**绝不能因为上报失败而影响用户**。
//    这条链路存在的意义是「顺手记一笔」，任何一步出问题都吞掉，
//    返回 204。让用户因为「错误上报接口挂了」而看到错误，是最荒唐的结果。
//
// 2）**必须限流**。前端错误最典型的形态是渲染循环里每秒抛几十次。
//    不限流的话，一个人的一次崩溃就能把服务器和数据库打满 ——
//    观察设施反过来变成故障源。
//
// 3）**必须脱敏**。错误消息里经常带着业务数据（客户名、合同金额、
//    手机号），因为那些值就在出错的那行代码附近。
//    这张表将来是要拿出来看的，不该把客户信息复制一份进去。
const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');

const router = express.Router();

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;
const MAX_BATCH = 20;

/*
  简单的内存限流：每个来源每分钟最多 30 条。

  用内存不用 Redis，是因为**这是观察设施，不是账本**：
  掉几条错误报告无所谓，为它引入一个依赖不值当。
  进程重启计数清零也可以接受。
*/
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const rateBuckets = new Map();

const rateLimited = (key) => {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    rateBuckets.set(key, { start: now, n: 1 });
    return false;
  }
  bucket.n += 1;
  return bucket.n > RATE_MAX;
};

// 定期清掉过期的桶，否则 Map 会随着 IP 数量无限增长
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) {
    if (now - v.start > RATE_WINDOW_MS * 5) rateBuckets.delete(k);
  }
}, RATE_WINDOW_MS * 5).unref();

/*
  脱敏。

  这几类值出现在错误消息里，几乎总是业务数据而不是排查线索：
  手机号、身份证、金额、邮箱、长数字串。
  把它们换成占位符，不影响「这是哪个 bug」的判断 ——
  指纹靠的是错误类型和代码位置，不是具体数值。
*/
const redact = (text) => String(text || '')
  .replace(/1[3-9]\d{9}/g, '<手机号>')
  .replace(/\d{17}[\dXx]/g, '<身份证>')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<邮箱>')
  .replace(/¥\s?[\d,]+(\.\d+)?/g, '<金额>')
  .replace(/\b\d{9,}\b/g, '<长数字>');

/*
  指纹：决定「这两次是不是同一个 bug」。

  只用类型 + 消息 + 位置，**不含具体数值和用户信息** ——
  含了的话同一个 bug 会因为客户名不同而散成几十个指纹，
  聚合就白做了。
*/
const fingerprintOf = (kind, message, source) => crypto
  .createHash('sha1')
  .update([
    kind,
    // 数字换成占位符：「第 3 项未定义」和「第 7 项未定义」是同一个 bug
    String(message || '').replace(/\d+/g, 'N').slice(0, 200),
    String(source || '').slice(0, 200),
  ].join('|'))
  .digest('hex')
  .slice(0, 16);

const clean = (v, max) => redact(String(v || '')).trim().slice(0, max);

router.post('/api/client-errors', async (req, res) => {
  // 数据库没启用就直接当收下了 —— 见上面第 1 条约束
  if (!pool.isEnabled()) return res.status(204).end();

  try {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const rateKey = req.authUser?.id || forwarded || req.ip || 'anon';
    if (rateLimited(rateKey)) return res.status(204).end();

    const items = Array.isArray(req.body?.errors) ? req.body.errors.slice(0, MAX_BATCH) : [];
    if (items.length === 0) return res.status(204).end();

    const userId = String(req.authUser?.id || '').trim();
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);

    for (const item of items) {
      const kind = ['js', 'promise', 'api', 'render'].includes(item?.kind) ? item.kind : 'js';
      const message = clean(item?.message, MAX_MESSAGE);
      if (!message) continue;
      const source = clean(item?.source, 300);
      const stack = clean(item?.stack, MAX_STACK);
      const route = String(item?.route || '').slice(0, 200);
      const appVersion = String(item?.appVersion || '').slice(0, 40);
      const fp = fingerprintOf(kind, message, source);

      await pool.query(
        `
          INSERT INTO client_errors
            (id, fingerprint, day, kind, message, source, stack, route, user_agent, app_version, count, user_ids)
          VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, $9, 1, CASE WHEN $10 = '' THEN '{}'::text[] ELSE ARRAY[$10] END)
          ON CONFLICT (day, fingerprint) DO UPDATE SET
            count        = client_errors.count + 1,
            last_seen_at = NOW(),
            -- 只有没记过这个人才追加，否则一个人报 100 次数组就有 100 个重复
            user_ids     = CASE
                             WHEN $10 = '' OR client_errors.user_ids @> ARRAY[$10] THEN client_errors.user_ids
                             ELSE client_errors.user_ids || ARRAY[$10]
                           END,
            -- 已经标记修复的错误又出现了，说明没修好，退回 new
            status       = CASE WHEN client_errors.status = 'fixed' THEN 'new' ELSE client_errors.status END
        `,
        [
          `CERR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
          fp, kind, message, source, stack, route, userAgent, appVersion, userId,
        ]
      );
    }
    return res.status(204).end();
  } catch (error) {
    // 吞掉。上报失败不能变成用户看得见的问题
    console.warn('[clientErrors] 记录失败（不影响用户）:', error?.message || error);
    return res.status(204).end();
  }
});

/** 给管理员看的列表。默认只看最近 7 天还没处理的。 */
router.get('/api/client-errors', async (req, res) => {
  if (!pool.isEnabled()) return sendFail(res, ERROR_CODES.SERVER_ERROR, '数据库未启用', {}, 500);
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const status = String(req.query.status || '').trim();
    const rows = await pool.query(
      `
        SELECT id, fingerprint, day, kind, message, source, route,
               count, array_length(user_ids, 1) AS affected_users,
               first_seen_at, last_seen_at, status, note
        FROM client_errors
        WHERE day >= CURRENT_DATE - $1::int
          AND ($2 = '' OR status = $2)
        ORDER BY (status = 'new') DESC, count DESC, last_seen_at DESC
        LIMIT 200
      `,
      [days, status]
    );
    return sendSuccess(res, { errors: rows.rows || [] }, 'success');
  } catch (error) {
    return sendFail(res, ERROR_CODES.SERVER_ERROR, error?.message || '查询失败', {}, 500);
  }
});

module.exports = router;
