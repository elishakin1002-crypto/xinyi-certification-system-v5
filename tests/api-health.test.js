const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, getBaseUrl } = require('./helpers/httpServer');

test('GET / returns standard success envelope', async () => {
  const server = await startServer();
  try {
    const url = `${getBaseUrl(server)}/`;
    const res = await fetch(url);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.code, 0);
    assert.equal(body.message, '信义后端服务运行正常');
    assert.equal(body.data.service, 'xinyi-backend');
  } finally {
    await stopServer(server);
  }
});
