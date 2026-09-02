// 守住一条容易漏、而且漏了很难查的规则。
//
// ── 规则 ──────────────────────────────────────────────────────
// 服务端有两种鉴权守卫，长得像但机制完全不同：
//
//   requireAuthSession / requireAuthActionSession
//     自己去加载会话，放在哪个路径下都能用
//
//   requireSessionRoles
//     **只检查 req.authUser，不负责加载它**
//     而填 req.authUser 的是 isProtectedApiPath 控制的全局中间件
//
// 所以用 requireSessionRoles 的路由，前缀必须在 isProtectedApiPath 名单里。
//
// ── 漏了会怎样 ────────────────────────────────────────────────
// 2026-09-02 发现 /api/review/monthly 就是这样：路由明明写了
// 允许 ADMIN / SYS_ADMIN / MANAGER，实际**对所有人、所有时候都返回 401**。
//
// 最难查的地方在于报错内容具有误导性 —— 它说「Login required」，
// 于是所有人都往登录、会话、Cookie 上找，而真正的原因是一个路径前缀没登记。
// 而且这个接口是战略页的默认标签，一打开就是错误。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '../server/app.js'), 'utf8');

const protectedPrefixes = () => {
  const start = src.indexOf('const isProtectedApiPath');
  assert.ok(start >= 0, '找不到 isProtectedApiPath —— 函数名变了，这个测试要跟着改');
  const block = src.slice(start, src.indexOf('const readCookie'));
  const list = [...block.matchAll(/startsWith\('\/api\/([a-z0-9-]+)'/g)].map((m) => m[1]);
  // /api/ai 那条带了 !== '/api/ai/health' 的例外，正则同样能取到前缀
  assert.ok(list.length > 5, '解析出的前缀太少，多半是正则和代码结构对不上了');
  return new Set(list);
};

test('用 requireSessionRoles 的路由，前缀必须在 isProtectedApiPath 里', () => {
  const guarded = protectedPrefixes();
  const offenders = [];

  src.split('\n').forEach((line, i) => {
    if (!line.includes('requireSessionRoles')) return;
    const m = line.match(/app\.(?:get|post|put|patch|delete)\(\s*'\/api\/([a-z0-9-]+)/);
    if (!m) return;                       // 不是路由注册行（可能是定义处）
    if (guarded.has(m[1])) return;
    offenders.push(`server/app.js:${i + 1}  /api/${m[1]}  ${line.trim().slice(0, 90)}`);
  });

  assert.deepEqual(offenders, [],
    '这些路由会对所有人永远返回 401 —— requireSessionRoles 不加载会话，\n' +
    '需要把前缀加进 server/app.js 的 isProtectedApiPath：\n' + offenders.join('\n'));
});

test('/api/review 在名单里 —— 月度经营复盘是战略页默认标签', () => {
  assert.ok(protectedPrefixes().has('review'),
    '/api/review 不在 isProtectedApiPath 里，月度复盘会打不开');
});
