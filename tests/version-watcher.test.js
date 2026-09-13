// 「更新了提醒刷新」这件事，开发模式也要管。
//
// 2026-09-13 金恩来：「之前那个更新了就提醒刷新的功能挺好的，怎么不见了」
//
// 它没不见 —— **它在 localhost 上从来就没生效过**：
// 原来比的是打包文件名 `assets/index-xxxx.js`，而开发模式下没有这个文件，
// `check()` 第一行就 return 了。
//
// 可他的走查几乎全在 localhost 做，我又在旁边一直改代码 ——
// 最需要这个提示的场合，恰恰是它唯一不工作的场合。
// 今天就因此绕了一圈：他截图说「服务项目又跑到下面去了」，
// 而那张图是上一版的界面。
//
// 真实行为由 .artifacts/check-version-watcher-dev.cjs 验：
// 真登录 → 真杀 dev 服务（非干净断开）→ 断开期间确实弹出提示。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'components/VersionWatcher.tsx'), 'utf8');
/** 扫源码先去注释 —— 注释里写着这些词，会误伤也会误放 */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('开发模式要盯热更新连接，不能只比打包文件名', () => {
  assert.match(src, /import\.meta[\s\S]{0,20}\.hot/, '没有用到 import.meta.hot');
  assert.match(src, /vite:ws:disconnect/, '没有监听断开事件 —— 开发模式下等于没有这个功能');
});

test('重连时要收起提示，不许和 Vite 的自动刷新打架', () => {
  /*
    Vite 客户端在非干净断开后会一直 ping，服务器回来就 location.reload()。
    我们在重连时**不该**再弹一次「请刷新」：多余，而且会和它抢。
    这里只负责那段"断着的空窗期" —— 那段时间 Vite 只在 console 打一行，
    而没有人盯着 console。
  */
  // 别写成「事件名后面跟着 setStale」—— 源码里处理函数是先定义、后注册的，
  // 顺序反过来，这么写会误报（第一版就是这么红的）。分两件事各查各的。
  const handler = /const onConnect = \(\) => \{[^}]*setStale\(false\)[^}]*\}/;
  assert.match(src, handler, '重连的处理函数没有把提示收起来');
  assert.match(src, /hot\.on\('vite:ws:connect', onConnect\)/, '重连事件没挂上处理函数');
});

test('两种情况的说法要分开 —— 说错了人会往错的方向查', () => {
  assert.match(src, /系统已更新/, '生产那套说法没了');
  assert.match(src, /和开发服务器断开了/, '开发那套说法没了');
  assert.match(src, /reason === 'hmr'/, '没有按原因分支，两种情况会用同一句话');
});

test('生产那条路不许被改坏 —— 它本来是好的', () => {
  /*
    改开发模式最容易顺手把生产那套一起改了。
    生产靠的是比对 index.html 里的打包文件名，这条要留着。
  */
  assert.match(src, /assets\\\/index-/, '不再比对打包文件名，生产就收不到更新提示了');
  assert.match(src, /cache: 'no-store'/, '取 index.html 没加 no-store，会拿到缓存的旧版');
});

test('只提示不自动刷新 —— 别把人正在填的表单冲掉', () => {
  /*
    这条是原设计里最重要的一条：为了一个版本提示毁掉半小时的录入，
    代价完全不成比例。刷新必须是人点的。
  */
  assert.ok(!/setInterval[\s\S]{0,200}location\.reload/.test(src),
    '出现了自动刷新 —— 会冲掉正在填的表单');
  assert.match(src, /onClick=\{\(\) => window\.location\.reload\(\)\}/,
    '刷新不再是人点的了');
});
