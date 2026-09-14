// 批次4 路由：情报信号 / 审计问题 / 战略任务（PG 新表，均为 CRUD）。
// DB 未启用 → next('router')；这些模块无 legacy 接口，故 DB 必须启用才可用。
const express = require('express');
const pool = require('../db/pool');
const { signalRepo, auditRepo, strategicRepo } = require('../repos/batch4Repos');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
const { explainDbError } = require('../utils/dbErrors');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    /*
      数据库约束报错要翻成人话，不能一律 500。
      500 在界面上等于「系统崩了」，同事只会截图来问；
      而真相往往是一句话能说清的（「这个客户不存在，先去建一下」）。
      认不出来的才走原来的 500 —— 见 server/utils/dbErrors.js。
    */
    const known = explainDbError(e);
    if (known) return sendFail(res, ERROR_CODES.PARAM_ERROR, known.message, {}, known.status);
    sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'batch4 error', {}, 500);
  }
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
/*
  ── 情报的 PATCH 要能「找不到就补建」（2026-09-14 Codex 走查抓到）──

  症状：在情报雷达里点「标记已分拣」**点了没反应** ——
  界面上那条仍然显示「待处理」，按钮也还在。

  真因：情报雷达展示的信号来自两处 ——
    · market_signals 关系表
    · 情报抓取的缓存（.runtime/intel_store.json）
  而缓存里那些**不一定落过库**（抓取时写 PG 那一步是 try/catch 只告警，
  而且回退缓存那条路返回的本来就是老数据）。
  于是前端 PATCH /api/signals/:id → 通用 mount 里先 getById，查不到 → 404，
  前端 `.catch` 把它吞成一行 console.warn，接着轮询又把服务端的旧值盖回来。

  **这和当初「合同删了刷新又回来」是同一个形状**：
  界面上看得见的东西，后端没有它的行，于是任何写操作都静默失效。

  修法：这一条路由排在通用 mount 之前，查不到就用请求里带的整条信号补建。
  前端因此改成 PATCH 时把整条信号发过来（见 services/signalService.ts）。

  为什么不去修"让缓存和库永远一致"：那是对的方向但工程量大（见对账脚本那条）。
  这里先保证**人点下去一定有效果** —— 静默失效比慢一点糟得多。
*/
router.patch('/api/signals/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const body = payload(req.body, 'signal') || {};
  const existing = await signalRepo.getById(id);
  if (existing) {
    return sendSuccess(res, { signal: await signalRepo.update(id, body) }, 'success');
  }
  // 库里没有这条 —— 用请求里带的整条补建。缺标题就拒绝，别建出空壳
  if (!String(body.title || '').trim()) {
    return sendFail(res, ERROR_CODES.NOT_FOUND,
      '这条情报还没入库，而且这次请求里没带够信息补建它。刷新一下再试。', {}, 404);
  }
  const signal = await signalRepo.upsert({ ...body, id });
  return sendSuccess(res, { signal }, 'success');
}));

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
