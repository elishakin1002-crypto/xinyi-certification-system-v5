// 单项权限委派与账号有效期（待办 P0-3 / P0-4）。
//
// ── 为什么需要 ────────────────────────────────────────────────
// 角色是**打包**的：给顾问加「销售」角色，他就连全公司合同金额一起看到了。
// 而实际需求经常是「她能跟线索，但看不到金额」——那要在角色之外单独加/减动作。
//
// 有效期是给兼职和临时合作方的：到期自动登不进来，
// **不用指望有人记得回来手工停用**。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { resolveTestDbUrl } = require('./helpers/testDb');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const dbUrl = resolveTestDbUrl();

const freshStore = () => {
  process.env.DATABASE_URL = dbUrl;
  const p = require.resolve('../server/authStore.js');
  delete require.cache[p];
  return require('../server/authStore.js');
};

const cleanup = async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: dbUrl });
  try { await pool.query('DROP TABLE IF EXISTS auth_sessions, auth_users CASCADE'); }
  finally { await pool.end(); }
  delete process.env.DATABASE_URL;
};

const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

test.afterEach(async () => { await cleanup(); });

test('额外授予和显式收回都能存下来、读回来', async () => {
  const store = freshStore();
  await store.initAuthStore();
  const u = await store.createUser({
    name: '甲', username: 'deleg1', password: 'Passw0rd!x', roles: ['CONSULTANT'],
    extraActions: ['LEAD_CREATE'], deniedActions: ['CONTRACT_CREATE'],
  });
  assert.deepEqual(u.extraActions, ['LEAD_CREATE']);
  assert.deepEqual(u.deniedActions, ['CONTRACT_CREATE']);

  const listed = (await store.listUsers()).find((x) => x.username === 'deleg1');
  assert.deepEqual(listed.extraActions, ['LEAD_CREATE'], 'listUsers 读不回来 —— publicUser 是白名单式的，容易漏');
});

test('动作码统一转大写 —— 大小写不一致会让权限「配了但不生效」', async () => {
  const store = freshStore();
  await store.initAuthStore();
  const u = await store.createUser({
    name: '乙', username: 'deleg2', password: 'Passw0rd!x', roles: ['CONSULTANT'],
    extraActions: ['lead_create', ' Contract_Create '],
  });
  assert.deepEqual(u.extraActions, ['LEAD_CREATE', 'CONTRACT_CREATE']);
});

test('只改姓名不能把权限委派清空', async () => {
  /*
    **这是最难查的那类 bug。**
    normalizeUserInput 对没传的字段一律给空数组，
    所以 updateUser 里必须把旧值合并进去——漏了的话，
    管理员改个姓名就顺手把之前配的权限抹掉了，不报错、事后也想不到是这里。
  */
  const store = freshStore();
  await store.initAuthStore();
  const u = await store.createUser({
    name: '丙', username: 'deleg3', password: 'Passw0rd!x', roles: ['CONSULTANT'],
    extraActions: ['LEAD_CREATE'], deniedActions: ['CONTRACT_CREATE'], accountExpiresAt: dayOffset(30),
  });
  const after = await store.updateUser(u.id, { name: '丙丙' });
  assert.equal(after.name, '丙丙');
  assert.deepEqual(after.extraActions, ['LEAD_CREATE'], '改姓名把额外授权清空了');
  assert.deepEqual(after.deniedActions, ['CONTRACT_CREATE'], '改姓名把收回记录清空了');
  assert.equal(after.accountExpiresAt, dayOffset(30), '改姓名把有效期清空了');
});

test('过期账号登不进来', async () => {
  /*
    **一个不生效的到期日比没有更糟**：管理员填了日期以为管住了，
    实际那个人到期后照样能登，而且没人会去复查。
  */
  const store = freshStore();
  await store.initAuthStore();
  const password = `Exp-${Date.now()}!`;
  await store.createUser({
    name: '过期的', username: 'expired1', password, roles: ['CONSULTANT'],
    accountExpiresAt: dayOffset(-1), mustChangePassword: false,
  });
  const r = await store.authenticateUser({ account: 'expired1', password });
  assert.equal(r, null, '过期账号登进去了');
});

