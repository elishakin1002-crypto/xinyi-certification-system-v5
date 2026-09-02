// 把 state store 里的几个数据集投影成 PG 关系表的行。
//
// ── 解决什么问题（待办 P0-19b）────────────────────────────────
// 不符合项、工作日志、任务模板只存在 state store 的一个 jsonb 大数组里，
// 对应的 PG 表（audit_issues / project_work_logs / task_templates）一直是 0 行。
//
// ── 为什么是投影，不是搬家 ────────────────────────────────────
// 搬家意味着改读路径——审核页、项目页、工作日志都要改数据源，
// 那是上线前最不该动的东西。所以这里只加一条写路径：
// **state store 照写不误（读的还是它），同时把内容投影进关系表。**
//
// 换来的是：
//   ✅ 能用 SQL 统计（「谁这个月记了多少工时」不用把整个数组捞进内存）
//   ✅ 备份和恢复有了行级粒度
//   ✅ 提醒在 PG、本体在 JSON 的裂缝补上了
//
// **没换来的**（要说清楚，别让人以为问题全解决了）：
//   ❌ 并发覆盖风险还在。state store 是整份数组写入，
//      两个人同时改，后写的仍会盖掉先写的——那是读路径改造（P0-19）才能解决的。
//
// ── 2026-09-02 收紧 ───────────────────────────────────────────
// 上面那条「并发覆盖」原本会一路传导到关系表：投影会删掉数组里没有的行，
// 于是一个副本落后的浏览器能删掉别人刚记的数据。
// 现在删除只在调用方显式传 allowClear 时执行（清理脚本用），
// 前端同步只 upsert 不删。详见 projectDataset 里的注释。
// **这只是止血，不是治本**——治本是 P0-19 读路径改造。
//
// ── 失败了怎么办 ──────────────────────────────────────────────
// 只警告，不抛。关系表现在是**派生数据**，投影失败不该让业务写入回滚——
// 那等于用一个次要问题制造一个主要问题。同一条理由见 datasetMirror.js。
const { withTransaction } = require('../db/pool');
const { auditRepo } = require('../repos/batch4Repos');
const { workLogRepo, taskTemplateRepo } = require('../repos/batch5Repos');

/** 数据集键 → 仓储 + 表名。只有列在这里的才会被投影。 */
const PROJECTED = {
  audit_issues_v1: { repo: auditRepo, table: 'audit_issues', label: '不符合项' },
  project_work_logs_v1: { repo: workLogRepo, table: 'project_work_logs', label: '工作日志' },
  task_templates_v1: { repo: taskTemplateRepo, table: 'task_templates', label: '任务模板' },
};

const projectedKeys = () => Object.keys(PROJECTED);

/**
 * 把一份数据集投影进对应的关系表。
 *
 * **删除也要跟上**：数据集是全量数组，前端删掉一条之后再整份写回，
 * 关系表里那条如果不删就变成幽灵行——将来用 SQL 统计会多算。
 * 所以在同一个事务里：upsert 数组里的每条，删掉数组里没有的。
 */
const projectDataset = async (client, key, rows, allowClear = false) => {
  const conf = PROJECTED[key];
  if (!conf || !Array.isArray(rows)) return { upserted: 0, deleted: 0 };

  const run = (text, values) => client.query(text, values);
  const ids = [];
  let upserted = 0;

  for (const rec of rows) {
    if (!rec || !rec.id) continue;   // 没有 id 的记录无法幂等 upsert，跳过
    await conf.repo.upsertWith(run, rec);
    ids.push(String(rec.id));
    upserted++;
  }

  /*
    数组为空时**不删表里的行**。

    空数组的来源分两种：真的全删光了，和「前端还没加载完就触发了一次写」。
    第二种在实际使用中出现过，而它和第一种在数据上一模一样。
    分不清的时候，宁可留下几条幽灵行，也不能一次清空整张表——
    前者是统计误差，后者是数据事故。
  */
  let deleted = 0;
  if (ids.length === 0 && allowClear) {
    /*
      **有意清空**：调用方明确声明了这次就是要清掉（清理脚本、批量退档）。

      2026-09-01 踩到这个：演示数据清理把 audit_issues_v1 清成了空数组，
      state store 空了、关系表里那行还在——数据体检立刻报「两边数量不一致」。
      保护本身是对的（分不清「真删光」和「没加载完」），
      但**合法的清空必须有路可走**，否则只能靠人事后手工删。
    */
    const r = await client.query(`DELETE FROM ${conf.table}`);
    return { upserted, deleted: r.rowCount || 0 };
  }
  /*
    ── 只有「有意为之」的调用才允许删行（2026-09-02 收紧）────────

    原来这里对任何一次写入都执行「删掉数组里没有的行」。
    在单人使用时是对的：前端删了一条，表里那条也该消失。

    **多人同时用的时候它是个数据事故**：
    每个浏览器推的是自己 localStorage 里那份全量数组，
    而各人的副本互不相通（VITE_STATE_SYNC_READ_ENABLED 默认关闭，没人从服务端回读）。
    于是——
      小敏 10:00 记一条工作日志  → 表里 48 行
      梁杰 10:05 改了别的东西    → 他浏览器推自己那份 47 条的数组
                                → DELETE ... WHERE NOT IN (他的 47 条)
                                → 小敏那条被删掉，无报错、无提示

    生产上已经差点发生：2026-09-02 线上 project_work_logs_v1 推上来是**空数组**，
    而表里有 47 行。只因为上面那条「空数组不删」的保护才没删成。
    当时浏览器里要是有 1 条而不是 0 条，另外 46 条就没了。

    ── 为什么选「不删」而不是「加版本号」 ────────────────────────
    加乐观锁是正解，但那要改前端的读路径（待办 P0-19），不是今天能安全上线的。
    在那之前，两害相权：
      不删 → 用户删掉的行变成幽灵行，SQL 统计工时会多算  （统计误差）
      照删 → 同事的记录被静默删除                        （数据事故）
    **多几行远好过少几行**，而且幽灵行事后能对账清理，删掉的找不回来。

    清理脚本、批量退档这类**明确知道自己在干什么**的调用，
    传 allowClear:true 依然能删。前端同步永远传不到这个标志。
  */
  if (ids.length > 0 && allowClear) {
    const r = await client.query(
      `DELETE FROM ${conf.table} WHERE NOT (id = ANY($1::text[]))`, [ids]);
    deleted = r.rowCount || 0;
  }

  return { upserted, deleted };
};

/**
 * 投影一批数据集。调用方：stateStore.upsertStateBatch。
 * 不在 PROJECTED 里的键直接忽略，不报错。
 */
const projectToRelational = async (datasets = {}, meta = {}) => {
  const keys = Object.keys(datasets).filter((k) => PROJECTED[k] && Array.isArray(datasets[k]));
  if (keys.length === 0) return { projected: [] };

  const result = [];
  try {
    await withTransaction(async (client) => {
      for (const k of keys) {
        const { upserted, deleted } = await projectDataset(client, k, datasets[k], Boolean(meta.allowClear));
        result.push({ key: k, label: PROJECTED[k].label, upserted, deleted });
      }
    });
  } catch (error) {
    // 派生数据写失败不影响主流程，但必须留下痕迹——静默失败比不做更糟
    console.warn('[relationalProjection] 投影失败（不影响 state store 写入）:', error?.message || error);
    return { projected: [], error: error?.message || String(error) };
  }
  return { projected: result };
};

module.exports = { projectToRelational, projectedKeys, PROJECTED };
