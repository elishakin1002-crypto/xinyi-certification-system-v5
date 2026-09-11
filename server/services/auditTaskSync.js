const { isDeepStrictEqual } = require('node:util');
const { conflict } = require('./stateMerge');

// Called inside the guarded state transaction. Only changed issues affect tasks;
// lock and patch the current project, never replace it with a browser snapshot.
const syncAuditTasks = async (client, before, after) => {
  const oldById = new Map(before.map(row => [row.id, row]));
  const newById = new Map(after.map(row => [row.id, row]));
  const changes = [...new Set([...oldById.keys(), ...newById.keys()])]
    .map(id => [oldById.get(id), newById.get(id)])
    .filter(([old, next]) => !isDeepStrictEqual(old, next));
  const projectIds = [...new Set(changes.flatMap(pair => pair.map(row => row?.projectId).filter(Boolean)))].sort();
  const projects = new Map();
  for (const id of projectIds) {
    const result = await client.query('SELECT id, manager, tasks FROM projects WHERE id=$1 FOR UPDATE', [id]);
    if (result.rows[0]) projects.set(id, result.rows[0]);
  }
  const dirty = new Set();
  for (const [old, next] of changes) {
    if (next?.projectId && next.rectificationTaskId && !projects.has(next.projectId)) throw conflict('audit_issues_v1');
    if (old?.projectId && old.rectificationTaskId &&
        (!next || next.projectId !== old.projectId || next.rectificationTaskId !== old.rectificationTaskId)) {
      const project = projects.get(old.projectId);
      if (project) {
        project.tasks = (project.tasks || []).filter(task => task.id !== old.rectificationTaskId);
        dirty.add(project.id);
      }
    }
    if (!next?.projectId || !next.rectificationTaskId) continue;
    const project = projects.get(next.projectId);
    const tasks = project.tasks || [];
    const index = tasks.findIndex(task => task.id === next.rectificationTaskId);
    // A new link must not take over an unrelated existing task.
    if (index >= 0 && (old?.rectificationTaskId !== next.rectificationTaskId || old?.projectId !== next.projectId)) throw conflict('audit_issues_v1');
    const summary = String(next.findings || '不符合项').replace(/\s+/g, ' ').trim().slice(0, 24) || '不符合项';
    const payload = {
      id: next.rectificationTaskId,
      title: `整改闭环｜${next.customerName || '客户'}｜${summary}`,
      deadline: String(next.deadline || '').trim() || new Date().toISOString().slice(0, 10),
      status: next.status === 'Closed' ? 'Completed' : 'Pending',
      priority: next.severity === 'Major' ? 'High' : 'Medium',
      category: 'Core',
      owner: String(next.auditor || project.manager || '待指派').trim() || '待指派',
    };
    if (index < 0) tasks.push(payload);
    else tasks[index] = { ...tasks[index], ...payload };
    project.tasks = tasks;
    dirty.add(project.id);
  }
  for (const id of dirty) {
    const tasks = projects.get(id).tasks;
    const core = tasks.filter(task => task.category === 'Core' && task.status !== 'Skipped');
    const progress = core.length ? Math.round(core.filter(task => task.status === 'Completed').length / core.length * 100) : 0;
    await client.query('UPDATE projects SET tasks=$2::jsonb, progress=$3, updated_at=NOW() WHERE id=$1', [id, JSON.stringify(tasks), progress]);
  }
};
module.exports = { syncAuditTasks };
