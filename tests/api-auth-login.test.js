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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('employee auth: login, me, and logout use http-only session cookie', async () => {
  const password = `Pass-${Date.now()}!`;
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
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
    const loginBody = await login.json();
    const setCookie = login.headers.get('set-cookie') || '';
    const session = cookieValue(setCookie, 'xinyi_session');

    assert.equal(login.status, 200);
    assert.equal(loginBody.ok, true);
    assert.equal(loginBody.data.user.email, 'admin@example.test');
    assert.ok(loginBody.data.user.roles.includes('ADMIN'));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.ok(session);

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `xinyi_session=${session}` }
    });
    const meBody = await me.json();
    assert.equal(me.status, 200);
    assert.equal(meBody.ok, true);
    assert.equal(meBody.data.user.email, 'admin@example.test');

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `xinyi_session=${session}` }
    });
    const logoutBody = await logout.json();
    assert.equal(logout.status, 200);
    assert.equal(logoutBody.ok, true);
    assert.match(logout.headers.get('set-cookie') || '', /Expires=Thu, 01 Jan 1970/i);

    const afterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `xinyi_session=${session}` }
    });
    const afterLogoutBody = await afterLogout.json();
    assert.equal(afterLogout.status, 401);
    assert.equal(afterLogoutBody.code, 1002);

  } finally {
    await stopServerProcess(child);
  }
});

test('退出后拿旧会话打业务接口，一律 401', async () => {
  /*
    老板 2026-08-28 提的场景：「我刚退出，别人在我电脑上把网址
    重新输一遍，是不是就进去了」。

    正常操作进不去（cookie 已被清成 Expires=1970），
    但真正要证明的是**服务端那串 session id 确实作废了**——
    否则谁抄走了它（共用电脑、浏览器插件、被截获的请求），
    退出多久都还能继续用，直到 7 天后自然过期。

    ── 这条必须开着鉴权跑 ────────────────────────────────────
    testEnv() 默认把 XINYI_SESSION_AUTH_REQUIRED 关掉，
    关掉时全局守卫会放行任何请求（只做「尽力解析身份」）。
    在那个配置下断言 401 测不出任何东西——
    第一版就写错在这里，测试红了才发现是断言放错了地方，不是产品有洞。

    生产的 .env.local 里这个开关是 1，所以这里显式打开，和生产一致。
  */
  const password = `Pass-${Date.now()}!`;
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: password,
    XINYI_SESSION_COOKIE_SECURE: 'false',
    XINYI_SESSION_AUTH_REQUIRED: 'true'
  });

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'admin@example.test', password })
    });
    const session = cookieValue(login.headers.get('set-cookie') || '', 'xinyi_session');
    assert.ok(session, '没拿到会话');

    const BUSINESS = ['/api/state/sync', '/api/contracts', '/api/settlements', '/api/auth/users'];

    // 先证明这些接口在**有效**会话下是通的，否则下面的 401 可能只是接口本来就不存在
    for (const ep of BUSINESS) {
      const before = await fetch(`${baseUrl}${ep}`, { headers: { Cookie: `xinyi_session=${session}` } });
      assert.notEqual(before.status, 404, `${ep} 不存在，这条用例没测到东西`);
      assert.notEqual(before.status, 401, `${ep} 在有效会话下就被挡住了，401 证明不了是退出起的作用`);
    }

    await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST', headers: { Cookie: `xinyi_session=${session}` }
    });

    for (const ep of BUSINESS) {
      const replay = await fetch(`${baseUrl}${ep}`, { headers: { Cookie: `xinyi_session=${session}` } });
      assert.equal(replay.status, 401,
        `退出后用旧会话仍然能访问 ${ep}（返回 ${replay.status}）——服务端会话没有真正销毁`);
    }
  } finally {
    await stopServerProcess(child);
  }
});

