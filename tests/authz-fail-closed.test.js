// 授权判定**自己出错**的时候怎么办。
//
// ── 为什么这件事要单独测 ──────────────────────────────────────
// 平时测的都是「该拒的拒了、该放的放了」。但还有第三种情况：
// **判定过程本身崩了**（取资源的 SQL 报错、字段结构变了、依赖模块抛异常）。
//
// 这时候如果放行，那么「让判定崩掉」就等价于「拿到所有权限」——
// 而制造一次崩溃通常比绕过一条规则容易得多。
//
// 所以 enforce 模式下必须拒绝。但拒绝要和「真的没权限」**区分开**：
// 不区分的话，同事看到「无权限」会去找老板要权限，
// 而真正的问题是系统坏了——于是没人报修，故障一直在。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** 在指定模式下重新加载中间件（MODE 是模块加载时读的常量） */
const loadMiddleware = (mode, failOpen) => {
  const prevMode = process.env.XINYI_AUTHZ_MODE;
  const prevFo = process.env.XINYI_AUTHZ_FAILOPEN;
  process.env.XINYI_AUTHZ_MODE = mode;
  if (failOpen === undefined) delete process.env.XINYI_AUTHZ_FAILOPEN;
  else process.env.XINYI_AUTHZ_FAILOPEN = failOpen;

  const p = require.resolve('../server/authz/middleware.js');
  delete require.cache[p];
  const mod = require('../server/authz/middleware.js');

  return {
    mod,
    restore: () => {
      if (prevMode === undefined) delete process.env.XINYI_AUTHZ_MODE;
      else process.env.XINYI_AUTHZ_MODE = prevMode;
      if (prevFo === undefined) delete process.env.XINYI_AUTHZ_FAILOPEN;
      else process.env.XINYI_AUTHZ_FAILOPEN = prevFo;
      delete require.cache[p];
    },
  };
};

/** 假的 express req/res/next，够用就行 */
const fakeCtx = () => {
  const res = {
    statusCode: 0, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  let nexted = false;
  return { req: { authUser: { id: 'U-1', name: '甲', roles: ['CONSULTANT'] }, params: {} },
           res, next: () => { nexted = true; }, wasNexted: () => nexted };
};

/** 让判定必崩：取资源时抛异常 */
const explodingResource = () => { throw new Error('模拟：取目标记录时数据库炸了'); };

test('enforce 模式下判定出错必须拒绝，不能放行', async () => {
  /*
    放行的话，「让判定崩掉」就等价于「拿到所有权限」。
    而制造一次崩溃通常比绕过一条规则容易得多。
  */
  const { mod, restore } = loadMiddleware('enforce');
  try {
    const { req, res, next, wasNexted } = fakeCtx();
    await mod.requireAction('PAYMENT_CONFIRM', { resource: explodingResource })(req, res, next);
    assert.equal(wasNexted(), false, '判定崩了却放行了——等于把权限白送出去');
    assert.equal(res.statusCode, 500);
  } finally { restore(); }
});

test('出错的提示要和「真的没权限」分开', async () => {
  /*
    不分开的话，同事看到「无权限」会去找老板要权限，
    而真正的问题是系统坏了——于是没人报修，故障一直挂着。
  */
  const { mod, restore } = loadMiddleware('enforce');
  try {
    const { req, res, next } = fakeCtx();
    await mod.requireAction('PAYMENT_CONFIRM', { resource: explodingResource })(req, res, next);
    assert.equal(res.body.data.authzError, true, '没标出这是判定故障');
    assert.notEqual(res.body.code, 4030, '和「无权限」用了同一个错误码');
    assert.match(res.body.message, /不是权限不足/, '提示没说清这不是权限问题');
    assert.match(res.body.message, /系统维护人|报给/, '没告诉用户该找谁');
  } finally { restore(); }
});

test('observe 模式下判定出错仍然放行', async () => {
  /*
    观察阶段判定还不可信，一个解析 bug 把全公司挡在门外，
    代价远大于漏判。两种模式的取舍不同是刻意的。
  */
  const { mod, restore } = loadMiddleware('observe');
  try {
    const { req, res, next, wasNexted } = fakeCtx();
    await mod.requireAction('PAYMENT_CONFIRM', { resource: explodingResource })(req, res, next);
    assert.equal(wasNexted(), true, 'observe 模式下不该拦');
    assert.equal(res.headers['X-Authz-Error'], '1', '放行了但没留下痕迹');
  } finally { restore(); }
});

test('紧急开关能立刻恢复放行，不用改代码', async () => {
  /*
    留给「周一早上全员干不了活」那种时刻：
    设一个环境变量重启就恢复，不用重新部署、不用等人改代码。
    没有这条退路的话，出事时唯一的选择是回滚整个版本。
  */
  const { mod, restore } = loadMiddleware('enforce', '1');
  try {
    const { req, res, next, wasNexted } = fakeCtx();
    await mod.requireAction('PAYMENT_CONFIRM', { resource: explodingResource })(req, res, next);
    assert.equal(wasNexted(), true, '紧急开关没生效');
  } finally { restore(); }
});

test('紧急开关必须是显式的 1，不能被别的值误开', async () => {
  // 「true」「yes」这类值不认——这个开关是拿来关掉安全防线的，宁可难用一点
  for (const v of ['true', 'yes', '0', '']) {
    const { mod, restore } = loadMiddleware('enforce', v);
    try {
      const { req, res, next, wasNexted } = fakeCtx();
      await mod.requireAction('PAYMENT_CONFIRM', { resource: explodingResource })(req, res, next);
      assert.equal(wasNexted(), false, `XINYI_AUTHZ_FAILOPEN=${v} 不该打开紧急放行`);
    } finally { restore(); }
  }
});

test('判定异常要记进账本，不能只打一行 console', async () => {
  // console 会被日志轮转冲掉，而这条记录是「授权系统曾经失灵过」的唯一证据
  const src = stripComments(read('server/authz/middleware.js'));
  const catchBlock = src.slice(src.indexOf('} catch (e) {'));
  assert.match(catchBlock, /recordDenied/, '判定异常没有记进账本');
  assert.match(catchBlock, /authz\.error/, '没有把异常和普通拒绝区分标记');
});
