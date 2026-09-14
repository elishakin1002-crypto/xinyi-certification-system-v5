/**
 * 提醒的生命周期 —— 让提醒会自己退场。
 *
 * ── 问题（2026-09-14 金恩来：「提醒越挂越多也是个问题」）─────────
 *
 * 生产实测：228 条提醒，**0 条被读过，205 条已过期**，最早的是七个月前。
 * 提醒栏已经彻底失效 —— 人看一眼全是过期的，就再也不看了。
 *
 * 根因不是"生成得太多"，是**没有任何东西让它们退场**：
 *   · 过期了还挂着
 *   · 对应的事办完了，提醒不知道
 *   · 关联的合同/项目删了，提醒变成孤儿
 * 原来只有 is_read 一个布尔，而「我看过了」和「这件事办完了」是两回事。
 *
 * ── 六条规则，这个文件负责 1 3 4，前端负责 2 5 6 ──────────────
 *
 *   1 有生命周期    过期 N 天自动归档          ← 这里（每日任务）
 *   2 可完成        做完自动消失                ← 前端对账 + resolve 接口
 *   3 去重          同一件事不反复生成          ← 这里（dedupe_key 唯一索引）+ 库约束
 *   4 随对象消亡    业务记录没了，提醒跟着走    ← 这里（每日任务 + 删除时级联）
 *   5 分级          今天必须做的才进提醒栏      ← 前端
 *   6 有上限        超过 N 条折叠                ← 前端
 *
 * 放在服务端而不是前端的理由：前端只有人打开页面才跑。
 * 提醒该不该退场，不该取决于今天有没有人登录。
 */

/*
  link_type → 去哪张表找这个对象。

  找不到对应关系的 link_type（比如 'intel' 指向的是日期不是记录）**一律不动** ——
  宁可留着一条过期提醒，也不能因为"我不认识这个类型"就把它删了。
  这是删数据的代码，默认必须是"不删"。
*/
const LINK_TABLES = Object.freeze({
  contract: 'contracts',
  customer: 'customers',
  lead: 'leads',
  project: 'projects',
  audit: 'audit_issues',
  knowledge: 'knowledge_docs',
});

/** 过期多少天之后归档。给 3 天宽限：刚过期一两天的还该催 */
const ARCHIVE_GRACE_DAYS = Math.max(0, Number(process.env.XINYI_REMINDER_ARCHIVE_GRACE_DAYS || 3));

/**
 * 规则 1：过期的提醒自动归档。
 *
 * 归档不是删除 —— 某份合同确实在 3 月到期过，那条提醒是业务事实，
 * 删了就说不清当时提醒过没有。只是它不该再挤在待办栏里。
 */
const archiveExpired = async (pool) => {
  const r = await pool.query(
    `UPDATE reminders
        SET status = 'archived', archived_at = NOW()
      WHERE status = 'open'
        AND reminder_date IS NOT NULL
        AND reminder_date < CURRENT_DATE - ($1 || ' days')::interval`,
    [ARCHIVE_GRACE_DAYS]
  );
  return r.rowCount;
};

/**
 * 规则 4：关联对象已经不在了，提醒跟着走。
 *
 * 这些是**派生数据**（「XX 合同快到期了」），本体没了，它就没有意义 ——
 * 所以这里是真删不是归档。留着只会变成点开什么也没有的死条目。
 *
 * 注意只处理 LINK_TABLES 里认识的类型，且 link_id 非空。
 * 一个不认识的类型让它留着，代价是一条多余的提醒；
 * 猜错了删掉，代价是别人的待办凭空消失 —— 两者不对等。
 */
const removeOrphans = async (pool) => {
  let removed = 0;
  for (const [linkType, table] of Object.entries(LINK_TABLES)) {
    try {
      const r = await pool.query(
        `DELETE FROM reminders rm
          WHERE rm.link_type = $1
            AND coalesce(rm.link_id, '') <> ''
            AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = rm.link_id)`,
        [linkType]
      );
      removed += r.rowCount;
    } catch (e) {
      // 表不存在之类 —— 跳过这一类，不让收尾把整个任务打断
      console.warn(`[提醒] 清理 ${linkType} 孤儿提醒失败:`, e.message);
    }
  }
  return removed;
};

/**
 * 规则 3：同一件事只留一条。
 *
 * 库里已经加了 dedupe_key 唯一索引，新写入不会重复；
 * 这里收拾历史遗留 —— 同一个 key 留最新那条，其余删掉。
 */
const dedupe = async (pool) => {
  const r = await pool.query(
    `DELETE FROM reminders rm
      WHERE rm.ctid IN (
        SELECT ctid FROM (
          SELECT ctid, row_number() OVER (PARTITION BY dedupe_key ORDER BY created_at DESC) rn
            FROM reminders WHERE dedupe_key IS NOT NULL
        ) t WHERE t.rn > 1
      )`
  );
  return r.rowCount;
};

/**
 * 级联：删业务记录时顺手把它的提醒带走。
 *
 * 每日任务是兜底，这里是即时的 —— 人删掉一份合同之后，
 * 不该还要等到明天才看不到「这份合同快到期了」。
 *
 * 用在各 repo 的 remove 里，失败不抛（删提醒失败不该让删合同也失败）。
 */
const cascadeOnDelete = async (pool, linkType, linkId) => {
  if (!linkType || !linkId) return 0;
  try {
    const r = await pool.query(
      'DELETE FROM reminders WHERE link_type = $1 AND link_id = $2', [linkType, String(linkId)]
    );
    return r.rowCount;
  } catch (e) {
    console.warn('[提醒] 级联清理失败（不影响主删除）:', e.message);
    return 0;
  }
};

/** 跑一轮完整的生命周期维护 */
const runReminderLifecycle = async (pool) => {
  const archived = await archiveExpired(pool);
  const orphaned = await removeOrphans(pool);
  const deduped = await dedupe(pool);
  return { archived, orphaned, deduped };
};

/** 每日定时。和状态历史清理一样：不做成"有个脚本可以跑"，做成它自己会跑 */
const scheduleReminderLifecycle = (pool) => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const runOnce = async () => {
    try {
      const r = await runReminderLifecycle(pool);
      if (r.archived || r.orphaned || r.deduped) {
        console.log(`[提醒] 生命周期维护：归档过期 ${r.archived} 条，清理孤儿 ${r.orphaned} 条，去重 ${r.deduped} 条`);
      }
    } catch (e) {
      console.warn('[提醒] 生命周期维护失败（不影响业务）:', e.message);
    }
  };
  setTimeout(runOnce, 3 * 60 * 1000).unref?.();
  const timer = setInterval(runOnce, DAY_MS);
  timer.unref?.();
  console.log(`[提醒] 每日生命周期维护已启用（过期 ${ARCHIVE_GRACE_DAYS} 天归档 / 清理孤儿 / 去重）`);
  return timer;
};

module.exports = {
  LINK_TABLES,
  ARCHIVE_GRACE_DAYS,
  archiveExpired,
  removeOrphans,
  dedupe,
  cascadeOnDelete,
  runReminderLifecycle,
  scheduleReminderLifecycle,
};
