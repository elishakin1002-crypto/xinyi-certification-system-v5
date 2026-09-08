#!/usr/bin/env node
/**
 * 行业归类体检 —— 规则归得准不准，只能拿真实数据说话。
 *
 * 用法：npm run checkup:industry
 *   （需要能连生产库；本地跑会用本地库）
 *
 * 它回答两个问题：
 *   ① 归类之后，同行业还能不能聚起一堆人（聚不起来就等于没归）
 *   ② 还有哪些原始值落进「其他」—— 那是规则该不该补的唯一依据
 *
 * 为什么要有这个：行业值来自工商数据，是**开放集合**，
 * 明天来个新客户就可能带来第 181 个值。
 * 没有这个脚本，规则漏了没人会知道 —— 它不报错，只是静默归到「其他」。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const out = path.join(os.tmpdir(), `industry-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/industry.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
], { stdio: 'pipe' });
const { groupIndustry } = require(out);

require('dotenv').config({ path: path.join(root, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(root, 'node_modules/pg'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  select industry, count(*)::int as n from (
    select industry from customers where coalesce(industry,'') <> ''
    union all
    select industry from leads where coalesce(industry,'') <> ''
  ) t group by 1 order by 2 desc;
`);
await pool.end();

const total = rows.reduce((s, r) => s + r.n, 0);
const grouped = {};
const others = [];
rows.forEach(({ industry, n }) => {
  const g = groupIndustry(industry);
  grouped[g] = (grouped[g] || 0) + n;
  if (g === '其他') others.push(`${industry}(${n})`);
});

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

console.log(`\n行业归类体检 —— ${new Date().toISOString().slice(0, 10)}`);
console.log(`原始值 ${rows.length} 个 → 归成 ${Object.keys(grouped).length} 类，共 ${total} 条记录\n`);
Object.entries(grouped).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${pad(k, 14)} ${String(v).padStart(4)}  ${'█'.repeat(Math.round(v / total * 40))} ${(v / total * 100).toFixed(1)}%`);
});

const otherPct = ((grouped['其他'] || 0) / total * 100).toFixed(1);
console.log(`\n落进「其他」的原始值（占 ${otherPct}%）：`);
console.log(others.length ? '  ' + others.join('、') : '  （无）');
if (Number(otherPct) > 15) {
  console.log('\n  ⚠️ 超过 15% 归不进去，规则该补了 —— 看看上面那些值有没有共同的词。');
} else {
  console.log('\n  ✅ 归类覆盖率可以。剩下的多半是源数据本身就写着「其他未列明」，无解。');
}
console.log();
