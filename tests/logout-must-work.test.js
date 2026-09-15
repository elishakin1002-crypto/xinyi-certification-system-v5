// 退出登录必须退得出去 —— 这是全系统最不该失效的按钮。
//
// 2026-09-15 Codex 巡检第一条就撞上：点「退出登录」没有进入登录页，
// 停在原工作台，显示「有内容尚未保存到服务器 Login required」。
//
// 时序：
//   点退出 → authService.logout() 清 cookie
//   → 队列里那笔防抖写入这时才发出 → 401 Login required
//   → failedPayload 置上、红条弹出
//   → handleLogout 最后的 window.location.reload() 触发 beforeunload
//   → stateSyncService 的守卫看到 failedPayload，preventDefault
//   → **页面不走了**
//
// 后果正是这个按钮当初被加进来要防的事故（2026-08-24 的注释）：
//   「同事上机测试时登进去就出不来，共用电脑更换不了账号」
// 而且更糟 —— 共用电脑上退不出去 = 下一个人看到上一个人的数据，
// 在按角色分权的系统里这是事故。
//
// 修法不是把守卫删掉（那样真会丢草稿），是**改时序**：
// 清 cookie 之前先落盘（那时还有登录态），落完再放行 unload。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

test('退出前必须先落盘，而且要在清 cookie 之前', () => {
  /*
    顺序就是这条 bug 的全部内容。反过来写（先 logout 再 flush）
    一样会 401，一样退不出去，而且测试不看顺序就发现不了。
  */
  const src = stripComments(read('components/Layout.tsx'));
  const fn = src.slice(src.indexOf('const handleLogout'), src.indexOf('const [globalQuery'));
  assert.ok(fn.length > 200, '没截到 handleLogout，测试要跟着结构改');

  const iPrepare = fn.indexOf('prepareSignOut');
  const iLogout = fn.indexOf('authService.logout()');
  assert.ok(iPrepare > -1, '退出前没有落盘（prepareSignOut）—— 待写内容会在 401 里丢掉，而且会把页面拦住');
  assert.ok(iLogout > -1, '找不到 authService.logout() 调用');
  assert.ok(iPrepare < iLogout,
    '落盘写在了清 cookie 之后 —— 那时已经没有登录态，必然 401，和没修一样');
});

test('落盘失败要告诉人后果，但不许拦住退出', () => {
  const src = stripComments(read('components/Layout.tsx'));
  const fn = src.slice(src.indexOf('const handleLogout'), src.indexOf('const [globalQuery'));
  assert.match(fn, /confirm\(/, '落盘失败时没有告诉人「退出后这部分会丢」');
  assert.match(fn, /cancelSignOut\(\)/,
    '人点了「取消」之后没有把 beforeunload 守卫装回去 —— 那他接下来直接关页面就真没提示了');
  // 落盘这一步自己出错也不能卡住退出
  assert.match(fn, /catch[\s\S]{0,200}继续退出|catch[\s\S]{0,120}console\.warn\('\[logout\] 落盘失败/,
    '落盘这一步没有 try/catch —— 它一抛异常，退出按钮就彻底废了');
});

test('beforeunload 守卫必须能被主动退出显式关掉', () => {
  /*
    守卫本身要留着（有没保存的内容就别让人直接关页面），
    但必须有一个**显式**的开关让主动退出穿过去。
    不许靠猜「这次 unload 是不是退出」—— 那又是按形状猜。
  */
  const src = stripComments(read('services/stateSyncService.ts'));
  const guard = src.slice(src.indexOf("addEventListener('beforeunload'"));
  assert.match(guard.slice(0, 300), /signingOut/,
    'beforeunload 守卫里没有 signingOut 开关 —— 主动退出会被它拦住');
  assert.match(src, /prepareSignOut/, 'stateSyncService 没有提供 prepareSignOut');
  assert.match(src, /signingOut = true/, '没有任何地方把守卫关掉');
  assert.match(src, /cancelSignOut/, '没有把守卫装回去的办法');
});

test('401 不许把英文原文丢给用户看', () => {
  /*
    人看到的是「有内容尚未保存到服务器 / Login required」——
    第二行是服务端的英文。项目规矩：给用户的文案要说清后果和下一步。
  */
  const src = stripComments(read('services/stateSyncService.ts'));
  assert.match(src, /res\.status === 401/, '401 没有单独处理，会把服务端原文抛到界面上');
  assert.match(src, /登录已过期/, '401 的中文提示没写');
});
