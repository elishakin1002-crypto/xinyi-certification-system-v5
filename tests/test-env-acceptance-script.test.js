const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { runNodeScript } = require('./helpers/cli');

const envelope = (data = {}) => ({
  ok: true,
  code: 0,
  message: 'success',
  data
});

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk || '');
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });

const startAcceptanceServer = ({ authMode = 'postgres' } = {}) =>
  new Promise((resolve, reject) => {
    const admin = {
      id: 'U-AUTH-ADMIN',
      email: 'admin@example.test',
      username: 'admin',
      name: '系统管理员',
      roles: ['ADMIN'],
      activeRole: 'ADMIN',
      status: 'active'
    };
    const sessionValue = 'acceptance-session';
    const datasets = {};

    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body><div id="root"></div><script type="module"></script></body></html>');
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/ai/health') {
        res.end(JSON.stringify(envelope({ provider: 'mock' })));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state/health') {
        res.end(JSON.stringify(envelope({ mode: 'postgres', ready: true })));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/intel/latest') {
        res.end(JSON.stringify(envelope({ signals: [] })));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/health') {
        res.end(JSON.stringify(envelope({ mode: authMode, ready: true, users: 1 })));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const body = await readBody(req);
        if (body?.account !== admin.email || body?.password !== 'admin-pass-123') {
          res.statusCode = 403;
          res.end(JSON.stringify({ ok: false, code: 1003, message: 'Invalid account or password', data: {} }));
          return;
        }
        res.setHeader('Set-Cookie', `xinyi_session=${sessionValue}; Path=/; HttpOnly; SameSite=Lax`);
        res.end(JSON.stringify(envelope({ user: admin, expiresAt: new Date(Date.now() + 3600000).toISOString() })));
        return;
      }

      const hasSession = String(req.headers.cookie || '').includes(`xinyi_session=${sessionValue}`);
      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        if (!hasSession) {
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, code: 1002, message: 'Login required', data: {} }));
          return;
        }
        res.end(JSON.stringify(envelope({ user: admin, expiresAt: new Date(Date.now() + 3600000).toISOString() })));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/users') {
        res.end(JSON.stringify(envelope({ users: [admin] })));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/audit-logs') {
        res.end(JSON.stringify(envelope({ logs: [] })));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/state/sync') {
        const body = await readBody(req);
        Object.assign(datasets, body?.datasets || {});
        res.end(JSON.stringify(envelope({ written: Object.keys(body?.datasets || {}).length, mode: 'postgres' })));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state/sync') {
        const keys = String(url.searchParams.get('keys') || '').split(',').map((item) => item.trim()).filter(Boolean);
        const selected = keys.length > 0
          ? Object.fromEntries(keys.map((key) => [key, datasets[key]]))
          : datasets;
        res.end(JSON.stringify(envelope({ mode: 'postgres', datasets: selected, metadata: {} })));
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

