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

const startAuthServer = ({ listForbidden = false } = {}) =>
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
    const sessionValue = 'smoke-session';
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/api/auth/health') {
        res.end(JSON.stringify(envelope({ mode: 'postgres', ready: true, users: 1 })));
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
      if (!hasSession) {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, code: 1002, message: 'Login required', data: {} }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        res.end(JSON.stringify(envelope({ user: admin, expiresAt: new Date(Date.now() + 3600000).toISOString() })));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/users') {
        if (listForbidden) {
          res.statusCode = 403;
          res.end(JSON.stringify({ ok: false, code: 1003, message: 'No permission', data: {} }));
          return;
        }
        res.end(JSON.stringify(envelope({ users: [admin] })));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/audit-logs') {
        res.end(JSON.stringify(envelope({ logs: [] })));
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

test('auth api smoke passes when login session can read management endpoints', async () => {
  const { server, baseUrl } = await startAuthServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/auth-api-smoke.mjs',
      env: {
        AUTH_API_BASE: baseUrl,
        AUTH_SMOKE_ACCOUNT: 'admin@example.test',
        AUTH_SMOKE_PASSWORD: 'admin-pass-123'
      }
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /SUMMARY \| total=5 pass=5 fail=0/);
    assert.match(out.stdout, /PASS \| auth-users-list/);
    assert.match(out.stdout, /PASS \| auth-audit-logs/);
  } finally {
    await closeServer(server);
  }
});

test('auth api smoke fails when management endpoints are forbidden', async () => {
  const { server, baseUrl } = await startAuthServer({ listForbidden: true });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/auth-api-smoke.mjs',
      env: {
        AUTH_API_BASE: baseUrl,
        AUTH_SMOKE_ACCOUNT: 'admin@example.test',
        AUTH_SMOKE_PASSWORD: 'admin-pass-123'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(`${out.stderr}\n${out.stdout}`, /request failed \/api\/auth\/users: HTTP 403/i);
  } finally {
    await closeServer(server);
  }
});

test('auth api smoke fails fast when credentials are missing', async () => {
  const out = await runNodeScript({
    scriptPath: 'scripts/auth-api-smoke.mjs',
    env: {
      AUTH_API_BASE: 'http://127.0.0.1:1',
      AUTH_SMOKE_ACCOUNT: '',
      AUTH_SMOKE_PASSWORD: ''
    }
  });

  assert.equal(out.timedOut, false);
  assert.notEqual(out.code, 0);
  assert.match(`${out.stderr}\n${out.stdout}`, /AUTH_SMOKE_ACCOUNT and AUTH_SMOKE_PASSWORD are required/);
});
