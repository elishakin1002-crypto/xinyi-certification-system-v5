// 合同 repo —— 批次3。顶层 amount 元↔分；receivables/attachments JSONB（内部金额保持元）。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

const SPEC = [
  { api: 'id', col: 'id', kind: 'text' },
  { api: 'title', col: 'title', kind: 'text' },
  { api: 'owner', col: 'owner', kind: 'text' },
  { api: 'customerId', col: 'customer_id', kind: 'text' },
  { api: 'customerName', col: 'customer_name', kind: 'text' },
  { api: 'amount', col: 'amount', kind: 'amount' },
  { api: 'signDate', col: 'sign_date', kind: 'date' },
  { api: 'status', col: 'contract_status', kind: 'text' },
  { api: 'serviceLine', col: 'service_line', kind: 'text' },
  { api: 'riskLevel', col: 'risk_level', kind: 'text' },
  { api: 'archiveStatus', col: 'archive_status', kind: 'text' },
  { api: 'contractNo', col: 'contract_no', kind: 'text' },
  { api: 'contactPerson', col: 'contact_person', kind: 'text' },
  { api: 'paymentMethod', col: 'payment_method', kind: 'text' },
  { api: 'remarks', col: 'remarks', kind: 'text' },
  { api: 'ownerUserId', col: 'owner_user_id', kind: 'text' },
  { api: 'receivables', col: 'receivables', kind: 'json' },
  { api: 'attachments', col: 'attachments', kind: 'json' },
  { api: 'serviceItems', col: 'service_items', kind: 'json' }
];

const { toColumns, fromRow, insertSql, updateSql, upsertSql } = buildMapper(SPEC, { table: 'contracts' });

const contractRepo = {
  list: async ({ customerId, status } = {}) => {
    const where = []; const params = [];
    if (customerId) { params.push(customerId); where.push(`customer_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`contract_status = $${params.length}`); }
    const sql = `SELECT * FROM contracts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },
  getById: async (id) => {
    const r = await query('SELECT * FROM contracts WHERE id = $1 LIMIT 1', [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  createWith: async (runner, contract) => {
    const withId = { ...contract, id: contract.id || makeId('CT') };
    const { text, values } = insertSql(toColumns(withId));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  },
  updateWith: async (runner, id, updates) => {
    const { text, values } = updateSql(id, toColumns({ ...updates, id }));
    const r = await runner(text, values);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  create: async (c) => contractRepo.createWith(query, c),
  update: async (id, u) => contractRepo.updateWith(query, id, u),
  upsertWith: async (runner, obj) => {
    const { text, values } = upsertSql(toColumns({ ...obj, id: obj.id || makeId('CT') }));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  },
  addAttachment: async (id, attachment) => {
    const c = await contractRepo.getById(id);
    if (!c) return null;
    const attachments = Array.isArray(c.attachments) ? c.attachments : [];
    if (attachments.some((a) => a.id === attachment.id)) return c;
    return contractRepo.update(id, { attachments: [...attachments, attachment] });
  }
};

module.exports = { contractRepo, fromRow, toColumns };
