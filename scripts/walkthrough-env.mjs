#!/usr/bin/env node
/**
 * 走查环境 —— 让「随便造假数据、随便删」变成安全的事。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来 2026-09-11：「问题是我自己都没有测过主链路，
 * 怎么能直接上线让同事测呢？」以及「直接填假的数据？假的数据会污染系统吗？」
 *
 * 两个问题其实是同一个：**他缺一个可以放开手脚的环境。**
 *
 * 正规做法是三套环境 dev → staging → prod，测试环境里造多少假数据都无所谓。
 * 信义只有本地和生产两套，但**本地这套完全可以当 staging 用** ——
 * 前提是「搞坏了能一键还原」。没有这一条，人就不敢乱点，
 * 而**不敢乱点的走查是查不出问题的**。
 *
 * ── 这个项目被测试数据坑过 4 次 ────────────────────────────────
 *
 * 迁移 006 / 007 / 014 / 021 都是在清理测试残留。
 * 014 的根因写得很清楚：「测试从来没有独立数据库」。
 * 021 是 2026-09-11 清掉的 6 个 `11111` / `空任务项目`。
 *
 * 所以这个脚本的全部意义是：**把假数据关在本地，并且随时能一键抹掉。**
 *
 * ── 用法 ──────────────────────────────────────────────────────
 *   npm run walkthrough:snapshot   走查前拍一张基线快照
 *   npm run walkthrough:reset      随时回到基线（假数据一扫而空）
 *   npm run walkthrough:status     看基线是什么时候的、现在差了多少
 *
 * ⚠️ 只对本机开发库生效。连到生产会直接拒绝执行 —— 这不是提示，是硬拦。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));

const url = process.env.DATABASE_URL || '';
const BASELINE = path.join(ROOT, '.runtime/walkthrough-baseline.dump');
const META = path.join(ROOT, '.runtime/walkthrough-baseline.json');
const DOCKER_DB = 'xinyi-dev-db';

/*
  硬拦：这个脚本会整库覆盖，连错环境的后果是**把生产抹掉**。
  所以不是「提示一下」，是直接退出。
  这个项目已经因为「测试直连生产库」吃过一次亏（迁移 014）。
*/
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('\n❌ 拒绝执行：DATABASE_URL 不是本机地址。\n');
  console.error('   这个脚本会整库覆盖。连到生产上跑，等于把真实业务数据抹掉。');
  console.error('   走查请在本地做 —— 那正是本地环境存在的意义。\n');
  process.exit(1);
}

const dockerPgDump = () => execFileSync('docker', ['exec', DOCKER_DB, 'pg_dump', '-d', url, '-Fc'],
  { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024 });

const dockerPgRestore = (file) => {
  const buf = fs.readFileSync(file);
  execFileSync('docker', ['exec', '-i', DOCKER_DB, 'pg_restore', '-d', url, '--clean', '--if-exists', '--no-owner'],
    { input: buf, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024 });
};

const counts = async () => {
  const pool = new Pool({ connectionString: url });
  const out = {};
  for (const [k, t] of [['客户', 'customers'], ['线索', 'leads'], ['合同', 'contracts'], ['项目', 'projects'], ['不符合项', 'audit_issues'], ['工作日志', 'project_work_logs']]) {
    try { const { rows } = await pool.query(`select count(*) c from ${t}`); out[k] = Number(rows[0].c); }
    catch { out[k] = null; }
  }
  await pool.end();
  return out;
};

const cmd = process.argv[2] || 'status';

const snapshot = async () => {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  const buf = dockerPgDump();
  if (buf.length < 10000) throw new Error(`快照只有 ${buf.length} 字节，明显不对`);
  fs.writeFileSync(BASELINE, buf);
  const c = await counts();
  fs.writeFileSync(META, JSON.stringify({ at: new Date().toISOString(), size: buf.length, counts: c }, null, 2));
  console.log(`\n✅ 基线已保存  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`\n现在可以放开手脚走查了 —— 建项目、填假数据、传文件、乱点，`);
  console.log(`搞乱了随时 npm run walkthrough:reset 回到这一刻。\n`);
};

const reset = async () => {
  if (!fs.existsSync(BASELINE)) {
    console.error('\n❌ 还没有基线快照。先跑 npm run walkthrough:snapshot\n');
    process.exit(1);
  }
  const before = await counts();
  dockerPgRestore(BASELINE);
  const after = await counts();
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  console.log(`\n✅ 已还原到基线（${meta.at.slice(0, 16).replace('T', ' ')}）\n`);
  for (const k of Object.keys(after)) {
    const d = (before[k] ?? 0) - (after[k] ?? 0);
    console.log(`   ${k.padEnd(6)} ${String(before[k]).padStart(5)} → ${String(after[k]).padStart(5)}  ${d > 0 ? `（清掉 ${d} 条走查数据）` : ''}`);
  }
  console.log('\n⚠️ 页面上可能还留着旧数据 —— 刷新一下浏览器。\n');
};

const status = async () => {
  if (!fs.existsSync(META)) {
    console.log('\n还没有基线快照。走查前先跑：npm run walkthrough:snapshot\n');
    return;
  }
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  const now = await counts();
  console.log(`\n基线时间：${meta.at.slice(0, 16).replace('T', ' ')}   大小 ${(meta.size / 1024 / 1024).toFixed(1)} MB\n`);
  console.log('           基线    现在    差异');
  for (const k of Object.keys(now)) {
    const b = meta.counts[k] ?? 0; const n = now[k] ?? 0; const d = n - b;
    console.log(`  ${k.padEnd(6)} ${String(b).padStart(6)} ${String(n).padStart(7)} ${d === 0 ? '' : `  ${d > 0 ? '+' : ''}${d}`}`);
  }
  console.log('\n差异就是走查期间造出来的数据。npm run walkthrough:reset 一键清掉。\n');
};

const main = { snapshot, reset, status }[cmd];
if (!main) { console.error(`未知命令 ${cmd}，可用：snapshot / reset / status`); process.exit(1); }
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