test('到期日当天仍然有效', async () => {
  // 「有效期到 9 月 1 日」在人的理解里是「9 月 1 日还能用」，第二天才失效
  const store = freshStore();
  await store.initAuthStore();
  const password = `Today-${Date.now()}!`;
  await store.createUser({
    name: '今天到期', username: 'expiretoday', password, roles: ['CONSULTANT'],
    accountExpiresAt: dayOffset(0), mustChangePassword: false,
  });
  const r = await store.authenticateUser({ account: 'expiretoday', password });
  assert.ok(r?.sessionId, '到期日当天就被挡住了，和人的理解不一致');
});

test('留空 = 永久有效', async () => {
  const store = freshStore();
  await store.initAuthStore();
  const password = `Forever-${Date.now()}!`;
  await store.createUser({
    name: '永久', username: 'forever1', password, roles: ['CONSULTANT'],
    accountExpiresAt: '', mustChangePassword: false,
  });
  assert.ok((await store.authenticateUser({ account: 'forever1', password }))?.sessionId);
});

test('会话还没到期，但账号过期了 —— 也要挡住', async () => {
  /*
    **只在登录时判有效期是不够的。**
    兼职在到期前登进来，会话滑动续期会让他一直待着，到期日形同虚设。
    所以会话校验时要再判一次。
  */
  const store = freshStore();
  await store.initAuthStore();
  const password = `Sess-${Date.now()}!`;
  const u = await store.createUser({
    name: '待过期', username: 'willexpire', password, roles: ['CONSULTANT'],
    accountExpiresAt: dayOffset(1), mustChangePassword: false,
  });
  const auth = await store.authenticateUser({ account: 'willexpire', password });
  assert.ok(auth?.sessionId, '到期前应该能登');
  assert.ok(await store.getSessionUser(auth.sessionId), '刚登完会话应该有效');

  // 把有效期改成昨天，会话本身没动
  await store.updateUser(u.id, { accountExpiresAt: dayOffset(-1) });
  assert.equal(await store.getSessionUser(auth.sessionId), null,
    '账号过期了但旧会话还能用 —— 到期日形同虚设');
});

test('服务端授权把 extraActions / deniedActions 算进去了', () => {
  // 存下来但判权限时不看，等于白配
  const src = read('server/authz/authorize.js');
  assert.match(src, /extraActions/, '服务端授权没有考虑额外授予');
  assert.match(src, /deniedActions/, '服务端授权没有考虑显式收回');
});

test('改权限委派要走「改角色」那道闸，不能按普通资料修改对待', () => {
  /*
    单项委派看起来比换角色「轻」，实际可能更重：
    给一个 PAYMENT_CONFIRM 就等于把确认到账的权力给出去了。
    按「轻」对待的话，一个只有 EMPLOYEE_UPDATE 权限的人就能提权别人。
  */
  const src = read('server/app.js');
  const fn = src.slice(src.indexOf('const resolveEmployeeUpdatePermissionActions'),
    src.indexOf('const resolveEmployeeUpdatePermissionActions') + 1600);
  assert.match(fn, /roleFields[\s\S]{0,300}extraActions/, 'extraActions 没被算作角色变更');
  assert.match(fn, /roleFields[\s\S]{0,300}deniedActions/, 'deniedActions 没被算作角色变更');
});

test('员工页真的把这些字段接上了', () => {
  const src = read('pages/Employees.tsx');
  assert.match(src, /accountExpiresAt/, '页面没有有效期输入');
  assert.match(src, /extraActions/, '页面没有单项权限');
  assert.match(src, /ACTION_META/, '没有用动作中文名 —— 让人在一堆英文码里勾选等于没有开关');
  assert.match(src, /收走/, '只能加不能减，那「她能跟线索但看不到金额」还是做不到');
});
