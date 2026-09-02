/**
 * 把 state store 里已有的不符合项/工作日志/任务模板投影进 PG 关系表（待办 P0-19b）。
 *
 * 投影逻辑本身已经挂在 upsertStateBatch 上，**新写的数据会自动进表**。
 * 但存量不会——它们是在挂钩之前写进 state store 的，
 * 除非有人再改一次那份数据集，否则永远不会被投影。所以要补跑一次。
 *
 * 这个脚本**不改 state store**，只往关系表里写。
 * state store 仍然是读路径的真相，出问题重跑一次即可，没有不可逆的地方。
 *
 * 用法：
 *   node scripts/backfill-relational-projection.mjs           # 预演
 *   node scripts/backfill-relational-projection.mjs --apply   # 真写
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^(XINYI_DB_URL|PGSSLMODE)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const pool = require(path.join(root, 'server/db/pool.js'));
const { getStateBatch } = require(path.join(root, 'server/stateStore.js'));
const { projectToRelational, PROJECTED } = require(path.join(root, 'server/services/relationalProjection.js'));

const apply = process.argv.includes('--apply');
const KEYS = Object.keys(PROJECTED);

const main = async () => {
  const state = await getStateBatch(KEYS);
  const datasets = state?.datasets || {};

  console.log(`\n${apply ? '开始投影' : '预演（不写库）'}\n`);

  const plan = [];
  for (const key of KEYS) {
    const rows = Array.isArray(datasets[key]) ? datasets[key] : [];
    const withId = rows.filter((r) => r && r.id);
    const { rows: cur } = await pool.query(`SELECT count(*)::int n FROM ${PROJECTED[key].table}`);
    plan.push({ key, label: PROJECTED[key].label, table: PROJECTED[key].table, source: rows.length, valid: withId.length, before: cur[0].n });
  }

  for (const p of plan) {
    const skipped = p.source - p.valid;
    console.log(`  ${p.label.padEnd(6)} state store ${String(p.source).padStart(4)} 条 → ${p.table} （现有 ${p.before} 行）` +
      (skipped > 0 ? `  ⚠️ ${skipped} 条没有 id，无法幂等写入，会跳过` : ''));
  }

  if (!apply) {
    console.log('\n确认无误后加 --apply 真正写入。');
    process.exit(0);
  }

  const r = await projectToRelational(datasets);
  if (r.error) {
    console.error('\n❌ 投影失败：', r.error);
    process.exit(1);
  }

  console.log('\n结果：');
  for (const item of r.projected) {
    console.log(`  ${item.label.padEnd(6)} 写入 ${item.upserted} 条` + (item.deleted ? `，清掉 ${item.deleted} 条表里多出来的` : ''));
  }

  console.log('\n复核：');
  for (const key of KEYS) {
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${PROJECTED[key].table}`);
    const src = Array.isArray(datasets[key]) ? datasets[key].filter((x) => x && x.id).length : 0;
    const ok = rows[0].n === src;
    console.log(`  ${ok ? '✅' : '❌'} ${PROJECTED[key].table.padEnd(20)} ${rows[0].n} 行 / state store ${src} 条`);
  }

  process.exit(0);
};

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
