// AI 待确认队列的接口。
//
// 收口原则：AI 只提案，人确认后才执行。
// 每一次批准/驳回都同时写业务事件流——驳回原因是让 AI 变准的依据，
// 不留下来就白白浪费了人的判断。
const express = require('express');
const { aiProposalRepo } = require('../repos/aiProposalRepo');
const { businessEventRepo } = require('../repos/businessEventRepo');
const { sendSuccess, sendFail, ERROR_CODES } = require('../utils/apiResponse');

const router = express.Router();
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { sendFail(res, ERROR_CODES.SERVER_ERROR, e?.message || 'ai proposal error', {}, 500); }
};

/** 当前操作人。AI 服务账号代表员工调用时，req.authUser 已被换成被代表人 */
const actorOf = (req) => ({
  id: req.authUser?.id || '',
  name: req.authUser?.name || '',
  viaAiAgent: Boolean(req.aiActor),
  onBehalfOf: req.aiActor ? (req.authUser?.id || '') : null,
});

// 队列列表。默认只给待确认的
router.get('/api/ai-proposals', wrap(async (req, res) => {
  const list = await aiProposalRepo.list({
    status: req.query.status || 'pending',
    source: req.query.source,
    sourceRef: req.query.sourceRef,
    limit: req.query.limit,
  });
  sendSuccess(res, { proposals: list, total: list.length });
}));

// 采纳率统计：哪类提案 AI 还不该自己做
router.get('/api/ai-proposals/stats', wrap(async (req, res) => {
  sendSuccess(res, { stats: await aiProposalRepo.rejectionStats() });
}));

// 入队。AI 分析产出的动作走这里，不再直接执行
router.post('/api/ai-proposals', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.action || !b.action.type) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, '缺少 action.type', {}, 400);
  }
  const created = await aiProposalRepo.create({
    source: b.source || 'project_diagnosis',
    sourceRef: b.sourceRef || '',
    title: b.title || '',
    action: b.action,
    reason: b.reason || b.action.reason || '',
    confidence: b.confidence,
  });
  sendSuccess(res, { proposal: created }, 'success', ERROR_CODES.SUCCESS, 201);
}));

/**
 * 批准或驳回。
 * decide() 用 status='pending' 做条件，两个人同时点时第二个会拿到 null——
 * 这里据此返回 409，而不是假装成功。
 */
router.post('/api/ai-proposals/:id/decide', wrap(async (req, res) => {
  const { decision, rejectReason } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, 'decision 必须是 approved 或 rejected', {}, 400);
  }
  // 驳回必须给原因：这条记录的价值全在原因上，没有原因等于白驳
  if (decision === 'rejected' && !String(rejectReason || '').trim()) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, '驳回必须填写原因', {}, 400);
  }

  const actor = actorOf(req);
  const updated = await aiProposalRepo.decide(req.params.id, {
    status: decision, decidedBy: actor.id, rejectReason,
  });
  if (!updated) {
    return sendFail(res, ERROR_CODES.DATA_CONFLICT, '该提案已被处理过，请刷新后查看', {}, 409);
  }

  await businessEventRepo.record({
    eventType: decision === 'approved' ? 'ai_proposal.approved' : 'ai_proposal.rejected',
    subjectType: 'ai_proposal',
    subjectId: updated.id,
    actorUserId: actor.id,
    actorName: actor.name,
    viaAiAgent: actor.viaAiAgent,
    onBehalfOf: actor.onBehalfOf,
    summary: `${decision === 'approved' ? '批准' : '驳回'}提案：${updated.title || updated.action?.type || ''}`,
    detail: { source: updated.source, sourceRef: updated.sourceRef, action: updated.action },
    reason: decision === 'rejected' ? rejectReason : null,
    // approver 与 actor 分开：AI 代表张三提的案、李四批准，是两个人
    approver: actor.id,
    aiLevel: 'L3',   // 进队列的按定义就是 L3（执行前需人工确认）
    result: 'success',
  });

  sendSuccess(res, { proposal: updated });
}));

