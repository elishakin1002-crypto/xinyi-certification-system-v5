// 读不到 ≠ 没有 —— 出错时不许顺带断言一个我们并不知道的事实。
//
// 2026-09-17 按钮清点（Playwright 自动点了 231 个按钮）抓到的：
// 总助能进审计日志页，但 /api/auth/sessions 只对总经理和系统管理员开放。
// 于是她那一屏上同时出现两句自相矛盾的话：
//
//     只有总经理和系统管理员能看全部登录设备   ← 对
//     没有正在生效的登录。                     ← 假的
//
// 「没有」是一句关于事实的断言，而真相是"我看不到"。
// 在**安全相关**的页面上说这种假话尤其要不得：
// 她可能据此认为公司没人登着，而实际上可能有一台不认识的设备在线。
//
// 同一处还有：那个「刷新」按钮对她点一次 403 一次，永远不可能成功。
// 一个注定失败的按钮比没有按钮更糟 —— 人会以为是系统坏了，反复点。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'components/LoginSessions.tsx'), 'utf8');
const clean = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

test('读失败时不许说「没有正在生效的登录」', () => {
  /*
    守的是渲染顺序：error 分支必须排在 list.length === 0 之前。
    反过来的话，403 导致的空列表又会被说成"没有"。
  */
  const iError = clean.indexOf(') : error ?');
  const iEmpty = clean.indexOf('没有正在生效的登录');
  assert.ok(iError > 0, '没有单独的 error 分支 —— 读失败会掉进"空列表"那一支');
  assert.ok(iEmpty > 0, '找不到空状态文案，选择器过时了？');
  assert.ok(iError < iEmpty,
    'error 分支排在了空状态之后 —— 403 造成的空列表又会被断言成「没有正在生效的登录」');
});

test('读不到的时候不许留一个注定 403 的「刷新」按钮', () => {
  const i = clean.indexOf('刷新');
  assert.ok(i > 0, '找不到刷新按钮');
  const around = clean.slice(Math.max(0, i - 400), i);
  assert.match(around, /!error &&/,
    '「刷新」按钮没有按 error 隐藏 —— 没权限的人点一次 403 一次，永远不会成功');
});
