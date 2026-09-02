// 知识库路由（PG 新表）。含 Agent 级联自动生成的 PDCA 文档。
// DB 未启用 → next('router')。
const express = require('express');
const pool = require('../db/pool');
const { knowledgeRepo } = require('../repos/knowledgeRepo');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');
const { requireAction } = require('../authz/middleware');

const router = express.Router();
router.use((req, res, next) => (pool.isEnabled() ? next() : next('router')));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'knowledge error', {}, 500); }
};
const payload = (b) => (b?.doc && typeof b.doc === 'object' ? b.doc : (b || {}));

router.get('/api/knowledge', wrap(async (req, res) => {
  const docs = await knowledgeRepo.list({ linkType: req.query.linkType, linkId: req.query.linkId, category: req.query.category });
  sendSuccess(res, { docs }, 'success');
}));

router.get('/api/knowledge/:id', wrap(async (req, res) => {
  const doc = await knowledgeRepo.getById(req.params.id);
  if (!doc) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Doc not found', {}, 404);
  sendSuccess(res, { doc }, 'success');
}));


/*
  内容太短的文档一律不进 AI 语料，不管调用方怎么标。

  它们对检索**毫无用处却要花钱**：每次检索都要过一遍，token 按量算。
  更糟的是污染——空白模板和记录表单在 100 家客户之间高度雷同，
  会把真正有价值的复盘和案例从检索结果里挤下去，
  于是 AI 答出来的东西越来越像模板。

  阈值取 200 字：一份连 200 字都没有的文档，要么是空表单，
  要么正文没抽出来（扫描件、加密 PDF），两种情况都不该进语料。
  抽取失败时静默进语料是最坏的一种——花了钱，学到的是文件名。

  放在服务端而不是界面上：界面绕得过去，接口和批量导入也会写这个字段。
*/
const MIN_AI_CONTENT_LENGTH = 200;

const guardAiVisible = (body = {}) => {
  const next = { ...body };
  if (next.aiVisible !== true) return next;
  const text = String(next.content || '').trim();
  if (text.length < MIN_AI_CONTENT_LENGTH) {
    next.aiVisible = false;
    next.aiVisibleBlockedReason = `正文只有 ${text.length} 字（少于 ${MIN_AI_CONTENT_LENGTH}），不纳入 AI 语料`;
  }
  return next;
};

router.post('/api/knowledge',
  requireAction('KNOWLEDGE_WRITE', { resource: (req) => ({ type: 'knowledge', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  const doc = await knowledgeRepo.create({ source: 'manual', ...guardAiVisible(payload(req.body)) });
  sendSuccess(res, { doc }, 'success', ERROR_CODES.SUCCESS, 201);
}));

router.patch('/api/knowledge/:id',
  requireAction('KNOWLEDGE_WRITE', { resource: (req) => ({ type: 'knowledge', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  if (!(await knowledgeRepo.getById(req.params.id))) return sendFail(res, ERROR_CODES.NOT_FOUND, 'Doc not found', {}, 404);
  const doc = await knowledgeRepo.update(req.params.id, guardAiVisible(payload(req.body)));
  sendSuccess(res, { doc }, 'success');
}));

router.delete('/api/knowledge/:id',
  requireAction('KNOWLEDGE_WRITE', { resource: (req) => ({ type: 'knowledge', id: req.params?.id || '' }) }),
  wrap(async (req, res) => {
  await knowledgeRepo.remove(req.params.id);
  sendSuccess(res, { ok: true }, 'success');
}));

module.exports = router;
