// 把 PG 业务表的内容回写到 state store 的数据集镜像。
//
// ── 为什么需要这层 ────────────────────────────────────────────────
// 系统里同一份数据存了两处：
//   ① PG 业务表（leads / contracts / projects …）—— batch 路由读写，是真相
//   ② state store 的数据集（leads_v8 …）        —— 前端 /api/state/sync 读写
//
// 前端两条路都走：进页面时先用 ② 水合，再按开关用 ① 覆盖；
// 保存时把整份数据集写回 ②。
//
// 于是出现这条数据丢失路径：
//   网站表单 → API 建了一条线索 → 只进了 ①
//   → 前端此时手里还是旧的 ② → 用户点保存 → 整份写回 ② → 那条线索被旧副本盖掉
//
// 2026-08-21 的实测证据：state store 里 458 条线索，PG 里 455 条，对不上。
//
// 这里做的是**外科式修补**：API 写完 PG 之后，顺手把镜像刷新成 PG 的内容，
// 让 ② 始终跟得上 ①。不改任何读路径，风险可控。
//
// 真正的解法是让 /api/state/sync 直接从 PG 读（一份真相，镜像作废），
// 但那会改变每个页面的数据来源，不适合在上线前动。见待办 P0-19。
const { upsertStateBatch } = require('../stateStore');

/** 业务表 → 数据集键。只有列在这里的才会被镜像。 */
const MIRRORED = {
  lead: 'leads_v8',
  customer: 'customers_v8',
  contract: 'contracts_v8',
  project: 'projects_v8',
  // 提醒和知识文档也有 PG 表，事务接口会写它们，镜像同样要跟上
  reminder: 'reminders_v8',
  knowledge: 'knowledge_docs_v8',
  settlement: 'settlements_v8',
};

/**
 * 把某类资源的全量数据刷进镜像。
 *
 * 失败只警告不抛：镜像是派生数据，刷新失败不该让业务写入回滚——
 * 那样等于用一个次要问题制造一个主要问题。
 */
const refreshMirror = async (resourceType, repo, meta = {}) => {
  const key = MIRRORED[resourceType];
  if (!key || !repo?.list) return false;
  try {
    const rows = await repo.list();
    await upsertStateBatch({ [key]: rows }, {
      actorUserId: meta.actorUserId || '',
      clientId: meta.clientId || 'dataset-mirror',
      appVersion: meta.appVersion || `${resourceType}-mirror`,
    });
    return true;
  } catch (e) {
    console.warn(`[datasetMirror] ${resourceType} 镜像刷新失败（不影响主流程）:`, e?.message);
    return false;
  }
};

/** 包一层路由处理器：正常响应后再刷镜像 */
const withMirror = (resourceType, repo, handler) => async (req, res, ...rest) => {
  const out = await handler(req, res, ...rest);
  await refreshMirror(resourceType, repo, { actorUserId: req.authUser?.id || '' });
  return out;
};

module.exports = { refreshMirror, withMirror, MIRRORED };

/** 数据集键 → 资源类型。事务接口一次写多种数据集，要按键逐个刷镜像。 */
const TYPE_BY_KEY = Object.fromEntries(Object.entries(MIRRORED).map(([t, k]) => [k, t]));

/**
 * 按数据集键批量刷新镜像。
 *
 * 事务接口（/api/projects/transaction 等）一次会写项目、客户、提醒等多种数据，
 * 只刷「路由主类型」那一种不够——客户写进了 PG，镜像里却还是旧的。
 */
const refreshMirrorsByKeys = async (datasetKeys = [], repos = {}, meta = {}) => {
  for (const key of datasetKeys) {
    const type = TYPE_BY_KEY[key];
    if (type && repos[type]) await refreshMirror(type, repos[type], meta);
  }
};

module.exports.refreshMirrorsByKeys = refreshMirrorsByKeys;
module.exports.TYPE_BY_KEY = TYPE_BY_KEY;
