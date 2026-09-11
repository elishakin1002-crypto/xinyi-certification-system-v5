const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const load = (fetch) => {
  const source = fs.readFileSync(require.resolve('../services/stateSyncService.ts'), 'utf8').replaceAll('import.meta.env', '({})');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  let timer;
  const context = { exports: {}, fetch, console, setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; } };
  vm.runInNewContext(js, context);
  return { service: context.exports.stateSyncService, tick: async () => { const fn = timer; timer = null; fn?.(); await new Promise(resolve => setImmediate(resolve)); } };
};
const success = () => ({ ok: true, json: async () => ({ code: 0 }) });
const key = 'project_work_logs_v1';

test('unchanged protected datasets are omitted; changed datasets carry original read', async () => {
  const sent = [];
  const { service, tick } = load(async (_, init) => { sent.push(JSON.parse(init.body)); return success(); });
  service.rememberBaseline(key, [{ id: 'a', actualHours: 1 }]);
  service.scheduleSync({ datasets: { [key]: [{ id: 'a', actualHours: 1 }] } });
  await tick(); assert.equal(sent.length, 0);
  service.scheduleSync({ datasets: { [key]: [{ id: 'a', actualHours: 0.5 }] } });
  await tick(); assert.equal(sent.length, 1);
  assert.equal(sent[0].baseDatasets[key][0].actualHours, 1);
  service.scheduleSync({ datasets: { [key]: [{ id: 'a', actualHours: 2 }] } });
  await tick(); assert.equal(sent[1].baseDatasets[key][0].actualHours, 0.5);
});
test('overlapping saves serialize and use the acknowledged baseline', async () => {
  const sent = []; let release;
  const { service, tick } = load(async (_, init) => {
    sent.push(JSON.parse(init.body));
    if (sent.length === 1) await new Promise(resolve => { release = resolve; });
    return success();
  });
  service.rememberBaseline(key, []);
  service.scheduleSync({ datasets: { [key]: [{ id: 'a', actualHours: 1 }] } }); await tick();
  service.scheduleSync({ datasets: { [key]: [{ id: 'a', actualHours: 2 }] } }); await tick();
  assert.equal(sent.length, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].baseDatasets[key][0].actualHours, 1);
});
test('conflicts are visible, preserve pending data, and do not blindly retry', async () => {
  let calls = 0;
  const { service, tick } = load(async () => { calls++; return { ok: false, json: async () => ({ code: 5001, message: 'conflict' }) }; });
  service.rememberBaseline(key, []);
  service.scheduleSync({ datasets: { [key]: [{ id: 'a' }] } }); await tick();
  assert.equal(service.getSyncError(), 'conflict');
  service.scheduleSync({ datasets: { [key]: [{ id: 'a' }, { id: 'b' }] } }); await tick();
  assert.equal(calls, 1);
  assert.equal(service.exportPending().datasets[key].length, 2);
  service.retry(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});
