/**
 * 状态快照历史的分层保留 —— 每天自动跑，不靠人记得。
 *
 * ── 为什么要有这个（2026-09-14）─────────────────────────────
 *
 * 金恩来：「数据库的备份怎么会有 4002 份这么多？这完全不合理啊！」
 *
 * 两个原因叠在一起：
 *   ① 前端整份写回时不管有没有改动都存一份全量快照（已在 stateStore 加哈希去重）
 *   ② **原来就有一个清理脚本（npm run state:history），但从来没人跑过**
 *
 * 第二条才是真问题。「有个脚本可以清」和「它每天自己清」是两回事 ——
 * 前者等于没有。这个项目里已经栽过一次：npm run checkup 也是"有但没人跑"，
 * 于是页面达标情况没人看，做成了头重脚轻。
 * 所以这次不写脚本，写成**跟着服务一起起来的定时任务**。
 *
 * ── 保留策略为什么这么分 ────────────────────────────────────
 *
 *   近 7 天      全留        出问题基本在几天内发现，这几天要能逐次回溯
 *   7-30 天      每天留 1 版  一个月内的事，精确到天足够定位
 *   30-90 天     每周留 1 版  三个月内的事，精确到周足够"大概那阵子改的"
 *   90 天以上    删          再久的去 /opt/xinyi-releases 的部署快照里找
 *
 * 另有**保底**：每个数据集无论多旧，至少留最近 20 版。
 * 防止某个数据集半年没改，一清就一版都不剩 —— 那时候想回滚就真的没了。
 */

/*
  这条 SQL 一次算完"该留哪些"，再删掉其余的。

  为什么不分四次删：分开删的话，每一档都要自己判断"我这档保留的，
  会不会已经被上一档删了"，边界条件很容易写错，而写错的后果是**多删**。
  一次算出保留集合，剩下的删掉，边界自然不会重叠。

  window 函数说明：
    rn      —— 每个数据集内按时间倒序的名次，用来做「至少留 20 版」保底
    day_rn  —— 每个数据集每一天内的名次，=1 就是那天最后一版
    week_rn —— 每个数据集每一周内的名次，=1 就是那周最后一版
*/
const PRUNE_SQL = `
WITH ranked AS (
  SELECT
    id,
    dataset_key,
    created_at,
    row_number() OVER (PARTITION BY dataset_key ORDER BY created_at DESC) AS rn,
    row_number() OVER (PARTITION BY dataset_key, date_trunc('day', created_at) ORDER BY created_at DESC) AS day_rn,
    row_number() OVER (PARTITION BY dataset_key, date_trunc('week', created_at) ORDER BY created_at DESC) AS week_rn
  FROM app_state_history
),
keep AS (
  SELECT id FROM ranked
  WHERE
    rn <= $1                                                        -- 保底：每个数据集至少留最近 N 版
    OR created_at >= NOW() - INTERVAL '7 days'                      -- 近 7 天：全留
    OR (created_at >= NOW() - INTERVAL '30 days' AND day_rn = 1)     -- 7-30 天：每天留最后一版
    OR (created_at >= NOW() - INTERVAL '90 days' AND week_rn = 1)    -- 30-90 天：每周留最后一版
)
DELETE FROM app_state_history h
WHERE NOT EXISTS (SELECT 1 FROM keep k WHERE k.id = h.id)
`;

const KEEP_MIN_VERSIONS = Math.max(5, Number(process.env.XINYI_STATE_HISTORY_KEEP_MIN || 20));

/**
 * 跑一次清理。
 * @param {import('pg').Pool} pool
 * @param {{dryRun?: boolean}} opts dryRun 只数不删，给体检脚本用
 */
