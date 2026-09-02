// 项目 repo —— 批次2。API 契约保持 camelCase + 元。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

const SPEC = [
  { api: 'id', col: 'id', kind: 'text' },
  { api: 'customerId', col: 'customer_id', kind: 'text' },
  { api: 'name', col: 'name', kind: 'text' },
  { api: 'contractRef', col: 'contract_ref', kind: 'text' },
  { api: 'sourceType', col: 'source_type', kind: 'text' },
  { api: 'sourceRef', col: 'source_ref', kind: 'text' },
  { api: 'projectMode', col: 'project_mode', kind: 'text' },
  { api: 'costStatus', col: 'cost_status', kind: 'text' },
  { api: 'projectAmount', col: 'project_amount', kind: 'amount' },
  { api: 'projectCategory', col: 'project_category', kind: 'text' },
  { api: 'manager', col: 'manager', kind: 'text' },
  { api: 'progress', col: 'progress', kind: 'int' },
  { api: 'status', col: 'project_status', kind: 'text' },
  { api: 'paymentStatus', col: 'payment_status', kind: 'text' },
  { api: 'deadline', col: 'deadline', kind: 'date' },
  { api: 'duration', col: 'duration', kind: 'int' },
  { api: 'projectType', col: 'project_type', kind: 'text' },
  { api: 'vendorId', col: 'vendor_id', kind: 'text' },
  { api: 'vendorName', col: 'vendor_name', kind: 'text' },
  { api: 'purchasingCost', col: 'purchasing_cost', kind: 'amount' },
  { api: 'ownerUserId', col: 'owner_user_id', kind: 'text' },
  { api: 'tasks', col: 'tasks', kind: 'json' },
  { api: 'serviceItems', col: 'service_items', kind: 'json' },
  { api: 'settlementConfig', col: 'settlement_config', kind: 'json' },
  { api: 'aiInsight', col: 'ai_insight', kind: 'json' },
  { api: 'completionRecord', col: 'completion_record', kind: 'json' }
];

const { toColumns, fromRow, insertSql, updateSql, upsertSql } = buildMapper(SPEC, { table: 'projects' });

const projectRepo = {
  list: async ({ status, manager, customerId } = {}) => {
    const where = [];
    const params = [];
    if (status) { params.push(status); where.push(`project_status = $${params.length}`); }
    if (manager) { params.push(manager); where.push(`manager = $${params.length}`); }
    if (customerId) { params.push(customerId); where.push(`customer_id = $${params.length}`); }
    const sql = `SELECT * FROM projects ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },
  getById: async (id) => {
    const r = await query('SELECT * FROM projects WHERE id = $1 LIMIT 1', [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  createWith: async (runner, project) => {
    const withId = { ...project, id: project.id || makeId('P') };
    const { text, values } = insertSql(toColumns(withId));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  },
  updateWith: async (runner, id, updates) => {
    const { text, values } = updateSql(id, toColumns({ ...updates, id }));
    const r = await runner(text, values);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  create: async (project) => projectRepo.createWith(query, project),
  update: async (id, updates) => projectRepo.updateWith(query, id, updates),
  upsertWith: async (runner, obj) => {
    const { text, values } = upsertSql(toColumns({ ...obj, id: obj.id || makeId('P') }));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  }
};

module.exports = { projectRepo, fromRow, toColumns };
