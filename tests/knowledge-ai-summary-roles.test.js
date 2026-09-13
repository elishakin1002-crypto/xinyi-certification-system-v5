// AI 智能摘要只给 系统管理员 / 总经理 / 总助。
//
// 2026-09-13 金恩来：「ai智能摘要的功能，只开发给系统管理员、总经理、总助
// 这三个角色吧！其他角色，目前先不用显示这个功能了！」
//
// 真实行为由 .artifacts/check-ai-summary-roles.cjs 验（五个角色真登录各看一遍）：
//   管理员/总经理/总助 → 侧栏 1 个、卡片摘要 26 个
//   顾问/财务         → 侧栏 0 个、卡片摘要 0 个
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'pages/Knowledge.tsx'), 'utf8');
/** 扫源码先去注释 */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('三个角色，一个不多一个不少', () => {
  const m = /AI_SUMMARY_ROLES: RoleID\[\] = \[([^\]]*)\]/.exec(src);
  assert.ok(m, '找不到 AI_SUMMARY_ROLES');
  const roles = m[1].split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean).sort();
  assert.deepEqual(roles, ['ADMIN', 'MANAGER', 'SYS_ADMIN'],
    `名单不对：${roles.join('、')}（应为 系统管理员 SYS_ADMIN / 总经理 ADMIN / 总助 MANAGER）`);
});

test('按 activeRole 判，不是按 roles', () => {
  /*
    系统里有「切换视角」，而**视角切换不改权限**（走查手册里专门写过这条）。
    要看的是他当前实际生效的角色，否则一个有多重身份的人切到别的视角
    还是能看到 —— 或者反过来，看不到本该看的。
  */
  assert.match(src, /AI_SUMMARY_ROLES\.includes\(activeRole\)/,
    '没有按 activeRole 判断');
});

test('侧栏和卡片摘要两处都要挡住 —— 挡一处等于没挡', () => {
  /*
    摘要在两个地方露出：文档卡片上的摘要块、预览弹窗右侧的 AI 侧栏。
    只挡侧栏的话，列表上照样一眼扫到所有摘要。
  */
  assert.match(src, /\{canUseAiSummary && \(\s*<div className="w-full md:w-80/,
    '预览弹窗的 AI 侧栏没有按权限挡');
  assert.match(src, /\{canUseAiSummary && \(doc\.summary \?/,
    '文档卡片上的摘要块没有按权限挡');
});

test('不许顺手动 aiVisible —— 那是另一回事', () => {
  /*
    aiVisible = 「这份文档准不准进 AI 语料」。
    canUseAiSummary = 「谁能看到摘要界面」。
    今天刚因为把两件事混进一个词（「机密」）绕过一圈，这里不能再混。
  */
  assert.ok(!/aiVisible\s*=\s*canUseAiSummary/.test(src),
    '把「谁能看摘要」和「准不准进 AI 语料」混成一个字段了');
});
