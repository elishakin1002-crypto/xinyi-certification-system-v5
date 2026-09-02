const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runNodeScript } = require('./helpers/cli');
const fs = require('node:fs');

/*
  这个文件里的三个用例都要真的起 Chromium（local-auth-smoke.mjs 用 Playwright
  验证前端是否跳登录页）。浏览器二进制没装时，必须**整体跳过**，不能只跳失败的那个：

  2026-08-21 的现象是只有「应该成功」那个用例红，另外两个「应该失败」的绿——
  但它们绿得毫无意义：浏览器起不来 → 检查失败 → 脚本退出码非 0 → 正好撞上预期。
  这种假绿比红更危险，等于这块根本没有覆盖，而报表上看着是通过的。

  装浏览器：npx playwright install chromium
*/
const chromiumReady = (() => {
  try {
    const p = require('playwright').chromium.executablePath();
    return Boolean(p) && fs.existsSync(p);
  } catch {
    return false;
  }
})();
const skip = chromiumReady
  ? false
  : 'Chromium 未安装，跳过（装它：npx playwright install chromium）';

const envelope = (data = {}) => ({
  ok: true,
  code: 0,
  message: 'success',
  data
});

const startLocalAuthServer = ({ users = 1, redirectToLogin = true } = {}) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/api/auth/health') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(envelope({ mode: 'file', ready: true, users })));
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(redirectToLogin
        ? `<!doctype html><html><head><meta charset="utf-8"></head><body><h2>员工登录</h2><input placeholder="员工邮箱或账号" /><script>history.replaceState(null, '', '/#/login');</script></body></html>`
        : `<!doctype html><html><head><meta charset="utf-8"></head><body><h2>工作台</h2></body></html>`);
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

test('local auth smoke passes when local app redirects to login and has users', { skip }, async () => {
  const { server, baseUrl } = await startLocalAuthServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/local-auth-smoke.mjs',
      env: {
        LOCAL_AUTH_FRONTEND_BASE: baseUrl,
        LOCAL_AUTH_BACKEND_BASE: baseUrl
      },
      timeoutMs: 15000
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /PASS \| auth-health-users/);
    assert.match(out.stdout, /PASS \| frontend-login-redirect/);
    assert.match(out.stdout, /SUMMARY \| total=2 pass=2 fail=0/);
  } finally {
    await closeServer(server);
  }
});

test('local auth smoke fails when local auth store has no users', { skip }, async () => {
  const { server, baseUrl } = await startLocalAuthServer({ users: 0 });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/local-auth-smoke.mjs',
      env: {
        LOCAL_AUTH_FRONTEND_BASE: baseUrl,
        LOCAL_AUTH_BACKEND_BASE: baseUrl
      },
      timeoutMs: 15000
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /FAIL \| auth-health-users/);
  } finally {
    await closeServer(server);
  }
});

test('local auth smoke fails when dashboard does not redirect to login', { skip }, async () => {
  const { server, baseUrl } = await startLocalAuthServer({ redirectToLogin: false });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/local-auth-smoke.mjs',
      env: {
        LOCAL_AUTH_FRONTEND_BASE: baseUrl,
        LOCAL_AUTH_BACKEND_BASE: baseUrl
      },
      timeoutMs: 15000
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /FAIL \| frontend-login-redirect/);
  } finally {
    await closeServer(server);
  }
});