const baseEnv = (baseUrl) => ({
  TEST_ENV_ACCEPTANCE_STEPS: 'deploy,state-persistence,auth-mode,auth-api',
  DEPLOY_FRONTEND_BASE: baseUrl,
  DEPLOY_BACKEND_BASE: baseUrl,
  STATE_EXPECTED_MODE: 'postgres',
  AUTH_EXPECTED_MODE: 'postgres',
  DATABASE_URL: 'postgres://dummy:dummy@localhost:5432/dummy',
  XINYI_REQUIRE_POSTGRES: 'true',
  XINYI_AUTH_REQUIRE_POSTGRES: 'true',
  XINYI_API_AUTH_TOKEN: 'token',
  AUTH_SMOKE_ACCOUNT: 'admin@example.test',
  AUTH_SMOKE_PASSWORD: 'admin-pass-123',
  XINYI_SESSION_AUTH_REQUIRED: 'true',
  XINYI_SESSION_ROLE_ENFORCEMENT: 'true',
  CORS_ALLOWED_ORIGINS: 'https://example.test',
  VITE_AI_BACKEND_URL: '/api/ai',
  VITE_INTEL_LOCAL_FALLBACKS_ENABLED: '0',
  VITE_STATE_SYNC_ENABLED: '1',
  VITE_AUTH_REQUIRED: '1',
  VITE_LEADS_API_ENABLED: '1',
  VITE_LEADS_API_READ_ENABLED: '1',
  VITE_LEADS_API_VERIFY_WRITES_ENABLED: '1',
  VITE_CUSTOMERS_API_ENABLED: '1',
  VITE_CUSTOMERS_API_READ_ENABLED: '1',
  VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED: '1',
  VITE_CONTRACTS_API_READ_ENABLED: '1',
  VITE_CONTRACTS_API_WRITE_ENABLED: '1',
  VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED: '1',
  VITE_PROJECTS_API_READ_ENABLED: '1',
  VITE_PROJECTS_API_WRITE_ENABLED: '1',
  VITE_PROJECTS_API_VERIFY_WRITES_ENABLED: '1'
});

test('test env acceptance passes selected smoke steps', async () => {
  const { server, baseUrl } = await startAcceptanceServer();
  const reportPath = path.join(os.tmpdir(), `xinyi-acceptance-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/test-env-acceptance.mjs',
      env: {
        ...baseEnv(baseUrl),
        TEST_ENV_ACCEPTANCE_REPORT: reportPath
      },
      timeoutMs: 12000
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /SUMMARY \| total=4 pass=4 fail=0/);
    assert.match(out.stdout, /PASS \| deploy/);
    assert.match(out.stdout, /PASS \| auth-api/);
    assert.match(out.stdout, /\[test-env-acceptance\] report=/);

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.summary.total, 4);
    assert.equal(report.summary.fail, 0);
    assert.equal(report.redaction.enabled, true);
    assert.equal(report.redaction.keys.includes('AUTH_SMOKE_PASSWORD'), true);
    assert.equal(report.redaction.keys.includes('XINYI_API_AUTH_TOKEN'), true);
    assert.equal(report.redaction.keys.includes('DATABASE_URL'), true);
    assert.equal(report.results.length, 4);
    assert.equal(report.results.every((item) => item.pass), true);
    const reportText = JSON.stringify(report);
    assert.equal(reportText.includes('admin-pass-123'), false);
    assert.equal(reportText.includes('postgres://dummy:dummy@localhost:5432/dummy'), false);
  } finally {
    fs.rmSync(reportPath, { force: true });
    await closeServer(server);
  }
});

test('test env acceptance fails when a selected smoke step fails', async () => {
  const { server, baseUrl } = await startAcceptanceServer({ authMode: 'file' });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/test-env-acceptance.mjs',
      env: baseEnv(baseUrl),
      timeoutMs: 12000
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /FAIL \| deploy|FAIL \| auth-mode/);
    assert.match(out.stdout, /SUMMARY \| total=4 pass=2 fail=2|SUMMARY \| total=4 pass=3 fail=1/);
  } finally {
    await closeServer(server);
  }
});

test('test env acceptance requires explicit deploy bases for postgres validation', async () => {
  const out = await runNodeScript({
    scriptPath: 'scripts/test-env-acceptance.mjs',
    env: {
      TEST_ENV_ACCEPTANCE_STEPS: 'deploy',
      DEPLOY_FRONTEND_BASE: '',
      DEPLOY_BACKEND_BASE: '',
      STATE_EXPECTED_MODE: 'postgres',
      AUTH_EXPECTED_MODE: 'postgres'
    },
    timeoutMs: 8000
  });

  assert.equal(out.timedOut, false);
  assert.notEqual(out.code, 0);
  assert.match(out.stderr, /DEPLOY_FRONTEND_BASE and DEPLOY_BACKEND_BASE are required/);
  assert.doesNotMatch(out.stdout, /START \| deploy/);
});
