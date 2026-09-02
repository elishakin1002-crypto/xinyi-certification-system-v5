// 批次4 路由：情报信号 / 审计问题 / 战略任务（PG 新表，均为 CRUD）。
// DB 未启用 → next('router')；这些模块无 legacy 接口，故 DB 必须启用才可用。
const express = require('express');
const pool = require('../db/pool');
const { signalRepo, auditRepo, strategicRepo } = require('../repos/batch4Repos');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'batch4 error', {}, 500); }
};
const payload = (b, key) => (b?.[key] && typeof b[key] === 'object' ? b[key] : (b || {}));

// 通用 CRUD 装配：path 基址、repo、响应字段名(单/复数)、过滤键
const mount = (base, repo, single, plural, filterKeys, afterWrite) => {
  router.get(`/api/${base}`, wrap(async (req, res) => {
    const q = {}; filterKeys.forEach((k) => { if (req.query[k] !== undefined) q[k] = req.query[k]; });
    sendSuccess(res, { [plural]: await repo.list(q) }, 'success');
  }));
  router.get(`/api/${base}/:id`, wrap(async (req, res) => {
    const item = await repo.getById(req.params.id);
    if (!item) return sendFail(res, ERROR_CODES.NOT_FOUND, `${single} not found`, {}, 404);
    sendSuccess(res, { [single]: item }, 'success');
  }));
  router.post(`/api/${base}`, wrap(async (req, res) => {
    let item = await repo.create(payload(req.body, single));
    if (afterWrite) item = (await afterWrite(item)) || item;
    sendSuccess(res, { [single]: item }, 'success', ERROR_CODES.SUCCESS, 201);
  }));
  router.patch(`/api/${base}/:id`, wrap(async (req, res) => {
    if (!(await repo.getById(req.params.id))) return sendFail(res, ERROR_CODES.NOT_FOUND, `${single} not found`, {}, 404);
    let item = await repo.update(req.params.id, payload(req.body, single));
    if (afterWrite) item = (await afterWrite(item)) || item;
    sendSuccess(res, { [single]: item }, 'success');
  }));
};

const { syncRectificationTask } = require('../services/auditRectification');
const { requireAction } = require('../authz/middleware');
mount('signals', signalRepo, 'signal', 'signals', ['kind', 'status', 'urgency', 'ownerUserId']);
mount('audit-issues', auditRepo, 'issue', 'issues', ['status', 'customerId', 'severity'], syncRectificationTask);
mount('strategic-tasks', strategicRepo, 'task', 'tasks', ['status', 'priority', 'owner']);

// 情报→跟进项目 转化（级联）
router.post('/api/signals/:id/convert',
  requireAction('LEAD_CONVERT', { resource: (req) => ({ type: 'signal', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  const { convertSignalToProject } = require('../services/convertSignal');
  const result = await convertSignalToProject(req.params.id, { manager: req.body?.manager });
  if (!result.ok) return sendFail(res, ERROR_CODES.DATA_CONFLICT, result.reason, {}, 409);
  const project = await require('../repos/projectRepo').projectRepo.getById(result.projectId);
  sendSuccess(res, { ...result, project }, 'success');
}));

// 情报批量 upsert（抓取/批量写；按 id 幂等）
router.post('/api/signals/bulk',
  requireAction('LEAD_CREATE', { resource: (req) => ({ type: 'signal', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  const list = Array.isArray(req.body?.signals) ? req.body.signals : [];
  let written = 0;
  for (const sig of list) {
    if (!sig || !sig.id) continue;
    await signalRepo.upsert(sig);
    written += 1;
  }
  sendSuccess(res, { written }, 'success');
}));

module.exports = router;
