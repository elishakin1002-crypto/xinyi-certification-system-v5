// 通用 CRUD repo 工厂。给定表名/字段规格/过滤列，生成标准 repo。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

// opts: { table, spec, idPrefix, filters: { queryKey: column }, orderBy }
const makeRepo = ({ table, spec, idPrefix = 'X', filters = {}, orderBy = 'created_at DESC' }) => {
  const { toColumns, fromRow, insertSql, updateSql, upsertSql } = buildMapper(spec, { table });

  const list = async (q = {}) => {
    const where = [];
    const params = [];
    for (const [key, col] of Object.entries(filters)) {
      const v = q[key];
      if (v !== undefined && v !== '') { params.push(v); where.push(`${col} = $${params.length}`); }
    }
    const sql = `SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  };
  const getById = async (id) => {
    const r = await query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  };
  const createWith = async (runner, obj) => {
    const { text, values } = insertSql(toColumns({ ...obj, id: obj.id || makeId(idPrefix) }));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  };
  const updateWith = async (runner, id, updates) => {
    const { text, values } = updateSql(id, toColumns({ ...updates, id }));
    const r = await runner(text, values);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  };
  const upsertWith = async (runner, obj) => {
    const { text, values } = upsertSql(toColumns({ ...obj, id: obj.id || makeId(idPrefix) }));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  };
  return {
    list, getById, createWith, updateWith, upsertWith,
    create: (obj) => createWith(query, obj),
    update: (id, u) => updateWith(query, id, u),
    upsert: (obj) => upsertWith(query, obj),
    toColumns, fromRow,
  };
};

module.exports = { makeRepo };
