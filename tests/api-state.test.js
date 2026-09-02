const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, getBaseUrl } = require('./helpers/httpServer');

test('GET /api/state/health returns envelope with mode', async () => {
  const server = await startServer();
  try {
    const res = await fetch(`${getBaseUrl(server)}/api/state/health`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.code, 0);
    assert.ok(body.data);
    assert.equal(typeof body.data.mode, 'string');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/state/sync validates datasets payload', async () => {
  const server = await startServer();
  try {
    const res = await fetch(`${getBaseUrl(server)}/api/state/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'test-only' })
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, 1001);
  } finally {
    await stopServer(server);
  }
});

test('POST+GET /api/state/sync can round-trip one dataset key', async () => {
  const server = await startServer();
  try {
    const datasetKey = `test_probe_${Date.now()}`;
    const payload = { ts: new Date().toISOString(), source: 'node-test' };

    const writeRes = await fetch(`${getBaseUrl(server)}/api/state/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasets: { [datasetKey]: payload }, source: 'node-test' })
    });
    const writeBody = await writeRes.json();

    assert.equal(writeRes.status, 200);
    assert.equal(writeBody.ok, true);
    assert.equal(writeBody.code, 0);

    const readRes = await fetch(`${getBaseUrl(server)}/api/state/sync?keys=${encodeURIComponent(datasetKey)}`);
    const readBody = await readRes.json();

    assert.equal(readRes.status, 200);
    assert.equal(readBody.ok, true);
    assert.equal(readBody.code, 0);
    assert.deepEqual(readBody.data.datasets[datasetKey], payload);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/state/sync normalizes dataset keys and returns metadata source', async () => {
  const server = await startServer();
  try {
    const payload = { flag: true };
    const writeRes = await fetch(`${getBaseUrl(server)}/api/state/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasets: {
          CamelCaseKey: payload,
          'Lead-Data.V1': { n: 1 },
          'bad key !': { n: 2 }
        },
        source: 'contract-test'
      })
    });
    const writeBody = await writeRes.json();

    assert.equal(writeRes.status, 200);
    assert.equal(writeBody.ok, true);
    assert.equal(writeBody.code, 0);
    assert.equal(writeBody.data.written, 2);

    const readRes = await fetch(
      `${getBaseUrl(server)}/api/state/sync?keys=${encodeURIComponent('CamelCaseKey,Lead-Data.V1,bad key !')}`
    );
    const readBody = await readRes.json();

    assert.equal(readRes.status, 200);
    assert.equal(readBody.ok, true);
    assert.equal(readBody.code, 0);

    assert.deepEqual(readBody.data.datasets.camel_case_key, payload);
    assert.deepEqual(readBody.data.datasets.lead_data_v1, { n: 1 });
    assert.equal(Object.prototype.hasOwnProperty.call(readBody.data.datasets, 'bad key !'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(readBody.data.datasets, 'bad_key_'), false);

    assert.equal(readBody.data.metadata.camel_case_key.source, 'contract-test');
    assert.equal(readBody.data.metadata.lead_data_v1.source, 'contract-test');
  } finally {
    await stopServer(server);
  }
});
