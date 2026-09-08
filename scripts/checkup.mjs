#!/usr/bin/env node
/**
 * 系统体检 —— 一眼看出哪块厚、哪块薄。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个脚本
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来 2026-09-08：「我们这样聊一段改一段的模式很难使系统整体变得完整……
 * 甚至有可能出现『头重脚轻』这样畸形的比例，你看要怎么防止这种现象。」
 *
 * 他说的现象是真的，而且已经发生了。原因在**我**不在他：
 * 反应式的修复天然是**纵向**的 —— 他指出项目管理有问题，
 * 我就把项目管理做深，一轮下来 3300 行；
 * 而没人提过的战略管理还是 445 行、连个空状态都没有。
 *
 * 纵向做深没错，错在**没有定期横向拉平**。
 * 而横向拉平的前提是「看得见哪里薄」—— 这就是这个脚本。
 *
 * 用法：npm run checkup
 *
 * 它不改任何东西，只是把现状摊开。**建议每完成两三轮改动跑一次**，
 * 挑最薄的那一列补齐，而不是等用户发现。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return ''; }
};

/* 登录和改密码是独立于业务的入口页，不参与业务一致性体检 */
const SKIP = new Set(['Login', 'ChangePassword']);

const app = read('App.tsx');
const pageGuide = read('src/modules/help/pageGuide.ts');
const tourSteps = read('src/modules/onboarding/steps.ts');
const testFiles = fs.readdirSync(path.join(root, 'tests'))
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => ({ name: f, body: read(`tests/${f}`) }));

/**
 * 从 App.tsx 里把「组件 → 路由」对出来。
 *
 * 路由有两种写法，**必须都认**：
 *   <Route path="/x" element={<Foo />} />
 *   <Route path="/x" element={<ProtectedRoute ...><Foo /></ProtectedRoute>} />
 *
 * 第一版只认第二种，于是 Dashboard 被判成「没有本页详解」——
 * 而它明明有。**一个会误报的体检表比没有更糟**：
 * 它会把人指向根本不存在的问题，然后人就不再信这张表了。
 */
const routeOf = (component) => {
  /*
    **按 <Route 逐条切开，不允许跨条匹配。**

    第二版用了一个跨行的懒惰匹配，结果从 `path="/"` 那条一路串到
    下面的 `<Dashboard />`，把 Dashboard 的路由报成了 `/change-password`。
    体检表于是说「Dashboard 没有本页详解」—— 而它有。
    修 bug 的工具自己有 bug，是最没有说服力的一件事。
  */
  const re = new RegExp(`<${component}\\s*/>`);
  for (const frag of app.split('<Route ')) {
    if (!re.test(frag)) continue;
    const m = frag.match(/^\s*path="([^"]+)"/);
    if (m) return m[1];
  }
  return '';
};

/**
 * 每个业务页面「应该有」的东西。
 *
 * 这份清单不是我拍的，是这半年反复被金恩来指出后攒下来的：
 *   空状态   —— 新人第一次进来全是空的，一片空白他不知道该干嘛
 *   样例行   —— 2026-09-07 他说「没有内容谁会看？看了谁又能记得住？」
 *   本页详解 —— 三层帮助的第二层，「这一页是干什么的」
 *   新手引导 —— 岗位上手时会不会走到这一页
 *   手机端   —— 同事多半在手机上看
 *   写失败   —— 保存失败不能静默，否则「看着成功了其实没存上」
 *   测试     —— 有没有测试提到它
 */
const CHECKS = [
  { key: '空状态', has: (src) => /EmptyState/.test(src) },
  { key: '样例行', has: (src) => /SampleRow|SampleTr/.test(src) },
  { key: '本页详解', has: (_s, route) => route && pageGuide.includes(`path: '${route}'`) },
  { key: '新手引导', has: (_s, route) => route && tourSteps.includes(`route: '${route}'`) },
  { key: '手机端', has: (src) => (src.match(/\bmd:/g) || []).length >= 5 },
  { key: '测试', has: (_s, _r, name) => testFiles.some((t) => t.body.includes(`pages/${name}.tsx`)) },
];

const pages = fs.readdirSync(path.join(root, 'pages'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => f.replace('.tsx', ''))
  .filter((n) => !SKIP.has(n));

const rows = pages.map((name) => {
  const src = read(`pages/${name}.tsx`);
  const route = routeOf(name);
  const lines = src.split('\n').length;
  const results = CHECKS.map((c) => Boolean(c.has(src, route, name)));
  return { name, route, lines, results, score: results.filter(Boolean).length };
});

/* ── 输出 ────────────────────────────────────────────────── */

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)));

console.log('\n信义系统体检 —— ' + new Date().toISOString().slice(0, 10));
console.log('='.repeat(74));
console.log(pad('页面', 16) + pad('行数', 7) + CHECKS.map((c) => pad(c.key, 10)).join('') + '完整度');
console.log('-'.repeat(74));

rows.slice().sort((a, b) => a.score - b.score || b.lines - a.lines).forEach((r) => {
  console.log(
    pad(r.name, 16) + pad(r.lines, 7)
    + r.results.map((ok) => pad(ok ? ' ✅' : ' ❌', 10)).join('')
    + `${r.score}/${CHECKS.length}`
  );
});

console.log('-'.repeat(74));

/* 每一列的覆盖率 —— 哪一列红得多，下一轮就横扫哪一列 */
console.log('\n按维度看，哪一项最该补：');
CHECKS.forEach((c, i) => {
  const have = rows.filter((r) => r.results[i]).length;
  const miss = rows.filter((r) => !r.results[i]).map((r) => r.name);
  const bar = '█'.repeat(Math.round((have / rows.length) * 20)).padEnd(20, '·');
  console.log(`  ${pad(c.key, 10)} ${bar} ${have}/${rows.length}`);
  if (miss.length) console.log(`  ${' '.repeat(10)} 缺：${miss.join('、')}`);
});

/* 体量失衡：最大页面是最小页面的几倍 */
const sorted = rows.slice().sort((a, b) => b.lines - a.lines);
const ratio = (sorted[0].lines / sorted[sorted.length - 1].lines).toFixed(1);
console.log(`\n体量：最厚 ${sorted[0].name}（${sorted[0].lines} 行）是最薄 ${sorted[sorted.length - 1].name}（${sorted[sorted.length - 1].lines} 行）的 ${ratio} 倍`);
if (Number(ratio) > 5) {
  console.log('  ⚠️ 差距超过 5 倍。这不一定是问题（页面本身有繁简），');
  console.log('     但**薄的那几个要确认是"本来就简单"还是"没人提过所以没做"**。');
}

console.log('\n下一轮建议：挑上面 ❌ 最多的那一列横扫一遍，而不是继续把最厚的页面做得更厚。\n');
