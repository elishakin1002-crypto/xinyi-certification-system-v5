/**
 * 数据回溯：看历史版本、比差异、回滚、清理。
 *
 * ── 为什么要有这个 ────────────────────────────────────────────
 * `app_state_history` 里**每一次保存都存了一份完整快照**，
 * 所以任何被覆盖的数据理论上都能翻回去。
 *
 * 但 2026-09-01 之前**没有任何工具在用这张表**。意味着真出事时：
 *   · 要手写 SQL 去翻历史 —— 只有懂数据库的人才干得了
 *   · 而懂的人不在的时候，「理论上能恢复」等于「实际上恢复不了」
 *
 * 保护措施不能只存在于「我在的时候」。
 *
 * 用法：
 *   node scripts/state-history.mjs list                        # 每个数据集有多少版本
 *   node scripts/state-history.mjs versions customers_v8       # 某个数据集的版本列表
 *   node scripts/state-history.mjs diff customers_v8 123 456   # 比两个版本
 *   node scripts/state-history.mjs restore customers_v8 123    # 回滚（会先备份）
 *   node scripts/state-history.mjs prune --keep-days 90        # 清理旧历史
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^(XINYI_DB_URL|DATABASE_URL|PGSSLMODE)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.XINYI_DB_URL,
  ssl: String(process.env.PGSSLMODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined,
});

const argv = process.argv.slice(2);
const cmd = argv[0] || 'list';
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const count = (v) => (Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 1));
const when = (d) => new Date(d).toLocaleString('zh-CN');

const list = async () => {
  const { rows } = await pool.query(`
    SELECT h.dataset_key,
           count(*)::int versions,
           min(h.created_at) first_at,
           max(h.created_at) last_at
      FROM app_state_history h
     GROUP BY 1 ORDER BY 2 DESC`);
  console.log('\n数据集'.padEnd(28) + '版本数'.padStart(7) + '   最早'.padEnd(22) + '最近');
  console.log('─'.repeat(84));
  for (const r of rows) {
    console.log(String(r.dataset_key).padEnd(26) + String(r.versions).padStart(7) + '   ' +
      when(r.first_at).padEnd(21) + when(r.last_at));
  }
  const { rows: t } = await pool.query('SELECT count(*)::int n, pg_size_pretty(pg_total_relation_size(\'app_state_history\')) sz FROM app_state_history');
  console.log(`\n合计 ${t[0].n} 个版本，占 ${t[0].sz}`);
  console.log('清理旧版本：node scripts/state-history.mjs prune --keep-days 90\n');
};

const versions = async (key) => {
  if (!key) { console.error('要指定数据集名，比如 customers_v8'); process.exit(2); }
  const { rows } = await pool.query(`
    SELECT id, created_at, source, actor_user_id, jsonb_typeof(dataset_value) t,
           CASE WHEN jsonb_typeof(dataset_value)='array' THEN jsonb_array_length(dataset_value) ELSE NULL END n
      FROM app_state_history WHERE dataset_key=$1
     ORDER BY created_at DESC LIMIT ${Number(flag('limit', 40))}`, [key]);
  if (rows.length === 0) { console.log(`\n${key} 没有历史记录\n`); return; }

  console.log(`\n${key} 的历史版本（新→旧）\n`);
  console.log('版本号'.padEnd(10) + '时间'.padEnd(22) + '条数'.padStart(6) + '  变化'.padEnd(10) + '来源');
  console.log('─'.repeat(78));
  let prev = null;
  for (const r of rows) {
    const n = r.n === null ? '-' : String(r.n);
    // 按时间倒序排的，所以「变化」是相对**更旧的那一版**
    let delta = '';
    if (prev !== null && r.n !== null) {
      const d = prev - r.n;
      delta = d > 0 ? `+${d}` : (d < 0 ? String(d) : '—');
    }
    prev = r.n;
    console.log(String(r.id).padEnd(10) + when(r.created_at).padEnd(22) + n.padStart(6) + '  ' +
      delta.padEnd(10) + String(r.source || ''));
  }
  console.log(`\n看差异：node scripts/state-history.mjs diff ${key} <旧版本号> <新版本号>`);
  console.log(`回滚：  node scripts/state-history.mjs restore ${key} <版本号>\n`);
};

const load = async (id) => {
  const { rows } = await pool.query('SELECT dataset_key, dataset_value, created_at FROM app_state_history WHERE id=$1', [id]);
  if (!rows[0]) { console.error(`找不到版本 ${id}`); process.exit(2); }
  return rows[0];
};

const diff = async (key, aId, bId) => {
  if (!aId || !bId) { console.error('要给两个版本号'); process.exit(2); }
  const a = await load(aId);
  const b = await load(bId);
  const av = Array.isArray(a.dataset_value) ? a.dataset_value : [];
  const bv = Array.isArray(b.dataset_value) ? b.dataset_value : [];
  const aIds = new Set(av.map((x) => String(x?.id ?? '')));
  const bIds = new Set(bv.map((x) => String(x?.id ?? '')));

  const gone = av.filter((x) => !bIds.has(String(x?.id ?? '')));
  const added = bv.filter((x) => !aIds.has(String(x?.id ?? '')));

  console.log(`\n${key}`);
  console.log(`  版本 ${aId}（${when(a.created_at)}）  ${av.length} 条`);
  console.log(`  版本 ${bId}（${when(b.created_at)}）  ${bv.length} 条\n`);

  const name = (x) => x?.name || x?.customerName || x?.title || x?.company || x?.id || '(无名)';
  if (gone.length) {
    console.log(`❌ 消失了 ${gone.length} 条：`);
    gone.slice(0, 20).forEach((x) => console.log(`   ${String(x?.id || '').padEnd(28)} ${name(x)}`));
    if (gone.length > 20) console.log(`   …另有 ${gone.length - 20} 条`);
  }
  if (added.length) {
    console.log(`\n✅ 新增了 ${added.length} 条：`);
    added.slice(0, 20).forEach((x) => console.log(`   ${String(x?.id || '').padEnd(28)} ${name(x)}`));
    if (added.length > 20) console.log(`   …另有 ${added.length - 20} 条`);
  }
  if (!gone.length && !added.length) console.log('两个版本的记录 id 完全一致（内容可能有改动）');
  console.log('');
};

const restore = async (key, id) => {
  if (!id) { console.error('要指定版本号'); process.exit(2); }
  const v = await load(id);
  if (v.dataset_key !== key) { console.error(`版本 ${id} 属于 ${v.dataset_key}，不是 ${key}`); process.exit(2); }

  const { rows: cur } = await pool.query('SELECT dataset_value FROM app_state_latest WHERE dataset_key=$1', [key]);
  const nowCount = cur[0] ? count(cur[0].dataset_value) : 0;
  const backCount = count(v.dataset_value);

  console.log(`\n把 ${key} 回滚到版本 ${id}（${when(v.created_at)}）`);
  console.log(`  当前 ${nowCount} 条  →  回滚后 ${backCount} 条\n`);

  if (!argv.includes('--apply')) {
    console.log('这是预演。确认后加 --apply 真正回滚。\n');
    return;
  }

  console.log('先做一次全量备份…');
  try {
    execFileSync('npm', ['run', 'backup'], { cwd: root, stdio: 'ignore' });
    console.log('备份完成');
  } catch {
    console.error('\n❌ 备份失败，**中止回滚**。');
    console.error('在没有退路的情况下覆盖数据，是把一个可恢复的问题变成不可恢复的。\n');
    process.exit(1);
  }

  /*
    走 upsertStateBatch 而不是直接 UPDATE：
    那条路会**把当前值也记进历史**，所以回滚本身是可逆的——
    回错了还能再回来。直接改表的话，当前这一版就永远没了。
  */
  const { upsertStateBatch } = require(path.join(root, 'server/stateStore.js'));
  await upsertStateBatch({ [key]: v.dataset_value }, { source: 'state-history-restore', clientId: `restore-from-${id}` });

  const { rows: after } = await pool.query('SELECT dataset_value FROM app_state_latest WHERE dataset_key=$1', [key]);
  console.log(`\n✅ 回滚完成，现在 ${count(after[0].dataset_value)} 条`);
  console.log('（回滚前那一版也已存进历史，回错了还能再回来）\n');
};

