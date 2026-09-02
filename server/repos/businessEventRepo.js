// 业务事件流 repo —— 记录「发生了什么、谁做的、为什么」。
//
// 设计原则：**记事件绝不能让主流程失败**。
// 打点是附加价值，主动作（完结项目、批准提案）才是用户要的结果。
// 所以 record() 吞掉所有异常，只在服务端日志留痕。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

const SPEC = [
  { api: 'id', col: 'id', kind: 'text' },
  { api: 'eventType', col: 'event_type', kind: 'text' },
  { api: 'subjectType', col: 'subject_type', kind: 'text' },
  { api: 'subjectId', col: 'subject_id', kind: 'text' },
  { api: 'actorUserId', col: 'actor_user_id', kind: 'text' },
  { api: 'actorName', col: 'actor_name', kind: 'text' },
  { api: 'viaAiAgent', col: 'via_ai_agent', kind: 'bool' },
  { api: 'onBehalfOf', col: 'on_behalf_of', kind: 'text' },
  { api: 'summary', col: 'summary', kind: 'text' },
  { api: 'detail', col: 'detail', kind: 'json' },
  { api: 'reason', col: 'reason', kind: 'text' },
  // ── Action Ledger 四要素补齐 ──
  { api: 'policy', col: 'policy', kind: 'text' },       // 命中的授权规则：凭什么允许/拒绝
  { api: 'approver', col: 'approver', kind: 'text' },   // L3 批准人，与 actor 分开
  { api: 'result', col: 'result', kind: 'text' },       // success / failed / denied
  { api: 'aiLevel', col: 'ai_level', kind: 'text' },    // 本次判定的 L0-L4
];

const { toColumns, fromRow, insertSql } = buildMapper(SPEC, { table: 'business_events' });

const businessEventRepo = {
  /**
   * 记一条事件。失败只警告，绝不抛——不能因为打点失败让业务动作回滚。
   * @returns 事件对象，失败时返回 null
   */
  record: async (evt) => {
    try {
      const withId = { ...evt, id: evt.id || makeId('EVT') };
      const { text, values } = insertSql(toColumns(withId));
      const r = await query(text, values);
      return fromRow(r.rows[0]);
    } catch (e) {
      console.warn('[businessEvent] 记录失败（不影响主流程）:', e?.message);
      return null;
    }
  },

  /**
   * 记一条「被拒绝」的操作。
   * 只记成功的动作是不够的——denied 才是安全审计最该看的：
   * 谁试图越权、被哪条策略挡下。AI 接入后这批数据尤其重要。
   */
  recordDenied: async ({ actor, action, resource, policy, reason, aiLevel }) =>
    businessEventRepo.record({
      eventType: `${action}.denied`,
      subjectType: resource?.type || 'unknown',
      subjectId: resource?.id || '',
      actorUserId: actor?.id || '',
      actorName: actor?.name || '',
      viaAiAgent: Boolean(actor?.viaAiAgent),
      onBehalfOf: actor?.onBehalfOf || null,
      summary: `拒绝执行 ${action}`,
      reason: reason || '',
      policy: policy || '',
      result: 'denied',
      aiLevel: aiLevel || null,
      detail: { action, resource },
    }),

  /** 越权尝试清单——「只记录不拦截」阶段结束后，就看这个决定要不要收紧 */
  deniedAttempts: async ({ since, limit = 200 } = {}) => {
    const params = [];
    let sql = "SELECT * FROM business_events WHERE result <> 'success'";
    if (since) { params.push(since); sql += ` AND occurred_at >= $${params.length}`; }
    params.push(Math.min(Number(limit) || 200, 1000));
    sql += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },

  /** 某个对象的时间线，项目详情页用 */
  timeline: async (subjectType, subjectId, { limit = 50 } = {}) => {
    const r = await query(
      `SELECT * FROM business_events
        WHERE subject_type = $1 AND subject_id = $2
        ORDER BY occurred_at DESC LIMIT $3`,
      [String(subjectType || ''), String(subjectId || ''), Math.min(Number(limit) || 50, 200)]
    );
    return r.rows.map(fromRow);
  },

  /** 某个人做了什么——AI 理解这个人工作习惯的依据 */
  byActor: async (actorUserId, { limit = 100, since } = {}) => {
    const params = [String(actorUserId || '')];
    let sql = 'SELECT * FROM business_events WHERE actor_user_id = $1';
    if (since) { params.push(since); sql += ` AND occurred_at >= $${params.length}`; }
    params.push(Math.min(Number(limit) || 100, 500));
    sql += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },

  /**
   * 按类型统计原因分布。
   * 例如「task.skipped」的原因分布，直接回答「哪些任务模板是多余的」。
   */
  reasonBreakdown: async (eventType, { since } = {}) => {
    const params = [String(eventType || '')];
    let sql = `SELECT coalesce(nullif(reason, ''), '(未填写)') AS reason, count(*)::int AS n
                 FROM business_events WHERE event_type = $1`;
    if (since) { params.push(since); sql += ` AND occurred_at >= $${params.length}`; }
    sql += ' GROUP BY 1 ORDER BY n DESC';
    const r = await query(sql, params);
    return r.rows;
  },
};

module.exports = { businessEventRepo };
