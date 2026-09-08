// AI 配置中心 —— 体检表上唯一没有测试的页面（2026-09-08 补）。
//
// 它管的是「AI 花了多少钱、谁在用、能力开到什么程度」，
// 出问题的后果是钱和权限两头，值得有底线测试。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('AI 配置中心不自己维护花名册', () => {
  /*
    人员在「员工账号」页管理，这一页只展示。
    两处都能改的话，必然漂移 —— 而权限漂移是最难查的一类问题。
  */
  const src = read('pages/AICenter.tsx');
  assert.match(src, /统一在「员工账号」页管理，此处仅展示/, '没有说清它不是管理入口');

  /*
    **先剥注释再查** —— 这是本项目第 26 号坑（见 docs/踩过的坑.md）：
    第一版没剥，结果被那段解释「为什么拆掉 addUserProfile」的注释匹配到，
    测试红着而代码是对的。写清楚为什么反而让测试失败，是最没道理的一种失败。
  */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/addUserProfile|deleteUserProfile|createUser\(/.test(code),
    'AI 中心不该有增删人员的能力 —— 花名册的单一真相源是「员工账号」页');
});

test('空花名册要说清人从哪来', () => {
  const src = read('pages/AICenter.tsx');
  assert.match(src, /花名册是空的/, '没有空状态');
  assert.match(src, /在「员工账号」页管理/, '空状态没告诉人该去哪开号');
});

test('用量看板要能按人和按功能拆', () => {
  /*
    审计能做下去靠的就是这两个维度。
    只有总数的话，回答不了「是人点的还是自动跑的」——
    而那才是判断会不会失控的关键。见 docs/AI用量审计.md。
  */
  const usage = read('server/services/aiUsage.js');
  ['actor_name', 'feature', 'total_tokens'].forEach((col) =>
    assert.ok(usage.includes(col), `用量记录少了 ${col}`));
});
