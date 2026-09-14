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
  { api: 'pushedToWeChat', col: 'pushed_to_wechat', kind: 'bool' },
  /*
    生命周期三件套（2026-09-14 加，见 db/migrations/023）。

    原来只有 isRead 一个布尔 —— 而「我看过了」和「这件事办完了」是两回事。
    没有"办完"这个状态，提醒就没有退出机制，
    于是生产上攒了 228 条、0 条已读、205 条过期，功能等于废掉。
  */
  { api: 'status', col: 'status', kind: 'text' },
  { api: 'resolvedAt', col: 'resolved_at', kind: 'text' },
  { api: 'archivedAt', col: 'archived_at', kind: 'text' },
  { api: 'dedupeKey', col: 'dedupe_key', kind: 'text' }
];

const { toColumns, fromRow, insertSql, updateSql, upsertSql } = buildMapper(SPEC, { table: 'reminders' });

const reminderRepo = {
  /**
   * 列提醒。
   *
   * **默认只给待办（status='open'）**。这是这次改动最要紧的一行：
   * 在这之前列表把七个月前的过期提醒和今天的一起端出来，
   * 人看一眼就再也不看了。要看归档的，显式传 status。
   */
  list: async ({ linkType, linkId, isRead, status = 'open', includeArchived = false } = {}) => {
    const where = [];
    const params = [];
    if (linkType) { params.push(linkType); where.push(`link_type = $${params.length}`); }
    if (linkId) { params.push(linkId); where.push(`link_id = $${params.length}`); }
    if (isRead !== undefined) { params.push(Boolean(isRead)); where.push(`is_read = $${params.length}`); }
    if (!includeArchived && status) { params.push(String(status)); where.push(`coalesce(status,'open') = $${params.length}`); }
    const sql = `SELECT * FROM reminders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY reminder_date DESC NULLS LAST, created_at DESC`;
    const r = await query(sql, params);
    return r.rows.map(fromRow);
  },

  /**
   * 规则 2：把一条提醒标记为「办完了」。
   *
   * 和 isRead 的区别要说清楚：
   *   isRead  = 我看见了（看一眼就算）
   *   done    = 这件事处理完了（该收款的收了、该整改的改了）
   * 只有后者才让它离开待办栏。原来只有前者，所以没人标 ——
   * 因为标了也不代表事情做了，标它没有意义。
   */
  resolve: async (id) => {
    const r = await query(
      `UPDATE reminders SET status='done', resolved_at=NOW(), is_read=true, updated_at=NOW()
        WHERE id = $1 RETURNING *`, [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  getById: async (id) => {
    const r = await query('SELECT * FROM reminders WHERE id = $1 LIMIT 1', [String(id || '')]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  },
  // 用提供的 client（事务内）或默认池插入一条
  createWith: async (runner, reminder) => {
    const id = reminder.id || makeId('REM');
    /*
      规则 3（去重）：系统提醒的 id 本来就是确定性的
      （AUTO-AR-DUE-合同id-应收id），直接拿来当去重键。
      库里 dedupe_key 上有唯一索引，同一件事重复生成会被挡在库层，
      而不是靠"前端记得先查一下"。人手建的提醒没有去重需求，留空。
    */
    const withId = {
      ...reminder,
      id,
      status: reminder.status || 'open',
      dedupeKey: reminder.dedupeKey || (String(id).startsWith('AUTO-') ? id : null)
    };
    const { text, values } = insertSql(toColumns(withId));
    try {
      const r = await runner(text, values);
      return fromRow(r.rows[0]);
    } catch (e) {
      /*
        ── 重复生成要幂等，不能报错（2026-09-14 实跑发现）──────────

        加了 dedupe_key 唯一索引之后，重复建同一条系统提醒直接 500 ——
        因为唯一约束冲突原样抛了出去。

        但**系统提醒本来就会反复生成**：每次前端跑一遍生成逻辑，
        「AUTO-AR-DUE-合同x-应收y」都会再来一次。这不是错误，是正常运转。
        该做的是「已经有了就返回那一条」，不是把 500 摔给调用方 ——
        500 会让前端以为写失败，进而弹一个根本不存在的错误给同事看。

        23505 = unique_violation。
      */
      if (e?.code === '23505') {
        const existing = await runner(
          'SELECT * FROM reminders WHERE dedupe_key = $1 OR id = $2 LIMIT 1',
          [withId.dedupeKey || null, id]
        );
        if (existing.rows[0]) return fromRow(existing.rows[0]);
      }
      throw e;
    }
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
