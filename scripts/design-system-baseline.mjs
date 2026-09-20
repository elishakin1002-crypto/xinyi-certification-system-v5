#!/usr/bin/env node
/*
  重新生成「手搓 UI 样式」的基线数字。

  什么时候跑：**只在你真的还了旧账、数字降下来之后跑。**

  不要在测试红了的时候跑它 —— 测试红说明新代码又手搓了样式，
  正确的做法是去用 src/ui 里的规范（缺就往那里加一个），
  而不是把基线调高把红的变绿。那等于把闸门拆了，
  而且拆得悄无声息（见 tests/design-system.test.js 顶上的说明）。

  规则和计数逻辑都在测试里，这个脚本只是复用它再写一次文件 ——
  两处各写一份规则，早晚会对不上。
*/
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/*
  测试文件不导出计数函数（它是 node:test 的文件，一 require 就会跑测试），
  所以这里直接把它当文本读进来、取出规则。
  这么做是丑的，但比"规则写两遍"好 —— 写两遍一定会分叉。
*/
const testSrc = fs.readFileSync(path.join(ROOT, 'tests', 'design-system.test.js'), 'utf8');
const ids = [...testSrc.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]);
const res = [...testSrc.matchAll(/re: (\/[\s\S]*?\/g)\n/g)].map((m) => m[1]);
if (ids.length === 0 || ids.length !== res.length) {
  console.error('⛔ 没能从 tests/design-system.test.js 里解析出规则。改过那个文件的结构就要同步改这里。');
  process.exit(1);
}

const DIRS = ['pages', 'components'];
const walk = (dir) => {
  const out = [];
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name.name)) out.push(full);
  }
  return out;
};
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => { const i = line.indexOf('//'); return i === -1 ? line : line.slice(0, i); })
    .join('\n');

const counts = {};
for (const id of ids) counts[id] = 0;
for (const dir of DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    ids.forEach((id, i) => {
      const re = new RegExp(res[i].slice(1, res[i].lastIndexOf('/')), 'g');
      counts[id] += (src.match(re) || []).length;
    });
  }
}

const out = path.join(ROOT, 'tests', 'fixtures', 'design-system-baseline.json');
const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
fs.writeFileSync(out, JSON.stringify(counts, null, 2) + '\n');

console.log('\n手搓样式基线：');
for (const id of ids) {
  const b = before?.[id];
  const arrow = b === undefined ? '（新）' : b === counts[id] ? '（不变）' : b > counts[id] ? `（${b} → ${counts[id]}，还了 ${b - counts[id]} 处 ✅）` : `（${b} → ${counts[id]}，**变多了 ${counts[id] - b} 处** ⚠️）`;
  console.log(`  ${id.padEnd(14)} ${String(counts[id]).padStart(4)}  ${arrow}`);
}
console.log(`\n已写入 ${path.relative(ROOT, out)}\n`);
