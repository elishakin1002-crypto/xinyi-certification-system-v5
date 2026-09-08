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
const MUST_STAY_COMPLETE = ['Projects', 'Audit', 'Leads', 'Finance', 'MyTasks'];

const app = read('App.tsx');
const routeOf = (component) => {
  const re = new RegExp(`<${component}\\s*/>`);
  for (const frag of app.split('<Route ')) {
    if (!re.test(frag)) continue;
    const m = frag.match(/^\s*path="([^"]+)"/);
    if (m) return m[1];
  }
  return '';
};

const checks = (name) => {
  const src = read(`pages/${name}.tsx`);
  const route = routeOf(name);
  return {
    空状态: /EmptyState/.test(src),
    样例行: /SampleRow|SampleTr/.test(src),
    本页详解: Boolean(route) && read('src/modules/help/pageGuide.ts').includes(`path: '${route}'`),
    手机端: (src.match(/\bmd:/g) || []).length >= 5,
  };
};

test('已经达标的页面不许退步', () => {
  MUST_STAY_COMPLETE.forEach((name) => {
    const r = checks(name);
    const missing = Object.entries(r).filter(([, ok]) => !ok).map(([k]) => k);
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
    // 以下是体检时就已存在、还没补齐的存量页面。
    // **这份名单只能变短，不能变长** —— 补完一个就从这里删掉一个。
    'Dashboard', 'AICenter', 'Employees', 'AuthAuditLogs',
    'Customers', 'IntelRadar', 'Knowledge', 'Contracts', 'Strategy',
  ]);

  const pages = fs.readdirSync(path.join(root, 'pages'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => f.replace('.tsx', ''))
    .filter((n) => !SKIP.has(n));

  const brandNew = pages.filter((n) => !known.has(n));
  brandNew.forEach((name) => {
    const r = checks(name);
    const missing = Object.entries(r).filter(([, ok]) => !ok).map(([k]) => k);
    assert.deepEqual(missing, [],
      `新页面 ${name} 缺：${missing.join('、')}。`
      + `新页面要一次到位 ——「以后再补」在这个项目里的实际含义是「不会补」`);
  });
});
