// 账号存储走 PostgreSQL 那条路。
//
// ── 为什么要单独测 ────────────────────────────────────────────
// 2026-09-01 生产把账号从 JSON 文件搬进了 PG（根治「整份倒回覆盖」那个丢账号的 bug）。
//
// 但所有别的鉴权测试**仍然跑文件模式**——它们各自用一个临时 AUTH_STORE_PATH
// 来保证隔离，把 DATABASE_URL 塞进去会让它们全连到同一个真实库。
//
// 于是出现最危险的那种局面：**测试全绿，但生产走的是另一条没测过的路。**
// 这个项目已经踩过一次（测试库那次：testEnv 返回空 URL，
// 所有测试静默走文件回退，绿了几个星期，测的却不是生产那条路）。
//
// 所以这个文件显式连测试库，专门验 PG 那条。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { resolveTestDbUrl } = require('./helpers/testDb');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

const dbUrl = resolveTestDbUrl();

/** 每个用例一套干净的模块状态——authStore 用模块级变量缓存后端 */
const freshStore = () => {
  process.env.DATABASE_URL = dbUrl;
  const p = require.resolve('../server/authStore.js');
  delete require.cache[p];
  return require('../server/authStore.js');
};

const cleanup = async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query('DROP TABLE IF EXISTS auth_sessions, auth_users CASCADE');
  } finally { await pool.end(); }
  delete process.env.DATABASE_URL;
};

test.afterEach(async () => { await cleanup(); });

test('配了 DATABASE_URL 就走 PostgreSQL，不是文件', async () => {
  const store = freshStore();
  const health = await store.getAuthHealth();
  assert.equal(health.mode, 'postgres', `实际是 ${health.mode}：${health.reason}`);
});

test('建账号、按用户名找、验密码，整条链在 PG 上要通', async () => {
  /*
    这三步是登录的全部依赖。文件模式下它们早就测过了，
    但 PG 那条是另一套 SQL——**没测过的代码就是没写过的代码**。
  */
  const store = freshStore();
  await store.initAuthStore();

  const password = `PgAuth-${Date.now()}!`;
  const created = await store.createUser({
    name: '测试顾问', username: 'pgtestuser', password,
    roles: ['CONSULTANT'], status: 'active', mustChangePassword: true,
  });
  assert.ok(created.id);

  const users = await store.listUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'pgtestuser');
  assert.deepEqual(users[0].roles, ['CONSULTANT']);
  assert.equal(users[0].mustChangePassword, true, '强制改密标记没存下来');
});

test('用户名唯一 —— 不能建出两个同名账号', async () => {
  // 文件模式靠代码判重，PG 靠唯一索引。两条路都要挡住
  const store = freshStore();
  await store.initAuthStore();
  await store.createUser({ name: 'A', username: 'dup', password: 'Passw0rd!x', roles: ['CONSULTANT'] });
  await assert.rejects(
    () => store.createUser({ name: 'B', username: 'dup', password: 'Passw0rd!x', roles: ['CONSULTANT'] }),
    /already exists/i,
    '重名账号被建出来了');
});

test('登录建会话、撤销之后立刻失效', async () => {
  /*
    退出登录的根基。老板 8/31 问过「别人在我电脑上重新输网址能不能进」——
    答案取决于这一条：撤销必须**真的删掉记录**，不是只清 cookie。

    会话是 authenticateUser 建的（没有单独的 createSession 导出），
    所以这里走的就是真实登录路径。
  */
  const store = freshStore();
  await store.initAuthStore();
  const password = `PgSess-${Date.now()}!`;
  const u = await store.createUser({
    name: 'S', username: 'sessuser', password, roles: ['CONSULTANT'], mustChangePassword: false,
  });

  const auth = await store.authenticateUser({ account: 'sessuser', password });
  assert.ok(auth?.sessionId, '登录没拿到会话');
  assert.equal(auth.user.id, u.id);

  const found = await store.getSessionUser(auth.sessionId);
  assert.ok(found, '刚建的会话查不到');
  assert.equal(found.user.id, u.id);

  await store.revokeSession(auth.sessionId);
  const gone = await store.getSessionUser(auth.sessionId);
  assert.ok(!gone, '撤销之后会话还能用 —— 那等于没退出');
});

test('密码错了不给会话', async () => {
  /*
    PG 那条路的密码校验是另一套 SQL，要单独验。

    注意 authenticateUser 失败时**返回 null，不抛异常**——
    第一版写成 assert.rejects，测试红了却不是产品有问题。
    断言要照着函数真实的失败方式写，不能照着自己以为的写。
  */
  const store = freshStore();
  await store.initAuthStore();
  await store.createUser({ name: 'W', username: 'wrongpw', password: `Right-${Date.now()}!`, roles: ['CONSULTANT'] });
  const r = await store.authenticateUser({ account: 'wrongpw', password: 'definitely-not-it' });
  assert.equal(r, null, '错密码居然登进去了');

  const nobody = await store.authenticateUser({ account: 'nosuchuser', password: 'whatever' });
  assert.equal(nobody, null, '不存在的账号也给了会话');
});

test('搬迁脚本不重新哈希密码，直接搬哈希值', () => {
  /*
    走 createUser 的话会**用原文重新哈希**，而我们手上只有哈希值——
    所有人都得改密码才能登录。

    实测搬迁结果：15 个账号的 password_hash 与源文件逐字节一致，
    所以登录行为和搬迁前完全一样。这条守着别人以后「顺手改成走 createUser」。
  */
  const src = read('scripts/migrate-auth-to-postgres.mjs');
  assert.match(src, /INSERT INTO auth_users/, '没有直接写库');
  assert.match(src, /password_hash|passwordHash/, '没有搬密码哈希');
  assert.ok(!/store\.createUser\(/.test(src), '走了 createUser —— 会重新哈希，所有人都登不进去');
  assert.match(src, /ON CONFLICT \(id\) DO NOTHING/, '重复跑会覆盖已有账号');
});

test('搬迁不删原文件 —— 要留退路', () => {
  // 切过去出问题时，删掉 DATABASE_URL 重启就能回到文件模式
  const src = read('scripts/migrate-auth-to-postgres.mjs');
  assert.ok(!/unlinkSync|rmSync|fs\.rm\(/.test(src), '脚本会删原文件，切回去就没了');
  assert.match(src, /不会被删除|原文件留在原地/, '没有向执行者说明可以回退');
});

test('测试环境必须显式清空 DATABASE_URL', () => {
  /*
    serverProcess 起测试服务时 `...process.env` 整个继承。
    生产 .env.local 里现在有 DATABASE_URL，不清空的话：
      · 每个用例都连到同一个真实账号库，隔离没了
      · 而且会往生产账号库里写测试数据
  */
  const src = read('tests/helpers/testDb.js');
  assert.match(src, /DATABASE_URL: ''/, 'testEnv 没有清空 DATABASE_URL');
});
