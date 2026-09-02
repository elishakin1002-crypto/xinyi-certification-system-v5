const backendBase = String(process.env.AUTH_API_BASE || process.env.DEPLOY_BACKEND_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const account = String(process.env.AUTH_SMOKE_ACCOUNT || process.env.XINYI_AUTH_SMOKE_ACCOUNT || process.env.XINYI_AUTH_SEED_ADMIN_EMAIL || '').trim();
const password = String(process.env.AUTH_SMOKE_PASSWORD || process.env.XINYI_AUTH_SMOKE_PASSWORD || process.env.XINYI_AUTH_SEED_ADMIN_PASSWORD || '').trim();

const checks = [];

const record = (name, pass, details = {}) => {
  checks.push({ name, pass: Boolean(pass), ...details });
};

const readJson = async (res) => {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
};

const cookieValue = (setCookie, name) => {
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie || '');
  const part = raw.split(';')[0] || '';
  const [cookieName, value] = part.split('=');
  return cookieName === name ? value : '';
};

const requestJson = async (path, options = {}) => {
  const started = Date.now();
  const res = await fetch(`${backendBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const { text, json } = await readJson(res);
  const elapsedMs = Date.now() - started;
  if (!json || typeof json !== 'object') {
    throw new Error(`invalid json from ${path}: HTTP ${res.status} ${String(text || '').slice(0, 120)}`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`request failed ${path}: HTTP ${res.status} ${json.message || String(text || '').slice(0, 120)}`);
  }
  return { res, json, elapsedMs };
};

const printSummary = () => {
  checks.forEach((check) => {
    const flag = check.pass ? 'PASS' : 'FAIL';
    const meta = Object.entries(check)
      .filter(([key]) => !['name', 'pass'].includes(key))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' | ');
    console.log(`${flag} | ${check.name}${meta ? ` | ${meta}` : ''}`);
  });

  const fail = checks.filter((check) => !check.pass).length;
  console.log(`SUMMARY | total=${checks.length} pass=${checks.length - fail} fail=${fail} generatedAt=${new Date().toISOString()}`);
  if (fail > 0) process.exit(1);
};

const run = async () => {
  if (!account || !password) {
    throw new Error('AUTH_SMOKE_ACCOUNT and AUTH_SMOKE_PASSWORD are required');
  }

  const health = await requestJson('/api/auth/health');
  record('auth-health', Boolean(health.json?.data?.mode), {
    status: health.res.status,
    elapsedMs: health.elapsedMs,
    mode: health.json?.data?.mode || ''
  });

  const login = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password })
  });
  const user = login.json?.data?.user;
  const session = cookieValue(login.res.headers.get('set-cookie') || '', 'xinyi_session');
  record('auth-login', Boolean(user?.id && session), {
    status: login.res.status,
    elapsedMs: login.elapsedMs,
    userId: user?.id || ''
  });
  if (!session) throw new Error('login did not return xinyi_session cookie');

  const cookieHeader = { Cookie: `xinyi_session=${session}` };
  const me = await requestJson('/api/auth/me', { headers: cookieHeader });
  record('auth-me', me.json?.data?.user?.id === user?.id, {
    status: me.res.status,
    elapsedMs: me.elapsedMs,
    userId: me.json?.data?.user?.id || ''
  });

  const users = await requestJson('/api/auth/users', { headers: cookieHeader });
  const userList = users.json?.data?.users;
  record('auth-users-list', Array.isArray(userList) && userList.some((item) => item.id === user?.id), {
    status: users.res.status,
    elapsedMs: users.elapsedMs,
    total: Array.isArray(userList) ? userList.length : -1
  });

  const auditLogs = await requestJson('/api/auth/audit-logs', { headers: cookieHeader });
  const logs = auditLogs.json?.data?.logs;
  record('auth-audit-logs', Array.isArray(logs), {
    status: auditLogs.res.status,
    elapsedMs: auditLogs.elapsedMs,
    total: Array.isArray(logs) ? logs.length : -1
  });

  printSummary();
};

run().catch((error) => {
  console.error(`[auth-api-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
