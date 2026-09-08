#!/usr/bin/env node
/**
 * 系统体检 —— 一眼看出哪块厚、哪块薄。
 *
 * 金恩来 2026-09-08：「我们这样聊一段改一段的模式很难使系统整体变得完整……
 * 甚至有可能出现『头重脚轻』这样畸形的比例，你看要怎么防止这种现象。」
 *
 * 现象是真的，原因在开发方：反应式的修复天然是**纵向**的 ——
 * 他指出项目管理有问题就把项目管理做深，一轮 3300 行；
 * 而没人提过的战略管理还是 446 行、连空状态都没有。
 * 纵向做深没错，错在没有定期横向拉平 —— 而拉平的前提是「看得见哪里薄」。
 *
 * 用法：npm run checkup（不改任何东西，只把现状摊开）
 *
 * 判据在 scripts/lib/pageChecks.cjs，**和 tests/consistency-floor.test.js 共用一份** ——
 * 曾经是两份，我在这边把「手机端」判据改对了却忘了同步那边，
 * 于是测试报「Employees 退步了」而它明明刚加了手机卡片。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CHECKS, EXEMPT, listPages, inspect } = require('./lib/pageChecks.cjs');

const rows = listPages().map(inspect);

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)));

console.log('\n信义系统体检 —— ' + new Date().toISOString().slice(0, 10));
console.log('='.repeat(74));
console.log(pad('页面', 16) + pad('行数', 7) + CHECKS.map((c) => pad(c.key, 10)).join('') + '完整度');
console.log('-'.repeat(74));

rows.slice().sort((a, b) => a.score - b.score || b.lines - a.lines).forEach((r) => {
  console.log(
    pad(r.name, 16) + pad(r.lines, 7)
    + r.results.map((ok) => pad(ok === 'exempt' ? ' －' : ok ? ' ✅' : ' ❌', 10)).join('')
    + `${r.score}/${CHECKS.length}`
  );
});
console.log('-'.repeat(74));

console.log('\n按维度看，哪一项最该补：');
CHECKS.forEach((c, i) => {
  const have = rows.filter((r) => r.results[i] === true || r.results[i] === 'exempt').length;
  const miss = rows.filter((r) => r.results[i] === false).map((r) => r.name);
  console.log(`  ${pad(c.key, 10)} ${'█'.repeat(Math.round((have / rows.length) * 20)).padEnd(20, '·')} ${have}/${rows.length}`);
  if (miss.length) console.log(`  ${' '.repeat(10)} 缺：${miss.join('、')}`);
});

const sorted = rows.slice().sort((a, b) => b.lines - a.lines);
const ratio = (sorted[0].lines / sorted[sorted.length - 1].lines).toFixed(1);
console.log(`\n体量：最厚 ${sorted[0].name}（${sorted[0].lines} 行）是最薄 ${sorted[sorted.length - 1].name}（${sorted[sorted.length - 1].lines} 行）的 ${ratio} 倍`);
if (Number(ratio) > 5) {
  console.log('  ⚠️ 差距超过 5 倍。这不一定是问题（页面本身有繁简），');
  console.log('     但**薄的那几个要确认是"本来就简单"还是"没人提过所以没做"**。');
}

console.log('\n－ 表示明确豁免（本来就不适用），理由：');
Object.entries(EXEMPT).forEach(([k, why]) => console.log(`  ${k}：${why}`));

const red = rows.filter((r) => r.results.includes(false));
console.log(red.length === 0
  ? '\n✅ 所有页面都达标。下一轮可以往「深度」走了 —— 但每加一个新页面，记得它要一次到位。\n'
  : '\n下一轮建议：挑上面 ❌ 最多的那一列横扫一遍，而不是继续把最厚的页面做得更厚。\n');
