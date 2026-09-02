// 线索 repo —— 批次1。基于 PG leads 表，API 契约保持 camelCase + 元。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

const SPEC = [
  { api: 'id', col: 'id', kind: 'text' },
  { api: 'name', col: 'name', kind: 'text' },
  { api: 'company', col: 'company', kind: 'text' },
  { api: 'status', col: 'lead_status', kind: 'text' },
  { api: 'score', col: 'score', kind: 'int' },
  { api: 'potentialValue', col: 'potential_value_amount', kind: 'amount' },
  { api: 'probability', col: 'probability', kind: 'int' },
  { api: 'intent', col: 'intent', kind: 'text' },
  { api: 'source', col: 'source', kind: 'text' },
  { api: 'industry', col: 'industry', kind: 'text' },
  { api: 'mobile', col: 'mobile', kind: 'text' },
  { api: 'wechat', col: 'wechat', kind: 'text' },
  { api: 'position', col: 'position', kind: 'text' },
  { api: 'targetCertifications', col: 'target_certifications', kind: 'text' },
  { api: 'unifiedSocialCreditCode', col: 'unified_social_credit_code', kind: 'text' },
  { api: 'registeredAddress', col: 'registered_address', kind: 'text' },
  { api: 'legalRepresentative', col: 'legal_representative', kind: 'text' },
  { api: 'registeredCapital', col: 'registered_capital', kind: 'text' },
  { api: 'businessScope', col: 'business_scope', kind: 'text' },
  { api: 'foundingDate', col: 'founding_date', kind: 'date' },
  { api: 'operationStatus', col: 'operation_status', kind: 'text' },
  { api: 'companyType', col: 'company_type', kind: 'text' },
  { api: 'ownerUserId', col: 'owner_user_id', kind: 'text' },
  { api: 'lastContact', col: 'last_contact', kind: 'date' },
  { api: 'contacts', col: 'contacts', kind: 'json' },
  { api: 'existingCertifications', col: 'existing_certifications', kind: 'json' },
  { api: 'followUpRecords', col: 'follow_up_records', kind: 'json' }
];

const { toColumns, fromRow } = buildMapper(SPEC);
// 事务批量写要用的 upsert。本文件的 insertSql 是手写的（历史原因），
// 这里只补一个 upsert，不动已经在跑的建线索路径——上线前不改能用的东西。
const { upsertSql: leadUpsertSql } = buildMapper(SPEC, { table: 'leads' });

const insertSql = (cols) => {
  const keys = Object.keys(cols);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const jsonCols = new Set(['contacts', 'existing_certifications', 'follow_up_records', 'extra_fields']);
  const casted = keys.map((k, i) => (jsonCols.has(k) ? `${placeholders[i]}::jsonb` : placeholders[i]));
  return {
    text: `INSERT INTO leads (${keys.join(', ')}) VALUES (${casted.join(', ')}) RETURNING *`,
    values: keys.map((k) => cols[k])
  };
};

const updateSql = (id, cols) => {
  const keys = Object.keys(cols).filter((k) => k !== 'id');
  const jsonCols = new Set(['contacts', 'existing_certifications', 'follow_up_records', 'extra_fields']);
  const sets = keys.map((k, i) => `${k} = $${i + 2}${jsonCols.has(k) ? '::jsonb' : ''}`);
  sets.push('updated_at = NOW()');
  return {
    text: `UPDATE leads SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    values: [id, ...keys.map((k) => cols[k])]
  };
};

const leadRepo = {
  list: async ({ status, ownerUserId, q } = {}) => {
    const where = [];
    const params = [];
    if (status) { params.push(status); where.push(`lead_status = $${params.length}`); }
    if (ownerUserId) { params.push(ownerUserId); where.push(`owner_user_id = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR company ILIKE $${params.length})`); }
    const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },

  getById: async (id) => {
    const r = await query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  findByUscc: async (uscc) => {
    if (!uscc) return null;
    const r = await query('SELECT * FROM leads WHERE unified_social_credit_code = $1 LIMIT 1', [String(uscc)]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  create: async (lead) => {
    const withId = { ...lead, id: lead.id || makeId('L') };
    const { text, values } = insertSql(toColumns(withId));
    const r = await query(text, values);
    return fromRow(r.rows[0]);
  },

  update: async (id, updates) => {
    const cols = toColumns({ ...updates, id });
    const { text, values } = updateSql(id, cols);
    const r = await query(text, values);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },

  /** 批量导入用：按 id 存在与否决定插入还是更新，幂等可重跑 */
  bulkUpsert: async (leads) => {
    let written = 0;
    for (const lead of Array.isArray(leads) ? leads : []) {
      if (!lead) continue;
      const id = String(lead.id || '').trim();
      if (id && await leadRepo.getById(id)) {
        await leadRepo.update(id, lead);
      } else {
        await leadRepo.create(lead);
      }
      written += 1;
    }
    return written;
  },

  /*
    事务接口批量写线索。之前 leads_v8 根本不在事务接口的映射表里，
    「线索转合同」那一步发过来的「标记为已转化」被静默丢弃，
    线索会一直挂在未转化状态——销售看到的是一条永远转不掉的线索。
  */
  upsertWith: async (runner, obj) => {
    const { text, values } = leadUpsertSql(toColumns({ ...obj, id: obj.id || makeId('L') }));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  },

  addFollowUp: async (id, record) => {
    const existing = await leadRepo.getById(id);
    if (!existing) return null;
    const next = [...(existing.followUpRecords || []), record];
    return leadRepo.update(id, { followUpRecords: next });
  }
};

module.exports = { leadRepo, fromRow, toColumns };
