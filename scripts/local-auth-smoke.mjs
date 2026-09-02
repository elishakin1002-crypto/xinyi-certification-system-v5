import { chromium } from '@playwright/test';

const frontendBase = String(process.env.LOCAL_AUTH_FRONTEND_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const backendBase = String(process.env.LOCAL_AUTH_BACKEND_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
const expectedMinUsers = Number(process.env.LOCAL_AUTH_EXPECTED_MIN_USERS || 1);

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

const checkAuthHealth = async () => {
  const started = Date.now();
  try {
    const res = await fetch(`${backendBase}/api/auth/health`);
    const { text, json } = await readJson(res);
    const users = Number(json?.data?.users);
    const pass = res.ok
      && json?.ok === true
      && Number.isFinite(users)
      && users >= expectedMinUsers;
    record('auth-health-users', pass, {
      status: res.status,
      elapsedMs: Date.now() - started,
      mode: json?.data?.mode || '',
      users: Number.isFinite(users) ? users : 'missing',
      reason: pass ? '' : `expected-users>=${expectedMinUsers}; sample=${String(text || '').slice(0, 120)}`
    });
  } catch (error) {
    record('auth-health-users', false, {
      status: 0,
      elapsedMs: Date.now() - started,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
};

const checkLoginRedirect = async () => {
  const started = Date.now();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${frontendBase}/#/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const url = page.url();
    const loginTitleCount = await page.getByText('员工登录').count();
    const accountInputCount = await page.getByPlaceholder('员工邮箱或账号').count();
    const pass = url.includes('#/login') && loginTitleCount > 0 && accountInputCount > 0;
    record('frontend-login-redirect', pass, {
      status: 200,
      elapsedMs: Date.now() - started,
      url,
      loginTitle: loginTitleCount,
      accountInput: accountInputCount,
      reason: pass ? '' : 'dashboard did not redirect to login screen'
    });
  } catch (error) {
    record('frontend-login-redirect', false, {
      status: 0,
      elapsedMs: Date.now() - started,
      reason: error instanceof Error ? error.message : String(error)
    });
  } finally {
    if (browser) await browser.close();
  }
};

const printSummary = () => {
  checks.forEach((check) => {
    const flag = check.pass ? 'PASS' : 'FAIL';
    const meta = Object.entries(check)
      .filter(([key, value]) => !['name', 'pass'].includes(key) && value !== '')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' | ');
    console.log(`${flag} | ${check.name}${meta ? ` | ${meta}` : ''}`);
  });
  const fail = checks.filter((check) => !check.pass).length;
  console.log(`SUMMARY | total=${checks.length} pass=${checks.length - fail} fail=${fail} generatedAt=${new Date().toISOString()}`);
  if (fail > 0) process.exit(1);
};

const run = async () => {
  if (!Number.isFinite(expectedMinUsers) || expectedMinUsers < 0) {
    console.error('[local-auth] ERROR: LOCAL_AUTH_EXPECTED_MIN_USERS must be a non-negative number');
    process.exit(1);
  }
  await checkAuthHealth();
  await checkLoginRedirect();
  printSummary();
};

run().catch((error) => {
  console.error(`[local-auth] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
