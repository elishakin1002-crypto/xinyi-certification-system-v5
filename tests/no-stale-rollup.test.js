// 统计数字要当场算，不许读一份「可能没人维护的缓存」。
//
// 2026-09-16 跑权限矩阵时顺手发现：客户管理顶部
//     客户总数 1    在执行合同 0    高风险 0    累计合作金额 ¥0
// 而库里明明有一份 18000 元、状态 Active 的合同挂在这个客户名下。
//
// 真因：那两个数读的是**客户表上的冗余统计字段**
//     c.activeContracts / c.totalAmount
// 这是一份要靠"建合同时记得回头更新客户"才准的数据。
// 而合同识别建客户那条路径根本没写这两个字段，于是永远是 0。
//
// 冗余字段的通病：**写的人和读的人不是同一段代码。**
// 只要有一条写入路径忘了更新，这个数就永远错，而且不报错 ——
// 和「合同说已立项但项目管理里没有」「点了已分拣刷新变回待处理」
// 是同一个形状：显示的是标志位，不是事实。
//
// 合同就在 contracts 数组里，当场数一遍是 O(n)。
// 没有任何理由去信一份可能没人维护的缓存。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const strip = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

test('客户页顶部统计必须从真实合同算，不许读客户表上的冗余字段', () => {
  const src = strip(fs.readFileSync(path.join(root, 'pages/Customers.tsx'), 'utf8'));
  const fn = src.slice(src.indexOf('const customerStats'), src.indexOf('const canSeeCustomerFinance') > 0
    ? src.indexOf('const canSeeCustomerFinance') : src.indexOf('const customerStats') + 900);
  assert.ok(fn.length > 150, '没截到 customerStats');

  assert.ok(!/c\.activeContracts/.test(fn),
    '又在读 c.activeContracts —— 那是客户表上的冗余统计，'
    + '合同识别建客户时不写它，永远是 0');
  assert.ok(!/c\.totalAmount/.test(fn),
    '又在读 c.totalAmount —— 同上，会显示 ¥0 而实际有合同');

  assert.match(fn, /contracts\.filter|contracts\b[\s\S]{0,120}filter/,
    '「在执行合同」没有从 contracts 数组里数 —— 当场数一遍才是事实');
  assert.match(fn, /Status\.Active/, '「在执行合同」没有按 Active 过滤');
  assert.match(fn, /ct\.amount|\.amount \|\| 0/, '「累计合作金额」没有从合同金额累加');
});

test('这一类冗余统计字段不许再被界面直接当数字用', () => {
  /*
    防的是下一处：客户表上还有 cooperationCount / serviceCount /
    totalValueAmount 等一堆同类字段。
    它们可以存、可以在详情页当"参考值"显示，
    但**不许出现在顶部统计卡这种"人拿它做判断"的位置**。
  */
  const ROLLUP = ['activeContracts', 'totalAmount', 'cooperationCount', 'serviceCount'];
  const src = strip(fs.readFileSync(path.join(root, 'pages/Customers.tsx'), 'utf8'));
  // 只看统计卡那一段：从 customerStats 定义到它被渲染完
  const statsBlock = src.slice(src.indexOf('const customerStats'), src.indexOf('const customerStats') + 800);
  const bad = ROLLUP.filter(f => new RegExp(`c\\.${f}\\b`).test(statsBlock));
  assert.deepEqual(bad, [],
    `顶部统计又开始读冗余字段：${bad.join('、')}\n`
    + '  这些字段要靠别处"记得更新"才准，而写入路径不止一条。\n'
    + '  统计卡是人拿来做判断的地方，必须当场从原始数据算。');
});
