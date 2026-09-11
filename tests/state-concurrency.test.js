const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeRows } = require('../server/services/stateMerge');
const key = 'project_work_logs_v1';

test('different colleagues adding rows retain both; repeated request is idempotent', () => {
  const a = { id: 'a', actualHours: 0.5 }, b = { id: 'b', actualHours: 2 };
  assert.deepEqual(mergeRows(key, [], [b], [a]), [a, b]);
  assert.deepEqual(mergeRows(key, [], [b], [a, b]), [a, b]);
});
test('unchanged stale rows cannot overwrite remote edits or resurrect remote deletions', () => {
  const old = { id: 'a', workContent: 'old' }, updated = { ...old, workContent: 'new' };
  const added = { id: 'b' };
  assert.deepEqual(mergeRows(key, [old], [old, added], [updated]), [updated, added]);
  assert.deepEqual(mergeRows(key, [old], [old, added], []), [added]);
});
test('same row edits and delete/edit conflicts reject without overwriting', () => {
  const old = { id: 'a', workContent: 'old' };
  const updated = { ...old, workContent: 'new' };
  assert.throws(() => mergeRows(key, [old], [{ ...old, workContent: 'mine' }], [updated]), { code: 'STATE_CONFLICT' });
  assert.throws(() => mergeRows(key, [old], [], [updated]), { code: 'STATE_CONFLICT' });
  assert.deepEqual(mergeRows(key, [old], [], [old, { id: 'b' }]), [{ id: 'b' }]);
});
test('invalid arrays and duplicate IDs cannot silently lose records', () => {
  for (const rows of [null, [{ id: 'a' }, { id: 'a' }], [{}]]) {
    assert.throws(() => mergeRows(key, [], rows, []), { code: 'STATE_CONFLICT' });
  }
});

const { startServer, stopServer, getBaseUrl } = require('./helpers/httpServer');
test('Postgres concurrent HTTP saves preserve both records and atomic conflict rollback', async () => {
  const server = await startServer();
  const baseUrl = getBaseUrl(server);
  const { workLogRepo } = require('../server/repos/batch5Repos');
  const { query } = require('../server/db/pool');
  const id = `CONC-${Date.now()}`;
  const save = (rows, base, extra = {}) => fetch(`${baseUrl}/api/state/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasets: { [key]: rows, ...extra }, baseDatasets: { [key]: base } })
  });
  try {
    const health = await (await fetch(`${baseUrl}/api/state/health`)).json();
    assert.equal(health.data.mode, 'postgres', 'must exercise real PostgreSQL');
    const a = { id: `${id}-a`, workContent: 'A', actualHours: 0.5 };
    const b = { id: `${id}-b`, workContent: 'B', actualHours: 1 };
    const writes = await Promise.all([save([a], []), save([b], [])]);
    for (const res of writes) assert.equal(res.status, 200, await res.text());
    assert.equal((await workLogRepo.getById(a.id)).actualHours, 0.5);
    assert.equal((await workLogRepo.getById(b.id)).workContent, 'B');
    const base = [await workLogRepo.getById(a.id)];
    assert.equal((await save([{ ...base[0], workContent: 'winner' }], base)).status, 200);
    const conflict = await save([{ ...base[0], workContent: 'loser' }], base, { [`probe_${id.toLowerCase().replace(/-/g, '_')}`]: 'must rollback' });
    assert.equal(conflict.status, 409);
    assert.equal((await workLogRepo.getById(a.id)).workContent, 'winner');
    const state = await (await fetch(`${baseUrl}/api/state/sync`)).json();
    assert.ok(state.data.datasets[key].some(row => row.id === b.id));
    assert.equal(state.data.datasets[`probe_${id.toLowerCase().replace(/-/g, '_')}`], undefined);
    const raw = await query('SELECT actual_hours::float AS hours FROM project_work_logs WHERE id=$1', [a.id]);
    assert.equal(raw.rows[0].hours, 0.5);
  } finally { await stopServer(server); }
});
test('old clients and normalized-key bypass fail closed for protected datasets', async () => {
  const server = await startServer();
  try {
    for (const name of [key, 'ProjectWorkLogsV1']) {
      const res = await fetch(`${getBaseUrl(server)}/api/state/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasets: { [name]: [] } })
      });
      assert.equal(res.status, 409);
    }
  } finally { await stopServer(server); }
});

test('snapshot clearing persists and the same browser can save again without reloading', async () => {
  const server = await startServer();
  const { workLogRepo, taskTemplateRepo } = require('../server/repos/batch5Repos');
  const { auditRepo } = require('../server/repos/batch4Repos');
  const cases = [
    [key, workLogRepo, { workContent: 'visit', actualHours: 0.5, issueNote: 'remove me', nextPlan: 'remove me' }, ['issueNote', 'nextPlan']],
    ['task_templates_v1', taskTemplateRepo, { name: 'trial template', lastUsedAt: '2026-09-10' }, ['lastUsedAt']],
    ['audit_issues_v1', auditRepo, { findings: 'trial issue', rectificationPlan: 'remove me', verification: { result: 'old' } }, ['rectificationPlan', 'verification']],
  ];
  try {
    for (const [datasetKey, repo, fields, clear] of cases) {
      const original = { id: `ROUND-${datasetKey}-${Date.now()}`, ...fields };
      const save = (row, baseline) => fetch(`${getBaseUrl(server)}/api/state/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasets: { [datasetKey]: [row] }, baseDatasets: { [datasetKey]: baseline } }),
      });
      let response = await save(original, []);
      assert.equal(response.status, 200, await response.text());
      const cleared = { ...original };
      for (const field of clear) delete cleared[field];
      response = await save(cleared, [original]);
      assert.equal(response.status, 200, await response.text());
      const stored = await repo.getById(original.id);
      for (const field of clear) assert.equal(stored[field], undefined, `${datasetKey}.${field} must stay cleared after refresh`);
      response = await save({ ...cleared, trialNote: 'third save' }, [cleared]);
      assert.equal(response.status, 200, await response.text());
      assert.equal((await repo.getById(original.id)).trialNote, 'third save');
    }
  } finally { await stopServer(server); }
});
