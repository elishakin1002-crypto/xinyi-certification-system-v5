// 结算 repo —— 批次3。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

const SPEC = [
  { api: 'id', col: 'id', kind: 'text' },
  { api: 'type', col: 'settlement_type', kind: 'text' },
  { api: 'beneficiary', col: 'beneficiary', kind: 'text' },
  { api: 'contractRef', col: 'contract_ref', kind: 'text' },
  { api: 'month', col: 'month', kind: 'text' },
  { api: 'amount', col: 'amount', kind: 'amount' },
  { api: 'status', col: 'settlement_status', kind: 'text' },
  { api: 'notes', col: 'notes', kind: 'text' }
];

const { toColumns, fromRow, insertSql, updateSql, upsertSql } = buildMapper(SPEC, { table: 'settlements' });

const settlementRepo = {
  list: async ({ contractRef, month, status } = {}) => {
    const where = []; const params = [];
    if (contractRef) { params.push(contractRef); where.push(`contract_ref = $${params.length}`); }
    if (month) { params.push(month); where.push(`month = $${params.length}`); }
    if (status) { params.push(status); where.push(`settlement_status = $${params.length}`); }
    const sql = `SELECT * FROM settlements ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },
  getById: async (id) => {
    const r = await query('SELECT * FROM settlements WHERE id = $1 LIMIT 1', [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  createWith: async (runner, s) => {
    const withId = { ...s, id: s.id || makeId('S') };
    const { text, values } = insertSql(toColumns(withId));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  },
  create: async (s) => settlementRepo.createWith(query, s),
  update: async (id, updates) => {
    const { text, values } = updateSql(id, toColumns({ ...updates, id }));
    const r = await query(text, values);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  upsertWith: async (runner, obj) => {
    const { text, values } = upsertSql(toColumns({ ...obj, id: obj.id || makeId('S') }));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  }
};

module.exports = { settlementRepo, fromRow };
