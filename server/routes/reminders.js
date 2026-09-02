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
  const reminder = await reminderRepo.create({ isRead: false, ...payload(req.body) });
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
