// 退出登录在**浏览器这一侧**要做干净。
//
// ── 为什么服务端做对了还不够 ──────────────────────────────────
// 服务端的会话销毁是对的（见 api-auth-login.test.js）：
// 退出后拿旧 session id 打任何业务接口都是 401。
//
// 但那条防线保护的是「有请求发出去」的情况。老板 2026-08-28 问
// 「别人在我电脑上能不能看到我的数据」时，我第一反应也是拿 401 回答——
// 漏了**根本不发请求**的那条路：
//
//   浏览器的前进/后退缓存（bfcache）会把整个页面连同 React 内存状态
//   一起冻存。按后退键时原样恢复，一个网络请求都不发，
//   服务端的 401 完全够不着——上一个人的客户名单和合同金额直接还在屏幕上。
//
// 办公室共用电脑这是真会发生的。这两条用例守的就是这个。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('从 bfcache 恢复时强制重载', () => {
  /*
    event.persisted 为真就说明页面是从缓存整个恢复的，
    此时 React 状态（包括 authUser 和所有业务数据）都还在。
    必须重载，让鉴权重新跑一遍。
  */
  const src = stripComments(read('App.tsx'));
  assert.match(src, /pageshow/, '没有监听 pageshow —— bfcache 恢复时没有任何防护');
  assert.match(src, /event\.persisted[\s\S]{0,60}reload/,
    '监听了 pageshow 但没有在 persisted 时重载，等于没防住');
});

test('退出登录不能往浏览历史里推记录', () => {
  /*
    location.href = ... 会留下一条历史记录，退出后按「后退」回到 #/dashboard。
    那时会渲染登录页（authUser 已空），但历史里躺着一串业务页面地址本身
    就没必要——别人在这台电脑上翻后退，至少能看出这人平时在看哪些模块。

    location.replace 覆盖当前记录，不新增。
  */
  const src = stripComments(read('components/Layout.tsx'));
  const fn = src.slice(src.indexOf('const handleLogout'), src.indexOf('const [globalQuery'));
  assert.ok(fn.length > 0, '找不到退出登录的处理函数');
  assert.match(fn, /window\.location\.replace\(/, '退出没有用 replace');
  assert.ok(!/window\.location\.href\s*=/.test(fn),
    '还在用 location.href= —— 会在浏览历史里留下业务页面地址');
});

test('退出时必须重载，清掉内存里的业务数据', () => {
  /*
    只换路由不会清 React 状态。客户名单、合同金额这些还在进程内存里，
    下一个人只要让应用重新渲染就能看到。reload 是唯一可靠的清法。
  */
  const src = stripComments(read('components/Layout.tsx'));
  const fn = src.slice(src.indexOf('const handleLogout'), src.indexOf('const [globalQuery'));
  assert.match(fn, /window\.location\.reload\(\)/, '退出后没有重载，内存里的业务数据还在');
});

test('服务端退出失败也要清干净本地', () => {
  /*
    网络断了、后端挂了的时候，用户点了退出就必须退出。
    停在已登录状态、只弹个错误提示，是最糟的处理——
    用户以为自己退了，人就走开了。
  */
  const src = stripComments(read('components/Layout.tsx'));
  const fn = src.slice(src.indexOf('const handleLogout'), src.indexOf('const [globalQuery'));
  assert.match(fn, /finally\s*\{/, '本地清理没放在 finally 里');
  const finallyBlock = fn.slice(fn.indexOf('finally'));
  assert.match(finallyBlock, /replace|reload/, 'finally 里没有做本地清理');
});