const prune = async () => {
  /*
    历史会一直长。现在 1339 条还好，全员用起来之后每天几十次保存，
    一年就是几万条完整快照——每条都是整个数据集的副本。

    保留 90 天：出问题基本在几天内发现，90 天已经很宽。
    真要翻更久以前的，去备份里找。
  */
  const keepDays = Number(flag('keep-days', 90));
  const keepMin = Number(flag('keep-min', 20));
  console.log(`\n清理策略：每个数据集保留最近 ${keepDays} 天，且**至少保留最近 ${keepMin} 个版本**`);
  console.log('（保底条数是为了防止某个数据集很久没改，一清就一个版本都不剩）\n');

  const { rows: before } = await pool.query(
    "SELECT count(*)::int n, pg_size_pretty(pg_total_relation_size('app_state_history')) sz FROM app_state_history");

  const sql = `
    DELETE FROM app_state_history h
     WHERE h.created_at < NOW() - INTERVAL '${keepDays} days'
       AND h.id NOT IN (
         SELECT id FROM (
           SELECT id, row_number() OVER (PARTITION BY dataset_key ORDER BY created_at DESC) rn
             FROM app_state_history
         ) t WHERE t.rn <= ${keepMin}
       )`;

  if (!argv.includes('--apply')) {
    const { rows } = await pool.query(sql.replace('DELETE FROM app_state_history h', 'SELECT count(*)::int n FROM app_state_history h'));
    console.log(`现有 ${before[0].n} 个版本（${before[0].sz}），会删掉 ${rows[0].n} 个。`);
    console.log('确认后加 --apply 真正清理。\n');
    return;
  }

  const r = await pool.query(sql);
  const { rows: after } = await pool.query(
    "SELECT count(*)::int n, pg_size_pretty(pg_total_relation_size('app_state_history')) sz FROM app_state_history");
  console.log(`✅ 删掉 ${r.rowCount} 个版本。现在 ${after[0].n} 个（${after[0].sz}）\n`);
};

const main = async () => {
  try {
    if (cmd === 'list') await list();
    else if (cmd === 'versions') await versions(argv[1]);
    else if (cmd === 'diff') await diff(argv[1], argv[2], argv[3]);
    else if (cmd === 'restore') await restore(argv[1], argv[2]);
    else if (cmd === 'prune') await prune();
    else {
      console.log('\n用法：');
      console.log('  list                          每个数据集有多少版本');
      console.log('  versions <数据集>              版本列表（带条数变化）');
      console.log('  diff <数据集> <旧> <新>         比两个版本，列出消失和新增的记录');
      console.log('  restore <数据集> <版本> --apply 回滚（会先备份）');
      console.log('  prune --keep-days 90 --apply   清理旧版本\n');
    }
  } finally {
    await pool.end();
  }
};

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
