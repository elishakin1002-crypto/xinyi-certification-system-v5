const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const cookieValue = (setCookie, name) => {
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie || '');
  const part = raw.split(';')[0] || '';
  const [cookieName, value] = part.split('=');
  return cookieName === name ? value : '';
};

test('session guard: protected API requires login when enabled', async () => {
  const password = `Pass-${Date.now()}!`;
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    XINYI_SESSION_AUTH_REQUIRED: 'true',
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: password,
    XINYI_SESSION_COOKIE_SECURE: 'false'
  });

  try {
    const missing = await fetch(`${baseUrl}/api/state/health`);
    const missingBody = await missing.json();
    assert.equal(missing.status, 401);
    assert.equal(missingBody.code, 1002);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'admin@example.test', password })
    });
    const session = cookieValue(login.headers.get('set-cookie') || '', 'xinyi_session');
    assert.equal(login.status, 200);
    assert.ok(session);

    const ok = await fetch(`${baseUrl}/api/state/health`, {
      headers: { Cookie: `xinyi_session=${session}` }
    });
    const okBody = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(okBody.ok, true);
    assert.equal(okBody.code, 0);
  } finally {
    await stopServerProcess(child);
  }
});

test('session guard: when token+session are both enabled, session can access protected API', async () => {
  const password = `Pass-${Date.now()}!`;
  const token = `guard-token-${Date.now()}`;
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    XINYI_SESSION_AUTH_REQUIRED: 'true',
    XINYI_API_AUTH_REQUIRED: 'true',
    XINYI_API_AUTH_TOKEN: token,
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: password,
    XINYI_SESSION_COOKIE_SECURE: 'false'
  });

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'admin@example.test', password })
    });
    const session = cookieValue(login.headers.get('set-cookie') || '', 'xinyi_session');
    assert.equal(login.status, 200);
    assert.ok(session);

    const okBySession = await fetch(`${baseUrl}/api/state/health`, {
      headers: { Cookie: `xinyi_session=${session}` }
    });
    const okBody = await okBySession.json();
    assert.equal(okBySession.status, 200);
    assert.equal(okBody.ok, true);

    const invalidToken = await fetch(`${baseUrl}/api/state/health`, {
      headers: {
        Authorization: 'Bearer invalid-token',
        Cookie: `xinyi_session=${session}`
      }
    });
    const invalidBody = await invalidToken.json();
    assert.equal(invalidToken.status, 403);
    assert.equal(invalidBody.code, 1003);
  } finally {
    await stopServerProcess(child);
  }
});
