const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runNodeScript } = require('./helpers/cli');

const envelope = (data = {}) => ({
  ok: true,
  code: 0,
  message: 'success',
  data
});

const startMockServer = ({ authUsers = 0 } = {}) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body><div id="root"></div><script type="module"></script></body></html>');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/state/health') {
        res.end(JSON.stringify(envelope({ mode: 'postgres' })));
        return;
      }
      if (req.url === '/api/ai/health') {
        res.end(JSON.stringify(envelope({ provider: 'mock' })));
        return;
      }
      if (req.url === '/api/auth/health') {
        res.end(JSON.stringify(envelope({ mode: 'postgres', users: authUsers })));
        return;
      }
      if (req.url === '/api/intel/latest') {
        res.end(JSON.stringify(envelope({ signals: [] })));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, code: 2001, message: 'not found', data: {} }));
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        server.close(() => reject(new Error('failed to resolve server address')));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

test('deploy smoke passes when frontend/backend checks are healthy', async () => {
  const { server, baseUrl } = await startMockServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/deploy-smoke.mjs',
      env: {
        DEPLOY_FRONTEND_BASE: baseUrl,
        DEPLOY_BACKEND_BASE: baseUrl,
        STATE_EXPECTED_MODE: 'postgres',
        AUTH_EXPECTED_MODE: 'postgres'
      }
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /SUMMARY \| total=6 pass=6 fail=0/);
  } finally {
    await closeServer(server);
  }
});

test('deploy smoke can require initialized auth users', async () => {
  const { server, baseUrl } = await startMockServer({ authUsers: 0 });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/deploy-smoke.mjs',
      env: {
        DEPLOY_FRONTEND_BASE: baseUrl,
        DEPLOY_BACKEND_BASE: baseUrl,
        AUTH_EXPECTED_MODE: 'postgres',
        AUTH_EXPECTED_MIN_USERS: '1'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /expected-auth-users>=1, actual=0/i);
  } finally {
    await closeServer(server);
  }
});

test('deploy smoke fails when expected state mode does not match', async () => {
  const { server, baseUrl } = await startMockServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/deploy-smoke.mjs',
      env: {
        DEPLOY_FRONTEND_BASE: baseUrl,
        DEPLOY_BACKEND_BASE: baseUrl,
        STATE_EXPECTED_MODE: 'file',
        AUTH_EXPECTED_MODE: 'postgres'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /expected-state-mode=file, actual=postgres/);
  } finally {
    await closeServer(server);
  }
});
