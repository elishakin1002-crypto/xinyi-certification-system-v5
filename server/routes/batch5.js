// 批次5 路由：工作日志 / 任务模板。
//
// ── 为什么现在补这两条 ────────────────────────────────────────
// 这两个数据集原来**没有服务端读接口**：前端从 localStorage 取，
// 取不到就退回代码里的 MOCK 假数据，然后把整份数组推回服务器。
//
// 后果有两层：
//   ① 一台空浏览器会拿假数据当真数据推上去
//   ② 各人副本互不相通，谁后推谁说了算 ——
//      2026-09-02 线上就出现过：推上来的工作日志是空数组，而表里有 47 行
//
// 补上读接口之后，前端从服务端拿这两份数据，
// 大家看到的是同一份，整份覆盖的前提也就不成立了。
//
// DB 未启用 → next('router')。这两个模块没有 legacy 接口，
// 数据库必须启用才可用 —— 和 batch4 同一套约定。
const express = require('express');
const pool = require('../db/pool');
const { workLogRepo, taskTemplateRepo } = require('../repos/batch5Repos');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'batch5 error', {}, 500); }
};
const payload = (b, key) => (b?.[key] && typeof b[key] === 'object' ? b[key] : (b || {}));

// 和 batch4 的 mount 同形。没有抽成共享模块是因为两边的 afterWrite/权限
// 将来大概率会分叉，过早抽象会让以后每加一个特例都要动公共代码。
const mount = (base, repo, single, plural, filterKeys) => {
  router.get(`/api/${base}`, wrap(async (req, res) => {
    const q = {};
    filterKeys.forEach((k) => { if (req.query[k] !== undefined) q[k] = req.query[k]; });
    sendSuccess(res, { [plural]: await repo.list(q) }, 'success');
  }));
  router.get(`/api/${base}/:id`, wrap(async (req, res) => {
    const item = await repo.getById(req.params.id);
    if (!item) return sendFail(res, ERROR_CODES.NOT_FOUND, `${single} not found`, {}, 404);
    sendSuccess(res, { [single]: item }, 'success');
  }));
  router.post(`/api/${base}`, wrap(async (req, res) => {
    const item = await repo.create(payload(req.body, single));
    sendSuccess(res, { [single]: item }, 'success', ERROR_CODES.SUCCESS, 201);
  }));
  router.patch(`/api/${base}/:id`, wrap(async (req, res) => {
    if (!(await repo.getById(req.params.id))) {
      return sendFail(res, ERROR_CODES.NOT_FOUND, `${single} not found`, {}, 404);
    }
    const item = await repo.update(req.params.id, payload(req.body, single));
    sendSuccess(res, { [single]: item }, 'success');
  }));
};

mount('work-logs', workLogRepo, 'workLog', 'workLogs', ['projectId', 'taskId', 'operatorUserId']);
mount('task-templates', taskTemplateRepo, 'template', 'templates', ['archived']);

module.exports = router;
