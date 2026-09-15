#!/usr/bin/env node
/**
 * 上线前数据清理 —— 把走查期间造的测试数据清干净，只留真实线索。
 *
 * ── 为什么（2026-09-14 金恩来下的令）────────────────────────────
 *
 * 「线索的已转化都是假的啊！系统都没有上线，哪里来的真实已转化，
 *   倒是 400 多条数据是真实的，可以保留。其余的删了吧！」
 * 「现在这么多莫名其妙的数据上线后我要怎么解释？会不会对使用者造成误导？」
 *
 * 后一句是理由：同事上线第一天看到的每一条数据都该是真的。
 * 一条解释不清的测试合同，会让人怀疑**整个系统的数据都不可信** ——
 * 这种怀疑一旦形成，后面再干净也挽不回来。
 *
 * ── 留什么、删什么 ─────────────────────────────────────────────
 *
 *   留  455 条线索          天眼查级别的真实数据，重新采集要花钱花时间
 *       21 个账号            「谁做的」这条链不能断
 *   删  12 合同 / 11 客户 / 24 项目 / 工时 / 结算 / 审计问题
 *       8 篇知识文档         4 篇情报日报 + 4 篇 PDCA 复盘，都是自动生成的，
 *                            不是体系母版（逐篇看过）
 *       369 条情报           抓取已经修好，明早 08:55 自动跑一次就有新的
 *       提醒 / 业务事件      都是上面这些的派生物
 *   改  10 条「已转化」线索 → 退回「New」。系统没上线，不可能有真实转化
 *
 * ── 为什么要讲顺序（这只是脚本的事，日常使用没有任何顺序要求）──
 *
 * 这个库**几乎没有外键**（全库只有 auth_sessions → auth_users 一个），
 * 数据库不帮忙保证完整性。先删客户再删合同的话，
 * 合同上的 customer_id 会指向一个不存在的客户，而且**不报错**。
 * 所以按「先删依赖方，再删被依赖方」的顺序来。
 *
 * 外键补上之后（migration 025），这个顺序问题就不存在了 ——
 * 数据库会自己拦住，记错了也删不掉。
 *
 * ── 三件安全措施 ───────────────────────────────────────────────
 *
 *   1. 先整库备份，备份失败就中止（项目铁律）
 *   2. 两处存储一起清 —— 只清关系表的话，前端整份写回就全回来了
 *      （2026-09-13 我就这么栽过一次）
 *   3. 每条删除都写墓碑，删完还能回答「这条是谁在什么时候删的」
 *
 * 用法：
 *   node scripts/clean-pre-launch.mjs            # 只看会删什么，不动手
 *   node scripts/clean-pre-launch.mjs --apply    # 真的执行
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));

const APPLY = process.argv.includes('--apply');

/**
 * 删除顺序：**先依赖方，后被依赖方**。
 *
 * 数组顺序就是执行顺序，改动这里要想清楚谁指向谁。
 * 每一项：[表名, 说明, 可选的 where 条件]
 */
const DELETE_ORDER = [
  ['audit_issues', '不符合项（指向合同/客户/项目）'],
  ['project_work_logs', '工作日志（指向项目）'],
  ['settlements', '顾问结算（指向项目）'],
  ['reminders', '提醒（指向所有业务对象）'],
  /*
    ── business_events 不删（2026-09-14 第一次跑就被自己的保护挡住了）──

    我原本把它列进了删除清单，执行时被数据库触发器拦下：
        「责任记录只能追加，不能修改或删除（表 business_events）」
    整个事务回滚，一条都没删。

    **这个拦截是对的，该改的是我的清单。**
    这个项目的第一条铁律就是「谁做的这条链不能断」——
    business_events 记的是「谁在什么时候做了什么、谁被拒了什么」，
    它不是业务数据，是责任凭据。走查期间的操作也是真实发生过的操作。

    留着的代价：113 条事件会指向已经删掉的合同/项目。
    但那正是审计流水该有的样子 —— 它记录的是**当时发生了什么**，
    而不是**现在还剩什么**。真要追查「那份测试合同当时是谁建的」，
    这是唯一的线索。
  */
  ['projects', '项目（指向客户）'],
  ['contracts', '合同（指向客户）'],
  ['customers', '客户'],
  ['knowledge_docs', '知识文档（4 篇情报日报 + 4 篇 PDCA 复盘，都是自动生成的）'],
  ['market_signals', '情报信号（抓取已修好，明早自动跑一次就有新的）'],
  ['ai_proposals', 'AI 提案'],
  ['strategic_tasks', '战略任务'],
];

