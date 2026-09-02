// 工作日志与任务模板的 PG 仓储。
//
// ── 为什么现在才有 ──────────────────────────────────────────────
// 这两张表（project_work_logs / task_templates）在迁移里早就建好了，
// **但从来没有任何代码往里写过**，一直是 0 行。
// 数据实际存在 state store 的数据集里（app_state_latest 的一个 jsonb 大数组）。
//
// 后果不是「数据丢了」——备份已经覆盖了 state store。后果是：
//   ① 没法用 SQL 统计。「谁这个月记了多少工时」这种问题只能把整个数组捞出来在内存里算
//   ② 一条不符合项的**提醒**进了 PG、**本体**留在 JSON，同一件事裂成两半
//
// 工作日志是这套系统里最值钱的数据——咨询师在现场记的东西，
// AI 学不到、别处也拿不到。把它放在一个 jsonb 数组里不是它该待的地方。
const { makeRepo } = require('./_factory');

const workLogRepo = makeRepo({
  table: 'project_work_logs',
  idPrefix: 'WLOG',
  filters: { projectId: 'project_id', taskId: 'task_id', operatorUserId: 'operator_user_id' },
  orderBy: 'log_date DESC, created_at DESC',
  spec: [
    { api: 'id', col: 'id', kind: 'text' },
    { api: 'projectId', col: 'project_id', kind: 'text' },
    { api: 'serviceItemId', col: 'service_item_id', kind: 'text' },
    { api: 'taskId', col: 'task_id', kind: 'text' },
    { api: 'logDate', col: 'log_date', kind: 'date' },
    { api: 'workContent', col: 'work_content', kind: 'text' },
    // decimal 不是 amount：工时不是钱，不能走元→分那套缩放
    { api: 'actualHours', col: 'actual_hours', kind: 'decimal' },
    { api: 'issueNote', col: 'issue_note', kind: 'text' },
    { api: 'nextPlan', col: 'next_plan', kind: 'text' },
    { api: 'source', col: 'source', kind: 'text' },
    { api: 'operatorUserId', col: 'operator_user_id', kind: 'text' },
    { api: 'operatorName', col: 'operator_name', kind: 'text' },
  ],
});

const taskTemplateRepo = makeRepo({
  table: 'task_templates',
  idPrefix: 'TEMPLATE',
  filters: { archived: 'archived' },
  orderBy: 'created_at DESC',
  spec: [
    { api: 'id', col: 'id', kind: 'text' },
    { api: 'name', col: 'name', kind: 'text' },
    { api: 'tasks', col: 'tasks', kind: 'json' },
    { api: 'isBuiltIn', col: 'is_built_in', kind: 'bool' },
    { api: 'createdByUserId', col: 'created_by_user_id', kind: 'text' },
    { api: 'createdByName', col: 'created_by_name', kind: 'text' },
    { api: 'archived', col: 'archived', kind: 'bool' },
    { api: 'usageCount', col: 'usage_count', kind: 'int' },
    { api: 'lastUsedAt', col: 'last_used_at', kind: 'text' },
  ],
});

module.exports = { workLogRepo, taskTemplateRepo };
