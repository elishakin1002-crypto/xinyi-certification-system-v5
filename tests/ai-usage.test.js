// AI 用量计量与配额（待办 P0-10）。
//
// ── 防的是什么 ──────────────────────────────────────────────────
// **不是**限制正常使用。10 个人的公司，正常用量碰不到任何上限。
// 防的是「程序跑飞」：页面写出循环、重试没退避、有人狂点按钮——
// 这类事故的特征是量级异常，等发现时账单已经出来了。
//
// 所以上限定得很宽（顾问一天 200 次）。定得太紧的配额会被要求关掉，
// 关掉之后它一点用都没有。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { testEnv, truncateTestDb } = require('./helpers/testDb');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// 必须在 require 连接池之前设好，pool 在模块加载时就读 XINYI_DB_URL
Object.assign(process.env, testEnv());

const pool = require('../server/db/pool');
const aiUsage = require('../server/services/aiUsage');

const reqOf = (user) => ({ authUser: user });

test.beforeEach(async () => { await truncateTestDb(); });

test('取真实 token 数，取不到就记 NULL，绝不用估算冒充', async () => {
  /*
    provider 返回体里有 usage 就用真实值。
    **不能用字符数估算**——中英文混排能差出几倍，
    而这个数字是拿来做预算判断的。假的精确比明说不知道更危险。
  */
  const withUsage = aiUsage.usageFrom({ usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 } });
  assert.deepEqual(withUsage, { prompt: 120, completion: 45, total: 165 });

  for (const raw of [null, undefined, {}, { usage: null }, { usage: '不是对象' }]) {
    assert.deepEqual(aiUsage.usageFrom(raw), { prompt: null, completion: null, total: null },
      '取不到 usage 时应该是 null，不能凑一个数出来');
  }
});

test('多角色取最宽的额度，老板不设限', async () => {
  assert.equal(aiUsage.limitFor(['ADMIN']), Infinity, '老板花的是他自己的钱，系统不替他做主');
  assert.equal(aiUsage.limitFor(['CONSULTANT']), 200);
  assert.equal(aiUsage.limitFor(['FINANCE']), 100);
  // 一人多角色时按最宽的算，否则加一个角色反而变得更受限，说不通
  assert.equal(aiUsage.limitFor(['FINANCE', 'CONSULTANT']), 200);
  assert.equal(aiUsage.limitFor([]), 200, '没有角色时给个默认额度，不能是 0');
});

test('没撞上限就放行，并报出用了多少', async () => {
  const user = { id: 'U-1', name: '甲', roles: ['CONSULTANT'] };
  for (let i = 0; i < 3; i++) {
    await aiUsage.record({ req: reqOf(user), endpoint: '/api/ai/generate', ok: true, raw: {} });
  }
  const q = await aiUsage.checkQuota(reqOf(user));
  assert.equal(q.allowed, true);
  assert.equal(q.used, 3);
  assert.equal(q.limit, 200);
});

test('撞上限要拦住，并说清什么时候恢复', async () => {
  // 说不清什么时候恢复的限制，用户只会觉得系统坏了
  const user = { id: 'U-2', name: '乙', roles: ['FINANCE'] };  // 上限 100
  const rows = [];
  for (let i = 0; i < 100; i++) {
    rows.push(aiUsage.record({ req: reqOf(user), endpoint: '/api/ai/chat', ok: true, raw: {} }));
  }
  await Promise.all(rows);

  const q = await aiUsage.checkQuota(reqOf(user));
  assert.equal(q.allowed, false);
  assert.equal(q.used, 100);
  assert.match(q.message, /上限/);
  assert.match(q.message, /明天/, '没说什么时候恢复');
  assert.match(q.message, /100/, '没说清用了多少');
});

test('失败的调用不计入配额', async () => {
  /*
    上游超时、余额不足这类失败，用户什么也没得到。
    如果照样扣额度，一次上游抖动就能把人的当天额度打光——
    那是在用别人的故障惩罚用户。
  */
  const user = { id: 'U-3', name: '丙', roles: ['FINANCE'] };
  for (let i = 0; i < 100; i++) {
    await aiUsage.record({ req: reqOf(user), endpoint: '/api/ai/chat', ok: false, errorCode: 'TIMEOUT' });
  }
  const q = await aiUsage.checkQuota(reqOf(user));
  assert.equal(q.allowed, true, '失败的调用被算进配额了');
  assert.equal(q.used, 0);
});

test('失败照样要记账——连续失败本身就是要看见的信号', async () => {
  // key 过期、余额不足、上游抖动，都是从「失败突然变多」看出来的
  const user = { id: 'U-4', name: '丁', roles: ['CONSULTANT'] };
  await aiUsage.record({ req: reqOf(user), endpoint: '/api/ai/chat', ok: false, errorCode: 'NO_KEY' });
  const { rows } = await pool.query('select ok, error_code from ai_usage_log');
  assert.equal(rows.length, 1, '失败的调用没有留下记录');
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].error_code, 'NO_KEY');
});