const pruneStateHistory = async (pool, { dryRun = false, reclaimDisk = false } = {}) => {
  const sizeOf = async () => {
    const { rows: [r] } = await pool.query(
      `SELECT count(*)::int n, pg_total_relation_size('app_state_history') bytes FROM app_state_history`);
    return { rows: r.n, bytes: Number(r.bytes) };
  };

  const before = await sizeOf();

  if (dryRun) {
    const countSql = PRUNE_SQL.replace(
      'DELETE FROM app_state_history h',
      'SELECT count(*)::int AS n FROM app_state_history h'
    );
    const { rows: [r] } = await pool.query(countSql, [KEEP_MIN_VERSIONS]);
    return { before, wouldDelete: r.n, deleted: 0, after: before };
  }

  const res = await pool.query(PRUNE_SQL, [KEEP_MIN_VERSIONS]);

  /*
    ── 两种 VACUUM 差别很大，别搞混（2026-09-14 我自己踩了）──────

    我第一版写的是 `VACUUM (ANALYZE)`，注释里还特意写着
    「不然人看着以为没生效」—— 然后实跑：4235 条删到 1593 条，
    **磁盘 167.7 MB → 167.7 MB，一个字节没降。**

      VACUUM        把死行标记成"可复用"，空间留在表里给以后的 INSERT 用。
                    不加锁，随时能跑。表**不再继续长大**，但也**不还给系统**。
      VACUUM FULL   重写整张表，把空间还给操作系统。
                    但它要 ACCESS EXCLUSIVE 锁 —— **整张表读写全停**。

    所以分两种用法：
      · 每天的定时清理 → 普通 VACUUM。目的是"别再涨"，不加锁，安全。
      · 一次性回收那 146MB → VACUUM FULL，手动在没人用的时候跑
        （13 个人的系统，锁住几秒钟也要挑时间）。

    返回值里 before/after 照实报，不许把"行数少了"说成"省了磁盘"。
  */
  if (res.rowCount > 0) {
    try {
      await pool.query(reclaimDisk ? 'VACUUM FULL ANALYZE app_state_history' : 'VACUUM (ANALYZE) app_state_history');
    } catch (e) {
      console.warn('[状态历史] VACUUM 失败（数据已删，只是空间没整理）:', e.message);
    }
  }

  const after = await sizeOf();
  return {
    before,
    deleted: res.rowCount,
    after,
    wouldDelete: res.rowCount,
    diskReclaimed: reclaimDisk,
    // 没做 FULL 的话，磁盘不会降 —— 这句话要跟着结果走，免得调用方报喜
    diskNote: reclaimDisk ? '已回收磁盘' : '空间留作复用，表不再增长；要真正还给系统需 reclaimDisk:true（会短暂锁表）'
  };
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * 挂上每日定时清理。服务启动时调一次，之后每 24 小时一次。
 *
 * 启动时**先跑一次**：不然服务器重启频繁的话，永远等不到那个 24 小时。
 * 延迟 5 分钟，避开启动时的其它初始化。
 */
const scheduleStateHistoryPrune = (pool) => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const runOnce = async () => {
    try {
      const r = await pruneStateHistory(pool);
      if (r.deleted > 0) {
        console.log(`[状态历史] 清理 ${r.deleted} 个重复/过期版本：${r.before.rows} → ${r.after.rows} 条，${mb(r.before.bytes)} → ${mb(r.after.bytes)}`);
      }
    } catch (e) {
      // 清理失败绝不能影响主服务 —— 它只是省空间，不是业务
      console.warn('[状态历史] 清理失败（不影响业务）:', e.message);
    }
  };
  setTimeout(runOnce, 5 * 60 * 1000).unref?.();
  const timer = setInterval(runOnce, DAY_MS);
  timer.unref?.();
  console.log(`[状态历史] 每日自动清理已启用（近 7 天全留 / 7-30 天每天 1 版 / 30-90 天每周 1 版 / 每数据集保底 ${KEEP_MIN_VERSIONS} 版）`);
  return timer;
};

module.exports = { pruneStateHistory, scheduleStateHistoryPrune, KEEP_MIN_VERSIONS };