/** 要写墓碑的（有删除路径、会被前端整份写回的那些） */
const TOMBSTONE_TYPES = {
  contracts: 'contract',
  customers: 'customer',
  projects: 'project',
  knowledge_docs: 'knowledge',
};

/** 对应的状态库 key —— 关系表清了，这边不清等于白干 */
const STATE_KEYS = [
  'contracts_v8', 'customers_v8', 'projects_v8', 'knowledge_docs_v8',
  'reminders_v8', 'project_work_logs_v1', 'settlements_v8',
  'audit_issues_v1', 'market_signals_v1',
];

const backup = () => {
  const dir = path.join(ROOT, '.runtime/backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `pre-launch-clean-${stamp}.dump`);
  const url = process.env.DATABASE_URL || process.env.XINYI_DB_URL;
  /*
    ── pg_dump 可能不在本机，但在 Docker 容器里（2026-09-15）────────

    金恩来让我清本机数据时撞上：`spawnSync pg_dump ENOENT`。
    他的 Mac 上没装 PostgreSQL 客户端 —— 数据库跑在 Docker 里，
    pg_dump 在容器里（/usr/local/bin/pg_dump）。

    脚本当时**正确地中止了**（备份失败就不许删，这条铁律起了作用），
    但只报「ENOENT」对人毫无帮助 —— 他不知道该装什么、还是该换个跑法。

    所以先试本机的 pg_dump，没有就走容器。两条都不行才中止，
    并且告诉他具体怎么办。
  */
  const dumpViaDocker = () => {
    const container = process.env.XINYI_DB_CONTAINER || 'xinyi-dev-db';
    // 容器里连自己：把 host 换成 localhost（容器内的视角）
    const inner = url.replace(/@[^/]+\//, '@localhost/');
    const buf = execFileSync('docker', ['exec', container, 'pg_dump', '-Fc', inner], {
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 512
    });
    fs.writeFileSync(file, buf);
  };

  let how = '';
  try {
    execFileSync('pg_dump', ['-Fc', '-f', file, url], { stdio: 'pipe' });
    how = '本机 pg_dump';
  } catch (localErr) {
    try {
      dumpViaDocker();
      how = 'Docker 容器里的 pg_dump';
    } catch (dockerErr) {
      console.error('\n❌ 备份失败，中止。删数据之前必须有备份 —— 这是这个项目的铁律。\n');
      console.error('   本机 pg_dump：', String(localErr.message).slice(0, 120));
      console.error('   容器 pg_dump：', String(dockerErr.message).slice(0, 120));
      console.error('\n   两条路都不通，二选一：');
      console.error('     · 确认数据库容器在跑：docker start xinyi-dev-db');
      console.error('     · 或者本机装一个客户端：brew install libpq && brew link --force libpq\n');
      process.exit(1);
    }
  }
  console.log(`（备份用的是${how}）`);
  const size = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(`✅ 已备份：${file}（${size} MB）\n`);
  return file;
};

const main = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.XINYI_DB_URL });

  console.log('\n上线前数据清理' + (APPLY ? '（真的执行）' : '（试算，不动手）'));
  console.log('='.repeat(64));

  // ── 先看清楚会删什么 ──
  console.log('\n【会删除】');
  let total = 0;
  for (const [table, label] of DELETE_ORDER) {
    try {
      const { rows: [r] } = await pool.query(`select count(*)::int n from ${table}`);
      total += r.n;
      console.log(`  ${String(r.n).padStart(5)} 条  ${table.padEnd(20)} ${label}`);
    } catch { console.log(`  ????? 条  ${table.padEnd(20)} （表不存在，跳过）`); }
  }

  const { rows: [ld] } = await pool.query(
    `select count(*)::int total, count(*) filter (where lead_status='Converted')::int converted from leads`);
  console.log('\n【会保留】');
  console.log(`  ${String(ld.total).padStart(5)} 条  leads                线索（真实数据）`);
  const { rows: [au] } = await pool.query('select count(*)::int n from auth_users');
  console.log(`  ${String(au.n).padStart(5)} 个  auth_users           账号（「谁做的」这条链不能断）`);

  console.log('\n【会改】');
  console.log(`  ${String(ld.converted).padStart(5)} 条  线索「已转化」→「New」（系统没上线，不可能有真实转化）`);

  if (!APPLY) {
    console.log(`\n合计会删 ${total} 条。确认无误后加 --apply 执行。\n`);
    await pool.end();
    return;
  }

  // ── 真执行：先备份 ──
  console.log('');
  backup();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /*
      1. 先给要删的对象立墓碑 —— 必须在删之前，删完就查不到 id 了。
         墓碑让这些记录**在架构上回不来**：万一哪个同事的浏览器里
         还缓存着旧数组，整份写回时会被墓碑挡掉。
    */
    let tombs = 0;
    for (const [table, entityType] of Object.entries(TOMBSTONE_TYPES)) {
      const r = await client.query(
        `INSERT INTO deleted_records (entity_type, entity_id, deleted_by_name, reason)
         SELECT $1, id, '金恩来', '上线前清理走查期间的测试数据' FROM ${table}
         ON CONFLICT (entity_type, entity_id) DO NOTHING`, [entityType]);
      tombs += r.rowCount;
    }
    console.log(`立墓碑 ${tombs} 块（这些 id 以后不会被写回来）`);

    // 2. 按顺序删关系表
    for (const [table, label] of DELETE_ORDER) {
      try {
        const r = await client.query(`DELETE FROM ${table}`);
        console.log(`  删 ${String(r.rowCount).padStart(5)} 条  ${table.padEnd(20)} ${label}`);
      } catch (e) {
        console.log(`  ⚠️  ${table} 删除失败：${e.message.slice(0, 120)}`);
        throw e;   // 中途失败就整体回滚，不留半拉子状态
      }
    }

    // 3. 线索「已转化」退回「New」
    const lr = await client.query(
      `update leads set lead_status='New', updated_at=NOW() where lead_status='Converted'`);
    console.log(`  改 ${String(lr.rowCount).padStart(5)} 条  leads                「已转化」→「New」`);

    /*
      4. 状态库同步清空。

         **只清关系表的话，前端下次整份写回就全回来了。**
         2026-09-13 我就是只删了一半还向金恩来报告「已删除」，
         那 6 条一直躺在状态库里等着被写回来。
    */
    for (const key of STATE_KEYS) {
      await client.query(
        `update app_state_latest set dataset_value='[]'::jsonb, updated_at=NOW() where dataset_key=$1`, [key]);
    }
    console.log(`  清空状态库 ${STATE_KEYS.length} 个数据集`);

    await client.query('COMMIT');
    console.log('\n✅ 清理完成，已提交。');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n❌ 出错，已整体回滚，一条都没删：', e.message, '\n');
    process.exitCode = 1;
  } finally {
    client.release();
  }

  // ── 收尾对账 ──
  console.log('\n【清理后】');
  for (const [table] of [...DELETE_ORDER, ['leads'], ['auth_users']]) {
    try {
      const { rows: [r] } = await pool.query(`select count(*)::int n from ${table}`);
      console.log(`  ${String(r.n).padStart(5)} 条  ${table}`);
    } catch { /* 跳过 */ }
  }
  console.log('');
  await pool.end();
};

main().catch((e) => {
  console.error('\n❌ 脚本本身出错（不代表数据有问题）：', e.message, '\n');
  process.exit(2);
});
