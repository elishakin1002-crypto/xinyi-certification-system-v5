const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runNodeScript } = require('./helpers/cli');

const startDomainServer = ({ rootMarker = true } = {}) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(rootMarker
          ? '<!doctype html><html><body><div id="root"></div><script type="module"></script></body></html>'
          : '<!doctype html><html><body>missing root</body></html>');
        return;
      }
      res.statusCode = 404;
      res.end('not found');
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

test('domain smoke passes for a reachable frontend root in local script mode', async () => {
  const { server, baseUrl } = await startDomainServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/test-domain-smoke.mjs',
      env: {
        TEST_HOST: baseUrl,
        DOMAIN_SMOKE_ALLOW_HTTP: '1',
        DOMAIN_SMOKE_ALLOW_LOCALHOST: '1',
        DOMAIN_SMOKE_SKIP_DNS: '1'
      },
      timeoutMs: 12000
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /PASS \| test-host-present/);
    assert.match(out.stdout, /PASS \| frontend-root-loads/);
    assert.match(out.stdout, /SUMMARY \| total=5 pass=5 fail=0/);
  } finally {
    await closeServer(server);
  }
});

test('domain smoke rejects http unless explicitly allowed', async () => {
  const { server, baseUrl } = await startDomainServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/test-domain-smoke.mjs',
      env: {
        TEST_HOST: baseUrl,
        DOMAIN_SMOKE_ALLOW_LOCALHOST: '1',
        DOMAIN_SMOKE_SKIP_DNS: '1'
      },
      timeoutMs: 12000
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /FAIL \| https-required/);
  } finally {
    await closeServer(server);
  }
});

test('domain smoke fails when frontend root marker is missing', async () => {
  const { server, baseUrl } = await startDomainServer({ rootMarker: false });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/test-domain-smoke.mjs',
      env: {
        TEST_HOST: baseUrl,
        DOMAIN_SMOKE_ALLOW_HTTP: '1',
        DOMAIN_SMOKE_ALLOW_LOCALHOST: '1',
        DOMAIN_SMOKE_SKIP_DNS: '1'
      },
      timeoutMs: 12000
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /FAIL \| frontend-root-loads/);
  } finally {
    await closeServer(server);
  }
});