test('退出登录不能只清 cookie，服务端的会话记录必须删掉', async () => {
  /*
    这是「退出」和「假装退出」的分界线。

    只清 cookie 的话，浏览器里看起来是退出了，但那串 session id
    在服务端仍然有效——任何拿到它的人（浏览器插件、共用电脑上的
    历史记录、被截获的请求）都还能继续用，直到它自己过期（现在是 7 天）。

    所以这里直接查会话存储：退出之后那条记录必须不在了。
  */
  const password = `Pass-${Date.now()}!`;
  const storePath = path.join(os.tmpdir(), `xinyi-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: storePath,
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
    assert.ok(session, '没拿到会话');

    const readSessions = () => {
      const raw = JSON.parse(require('node:fs').readFileSync(storePath, 'utf8'));
      return Array.isArray(raw.sessions) ? raw.sessions : [];
    };
    assert.equal(readSessions().length, 1, '登录后会话存储里应该有一条记录');

    await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST', headers: { Cookie: `xinyi_session=${session}` }
    });

    assert.equal(readSessions().length, 0,
      '退出之后会话记录还在——那串 session id 仍然有效，等于没退出');
  } finally {
    await stopServerProcess(child);
  }
});

test('employee auth: invalid password is rejected', async () => {
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: 'correct-password',
    XINYI_SESSION_COOKIE_SECURE: 'false'
  });

  try {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'admin@example.test', password: 'wrong-password' })
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.code, 1003);
  } finally {
    await stopServerProcess(child);
  }
});

test('employee auth: repeated invalid passwords temporarily lock the account', async () => {
  const password = 'correct-password';
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-lock-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: password,
    XINYI_SESSION_COOKIE_SECURE: 'false',
    XINYI_AUTH_MAX_FAILED_LOGIN_ATTEMPTS: '3',
    XINYI_AUTH_LOCK_MS: '1000'
  });

  try {
    for (let idx = 0; idx < 3; idx += 1) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'admin@example.test', password: `wrong-${idx}` })
      });
      assert.equal(res.status, 403);
    }

    const locked = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'admin@example.test', password })
    });
    assert.equal(locked.status, 403);

    await delay(1150);

    const unlocked = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'admin@example.test', password })
    });
    assert.equal(unlocked.status, 200);
  } finally {
    await stopServerProcess(child);
  }
});

test('employee auth: active session slides forward and refreshes the cookie', async () => {
  const password = `Pass-${Date.now()}!`;
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-slide-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: password,
    XINYI_SESSION_COOKIE_SECURE: 'false',
    // TTL 固定成最小值，阈值调到比 TTL 还大，保证每次请求都会触发续期，测试不用真的等半个 TTL。
    XINYI_SESSION_TTL_MS: String(10 * 60 * 1000),
    XINYI_SESSION_RENEW_THRESHOLD_MS: String(24 * 60 * 60 * 1000)
  });

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'admin@example.test', password })
    });
    const loginBody = await login.json();
    const session = cookieValue(login.headers.get('set-cookie') || '', 'xinyi_session');
    assert.ok(session);

    await delay(1100);

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `xinyi_session=${session}` }
    });
    const meBody = await me.json();
    assert.equal(me.status, 200);
    assert.ok(
      Date.parse(meBody.data.expiresAt) > Date.parse(loginBody.data.expiresAt),
      'expiresAt should move forward while the session is in use'
    );
    const refreshed = me.headers.get('set-cookie') || '';
    assert.equal(cookieValue(refreshed, 'xinyi_session'), session, 'session id stays the same');
    assert.match(refreshed, /Expires=/i);
  } finally {
    await stopServerProcess(child);
  }
});

test('employee auth: sliding renewal can be disabled', async () => {
  const password = `Pass-${Date.now()}!`;
  const { child, baseUrl } = await startServerProcess({
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-fixed-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: password,
    XINYI_SESSION_COOKIE_SECURE: 'false',
    XINYI_SESSION_SLIDING: 'false',
    XINYI_SESSION_TTL_MS: String(10 * 60 * 1000),
    XINYI_SESSION_RENEW_THRESHOLD_MS: String(24 * 60 * 60 * 1000)
  });

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'admin@example.test', password })
    });
    const loginBody = await login.json();
    const session = cookieValue(login.headers.get('set-cookie') || '', 'xinyi_session');

    await delay(1100);

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `xinyi_session=${session}` }
    });
    const meBody = await me.json();
    assert.equal(me.status, 200);
    assert.equal(meBody.data.expiresAt, loginBody.data.expiresAt);
    assert.equal(me.headers.get('set-cookie'), null);
  } finally {
    await stopServerProcess(child);
  }
});

test('employee auth: health reports file mode when DATABASE_URL is not configured', async () => {
  const { child, baseUrl } = await startServerProcess({
    DATABASE_URL: '',
    AUTH_STORE_PATH: path.join(os.tmpdir(), `xinyi-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  });

  try {
    const res = await fetch(`${baseUrl}/api/auth/health`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.mode, 'file');
    assert.equal(body.data.ready, true);
  } finally {
    await stopServerProcess(child);
  }
});
