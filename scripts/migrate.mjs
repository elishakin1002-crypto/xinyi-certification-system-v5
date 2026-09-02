#!/usr/bin/env node
// 数据库增量迁移（P0-8）。
//
//   npm run migrate:status         只看状态，不动数据库
//   npm run migrate                应用待执行的迁移（先自动备份）
//   npm run migrate -- --dry-run   打印将要执行什么，不真执行
//   npm run migrate:new 加销售提成字段    生成新迁移文件骨架
//
// 为什么必须有这套东西：
//   原来建表靠 db/init/*.sql + docker 首次启动自动执行。这有两个死穴——
//   ① 腾讯云托管 PG 没有 docker 那套 entrypoint，只能人工登进去跑，跑没跑过没人知道；
//   ② 数据目录非空时 docker 根本不再执行，所以「加一个字段」这种事完全没有承载机制。
//   结果就是改表全靠手连生产库敲 SQL，敲错了只能靠备份救。
//
// 这套机制保证的事：
//   · 每个迁移只执行一次，执行记录落在 schema_migrations 表里；
//   · 已执行过的迁移文件被改动会直接报错——防的是「改了历史，不同环境结构悄悄分叉」；
//   · 每个迁移单独一个事务，失败自动回滚，不留半截状态；
//   · 全局咨询锁，两个部署同时跑也不会互相踩；
//   · 库里有数据时先自动备份再动手。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadEnv, maskUrl, dbNameOf, run, resolvePgTool } from './lib/backupCommon.mjs';

const MIGRATIONS_DIR = path.resolve('db/migrations');
// 任意常数，只要全项目统一即可；用它防止两个部署同时迁移
const LOCK_KEY = 8271993;

const hasFlag = (n) => process.argv.includes(`--${n}`);
const ssl = () => (String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require'
  ? { rejectUnauthorized: false } : undefined);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** 读迁移目录，返回按版本号排序的列表 */
