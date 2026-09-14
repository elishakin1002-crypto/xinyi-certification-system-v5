// 提醒路由（PG）。补上「断环」：级联生成的提醒经此被 Agent/前端读取与处理。
// DB 未启用 → next('router')。
const express = require('express');
const pool = require('../db/pool');
const { reminderRepo } = require('../repos/reminderRepo');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
const { requireAction } = require('../authz/middleware');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'reminder error', {}, 500); }
};
const parseBool = (v) => (v === undefined ? undefined : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const payload = (b) => (b?.reminder && typeof b.reminder === 'object' ? b.reminder : (b || {}));

router.get('/api/reminders', wrap(async (req, res) => {
  const reminders = await reminderRepo.list({ linkType: req.query.linkType, linkId: req.query.linkId, isRead: parseBool(req.query.isRead) });
  sendSuccess(res, { reminders }, 'success');
}));

router.post('/api/reminders',
  requireAction('REMINDER_WRITE', { resource: (req) => ({ type: 'reminder', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  /*
    ── 空 body 也能建出提醒（2026-09-14 鉴权巡检点名时查出来的）────

    这个接口原来照单全收：`POST /api/reminders` 发 `{}` 返回 201，
    库里多一条 title / link_id / link_type / reminder_type **全是 null** 的提醒。
    它在界面上长这样：一条没有标题、点开什么也没有、又永远消不掉的提醒。

    和当初「关联合同下拉一排（¥0）」是同一个毛病的第二例 ——
    建类接口缺输入校验。合同那次是半年后有人看见才发现的；
    这次是巡检跑完点名「提醒多了 6 条」当场揪出来的。

    一条提醒最少要有标题：没有标题的提醒，人看见也不知道该干什么，
    只会积在那里让整个提醒栏变成噪音。
  */
  const body = payload(req.body);
  const title = String(body?.title || '').trim();
  if (!title) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR,
      '提醒必须有标题 —— 没标题的提醒，人看见了也不知道要做什么，只会堆在那里。', {}, 400);
  }
  const reminder = await reminderRepo.create({ isRead: false, ...body, title });
  sendSuccess(res, { reminder }, 'success', ERROR_CODES.SUCCESS, 201);
}));

router.patch('/api/reminders/:id',
  requireAction('REMINDER_WRITE', { resource: (req) => ({ type: 'reminder', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  const reminder = await reminderRepo.update(req.params.id, payload(req.body));
  if (!reminder) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Reminder not found', {}, 404);
  sendSuccess(res, { reminder }, 'success');
}));

router.delete('/api/reminders/:id',
  requireAction('REMINDER_WRITE', { resource: (req) => ({ type: 'reminder', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  await reminderRepo.remove(req.params.id);
  sendSuccess(res, { ok: true }, 'success');
}));

module.exports = router;
