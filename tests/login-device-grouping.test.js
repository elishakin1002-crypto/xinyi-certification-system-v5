// 「我的登录设备」按设备归并，不是按登录次数罗列。
//
// 2026-09-12 金恩来看着自己那页问：「为什么出现那么多台 Mac Chrome？」
//
// 因为登录成功就插一条会话，**没有任何按设备去重**。
// 同一台电脑登十次就是十行，而且十行的 UA 完全相同。
//
// 这一页存在的唯一理由是「看到不是自己的设备就下线」。
// 十行同名的东西里挑不出那个陌生的 —— 功能等于没有。
// 而且越常用系统的人列表越长、越没法用，正好反了。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.runtime/loginSessions.test.cjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'components/LoginSessions.tsx'),
  '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic',
  '--external:react', '--external:react/jsx-runtime', '--external:lucide-react',
  `--outfile=${out}`,
], { stdio: 'pipe' });
/*
  authService 会在模块顶层碰 window/fetch，bundle 进来就跑不起来。
  用 --external 反而更糟：require 到真模块，一样炸。
  这里直接给它一个壳 —— 要验的是 groupByDevice 这个纯函数。
*/
const Module = require('node:module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (/services\/authService/.test(req)) return require.resolve('./helpers/authServiceStub.js');
  return origResolve.call(this, req, ...rest);
};
const { groupByDevice } = require(out);
Module._resolveFilename = origResolve;

const S = (id, over = {}) => ({
  id, userId: 'U1', userName: '黄佳佳',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140',
  ip: '::1', createdAt: '2026-09-12T01:00:00Z', lastSeenAt: '2026-09-12T01:00:00Z',
  isCurrent: false, remembered: false, ...over,
});

test('同一台电脑登很多次，只占一行', () => {
  /*
    这就是他截图里那一屏：11 行 Mac · Chrome，全是同一台。
    （其实全是我跑自动化巡检登出来的，但换成真人每天登一次，
     一个月照样堆出 30 行。）
  */
  const g = groupByDevice([S('a'), S('b'), S('c'), S('d')]);
  assert.equal(g.length, 1, `4 次登录应该并成 1 台，实际 ${g.length} 台`);
  assert.equal(g[0].count, 4, '没有把这台上压着几次登录数出来');
});

test('真的是两台设备就不许并到一起', () => {
  /*
    反方向同样要守：并过头了，陌生设备就被藏进自己那一行里，
    **这一页就从"没用"变成"有害"** —— 人看着列表以为干净，
    实际上别人正登着。
  */
  const g = groupByDevice([
    S('a'),
    S('b', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140' }),
    S('c', { ip: '192.168.1.50' }),
  ]);
  assert.equal(g.length, 3, 'UA 不同或 IP 不同必须算不同设备');
});

test('看全公司时，两个人用同型号电脑不能并成一台', () => {
  const g = groupByDevice([S('a'), S('b', { userId: 'U2', userName: '黄邦煜' })]);
  assert.equal(g.length, 2, '归并键漏了 userId —— 会把两个人的登录混成一行');
});

test('这台上只要有一条是当前会话，整台就是「当前这台」', () => {
  /*
    错了的后果很具体：按钮会显示「下线」而不是「退出这台」，
    人点下去把自己踢了，却没有得到「你正在退出自己」的预期。
  */
  const g = groupByDevice([S('a'), S('b', { isCurrent: true })]);
  assert.equal(g.length, 1);
  assert.equal(g[0].isCurrent, true);
});

test('当前这台排最前，其余按最近活跃倒序', () => {
  const g = groupByDevice([
    S('old', { ip: '10.0.0.1', lastSeenAt: '2026-09-10T00:00:00Z' }),
    S('new', { ip: '10.0.0.2', lastSeenAt: '2026-09-12T05:00:00Z' }),
    S('cur', { ip: '10.0.0.3', isCurrent: true, lastSeenAt: '2026-09-11T00:00:00Z' }),
  ]);
  assert.deepEqual(g.map(x => x.latest.id), ['cur', 'new', 'old']);
});

test('下线要撤掉这台上的每一次登录 —— 只撤一条等于没撤', () => {
  /*
    最要命的一条。这台上压着 4 次登录，只撤 1 条，
    对方换个标签页照样在线，而人已经以为把他踢下去了。
    **安全动作最怕这种假成功。**

    这里盯的是 kick() 真的遍历了整组，不是只拿 latest。
  */
  const src = fs.readFileSync(path.join(root, 'components/LoginSessions.tsx'), 'utf8');
  assert.match(src, /for \(const s of g\.sessions\) await authService\.revokeSession\(s\.id\)/,
    '下线没有遍历整台设备上的会话');
});

test('不许再写「常用设备」—— 那个词对应的是「勾了 14 天免登录」', () => {
  /*
    remembered 来自登录时勾的「这台电脑我常用，14 天内免登录」，
    和用得多不多无关。写成「常用设备」，人会以为系统认得这台机器、
    以为没这个标的就是可疑设备 —— 判断依据整个是错的。
  */
  const src = fs.readFileSync(path.join(root, 'components/LoginSessions.tsx'), 'utf8');
  // 注释里要留着这段历史（为什么不用这个词），所以只看会渲染出去的部分
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/常用设备/.test(code), '又出现「常用设备」这个会让人误判的说法');
  assert.match(code, /14 天免登录/, '没有照抄登录页那句话，两边对不上');
});