const readMigrations = () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((file) => {
      const m = file.match(/^(\d+)[_-](.+)\.sql$/);
      if (!m) throw new Error(`迁移文件名必须是「数字_描述.sql」：${file}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return {
        version: m[1],
        name: m[2],
        file,
        sql,
        checksum: sha(sql),
        // CREATE INDEX CONCURRENTLY 之类不能放在事务里，用注释标记跳过事务
        noTransaction: /^\s*--\s*migrate:no-transaction/m.test(sql),
      };
    })
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
};

const ensureTable = async (client) => {
  await client.query(`
    create table if not exists schema_migrations (
      version     text primary key,
      name        text not null,
      checksum    text not null,
      applied_at  timestamptz not null default now(),
      duration_ms integer
    )`);
};

/** 库里有没有业务数据——决定要不要强制先备份 */
const hasBusinessData = async (client) => {
  const { rows } = await client.query(`
    select coalesce(sum(n_live_tup), 0)::bigint as rows
      from pg_stat_user_tables
     where relname <> 'schema_migrations'`);
  return Number(rows[0].rows) > 0;
};

const main = async () => {
  const url = loadEnv();
  const statusOnly = hasFlag('status');
  const dryRun = hasFlag('dry-run');
  const skipBackup = hasFlag('skip-backup');

  const files = readMigrations();
  if (files.length === 0) { console.log(`\n${MIGRATIONS_DIR} 下没有迁移文件。\n`); return; }

  const pool = new pg.Pool({ connectionString: url, ssl: ssl() });
  const client = await pool.connect();

  try {
    await ensureTable(client);
    const { rows: appliedRows } = await client.query('select * from schema_migrations');
    const applied = new Map(appliedRows.map((r) => [r.version, r]));

    // 分类：已执行 / 校验和不符 / 待执行 / 文件已丢失
    const tampered = [];
    const pending = [];
    for (const f of files) {
      const a = applied.get(f.version);
      if (!a) pending.push(f);
      else if (a.checksum !== f.checksum) tampered.push({ f, a });
    }
    const orphaned = appliedRows.filter((r) => !files.some((f) => f.version === r.version));

    console.log(`\n数据库：${maskUrl(url)}`);
    console.log(`迁移目录：${MIGRATIONS_DIR}\n`);
    for (const f of files) {
      const a = applied.get(f.version);
      const bad = tampered.find((t) => t.f.version === f.version);
      const mark = bad ? '⚠ 已改动' : a ? '✓ 已执行' : '· 待执行';
      const when = a ? new Date(a.applied_at).toISOString().slice(0, 16).replace('T', ' ') : '';
      console.log(`  ${mark}  ${f.version}  ${f.name.padEnd(34)} ${when}`);
    }
    for (const o of orphaned) console.log(`  ? 记录存在但文件已丢失  ${o.version}  ${o.name}`);

    if (tampered.length) {
      console.error('\n⛔ 以下迁移已执行过，但文件内容被改动了：');
      for (const { f } of tampered) console.error(`   ${f.file}`);
      console.error('\n已执行的迁移是历史，不能改——改了会让各环境的表结构悄悄分叉。');
      console.error('要调整结构请新增一个迁移文件：npm run migrate:new <描述>\n');
      process.exitCode = 1;
      return;
    }

    if (pending.length === 0) { console.log('\n✅ 没有待执行的迁移，结构已是最新。\n'); return; }
    console.log(`\n待执行 ${pending.length} 个迁移。`);
    if (statusOnly) { console.log('（status 模式，不做任何改动）\n'); return; }
    if (dryRun) {
      for (const f of pending) console.log(`\n──── ${f.file} ────\n${f.sql.trim().slice(0, 600)}`);
      console.log('\n（dry-run，未执行）\n');
      return;
    }

    // 有数据就先备份。改表出错时备份是唯一的退路。
    if (!skipBackup && await hasBusinessData(client)) {
      console.log('\n库中已有业务数据，先做一次备份 ...');
      const r = await run(process.execPath, ['scripts/backup.mjs'], { cwd: process.cwd() });
      if (!r.ok) {
        console.error('\n⛔ 备份失败，已中止迁移。修好备份再来，或明确加 --skip-backup 跳过。');
        console.error(r.stderr.slice(0, 500));
        process.exitCode = 1;
        return;
      }
      const dir = String(r.stdout).match(/✅ 备份完成\s+(\S+)/)?.[1];
      console.log(`备份完成${dir ? `：${dir}` : ''}\n`);
    }

    // 咨询锁：两个部署同时跑迁移会互相踩
    const lock = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
    if (!lock.rows[0].ok) {
      console.error('\n⛔ 另一个迁移进程正在运行（拿不到咨询锁），稍后重试。\n');
      process.exitCode = 1;
      return;
    }

    try {
      for (const f of pending) {
        process.stdout.write(`  执行 ${f.version} ${f.name} ... `);
        const t0 = Date.now();
        try {
          // 每个迁移单独一个事务：失败就整个回滚，不留半截结构
          if (!f.noTransaction) await client.query('begin');
          await client.query(f.sql);
          await client.query(
            'insert into schema_migrations (version, name, checksum, duration_ms) values ($1,$2,$3,$4)',
            [f.version, f.name, f.checksum, Date.now() - t0]
          );
          if (!f.noTransaction) await client.query('commit');
          console.log(`完成 (${Date.now() - t0}ms)`);
        } catch (e) {
          if (!f.noTransaction) await client.query('rollback').catch(() => {});
          console.log('失败');
          console.error(`\n⛔ ${f.file} 执行失败，已回滚该迁移：\n   ${e.message}\n`);
          console.error('之前成功的迁移保持已执行状态，修好这个文件后重跑 npm run migrate 即可继续。\n');
          process.exitCode = 1;
          return;
        }
      }
      console.log(`\n✅ ${pending.length} 个迁移全部完成。\n`);
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
    await pool.end();
  }
};

/** 生成新迁移骨架，版本号自动递增 */
const createNew = (desc) => {
  if (!desc) { console.error('用法：npm run migrate:new <描述>，例如 npm run migrate:new 加销售提成字段'); process.exit(1); }
  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  const files = readMigrations();
  const next = String((files.length ? Math.max(...files.map((f) => parseInt(f.version, 10))) : 0) + 1).padStart(3, '0');
  const slug = desc.trim().replace(/\s+/g, '_').replace(/[^\w一-龥-]/g, '');
  const file = path.join(MIGRATIONS_DIR, `${next}_${slug}.sql`);
  fs.writeFileSync(file, `-- ${desc}
-- 生成于 ${new Date().toISOString().slice(0, 10)}
--
-- 注意：
--   1. 这个文件一旦执行过就不能再改（校验和会拦住），要调整请新建一个迁移。
--   2. 尽量写成可重复执行：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS。
--   3. 需要 CREATE INDEX CONCURRENTLY 时，在文件第一行加：-- migrate:no-transaction
--   4. 涉及金额的列注意单位：顶层金额列存「分」，JSONB 内部存「元」，
--      写数据的迁移必须走对应换算，别直接塞数字（这里踩过坑）。

`);
  console.log(`已创建 ${file}`);
};

/**
 * 不连数据库的静态检查，给 CI 用。
 * 能拦住的：文件名不合规、版本号重复、空文件、SQL 里出现整库危险语句。
 * 这些错误如果漏到部署那一刻才发现，代价比在 CI 拦下来大得多。
 */
const lint = () => {
  let files;
  try { files = readMigrations(); }
  catch (e) { console.error(`⛔ ${e.message}`); process.exit(1); }

  const problems = [];
  const seen = new Map();
  for (const f of files) {
    if (seen.has(f.version)) problems.push(`版本号重复：${f.file} 与 ${seen.get(f.version)}`);
    seen.set(f.version, f.file);
    if (!f.sql.replace(/--.*$/gm, '').trim()) problems.push(`${f.file} 除注释外没有任何 SQL`);
    // drop database / truncate 这类整库级破坏不该出现在迁移里
    const danger = f.sql.match(/\b(drop\s+database|drop\s+schema|truncate\s+table)\b/i);
    if (danger) problems.push(`${f.file} 含高危语句「${danger[0]}」，迁移不该做整库级破坏`);

    // 运行器已经把每个文件包在事务里，文件内再开事务会让内层 COMMIT 提前
    // 提交外层，失败时回滚不干净。只看行首语句，注释里提到不算。
    const sqlOnly = f.sql.replace(/--.*$/gm, '');
    const tx = sqlOnly.match(/^\s*(begin|commit|rollback|start\s+transaction)\s*;/im);
    if (tx && !f.noTransaction) {
      problems.push(`${f.file} 自己写了「${tx[1].trim()}」；运行器已管事务，去掉即可`);
    }
  }

  if (problems.length) {
    console.error('\n⛔ 迁移文件检查未通过：');
    problems.forEach((p) => console.error(`   ${p}`));
    console.error('');
    process.exit(1);
  }
  console.log(`✅ 迁移文件检查通过（${files.length} 个：${files.map((f) => f.version).join(', ')}）`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const idx = process.argv.indexOf('--new');
  if (idx > -1) createNew(process.argv.slice(idx + 1).join(' '));
  else if (hasFlag('lint')) lint();
  else main().catch((e) => { console.error('\n迁移失败：', e.message); process.exit(1); });
}
