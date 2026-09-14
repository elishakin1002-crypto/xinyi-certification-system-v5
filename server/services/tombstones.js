/**
 * 删除墓碑 —— 让「删了刷新又回来」在架构上不可能发生。
 *
 * ── 病根 ────────────────────────────────────────────────────
 *
 * 关系表（服务端写、SQL 统计读）和状态库（前端整份读、整份写回）是两份数据。
 * 后端删掉一条，状态库那份数组里还在，前端下次整份写回 —— 它就回来了。
 * 而且**全程没有任何报错**：删除接口返回 200，列表上也确实没了，
 * 刷新之后才发现它又在。
 *
 * 2026-09-13 我自己栽了一次：金恩来下令删的 6 篇死链文档，
 * 我只删了关系表那一半，还报告「已删除」—— 那 6 条一直躺在状态库里等着回来。
 *
 * ── 为什么是墓碑，不是"发现了再修" ──────────────────────────
 *
 * 对账脚本能发现不一致，但那是事后的，而且要人去看。
 * 墓碑让这件事**不可能发生**：删除时留一条「这个 id 已经被删了」，
 * 之后任何一次整份写回都先过一遍墓碑，被删的条目直接剔掉。
 * 前端写回什么都无所谓 —— 删掉的东西回不来。
 *
 * 顺带补上一个一直缺的东西：这个项目的第一条铁律是
 * 「谁做的这条链不能断」，而在此之前**删除是唯一没有留痕的动作**。
 */

/**
 * 状态库的数据集 key → 墓碑里的 entity_type。
 *
 * 只列**有服务端删除路径**的。没有删除接口的数据集加进来只是空转。
 * 新增了删除接口却忘了在这里登记，症状就是老 bug 复发 ——
 * 所以 tests/tombstone.test.js 里有一条对着删除路由清点这张表。
 */
const DATASET_ENTITY = Object.freeze({
  contracts_v8: 'contract',
  customers_v8: 'customer',
  leads_v8: 'lead',
  projects_v8: 'project',
  knowledge_docs_v8: 'knowledge',
  reminders_v8: 'reminder',
  project_work_logs_v1: 'worklog',
  settlements_v8: 'settlement',
});

/**
 * 记一块墓碑。
 *
 * 用 runner 而不是直接 pool：删除通常在事务里，
 * 墓碑必须和删除**同一个事务** —— 否则删成功而墓碑没记上，
 * 那条记录下次就又回来了，比不删还糟（人以为删掉了）。
 */
const recordDeletion = async (runner, { entityType, entityId, deletedBy, deletedByName, reason }) => {
  if (!entityType || !entityId) return;
  await runner(
    `INSERT INTO deleted_records (entity_type, entity_id, deleted_by, deleted_by_name, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (entity_type, entity_id)
     DO UPDATE SET deleted_at = NOW(), deleted_by = EXCLUDED.deleted_by,
                   deleted_by_name = EXCLUDED.deleted_by_name, reason = EXCLUDED.reason`,
    [String(entityType), String(entityId), deletedBy || null, deletedByName || null, reason || null]
  );
};

/**
 * 撤销墓碑 —— 同一个 id 又被重新建出来时用。
 *
 * 真实场景：删错了，重新录一遍，沿用原来的编号。
 * 不撤墓碑的话，新建的那条会被过滤器当成"已删的"又剔掉，
 * 而人只会看到「录进去了，刷新就没」—— 和原来的 bug 一模一样，方向相反。
 */
const clearTombstone = async (runner, entityType, entityId) => {
  if (!entityType || !entityId) return;
  await runner('DELETE FROM deleted_records WHERE entity_type = $1 AND entity_id = $2',
    [String(entityType), String(entityId)]);
};

/**
 * 按墓碑过滤一份整份写回的数据集。
 *
 * @returns {{value: any, removed: string[]}} removed 是被剔掉的 id，
 *          调用方要把它记进日志 —— 悄悄剔除和悄悄写回一样糟糕，
 *          出问题时至少要能在日志里看见"这里剔了几条、剔了哪几条"。
 */
const filterDeleted = async (runner, datasetKey, datasetValue) => {
  const entityType = DATASET_ENTITY[datasetKey];
  if (!entityType || !Array.isArray(datasetValue) || datasetValue.length === 0) {
    return { value: datasetValue, removed: [] };
  }

  const ids = datasetValue.map((x) => String(x?.id || '')).filter(Boolean);
  if (!ids.length) return { value: datasetValue, removed: [] };

  const r = await runner(
    'SELECT entity_id FROM deleted_records WHERE entity_type = $1 AND entity_id = ANY($2)',
    [entityType, ids]
  );
  if (!r.rows.length) return { value: datasetValue, removed: [] };

  const dead = new Set(r.rows.map((x) => String(x.entity_id)));
  return {
    value: datasetValue.filter((x) => !dead.has(String(x?.id || ''))),
    removed: [...dead]
  };
};

module.exports = { DATASET_ENTITY, recordDeletion, clearTombstone, filterDeleted };