test('每个人的额度互不影响', async () => {
  const a = { id: 'U-A', name: '甲', roles: ['FINANCE'] };
  const b = { id: 'U-B', name: '乙', roles: ['FINANCE'] };
  for (let i = 0; i < 100; i++) await aiUsage.record({ req: reqOf(a), ok: true });
  assert.equal((await aiUsage.checkQuota(reqOf(a))).allowed, false);
  assert.equal((await aiUsage.checkQuota(reqOf(b))).allowed, true, '一个人用满了把别人也挡住了');
});

test('没有会话的内部调用算作系统调用，单独一份额度', async () => {
  // 定时任务、情报抓取没有登录用户，不能因此不受限，也不能挤占某个人的额度
  const q = await aiUsage.checkQuota({});
  assert.equal(q.actor.kind, 'system');
  assert.equal(q.limit, 500);
});

test('记账失败不能让 AI 功能挂掉', async () => {
  /*
    计量是保护措施，不是业务功能。
    让一个辅助设施的故障去阻断主功能，是用小问题制造大问题。
  */
  const src = read('server/services/aiUsage.js');
  const fn = src.slice(src.indexOf('const record = async'), src.indexOf('const summary'));
  assert.match(fn, /catch\s*\(e\)/, 'record 没有兜住异常');
  assert.ok(!/throw/.test(fn), 'record 会抛异常——一次记账失败就能让 AI 用不了');
});

test('数据库查不了的时候放行，不是一律拦住', async () => {
  // 配额查询本身出故障时拦住所有人，等于把一个次要故障放大成全面停摆
  const src = read('server/services/aiUsage.js');
  const fn = src.slice(src.indexOf('const checkQuota'), src.indexOf('const record'));
  assert.match(fn, /allowed:\s*true[\s\S]{0,80}degraded/, '配额查询失败时没有放行');
});

test('汇总里要显示有多少调用拿不到 token 数', async () => {
  /*
    不显示的话，「总 token」看起来精确，实际上漏了一部分而没人知道——
    然后有人拿这个数去估月度成本。
  */
  const user = { id: 'U-5', name: '戊', roles: ['CONSULTANT'] };
  await aiUsage.record({ req: reqOf(user), ok: true, raw: { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } });
  await aiUsage.record({ req: reqOf(user), ok: true, raw: {} });   // 没有 usage

  const s = await aiUsage.summary({ days: 1 });
  assert.equal(s.totals.calls, 2);
  assert.equal(s.totals.tokens, 15);
  assert.equal(s.totals.unmetered, 1, '没把「拿不到 token 数」的调用数报出来');
});

test('AI 端点走的是带计量的那条路，不是直接调 requestAI', () => {
  /*
    直接调 requestAI 会绕过记账，账单上就成了一笔查不到出处的钱。
    这条测的是**接线**，不是逻辑——模块写好没接线等于没做，
    知识检索模块就这么断了三个月。
  */
  const src = stripComments(read('server/app.js'));
  for (const ep of ['/api/ai/generate', '/api/ai/chat', '/api/ai/selftest']) {
    const at = src.indexOf(`'${ep}'`);
    assert.ok(at > 0, `找不到端点 ${ep}`);
    const body = src.slice(at, at + 2600);
    assert.match(body, /meteredAI\(req,/, `${ep} 没走带计量的调用`);
  }
});

test('配额超限返回 429，不能混进 500', () => {
  /*
    配额提示是中文写的，里面没有 quota 也没有 429，
    靠关键词匹配会落到 500——前端把它当成服务器故障，
    用户看到「系统出错了」而不是「你今天用得太多了」。
  */
  const src = stripComments(read('server/app.js'));
  const fn = src.slice(src.indexOf('const toHttpStatus'), src.indexOf('const toInternalErrorCode'));
  assert.match(fn, /QUOTA_EXCEEDED[\s\S]{0,60}429/, '自家配额错误没有映射到 429');
});

test('用量汇总只对老板和系统管理员开放', () => {
  // 这里能看到每个人调了多少次，很接近「监控员工」的数据；权限开出去很难收回
  const src = stripComments(read('server/app.js'));
  const at = src.indexOf("'/api/ai/usage'");
  assert.ok(at > 0, '找不到用量汇总端点');
  const line = src.slice(at, at + 200);
  assert.match(line, /requireSessionRoles\(\['ADMIN',\s*'SYS_ADMIN'\]/, '用量端点的角色限制不对');
});
