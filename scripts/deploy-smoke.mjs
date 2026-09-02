const frontendBase = String(process.env.DEPLOY_FRONTEND_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const backendBase = String(process.env.DEPLOY_BACKEND_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const expectedStateMode = String(process.env.STATE_EXPECTED_MODE || '').trim().toLowerCase();
const expectedAuthMode = String(process.env.AUTH_EXPECTED_MODE || '').trim().toLowerCase();
const expectedMinAuthUsersRaw = String(process.env.AUTH_EXPECTED_MIN_USERS || '').trim();
const expectedMinAuthUsers = expectedMinAuthUsersRaw ? Number(expectedMinAuthUsersRaw) : 0;
const apiToken = String(process.env.XINYI_API_AUTH_TOKEN || process.env.API_AUTH_TOKEN || '').trim();

const headers = apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined;

const ensureEnvelope = (obj) => {
  if (!obj || typeof obj !== 'object') return { pass: false, reason: 'not-json-object' };
  for (const key of ['ok', 'code', 'message', 'data']) {
    if (!(key in obj)) return { pass: false, reason: `missing-${key}` };
  }
  return { pass: true, reason: '' };
};

const readJson = async (res) => {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
};

const checkFrontend = async () => {
  const started = Date.now();
  try {
    const res = await fetch(`${frontendBase}/`, { method: 'GET' });
    const text = await res.text();
    const pass = res.ok && /<div id="root">|<script type="module"/i.test(text);
    return {
      name: 'frontend-root',
      pass,
      status: res.status,
      elapsedMs: Date.now() - started,
      reason: pass ? '' : 'frontend-root-marker-missing'
    };
  } catch (error) {
    return {
      name: 'frontend-root',
      pass: false,
      status: 0,
      elapsedMs: Date.now() - started,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
};

const checkEnvelope = async (name, base, path, extraCheck = null) => {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, { method: 'GET', headers });
    const { text, json } = await readJson(res);
    const env = ensureEnvelope(json);
    let pass = res.ok && env.pass;
    let reason = env.pass ? '' : env.reason;

    if (pass && typeof extraCheck === 'function') {
      const extra = extraCheck(json);
      pass = Boolean(extra.pass);
      reason = extra.reason || '';
    }

    return {
      name,
      pass,
      status: res.status,
      elapsedMs: Date.now() - started,
      reason,
      code: json?.code,
      ok: json?.ok,
      message: json?.message,
      sample: pass ? '' : String(text || '').slice(0, 120)
    };
  } catch (error) {
    return {
      name,
      pass: false,
      status: 0,
      elapsedMs: Date.now() - started,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
};

const stateModeCheck = (body) => {
  if (!expectedStateMode) return { pass: true, reason: '' };
  const actual = String(body?.data?.mode || '').trim().toLowerCase();
  return actual === expectedStateMode
    ? { pass: true, reason: '' }
    : { pass: false, reason: `expected-state-mode=${expectedStateMode}, actual=${actual || 'missing'}` };
};

const authModeCheck = (body) => {
  if (expectedMinAuthUsersRaw && (!Number.isFinite(expectedMinAuthUsers) || expectedMinAuthUsers < 0)) {
    return { pass: false, reason: `invalid-auth-min-users=${expectedMinAuthUsersRaw}` };
  }
  if (!expectedAuthMode && !expectedMinAuthUsersRaw) return { pass: true, reason: '' };
  const actual = String(body?.data?.mode || '').trim().toLowerCase();
  if (expectedAuthMode && actual !== expectedAuthMode) {
    return { pass: false, reason: `expected-auth-mode=${expectedAuthMode}, actual=${actual || 'missing'}` };
  }
  if (expectedMinAuthUsersRaw) {
    const users = Number(body?.data?.users);
    if (!Number.isFinite(users) || users < expectedMinAuthUsers) {
      return { pass: false, reason: `expected-auth-users>=${expectedMinAuthUsers}, actual=${Number.isFinite(users) ? users : 'missing'}` };
    }
  }
  return { pass: true, reason: '' };
};

const run = async () => {
  const checks = [
    await checkFrontend(),
    await checkEnvelope('backend-ai-health', backendBase, '/api/ai/health'),
    await checkEnvelope('backend-state-health', backendBase, '/api/state/health', stateModeCheck),
    await checkEnvelope('backend-auth-health', backendBase, '/api/auth/health', authModeCheck),
    await checkEnvelope('backend-intel-latest', backendBase, '/api/intel/latest'),
    await checkEnvelope('frontend-api-proxy', frontendBase, '/api/ai/health')
  ];

  checks.forEach((check) => {
    const flag = check.pass ? 'PASS' : 'FAIL';
    const core = `${flag} | ${check.name} | HTTP ${check.status} | ${check.elapsedMs}ms`;
    const code = check.code !== undefined ? ` | ok=${String(check.ok)} code=${String(check.code)}` : '';
    const reason = check.reason ? ` | reason=${check.reason}` : '';
    console.log(core + code + reason);
  });

  const fail = checks.filter((check) => !check.pass).length;
  console.log(`SUMMARY | total=${checks.length} pass=${checks.length - fail} fail=${fail} generatedAt=${new Date().toISOString()}`);
  if (fail > 0) process.exit(1);
};

run();
