// 运维总览的每一块都必须真的取到数 —— 取不到不许显示成 0。
//
// 2026-09-17 交叉复核时读系统管理员工作台，看到的是：
//     0 个「7 天内被拦的越权请求」
//     当前登录：没有活跃会话
//     待改密码 —  ·  共 — 个账号
//     数据库迁移：已执行 — 个 · 最新 —
// 而当时真实情况是 340 次被拦请求、18 个活跃会话。
//
// 真因是三条 SQL 是坏的：
//   · accounts 那条**漏了 FROM auth_users**
//   · deniedRecent 用了 created_at，而 business_events 的时间列叫 occurred_at
//   · 迁移用了 MAX(id)，而 schema_migrations 的主键叫 version
// 路由里的 safe() 按设计把失败变成 null（它的注释写着"前端显示暂不可用"），
// 但前端的 num() 是 `Number(v || 0)` —— 于是 null 渲染成了 0。
//
// **在安全面板上，「0 次越权」和「我不知道有没有越权」是两件相反的事。**
// 前者让人放心走开，后者要人去查。显示成前者是最坏的一种错。
// 和 2026-09-15「没有正在生效的登录」同一条规矩：别把看不到说成没有。
//
// 这条测试盯的是**每一块都不是 null**。列名再被改一次，它当场红。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');
const { resolveTestDbUrl } = require('./helpers/testDb');

test('运维总览的每一块都要取到数，不许有块悄悄变成 null', async () => {
  /*
    **必须显式走 PG 那条路**（DATABASE_URL 指向测试库）。

    别的鉴权测试跑文件存储、各自一个临时 AUTH_STORE_PATH，
    那条路下库里根本没有 auth_users 表 —— 这个接口的「安全」块
    正是查那张表的，于是永远红，红的还不是真问题。
    而生产走的是 PG。测了文件那条等于没测。
    （同样的教训见 tests/auth-postgres-store.test.js 顶上那段。）

    另外：第一版写成「登录失败就 return」，结果本机没有那个账号，
    测试**永远跳过却报 ok** —— 假绿，这个项目已经栽过两次。
  */
  const adminPassword = `Admin-${Date.now()}!`;
  const { child, baseUrl } = await startServerProcess({
    DATABASE_URL: resolveTestDbUrl(),
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'ops@example.test',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: adminPassword,
    XINYI_SESSION_COOKIE_SECURE: 'false'
  });

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'ops@example.test', password: adminPassword })
    });
    assert.equal(login.res?.status ?? login.status, 200, '种的管理员登不进去，后面的断言就没意义了');
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];

    const res = await fetch(`${baseUrl}/api/admin/sysadmin-overview`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    const data = body?.data || {};

    /*
      逐块断言「不是 null」。
      null 在这个接口里有明确含义：**这一块取数失败了**（见路由里的 safe()）。
      所以任何一块是 null 都说明有 SQL 挂了，而挂了不会报错、
      只会在界面上变成 0 或者「没有」。
    */
    for (const block of ['errors', 'ai', 'security', 'data']) {
      assert.notEqual(data[block], null,
        `运维总览的「${block}」块取数失败了 —— 服务端日志里搜 [sysadminOverview] 能看到原因。`
        + '它会在界面上显示成 0 或「没有」，而不是「取不到」。');
    }
    assert.notEqual(data?.version?.migrations, null,
      '迁移信息取不到 —— 界面会显示「已执行 — 个」');

    // 安全块里每个子项都要在：少一个就会有一个数字悄悄变成 0
    for (const key of ['sessions', 'accounts', 'deniedRecent']) {
      assert.ok(data.security?.[key] !== undefined && data.security?.[key] !== null,
        `安全块缺少「${key}」—— 对应的数字会渲染成 0，而真相是"不知道"`);
    }
    for (const key of ['total', 'pending_password', 'disabled', 'expired']) {
      assert.equal(typeof data.security.accounts[key], 'number',
        `accounts.${key} 不是数字 —— 那条 SQL 多半又挂了（曾经漏过 FROM）`);
    }
    assert.equal(typeof data.security.deniedRecent.n, 'number',
      'deniedRecent.n 不是数字 —— 那条 SQL 曾经用错了时间列名');
  } finally {
    await stopServerProcess(child);
  }
});
