const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('context/AppContext.tsx', 'utf8');
const start = source.indexOf('  const syncAuditRectificationTask =');
const end = source.indexOf('\n  const addAuditIssue', start);
const compiled = ts.transpileModule(source.slice(start, end) + '\nglobalThis.sync = syncAuditRectificationTask;', {
  compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText;

test('rectification returns a stable link before React runs or replays its updater', () => {
  let updater;
  const project = { id: 'p1', manager: 'consultant', tasks: [] };
  const context = vm.createContext({
    resolveAuditLinkedProject: () => project,
    normalizedCurrentUser: { name: 'consultant' },
    buildAuditRectificationTaskTitle: () => 'rectification',
    calculateProjectProgress: () => 0,
    setProjects: fn => { updater = fn; },
  });
  vm.runInContext(compiled, context);
  const link = context.sync({ id: 'a1', status: 'Open' });
  assert.ok(link.rectificationTaskId, 'must return the task ID even with a deferred updater');
  const first = updater([project]);
  const replay = updater([project]);
  assert.equal(first[0].tasks[0].id, link.rectificationTaskId);
  assert.equal(replay[0].tasks[0].id, link.rectificationTaskId);
  const secondLink = context.sync({ id: 'a1', status: 'Closed', ...link });
  const updated = updater(first);
  assert.equal(secondLink.rectificationTaskId, link.rectificationTaskId);
  assert.equal(updated[0].tasks.length, 1);
  assert.equal(updated[0].tasks[0].status, 'Completed');
});
