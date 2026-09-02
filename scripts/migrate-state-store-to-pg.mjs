#!/usr/bin/env node
// 把 state_store.json 里的数据搬进 PostgreSQL 的 app_state_latest（P0-19）。
//
//   npm run migrate:state -- --dry-run   只看要搬什么
//   npm run migrate:state                真搬
//
// 背景（根因）：
//   server/stateStore.js 用的是 process.env.DATABASE_URL，
//   而系统其余部分用 XINYI_DB_URL —— **同一个数据库，两个不同的变量名**。
//   DATABASE_URL 从没设过，所以 PG 后端从未初始化，建表语句根本没执行，
//   一切静默回退到 JSON 文件。工作日志 29 条、不符合项、任务模板都困在那里：
//   SQL 查不到、AI 也查不到，而这正是最值钱的沉淀数据。
//
// 顺序很重要：**必须先搬数据、验证通过，再把变量接上**。
// 反过来的话，应用会去读空的 PG 表，看起来就像数据全没了。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const dryRun = process.argv.includes('--dry-run');

const ssl = () => (String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require'
  ? { rejectUnauthorized: false } : undefined);

/** 与 stateStore.js 的建表语句保持一致 —— 那里是 CREATE IF NOT EXISTS，这里补建同样的结构 */
const ensureTables = async (db) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_state_latest (
      dataset_key TEXT PRIMARY KEY,
      dataset_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT, actor_user_id TEXT, client_id TEXT, app_version TEXT
    );`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_state_history (
      id BIGSERIAL PRIMARY KEY,
      dataset_key TEXT NOT NULL,
      dataset_value JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT, actor_user_id TEXT, client_id TEXT, app_version TEXT
    );`);
};

const main = async () => {
  const url = loadEnv();
  const file = [
    path.resolve(process.cwd(), '.runtime/state_store.json'),
    path.resolve(process.cwd(), 'server/state_store.json'),
  ].find(f => fs.existsSync(f));
  if (!file) { console.error('找不到 state_store.json'); process.exit(1); }

  const datasets = JSON.parse(fs.readFileSync(file, 'utf8')).datasets || {};
  const entries = Object.entries(datasets);

  console.log(`\n源文件：${file}`);
  console.log(`目标库：${maskUrl(url)}`);
  console.log(`${dryRun ? '【预演，不写入】' : '【真实写入】'}\n`);

  /*
    只搬应用真正读取的数据集（与 AppContext 的 STATE_SYNC_DATASET_KEYS 一致）。
    文件里还有 98 个 test_probe_* / persistence_probe_* 之类的测试残留，
    照搬进去等于把垃圾也带进生产库。用白名单而不是黑名单——
    黑名单漏一个就带进去了，白名单漏一个只是少搬，能补。
  */
  const ALLOWED = new Set([
    'leads_v8', 'customers_v8', 'contracts_v8', 'projects_v8', 'settlements_v8',
    'reminders_v8', 'audit_issues_v1', 'knowledge_docs_v8', 'market_signals_v1',
    'project_work_logs_v1', 'strategic_insight_v1', 'strategic_tasks_v1',
    'user_profiles_v1', 'current_user_id', 'ai_decision_logs_v1', 'task_templates_v1',
  ]);
  const skipped = entries.filter(([k]) => !ALLOWED.has(k)).length;

  const rows = entries.filter(([k]) => ALLOWED.has(k)).map(([k, v]) => {
    const val = v && v.value !== undefined ? v.value : v;
    const n = Array.isArray(val) ? val.length : (val && typeof val === 'object' ? Object.keys(val).length : 0);
    return { key: k, value: val, count: n, updatedAt: v?.updatedAt || v?.updated_at || null };
  }).filter(r => r.count > 0);

  console.log(`将搬运 ${rows.length} 个数据集；跳过 ${skipped} 个非业务键（测试残留等）：`);
  for (const r of rows.sort((a, b) => b.count - a.count)) {
    console.log(`  ${r.key.padEnd(30)} ${String(r.count).padStart(5)} 条`);
  }

  if (dryRun) { console.log('\n预演结束，未写入任何数据。\n'); return; }

  const pool = new pg.Pool({ connectionString: url, ssl: ssl() });
  const db = await pool.connect();
  try {
    await ensureTables(db);
    await db.query('BEGIN');
    let written = 0;
    for (const r of rows) {
      await db.query(
        `INSERT INTO app_state_latest (dataset_key, dataset_value, updated_at, source)
         VALUES ($1, $2::jsonb, COALESCE($3::timestamptz, NOW()), 'migrated-from-file')
         ON CONFLICT (dataset_key) DO UPDATE
           SET dataset_value = EXCLUDED.dataset_value,
               updated_at = EXCLUDED.updated_at,
               source = EXCLUDED.source`,
        [r.key, JSON.stringify(r.value), r.updatedAt]
      );
      written += 1;
    }
    await db.query('COMMIT');
    console.log(`\n✅ 已写入 ${written} 个数据集`);

    // 逐个回读比对条数——不比对就等于没验证
    console.log('\n=== 回读校验 ===');
    let bad = 0;
    for (const r of rows) {
      // 有的数据集不是数组（如 current_user_id），要按类型取长度
      const { rows: got } = await db.query(
        `SELECT CASE jsonb_typeof(dataset_value)
                  WHEN 'array'  THEN jsonb_array_length(dataset_value)
                  WHEN 'object' THEN (SELECT count(*)::int FROM jsonb_object_keys(dataset_value))
                  ELSE 1 END AS n
           FROM app_state_latest WHERE dataset_key = $1`,
        [r.key]
      );
      const n = got[0]?.n;
      const ok = n === r.count;
      if (!ok) bad += 1;
      console.log(`  ${ok ? '✓' : '✗'} ${r.key.padEnd(30)} 文件 ${r.count} / 库 ${n ?? '读不到'}`);
    }
    console.log(bad === 0
      ? '\n全部一致。现在可以把 DATABASE_URL 接上了。\n'
      : `\n⚠️ ${bad} 个数据集对不上，先别切换。\n`);
    if (bad > 0) process.exitCode = 1;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release(); await pool.end();
  }
};

main().catch((e) => { console.error('\n迁移失败：', e.message); process.exit(1); });
