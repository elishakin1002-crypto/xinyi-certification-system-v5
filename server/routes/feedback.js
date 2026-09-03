// 同事的问题反馈。
//
// 和 client_errors 的分工：
//   client_errors  机器自动抓的，同事不知情
//   feedback       人主动说的，机器抓不到
// 最难查的一类是「系统没报错，但结果不是他要的」—— 只有人能说。
const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

const KINDS = ['bug', 'confused', 'wrong', 'improve'];
const SEVERITIES = ['blocked', 'annoying', 'later'];
const STATUSES = ['new', 'ack', 'doing', 'done', 'wontfix'];

const pick = (v, allowed, fallback) => (allowed.includes(String(v || '')) ? String(v) : fallback);
const trim = (v, max) => String(v || '').trim().slice(0, max);

router.post('/api/feedback', async (req, res) => {
  try {
    const b = req.body || {};
    const intent = trim(b.intent, 500);
    const actual = trim(b.actual, 500);
    /*
      至少要说清「想做什么」或「结果怎么样」其中一件。
      两个都空的提交收下来也没用 —— 看的人还是得去问，
      而那正是这个表单要消灭的成本。
    */
    if (!intent && !actual) {
      return sendFail(res, ERROR_CODES.PARAM_ERROR, '请至少填写「想做什么」或「结果怎么样」', {}, 400);
    }

    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const id = `FB-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    await pool.query(
      `
        INSERT INTO feedback
          (id, kind, severity, intent, actual, expected, route, user_id, user_name, user_agent, app_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        id,
        pick(b.kind, KINDS, 'bug'),
        pick(b.severity, SEVERITIES, 'annoying'),
        intent, actual, trim(b.expected, 500),
        trim(b.route, 200),
        String(req.authUser?.id || ''),
        String(req.authUser?.name || ''),
        String(req.headers['user-agent'] || '').slice(0, 300),
        trim(b.appVersion, 40),
      ]
    );
    return sendSuccess(res, { id }, 'success');
  } catch (error) {
    return sendFail(res, ERROR_CODES.SERVER_ERROR, error?.message || '反馈提交失败', {}, 500);
  }
});

/** 管理员看的列表。 */
router.get('/api/feedback', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const r = await pool.query(
      `
        SELECT id, kind, severity, intent, actual, expected, route,
               user_id, user_name, status, reply, created_at
        FROM feedback
        WHERE ($1 = '' OR status = $1)
        ORDER BY
          -- 挡住干活的排最前，其次没处理的，最后按时间
          CASE severity WHEN 'blocked' THEN 0 WHEN 'annoying' THEN 1 ELSE 2 END,
          (status = 'new') DESC,
          created_at DESC
        LIMIT 200
      `,
      [status]
    );
    return sendSuccess(res, { feedback: r.rows || [] }, 'success');
  } catch (error) {
    return sendFail(res, ERROR_CODES.SERVER_ERROR, error?.message || '查询失败', {}, 500);
  }
});

/** 管理员处理：改状态 + 回复。 */
router.patch('/api/feedback/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `
        UPDATE feedback
        SET status     = COALESCE(NULLIF($2, ''), status),
            reply      = COALESCE(NULLIF($3, ''), reply),
            handled_by = $4,
            handled_at = NOW()
        WHERE id = $1
        RETURNING id, status, reply
      `,
      [
        String(req.params.id || ''),
        pick(b.status, STATUSES, ''),
        trim(b.reply, 1000),
        String(req.authUser?.name || ''),
      ]
    );
    if (!r.rows?.[0]) return sendFail(res, ERROR_CODES.NOT_FOUND, '反馈不存在', {}, 404);
    return sendSuccess(res, { feedback: r.rows[0] }, 'success');
  } catch (error) {
    return sendFail(res, ERROR_CODES.SERVER_ERROR, error?.message || '更新失败', {}, 500);
  }
});

module.exports = router;
