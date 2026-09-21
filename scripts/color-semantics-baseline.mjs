#!/usr/bin/env node
/*
  重新生成「同义色系」基线。

  **只在真的替换完、数字降下来之后跑。** 测试红了不要跑它 ——
  红说明新代码又用了同义色，正确做法是换成对应的 tone。
*/
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const BANNED = {
  green: 'emerald', slate: 'gray', yellow: 'amber', rose: 'red', cyan: 'blue',
  teal: 'emerald', sky: 'blue', violet: 'purple', fuchsia: 'purple',
  pink: 'purple', lime: 'emerald', zinc: 'gray', neutral: 'gray', stone: 'gray'
};
const DIRS = ['pages', 'components'];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : (/\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i); }).join('\n');

const res = {};
for (const f of Object.keys(BANNED)) res[f] = 0;
for (const dir of DIRS) {
  for (const file of walk(dir)) {
    const src = strip(fs.readFileSync(file, 'utf8'));
    for (const fam of Object.keys(BANNED)) {
      res[fam] += (src.match(new RegExp(`\\b(?:bg|text|border|ring|from|to|via|divide)-${fam}-\\d{2,3}\\b`, 'g')) || []).length;
    }
  }
}

const out = path.join(ROOT, 'tests', 'fixtures', 'color-semantics-baseline.json');
const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n');
const total = Object.values(res).reduce((a, b) => a + b, 0);
const wasTotal = before ? Object.values(before).reduce((a, b) => a + b, 0) : null;
console.log(`\n同义色系合计：${total} 处` + (wasTotal === null ? '（新）' : wasTotal > total ? `（${wasTotal} → ${total}，换掉了 ${wasTotal - total} 处 ✅）` : wasTotal === total ? '（不变）' : '（**变多了** ⚠️）'));
for (const [f, n] of Object.entries(res)) if (n) console.log(`  ${f.padEnd(9)} ${String(n).padStart(4)}  → 应改用 ${BANNED[f]}`);
console.log(`\n已写入 ${path.relative(ROOT, out)}\n`);
