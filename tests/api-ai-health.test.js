const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, getBaseUrl } = require('./helpers/httpServer');

test('GET /api/ai/health always returns standard envelope shape', async () => {
  const server = await startServer();
  try {
    const res = await fetch(`${getBaseUrl(server)}/api/ai/health`);
    const body = await res.json();

    assert.ok([200, 500].includes(res.status));
    assert.equal(typeof body.ok, 'boolean');
    assert.equal(typeof body.code, 'number');
    assert.equal(typeof body.message, 'string');
    assert.equal(typeof body.data, 'object');
  } finally {
    await stopServer(server);
  }
});
