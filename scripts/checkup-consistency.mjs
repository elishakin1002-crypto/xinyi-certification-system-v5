#!/usr/bin/env node
/**
 * 两处存储对账 —— 「删了刷新又回来」这类毛病的体检表。
 *
 * ══════════════════════════════════════════════════════════════
 * 这个项目有两套存储，而且它们会悄悄对不上
 * ══════════════════════════════════════════════════════════════
 *
 *   关系表（contracts / customers / leads / projects / knowledge_docs …）
 *       —— 服务端 repo 层写的，SQL 统计、报表、权限过滤都读它
 *
 *   状态库（app_state_latest 里的 contracts_v8 / leads_v8 … 一整个 JSON 数组）
 *       —— 前端整份读、整份写回的那一份
 *
 * 只有三个数据集配了双向投影（见 relationalProjection.js 的 PROJECTED），
 * **其余的两边各写各的**。于是：
 *
 *   · 后端删了一条合同 → 状态库里还在 → 前端下次整份写回 → **它回来了**
 *     （这就是老注释里那句「后端无删除接口，前端删了刷新又回来」的真身）
 *   · 生产实测：知识文档 关系表 8 篇 / 状态库 14 篇；情报 369 / 349
 *
 * 这个脚本不修，只**照**：把两边逐个数据集摆出来，差在哪、差几条、
 * 哪些 id 只有一边有。金恩来 2026-09-14 说「我先看一轮哪些数据和看板有出入」——
 * 这张表就是那一轮的底稿。
 *
 * 用法：
 *   node scripts/checkup-consistency.mjs              # 本机
 *   DATABASE_URL=... node scripts/checkup-consistency.mjs --verbose   # 列出差异 id
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));

const VERBOSE = process.argv.includes('--verbose');

/**
 * 每个数据集：状态库里的 key ↔ 关系表名。
 *
 * 只列**两边都存**的。像 market_signals 这种状态库里是缓存、
 * 关系表才是正本的，差异是设计使然，列进来只会制造噪音。
 */
const PAIRS = [
  { key: 'contracts_v8', table: 'contracts', label: '合同' },
  { key: 'customers_v8', table: 'customers', label: '客户' },
  { key: 'leads_v8', table: 'leads', label: '线索' },
  { key: 'projects_v8', table: 'projects', label: '项目' },
  { key: 'knowledge_docs_v8', table: 'knowledge_docs', label: '知识文档' },
  { key: 'reminders_v8', table: 'reminders', label: '提醒' },
  { key: 'project_work_logs_v1', table: 'project_work_logs', label: '工作日志' },
  { key: 'settlements_v8', table: 'settlements', label: '结算' },
];

/** 已经配了双向投影的 key —— 这几个对不上才是真 bug，其余的对不上是架构使然 */
const PROJECTED_KEYS = new Set(['audit_issues_v1', 'project_work_logs_v1', 'task_templates_v1']);

const pad = (s, n) => {
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

const main = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log('\n两处存储对账 —— 关系表 ↔ 状态库\n' + '='.repeat(72));

  const rows = [];
  for (const { key, table, label } of PAIRS) {
    let stateIds = null;
    let dbIds = null;
    try {
      const { rows: [r] } = await pool.query(
        'select dataset_value from app_state_latest where dataset_key = $1', [key]);
      const arr = Array.isArray(r?.dataset_value) ? r.dataset_value : [];
      stateIds = new Set(arr.map((x) => String(x?.id || '')).filter(Boolean));
    } catch { /* 这个 key 不存在就当作没有状态库那一份 */ }
    try {
      const { rows: rs } = await pool.query(`select id from ${table}`);
      dbIds = new Set(rs.map((x) => String(x.id)));
    } catch { /* 表不存在 */ }

    if (!stateIds || !dbIds) {
      rows.push({ label, key, table, note: !stateIds ? '状态库里没有这个数据集' : '关系表不存在' });
      continue;
    }
    const onlyState = [...stateIds].filter((id) => !dbIds.has(id));
    const onlyDb = [...dbIds].filter((id) => !stateIds.has(id));
    rows.push({ label, key, table, state: stateIds.size, db: dbIds.size, onlyState, onlyDb, projected: PROJECTED_KEYS.has(key) });
  }

  console.log(`  ${pad('数据集', 12)}${pad('关系表', 8)}${pad('状态库', 8)}${pad('只在状态库', 12)}${pad('只在关系表', 12)}`);
  console.log('  ' + '-'.repeat(60));
  let bad = 0;
  for (const r of rows) {
    if (r.note) { console.log(`  ${pad(r.label, 12)}${r.note}`); continue; }
    const drift = r.onlyState.length + r.onlyDb.length;
    if (drift) bad += 1;
    console.log(`  ${drift ? '❌' : '✅'}${pad(r.label, 10)}${pad(r.db, 8)}${pad(r.state, 8)}${pad(r.onlyState.length, 12)}${pad(r.onlyDb.length, 12)}${r.projected ? '  (已配投影)' : ''}`);
  }

  if (VERBOSE) {
    for (const r of rows) {
      if (r.note || (!r.onlyState?.length && !r.onlyDb?.length)) continue;
      console.log(`\n  ── ${r.label} ──`);
      if (r.onlyState.length) console.log(`     只在状态库（前端看得见、SQL 统计看不见）：${r.onlyState.slice(0, 20).join(', ')}${r.onlyState.length > 20 ? ` …共 ${r.onlyState.length} 条` : ''}`);
      if (r.onlyDb.length) console.log(`     只在关系表（统计算得到、前端刷新后可能被抹掉）：${r.onlyDb.slice(0, 20).join(', ')}${r.onlyDb.length > 20 ? ` …共 ${r.onlyDb.length} 条` : ''}`);
    }
  }

  console.log('\n' + '='.repeat(72));
  if (bad === 0) {
    console.log('✅ 两处存储完全一致。\n');
  } else {
    /*
      这段话是写给"下一个看到这张表的人"的，包括半年后的我自己。
      光报数字，人会以为是统计口径不同；要说清后果，才知道该不该管。
    */
    console.log(`⚠️  ${bad} 个数据集两边对不上。这不是统计口径问题，是两份真实数据：\n`);
    console.log('   · 只在状态库的：前端列表里看得见，但所有 SQL 统计（工作台数字、');
    console.log('     报表、权限范围过滤）都算不到它 —— 「列表有 12 条，统计说 8 条」就是这么来的');
    console.log('   · 只在关系表的：统计算得到，但前端下次整份写回时可能把它抹掉');
    console.log('   · 后端删掉一条而状态库里还在 → **刷新之后它会回来**\n');
    console.log('   根治要把关系表变成唯一事实来源、状态库降级成派生缓存');
    console.log('   （现在只有 3 个数据集配了双向投影，见 relationalProjection.js）。');
    console.log('   加 --verbose 看具体是哪些 id。\n');
    process.exitCode = 1;
  }

  await pool.end();
};

main().catch((e) => {
  console.error('\n❌ 对账脚本自己出错了（不代表数据有问题，先看这条）：', e.message, '\n');
  process.exit(2);
});
