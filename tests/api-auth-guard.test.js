const test = require('node:test');
const assert = require('node:assert/strict');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

test('auth guard: protected API requires token when enabled', async () => {
  const token = `guard-token-${Date.now()}`;
  const { child, baseUrl } = await startServerProcess({
    XINYI_API_AUTH_TOKEN: token,
    XINYI_API_AUTH_REQUIRED: 'true'
  });

  try {
    const missing = await fetch(`${baseUrl}/api/state/health`);
    const missingBody = await missing.json();
    assert.equal(missing.status, 401);
    assert.equal(missingBody.code, 1002);

    const invalid = await fetch(`${baseUrl}/api/state/health`, {
      headers: { Authorization: 'Bearer invalid-token' }
    });
    const invalidBody = await invalid.json();
    assert.equal(invalid.status, 403);
    assert.equal(invalidBody.code, 1003);

    const ok = await fetch(`${baseUrl}/api/state/health`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const okBody = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(okBody.ok, true);
    assert.equal(okBody.code, 0);
  } finally {
    await stopServerProcess(child);
  }
});

test('cors guard: blocked origin is rejected when whitelist is configured', async () => {
  const token = `guard-token-${Date.now()}-cors`;
  const { child, baseUrl } = await startServerProcess({
    XINYI_API_AUTH_TOKEN: token,
    XINYI_API_AUTH_REQUIRED: 'true',
    CORS_ALLOWED_ORIGINS: 'http://allowed.example'
  });

  try {
    const blocked = await fetch(`${baseUrl}/api/ai/health`, {
      headers: {
        Origin: 'http://blocked.example',
        Authorization: `Bearer ${token}`
      }
    });
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 403);
    assert.equal(blockedBody.code, 1003);
    assert.equal(blockedBody.message, 'Origin not allowed');

    const allowed = await fetch(`${baseUrl}/api/ai/health`, {
      headers: {
        Origin: 'http://allowed.example',
        Authorization: `Bearer ${token}`
      }
    });
    const allowedBody = await allowed.json();
    assert.ok([200, 500].includes(allowed.status));
    assert.equal(typeof allowedBody.code, 'number');
    assert.equal(typeof allowedBody.ok, 'boolean');
  } finally {
    await stopServerProcess(child);
  }
});
