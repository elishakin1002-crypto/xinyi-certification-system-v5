#!/usr/bin/env node
/*
  重新生成「手机 / 桌面功能差异」基线。

  **只在真的把差异补平、数字降下来之后跑。**
  测试红了不要跑它 —— 红说明新功能只做了一边，
  正确的做法是把另一边补上，不是把基线调高（那等于把闸门拆了）。
*/
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parityOf } from './lib/mobileParity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const ALLOWED = ['setIsSidebarOpen', 'setIsMobileSearchOpen', 'handleOpenScopeResult'];   // 和测试里的 ALLOWED_ONE_SIDED 对应
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : (/\.tsx$/.test(e.name) ? [path.join(d, e.name)] : []));

const files = [...walk('pages'), ...walk('components')].filter((f) => {
  const s = fs.readFileSync(f, 'utf8');
  return /hidden\s+(md|lg):/.test(s) && /(md|lg):hidden/.test(s);
});

const byFile = {};
let total = 0;
for (const f of files) {
  const r = parityOf(f);
  const d = r.desktopOnly.filter((a) => !ALLOWED.includes(a));
  const m = r.mobileOnly.filter((a) => !ALLOWED.includes(a));
  if (!d.length && !m.length) continue;
  byFile[f] = { desktopOnly: d, mobileOnly: m };
  total += d.length + m.length;
}

const out = path.join(ROOT, 'tests', 'fixtures', 'mobile-parity-baseline.json');
const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')).total : null;
fs.writeFileSync(out, JSON.stringify({ total, byFile }, null, 2) + '\n');

console.log(`\n手机/桌面功能差异：${total} 处` + (before === null ? '（新）' : before > total ? `（${before} → ${total}，补平了 ${before - total} 处 ✅）` : before === total ? '（不变）' : `（${before} → ${total}，**变多了** ⚠️）`));
for (const [f, v] of Object.entries(byFile)) {
  console.log(`\n  ${f}`);
  if (v.desktopOnly.length) console.log(`    只有桌面能做：${v.desktopOnly.join(', ')}`);
  if (v.mobileOnly.length) console.log(`    只有手机能做：${v.mobileOnly.join(', ')}`);
}
console.log(`\n已写入 ${path.relative(ROOT, out)}\n`);
