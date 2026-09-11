const { isDeepStrictEqual } = require('node:util');

const protectedKeys = new Set(['audit_issues_v1', 'project_work_logs_v1', 'task_templates_v1']);
const defaults = {
  project_work_logs_v1: { actualHours: 0 },
  task_templates_v1: { tasks: [], isBuiltIn: false, archived: false, usageCount: 0 },
  audit_issues_v1: { status: 'Open', evidences: [] },
};
const comparable = (key, row) => {
  if (!row) return row;
  const { createdAt, updatedAt, ...value } = row;
  return JSON.parse(JSON.stringify({ ...defaults[key], ...value }));
};
const equal = (key, a, b) => isDeepStrictEqual(comparable(key, a), comparable(key, b));
const conflict = (key) => Object.assign(new Error('记录已被其他同事修改，本次未保存。请先导出未保存内容，再重新加载核对。'), { code: 'STATE_CONFLICT', datasetKey: key });
const indexed = (rows, key) => {
  if (!Array.isArray(rows)) throw conflict(key);
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || map.has(row.id)) throw conflict(key);
    map.set(row.id, row);
  }
  return map;
};

// Apply only changes made since this browser's read. Unseen remote rows survive.
// Conflicting edits/deletes are rejected atomically, including equal-length arrays.
const mergeRows = (key, base, incoming, current) => {
  const before = indexed(base, key);
  const after = indexed(incoming, key);
  const remote = indexed(current, key);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id), next = after.get(id), actual = remote.get(id);
    if (equal(key, old, next)) continue;
    if (!equal(key, actual, old) && !equal(key, actual, next)) throw conflict(key);
    if (next) remote.set(id, next);
    else remote.delete(id);
  }
  return [...remote.values()];
};

module.exports = { protectedKeys, mergeRows, conflict };
