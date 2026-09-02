// 客户 repo —— 批次1。基于 PG customers 表，API 契约保持 camelCase + 元。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

const SPEC = [
  { api: 'id', col: 'id', kind: 'text' },
  { api: 'name', col: 'name', kind: 'text' },
  { api: 'contactPerson', col: 'contact_person', kind: 'text' },
  { api: 'mobile', col: 'mobile', kind: 'text' },
  { api: 'industry', col: 'industry', kind: 'text' },
  { api: 'status', col: 'customer_status', kind: 'text' },
  { api: 'riskStatus', col: 'risk_status', kind: 'text' },
  { api: 'level', col: 'level', kind: 'text' },
  { api: 'totalValue', col: 'total_value_amount', kind: 'amount' },
  { api: 'totalAmount', col: 'total_amount', kind: 'amount' },
  { api: 'yearAmount', col: 'year_amount', kind: 'amount' },
  { api: 'activeContracts', col: 'active_contracts', kind: 'int' },
  { api: 'cooperationCount', col: 'cooperation_count', kind: 'int' },
  { api: 'serviceCount', col: 'service_count', kind: 'int' },
  { api: 'firstServiceDate', col: 'first_service_date', kind: 'date' },
  { api: 'lastServiceDate', col: 'last_service_date', kind: 'date' },
  { api: 'lastProjectAt', col: 'last_project_at', kind: 'date' },
  { api: 'lastProjectType', col: 'last_project_type', kind: 'text' },
  { api: 'nextOpportunity', col: 'next_opportunity', kind: 'text' },
  { api: 'unifiedSocialCreditCode', col: 'unified_social_credit_code', kind: 'text' },
  { api: 'registeredAddress', col: 'registered_address', kind: 'text' },
  { api: 'legalRepresentative', col: 'legal_representative', kind: 'text' },
  { api: 'registeredCapital', col: 'registered_capital', kind: 'text' },
  { api: 'businessScope', col: 'business_scope', kind: 'text' },
  { api: 'companyType', col: 'company_type', kind: 'text' },
  { api: 'customerNotes', col: 'customer_notes', kind: 'text' },
  { api: 'ownerUserId', col: 'owner_user_id', kind: 'text' },
  { api: 'contacts', col: 'contacts', kind: 'json' },
  { api: 'certificates', col: 'certificates', kind: 'json' },
  { api: 'existingCertifications', col: 'existing_certifications', kind: 'json' },
  { api: 'followUpRecords', col: 'follow_up_records', kind: 'json' },
  { api: 'pdcaPaidContractIds', col: 'pdca_paid_contract_ids', kind: 'json' }
];

const { toColumns, fromRow, insertSql, updateSql, upsertSql } = buildMapper(SPEC, { table: 'customers' });

const customerRepo = {
  list: async ({ level, riskStatus, q } = {}) => {
    const where = [];
    const params = [];
    if (level) { params.push(level); where.push(`level = $${params.length}`); }
    if (riskStatus) { params.push(riskStatus); where.push(`risk_status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`name ILIKE $${params.length}`); }
    const sql = `SELECT * FROM customers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },

  getById: async (id) => {
    const r = await query('SELECT * FROM customers WHERE id = $1 LIMIT 1', [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  findByUscc: async (uscc) => {
    if (!uscc) return null;
    const r = await query('SELECT * FROM customers WHERE unified_social_credit_code = $1 LIMIT 1', [String(uscc)]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  findByName: async (name) => {
    if (!name) return null;
    const r = await query('SELECT * FROM customers WHERE name = $1 LIMIT 1', [String(name)]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  createWith: async (runner, customer) => {
    const withId = { ...customer, id: customer.id || makeId('C') };
    const { text, values } = insertSql(toColumns(withId));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  },
  updateWith: async (runner, id, updates) => {
    const { text, values } = updateSql(id, toColumns({ ...updates, id }));
    const r = await runner(text, values);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  create: async (customer) => customerRepo.createWith(query, customer),
  update: async (id, updates) => customerRepo.updateWith(query, id, updates),
  upsertWith: async (runner, obj) => {
    const { text, values } = upsertSql(toColumns({ ...obj, id: obj.id || makeId('C') }));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  },

  addFollowUp: async (id, record) => {
    const existing = await customerRepo.getById(id);
    if (!existing) return null;
    const next = [...(existing.followUpRecords || []), record];
    return customerRepo.update(id, { followUpRecords: next });
  }
};

module.exports = { customerRepo, fromRow, toColumns };
