/**
 * 清理知识中心里的坏记录。**改数据前先备份，备份失败就中止。**
 *
 * 清两类：
 *   ① 死链   —— source_url 是 blob:（文件从来没真的存下来，点开是空白）
 *   ② 空壳   —— 标题/正文/文件全空（巡检或导入失败留下的，不是文档）
 *
 * 2026-09-13 金恩来：「死链，直接删了」。
 * 空壳那 25 条是我自己跑巡检时留下的（生产库 0 条，只在本地），
 * 一并清掉。
 *
 * 用法：
 *   npm run clean:knowledge          看要删哪些（不动数据）
 *   npm run clean:knowledge -- --yes 真的删
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
if (!url) { console.error('\n没有 DATABASE_URL。\n'); process.exit(1); }
const doIt = process.argv.includes('--yes');

/** 备份整张表。失败就中止 —— 这条是项目规矩，不是客套。 */
const backup = () => {
  const dir = path.join(ROOT, '.runtime');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `knowledge_docs-备份-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'')}.sql`);
  const buf = execFileSync('docker', ['exec', 'xinyi-dev-db', 'pg_dump', '-d', url, '-t', 'knowledge_docs'],
    { stdio: ['ignore','pipe','pipe'], maxBuffer: 512*1024*1024 });
  if (buf.length < 500) throw new Error(`备份只有 ${buf.length} 字节，明显不对`);
  fs.writeFileSync(file, buf);
  return file;
};

const main = async () => {
  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(`
    select id, coalesce(title,'') title, coalesce(source_url,'') source_url,
           length(coalesce(content,'')) content_len
    from knowledge_docs`);

  const dead = rows.filter(r => r.source_url.startsWith('blob:'));
  const empty = rows.filter(r => !r.title.trim() && Number(r.content_len) === 0);
  const ids = Array.from(new Set([...dead, ...empty].map(r => r.id)));

  console.log(`\n死链 ${dead.length} 条、空壳 ${empty.length} 条，去重后共 ${ids.length} 条：\n`);
  dead.forEach(r => console.log(`  [死链] ${r.title || r.id}`));
  empty.slice(0, 5).forEach(r => console.log(`  [空壳] ${r.id}`));
  if (empty.length > 5) console.log(`  [空壳] …… 还有 ${empty.length - 5} 条`);

  if (!ids.length) { console.log('\n没有要清的。\n'); await pool.end(); return; }
  if (!doIt) { console.log('\n（只是看看。真要删，加 --yes）\n'); await pool.end(); return; }

  const file = backup();
  console.log(`\n已备份 knowledge_docs → ${path.relative(ROOT, file)}`);
  const res = await pool.query('delete from knowledge_docs where id = any($1)', [ids]);
  await pool.end();
  console.log(`✅ 删掉 ${res.rowCount} 条。要还原：psql < ${path.relative(ROOT, file)}\n`);
};
main().catch(e => { console.error('\n❌', e.message, '\n'); process.exit(1); });
