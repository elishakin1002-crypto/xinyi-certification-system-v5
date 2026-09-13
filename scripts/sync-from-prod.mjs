/**
 * 把生产的业务数据同步到本机，让两边一致。
 *
 * 2026-09-13 金恩来：「如果是因为没有删除干净，那就删干净，
 * 我要让本地和云端保持一致」。
 *
 * ── 规矩 ──────────────────────────────────────────────────────
 *
 * · **只往本机写，绝不往生产写。** DATABASE_URL 不是本机地址就中止。
 * · **不动账号表**（auth_users / auth_sessions / auth_audit_logs）——
 *   走查账号的密码是本机设的，同步过来会把人锁在门外（09-11 踩过）。
 * · 先备份本机，备份失败就中止。
 *
 * 用法：
 *   npm run sync:from-prod            看两边差多少（不动数据）
 *   npm run sync:from-prod -- --yes   真的同步
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));

const url = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('\n❌ 拒绝执行：DATABASE_URL 不是本机地址。这个脚本只往本机写。\n');
  process.exit(1);
}
const SSH = ['-i', `${process.env.HOME}/.ssh/id_ed25519_xinyi`, 'ubuntu@124.223.209.102'];
const AUTH_TABLES = ['auth_users', 'auth_sessions', 'auth_audit_logs'];
const doIt = process.argv.includes('--yes');

const prodCount = (t) => {
  try {
    return execFileSync('ssh', [...SSH, `sudo -u postgres psql -d xinyi -t -A -c 'select count(*) from ${t};'`],
      { encoding: 'utf8' }).trim();
  } catch { return '?'; }
};

const main = async () => {
  const pool = new Pool({ connectionString: url });
  const { rows: tbls } = await pool.query(
    `select tablename from pg_tables where schemaname='public' order by tablename`);
  const tables = tbls.map(r => r.tablename)
    .filter(t => !AUTH_TABLES.includes(t) && t !== 'schema_migrations');

  console.log('\n本机 vs 生产：\n');
  const diff = [];
  for (const t of tables) {
    const { rows } = await pool.query(`select count(*) c from "${t}"`);
    const L = String(rows[0].c), P = prodCount(t);
    if (L !== P) diff.push(t);
    console.log(`  ${t.padEnd(24)} 本机 ${L.padStart(5)}  生产 ${P.padStart(5)}  ${L === P ? '一致' : '★ 不一致'}`);
  }
  await pool.end();

  console.log(`\n账号表不参与同步（${AUTH_TABLES.join('、')}）—— 同步过来会把走查密码覆盖掉。\n`);
  if (!diff.length) { console.log('两边已经一致，无需同步。\n'); return; }
  if (!doIt) { console.log('（只是看看。真要同步，加 --yes）\n'); return; }

  // 备份本机
  const dir = path.join(ROOT, '.runtime');
  fs.mkdirSync(dir, { recursive: true });
  const bak = path.join(dir, `本机全库-备份-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'')}.dump`);
  const buf = execFileSync('docker', ['exec', 'xinyi-dev-db', 'pg_dump', '-d', url, '-Fc'],
    { stdio: ['ignore','pipe','pipe'], maxBuffer: 1024*1024*1024 });
  if (buf.length < 10000) throw new Error(`备份只有 ${buf.length} 字节，明显不对`);
  fs.writeFileSync(bak, buf);
  console.log(`已备份本机 → ${path.relative(ROOT, bak)}（${(buf.length/1024/1024).toFixed(1)} MB）`);

  // 从生产导出（排除账号表），灌进本机
  const exclude = AUTH_TABLES.flatMap(t => ['-T', t]);
  console.log('正在从生产导出…');
  const dump = execFileSync('ssh', [...SSH, `sudo -u postgres pg_dump -d xinyi -Fc ${exclude.join(' ')}`],
    { encoding: 'buffer', maxBuffer: 1024*1024*1024 });
  console.log(`导出 ${(dump.length/1024/1024).toFixed(1)} MB，正在灌入本机…`);
  execFileSync('docker', ['exec', '-i', 'xinyi-dev-db', 'pg_restore', '-d', url,
    '--clean', '--if-exists', '--no-owner'],
    { input: dump, stdio: ['pipe','pipe','pipe'], maxBuffer: 1024*1024*1024 });
  console.log(`\n✅ 同步完成。要回到同步前：pg_restore 那份备份。\n`);
};
main().catch(e => { console.error('\n❌', e.message, '\n'); process.exit(1); });
