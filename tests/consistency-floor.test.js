// 一致性下限：**新页面不许比现在更薄**。
//
// 2026-09-08 金恩来：「我们这样聊一段改一段的模式很难使系统整体变得完整……
// 甚至有可能出现『头重脚轻』这样畸形的比例。」
//
// 体检表（npm run checkup）负责**看见**失衡，这条测试负责**不让它变得更糟**。
// 两者分工：表是给人看的、可以有红项；测试只卡一条底线 ——
// 已经达标的页面不许退步，新加的页面必须一次到位。
//
// 为什么不把所有红项都变成失败：那会让测试常年是红的，
// 而常年红的测试等于没有测试 —— 人会习惯性忽略它。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return ''; } };

const SKIP = new Set(['Login', 'ChangePassword']);

/*
  已经达标的页面 —— 这份名单只能加，不能减。
  减一个就意味着某个页面退步了，而那正是这条测试要拦的。
*/
const MUST_STAY_COMPLETE = [
  'Projects', 'Audit', 'Leads', 'Finance', 'MyTasks',
  // 2026-09-08 横扫补齐的：
  'Customers', 'Contracts', 'Knowledge', 'IntelRadar', 'Strategy', 'Employees', 'AuthAuditLogs',
];

/*
  判据从 scripts/lib/pageChecks.cjs 引入，**不再自己写一份**。
  原来这里有一份副本，我在 checkup 脚本里把「手机端」判据改对了
  却忘了同步这边 —— 于是测试报「Employees 退步了」，而它明明刚加了手机卡片。
  同一条规则两份副本，漂移一定会发生。
*/
const { inspect, CHECKS } = require('../scripts/lib/pageChecks.cjs');

const missingOf = (name) => {
  const r = inspect(name);
  return CHECKS.map((c, i) => (r.results[i] === false ? c.key : null)).filter(Boolean);
};

test('已经达标的页面不许退步', () => {
  MUST_STAY_COMPLETE.forEach((name) => {
    const missing = missingOf(name);
    assert.deepEqual(missing, [],
      `${name} 退步了，缺：${missing.join('、')}。这些是它已经有过的东西，不该在改动中丢掉`);
  });
});

test('新增页面必须一次到位', () => {
  /*
    「以后再补」在这个项目里的实际含义是「不会补」——
    样例行就是活证据：2026-09-07 说好每个板块都留一个，
    到 09-08 体检时 14 个业务页面只做了 5 个。

    所以新页面的门槛设在这里：不满足就别合进来，
    而不是先合进来再指望以后。
  */
  const known = new Set([
    ...MUST_STAY_COMPLETE,
    /*
      这里原来列着 9 个欠账页面，2026-09-08 横扫后**已经清空**。
      现在只剩两个「样例行不适用」的：工作台和 AI 中心展示的是
      汇总数字和开关，没有「一行记录」可以做样例（豁免理由写在
      scripts/checkup.mjs 的 EXEMPT 里）。

      **这份名单只能变短，不能变长。** 想往里加名字之前先问一句：
      是这个页面真的不适用，还是我只是不想现在做？
    */
    'Dashboard', 'AICenter',
  ]);

  const pages = require('../scripts/lib/pageChecks.cjs').listPages();

  const brandNew = pages.filter((n) => !known.has(n));
  brandNew.forEach((name) => {
    const missing = missingOf(name);
    assert.deepEqual(missing, [],
      `新页面 ${name} 缺：${missing.join('、')}。`
      + `新页面要一次到位 ——「以后再补」在这个项目里的实际含义是「不会补」`);
  });
});