// 执行结果回填：批准后动作是否真的落地
router.post('/api/ai-proposals/:id/executed', wrap(async (req, res) => {
  const updated = await aiProposalRepo.markExecuted(req.params.id, { error: req.body?.error });
  if (!updated) return sendFail(res, ERROR_CODES.NOT_FOUND, '提案不存在', {}, 404);

  /*
    「批准」和「执行成功」是两件事——批了但执行失败的情况必须能查出来，
    否则会以为 AI 已经把事办了。所以执行结果单独记一条，result 区分成败。
  */
  const actor = actorOf(req);
  const failed = Boolean(req.body?.error);
  await businessEventRepo.record({
    eventType: 'ai_proposal.executed',
    subjectType: 'ai_proposal',
    subjectId: updated.id,
    actorUserId: actor.id,
    actorName: actor.name,
    viaAiAgent: actor.viaAiAgent,
    onBehalfOf: actor.onBehalfOf,
    summary: `${failed ? '执行失败' : '执行成功'}：${updated.title || updated.action?.type || ''}`,
    reason: req.body?.error || null,
    approver: updated.decidedBy || null,
    aiLevel: 'L3',
    result: failed ? 'failed' : 'success',
    detail: { action: updated.action, sourceRef: updated.sourceRef, error: req.body?.error || null },
  });

  sendSuccess(res, { proposal: updated });
}));

module.exports = router;

/*
 * ───────── 业务事件流 ─────────
 * 记「发生了什么、谁做的、为什么」，与当前状态互补。
 * 放在同一文件是为了复用上面的 actorOf —— 事件的 actor 判定规则必须完全一致，
 * 分成两个文件迟早会出现两套「谁做的」逻辑。
 */

/** 记一条事件。前端在跳过任务、推迟截止日这类动作后调用 */
router.post('/api/business-events', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.eventType || !b.subjectType || !b.subjectId) {
    return sendFail(res, ERROR_CODES.PARAM_ERROR, 'eventType / subjectType / subjectId 必填', {}, 400);
  }
  const actor = actorOf(req);
  const evt = await businessEventRepo.record({
    eventType: String(b.eventType),
    subjectType: String(b.subjectType),
    subjectId: String(b.subjectId),
    actorUserId: actor.id,
    actorName: actor.name,
    viaAiAgent: actor.viaAiAgent,
    onBehalfOf: actor.onBehalfOf,
    summary: String(b.summary || ''),
    reason: b.reason ? String(b.reason) : null,
    detail: b.detail && typeof b.detail === 'object' ? b.detail : {},
  });
  // record 内部吞异常返回 null——打点失败不该让调用方以为业务动作也失败了
  sendSuccess(res, { event: evt, recorded: Boolean(evt) }, 'success', ERROR_CODES.SUCCESS, 201);
}));

/**
 * 按事件类型统计原因分布。
 * 例：/api/business-events/stats/reasons?eventType=task.skipped
 * 直接回答「哪些任务模板是多余的」。
 */
router.get('/api/business-events/stats/reasons', wrap(async (req, res) => {
  const eventType = String(req.query.eventType || '');
  if (!eventType) return sendFail(res, ERROR_CODES.PARAM_ERROR, 'eventType 必填', {}, 400);
  const rows = await businessEventRepo.reasonBreakdown(eventType, { since: req.query.since });
  sendSuccess(res, { eventType, breakdown: rows }, 'success');
}));

// 注意：这条参数路由必须放在 /stats/reasons 之后，
// 否则 Express 会先把 stats 当成 :subjectType 匹配掉。
/** 某个对象的时间线，项目详情页用 */
router.get('/api/business-events/:subjectType/:subjectId', wrap(async (req, res) => {
  const events = await businessEventRepo.timeline(req.params.subjectType, req.params.subjectId, {
    limit: Number(req.query.limit) || 50,
  });
  sendSuccess(res, { events }, 'success');
}));

