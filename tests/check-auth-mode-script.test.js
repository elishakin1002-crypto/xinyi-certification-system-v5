const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runNodeScript } = require('./helpers/cli');

const startJsonServer = (payload, status = 200) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        server.close(() => reject(new Error('failed to resolve server address')));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

test('check-auth-mode exits 0 when mode matches expected', async () => {
  const { server, url } = await startJsonServer({
    ok: true,
    code: 0,
    message: 'success',
    data: { mode: 'postgres' }
  });

  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/check-auth-mode.mjs',
      env: {
        AUTH_HEALTH_URL: `${url}/api/auth/health`,
        AUTH_EXPECTED_MODE: 'postgres'
      }
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /mode=postgres/i);
  } finally {
    await closeServer(server);
  }
});

test('check-auth-mode can require initialized auth users', async () => {
  const { server, url } = await startJsonServer({
    ok: true,
    code: 0,
    message: 'success',
    data: { mode: 'postgres', users: 0 }
  });

  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/check-auth-mode.mjs',
      env: {
        AUTH_HEALTH_URL: `${url}/api/auth/health`,
        AUTH_EXPECTED_MODE: 'postgres',
        AUTH_EXPECTED_MIN_USERS: '1'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(`${out.stderr}\n${out.stdout}`, /expected users>=1, actual users=0/i);
  } finally {
    await closeServer(server);
  }
});

test('check-auth-mode exits non-zero when mode mismatches expected', async () => {
  const { server, url } = await startJsonServer({
    ok: true,
    code: 0,
    message: 'success',
    data: { mode: 'file' }
  });

  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/check-auth-mode.mjs',
      env: {
        AUTH_HEALTH_URL: `${url}/api/auth/health`,
        AUTH_EXPECTED_MODE: 'postgres'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(`${out.stderr}\n${out.stdout}`, /expected mode=postgres, actual mode=file/i);
  } finally {
    await closeServer(server);
  }
});
