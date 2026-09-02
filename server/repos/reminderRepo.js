// 提醒 repo —— 批次2。
const { query } = require('../db/pool');
const { buildMapper, makeId } = require('./_mapper');

const SPEC = [
  { api: 'id', col: 'id', kind: 'text' },
  { api: 'title', col: 'title', kind: 'text' },
  { api: 'content', col: 'content', kind: 'text' },
  { api: 'date', col: 'reminder_date', kind: 'date' },
  { api: 'type', col: 'reminder_type', kind: 'text' },
  { api: 'isRead', col: 'is_read', kind: 'bool' },
  { api: 'linkId', col: 'link_id', kind: 'text' },
  { api: 'linkType', col: 'link_type', kind: 'text' },
  { api: 'forRole', col: 'for_role', kind: 'json' },
  { api: 'forUserIds', col: 'for_user_ids', kind: 'json' },
  { api: 'channels', col: 'channels', kind: 'json' },
  { api: 'pushedToWeChat', col: 'pushed_to_wechat', kind: 'bool' }
];

const { toColumns, fromRow, insertSql, updateSql, upsertSql } = buildMapper(SPEC, { table: 'reminders' });

const reminderRepo = {
  list: async ({ linkType, linkId, isRead } = {}) => {
    const where = [];
    const params = [];
    if (linkType) { params.push(linkType); where.push(`link_type = $${params.length}`); }
    if (linkId) { params.push(linkId); where.push(`link_id = $${params.length}`); }
    if (isRead !== undefined) { params.push(Boolean(isRead)); where.push(`is_read = $${params.length}`); }
    const sql = `SELECT * FROM reminders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY reminder_date DESC NULLS LAST, created_at DESC`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },
  getById: async (id) => {
    const r = await query('SELECT * FROM reminders WHERE id = $1 LIMIT 1', [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  // 用提供的 client（事务内）或默认池插入一条
  createWith: async (runner, reminder) => {
    const withId = { ...reminder, id: reminder.id || makeId('REM') };
    const { text, values } = insertSql(toColumns(withId));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  },
  create: async (reminder) => reminderRepo.createWith(query, reminder),
  update: async (id, updates) => {
    const { text, values } = updateSql(id, toColumns({ ...updates, id }));
    const r = await query(text, values);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  remove: async (id) => {
    await query('DELETE FROM reminders WHERE id = $1', [String(id || '')]);
    return { ok: true };
  },
  upsertWith: async (runner, obj) => {
    const { text, values } = upsertSql(toColumns({ ...obj, id: obj.id || makeId('REM') }));
    const r = await runner(text, values);
    return fromRow(r.rows[0]);
  }
};

module.exports = { reminderRepo, fromRow };
