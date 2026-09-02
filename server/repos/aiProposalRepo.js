// AI 提案 repo —— 待确认队列。
//
// 收口原则：AI 一律只提案，人确认后才执行。
// 原来 AI 诊断出的高优先级动作是直接自动执行的（人不知道 AI 改了什么），
// 其余动作压根不执行只在页面上展示——两头都错。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

const SPEC = [
  { api: 'id', col: 'id', kind: 'text' },
  { api: 'source', col: 'source', kind: 'text' },
  { api: 'sourceRef', col: 'source_ref', kind: 'text' },
  { api: 'title', col: 'title', kind: 'text' },
  { api: 'action', col: 'action', kind: 'json' },
  { api: 'reason', col: 'reason', kind: 'text' },
  { api: 'confidence', col: 'confidence', kind: 'text' },
  { api: 'status', col: 'status', kind: 'text' },
  { api: 'decidedBy', col: 'decided_by', kind: 'text' },
  { api: 'decidedAt', col: 'decided_at', kind: 'text' },
  { api: 'rejectReason', col: 'reject_reason', kind: 'text' },
  { api: 'executedAt', col: 'executed_at', kind: 'text' },
  { api: 'executeError', col: 'execute_error', kind: 'text' },
];

const { toColumns, fromRow, insertSql, updateSql } = buildMapper(SPEC, { table: 'ai_proposals' });

const aiProposalRepo = {
  /** 队列查询。默认只看待确认的——这是队列页最常用的口径 */
  list: async ({ status = 'pending', source, sourceRef, limit = 100 } = {}) => {
    const where = []; const params = [];
    if (status && status !== 'all') { params.push(status); where.push(`status = $${params.length}`); }
    if (source) { params.push(source); where.push(`source = $${params.length}`); }
    if (sourceRef) { params.push(sourceRef); where.push(`source_ref = $${params.length}`); }
    params.push(Math.min(Number(limit) || 100, 500));
    const sql = `SELECT * FROM ai_proposals
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC LIMIT $${params.length}`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },

  getById: async (id) => {
    const r = await query('SELECT * FROM ai_proposals WHERE id = $1 LIMIT 1', [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  create: async (p) => {
    const withId = { ...p, id: p.id || makeId('AIP'), status: p.status || 'pending' };
    const { text, values } = insertSql(toColumns(withId));
    const r = await query(text, values);
    return fromRow(r.rows[0]);
  },

  /**
   * 批准 / 驳回。
   * 用 status='pending' 作为更新条件，避免两个人同时点造成重复执行——
   * 第二个人的更新会命中 0 行，调用方据此知道「已经被处理过了」。
   */
  decide: async (id, { status, decidedBy, rejectReason }) => {
    const r = await query(
      `UPDATE ai_proposals
          SET status = $2, decided_by = $3, decided_at = now(),
              reject_reason = $4, updated_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [String(id || ''), status, decidedBy || '', rejectReason || null]
    );
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  /** 执行结果留痕：批准之后是否真的落地 */
  markExecuted: async (id, { error } = {}) => {
    const r = await query(
      `UPDATE ai_proposals
          SET executed_at = now(), execute_error = $2, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [String(id || ''), error || null]
    );
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  /**
   * 驳回原因统计——这张表最值钱的用途。
   * 它告诉你 AI 在哪类判断上不可靠，是让 AI 变准的真实依据。
   */
  rejectionStats: async () => {
    const r = await query(
      `SELECT source,
              count(*) FILTER (WHERE status = 'approved')::int AS approved,
              count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              count(*)::int AS total
         FROM ai_proposals
        WHERE status IN ('approved', 'rejected')
        GROUP BY source
        ORDER BY total DESC`
    );
    return r.rows.map((row) => ({
      ...row,
      // 采纳率低的来源，说明这类提案 AI 还不该自己做
      approvalRate: row.total ? Math.round((row.approved / row.total) * 100) : 0,
    }));
  },
};

module.exports = { aiProposalRepo };
