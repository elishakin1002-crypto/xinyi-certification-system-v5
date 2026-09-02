const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { hashPassword } = require('../server/authStore');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const cookieValue = (setCookie, name) => {
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie || '');
  const part = raw.split(';')[0] || '';
  const [cookieName, value] = part.split('=');
  return cookieName === name ? value : '';
};

const buildAuthStore = async () => {
  const authPath = path.join(os.tmpdir(), `xinyi-auth-roles-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const now = new Date().toISOString();
  const users = [
    {
      id: 'U-MANAGER-1',
      email: 'manager@example.test',
      username: 'manager',
      name: '交付负责人',
      passwordHash: hashPassword('manager-pass'),
      roles: ['MANAGER'],
      activeRole: 'MANAGER',
      status: 'active',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'U-FINANCE-1',
      email: 'finance@example.test',
      username: 'finance',
      name: '财务',
      passwordHash: hashPassword('finance-pass'),
      roles: ['FINANCE'],
      activeRole: 'FINANCE',
      status: 'active',
      createdAt: now,
      updatedAt: now
    }
  ];
  await fs.writeFile(authPath, JSON.stringify({ updatedAt: now, users, sessions: [] }, null, 2));
  return authPath;
};

const loginWithSession = async (baseUrl, account, password) => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password })
  });
  const body = await login.json();
  const session = cookieValue(login.headers.get('set-cookie') || '', 'xinyi_session');
  return { status: login.status, body, session };
};

test('session role guard: finance cannot trigger intel fetch', async () => {
  const authPath = await buildAuthStore();
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: authPath,
    XINYI_SESSION_AUTH_REQUIRED: 'true',
    XINYI_SESSION_COOKIE_SECURE: 'false',
    KIMI_API_KEY: '',
    GEMINI_API_KEY: ''
  });

  try {
    const login = await loginWithSession(baseUrl, 'finance@example.test', 'finance-pass');
    assert.equal(login.status, 200);
    assert.ok(login.session);

    const res = await fetch(`${baseUrl}/api/intel/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${login.session}`
      },
      body: JSON.stringify({ regions: ['温州'], industries: ['印刷'], limit: 1 })
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.code, 1003);
  } finally {
    await stopServerProcess(child);
  }
});

test('session role guard: manager can call intel fetch endpoint', async () => {
  const authPath = await buildAuthStore();
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: authPath,
    XINYI_SESSION_AUTH_REQUIRED: 'true',
    XINYI_SESSION_COOKIE_SECURE: 'false',
    KIMI_API_KEY: '',
    GEMINI_API_KEY: ''
  });

  try {
    const login = await loginWithSession(baseUrl, 'manager@example.test', 'manager-pass');
    assert.equal(login.status, 200);
    assert.ok(login.session);

    const res = await fetch(`${baseUrl}/api/intel/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `xinyi_session=${login.session}`
      },
      body: JSON.stringify({ regions: ['温州'], industries: ['印刷'], limit: 1 })
    });
    const body = await res.json();
    assert.notEqual(res.status, 403);
    assert.notEqual(body.code, 1003);
  } finally {
    await stopServerProcess(child);
  }
});

test('session role guard: api token bypasses session role checks for automation', async () => {
  const authPath = await buildAuthStore();
  const token = `guard-token-${Date.now()}`;
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: authPath,
    XINYI_SESSION_AUTH_REQUIRED: 'true',
    XINYI_API_AUTH_REQUIRED: 'true',
    XINYI_API_AUTH_TOKEN: token,
    KIMI_API_KEY: '',
    GEMINI_API_KEY: ''
  });

  try {
    const res = await fetch(`${baseUrl}/api/intel/fetch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ regions: ['温州'], industries: ['印刷'], limit: 1 })
    });
    const body = await res.json();
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
    assert.notEqual(body.code, 1002);
    assert.notEqual(body.code, 1003);
  } finally {
    await stopServerProcess(child);
  }
});
