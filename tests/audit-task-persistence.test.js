const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, getBaseUrl } = require('./helpers/httpServer');
const { projectRepo } = require('../server/repos/projectRepo');
const { auditRepo } = require('../server/repos/batch4Repos');

test('audit lifecycle persists linked tasks atomically and preserves unrelated project work', async () => {
  const server = await startServer();
  const prefix = `AUD-UAT-${Date.now()}`;
  const p1 = `${prefix}-p1`, p2 = `${prefix}-p2`;
  const key = 'audit_issues_v1';
  const save = (rows, base) => fetch(`${getBaseUrl(server)}/api/state/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets: { [key]: rows }, baseDatasets: { [key]: base } }),
  });
  const succeeds = async (rows, base) => { const res = await save(rows, base); assert.equal(res.status, 200, await res.text()); };
  try {
    await projectRepo.create({ id: p1, name: 'isolated test project', manager: 'consultant', tasks: [{ id: 'unrelated', category: 'Core', status: 'Completed' }] });
    await projectRepo.create({ id: p2, name: 'isolated transfer target', tasks: [] });
    const issue = { id: prefix, projectId: p1, rectificationTaskId: `${prefix}-task`, findings: 'missing record', auditor: 'consultant', status: 'Open', deadline: '2026-09-20' };
    await succeeds([issue], []);
    let project = await projectRepo.getById(p1);
    assert.equal(project.tasks.length, 2);
    assert.equal(project.tasks[1].status, 'Pending');
    const refreshed = await (await fetch(`${getBaseUrl(server)}/api/projects/${p1}`)).json();
    assert.equal(refreshed.data.project.tasks.find(t => t.id === issue.rectificationTaskId).status, 'Pending');
    assert.equal(project.progress, 50);
    assert.equal((await auditRepo.getById(issue.id)).rectificationTaskId, issue.rectificationTaskId);
    // Task UPDATE runs first; an invalid audit date must roll it back too.
    const invalid = await save([{ ...issue, status: 'Closed', deadline: '2026-02-31' }], [issue]);
    assert.equal(invalid.status, 500);
    assert.equal((await projectRepo.getById(p1)).tasks[1].status, 'Pending');
    assert.equal((await auditRepo.getById(issue.id)).status, 'Open');
    const closed = { ...issue, status: 'Closed' };
    await succeeds([closed], [issue]);
    project = await projectRepo.getById(p1);
    assert.equal(project.tasks[1].status, 'Completed');
    assert.equal(project.progress, 100);
    await succeeds([closed], [issue]); // lost response/retry cannot duplicate tasks
    assert.equal((await projectRepo.getById(p1)).tasks.length, 2);
    const moved = { ...closed, projectId: p2 };
    await succeeds([moved], [closed]);
    assert.deepEqual((await projectRepo.getById(p1)).tasks.map(t => t.id), ['unrelated']);
    assert.equal((await projectRepo.getById(p2)).tasks[0].id, issue.rectificationTaskId);
    const failed = await save([{ ...moved, projectId: `${prefix}-missing` }], [moved]);
    assert.equal(failed.status, 409);
    assert.equal((await auditRepo.getById(issue.id)).projectId, p2);
    assert.equal((await projectRepo.getById(p2)).tasks.length, 1);
    await succeeds([], [moved]);
    assert.equal((await auditRepo.getById(issue.id)), null);
    assert.deepEqual((await projectRepo.getById(p2)).tasks, []);
  } finally { await stopServer(server); }
});
