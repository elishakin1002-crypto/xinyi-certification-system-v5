/**
 * 知识中心体检 —— 把「打不开的」和「不该在这儿的」列出来。
 *
 * ── 为什么要有（2026-09-13）────────────────────────────────────
 *
 * 金恩来：「我看了一下现在的知识中心里还是有合同的」。
 *
 * 对 —— 我上一轮只删掉了「把合同推进知识中心」那个按钮，
 * **已经推进去的那些还在**。删按钮不等于收拾残局，这是我做了一半。
 *
 * 另外还有一类更隐蔽的：source_url 是 `blob:http://...` 的文档。
 * 那是浏览器临时地址，早就失效了 —— 列表上看着正常，点开是空白。
 *
 * **这个脚本只报告，不删。** 知识中心里的东西是他和同事放进去的，
 * 哪些该留、哪些该重传，是业务判断，不该由我替他决定。
 *
 * 用法：npm run checkup:knowledge
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));

const url = process.env.DATABASE_URL || '';
if (!url) { console.error('\n没有 DATABASE_URL，跳过。\n'); process.exit(0); }

const main = async () => {
  const pool = new Pool({ connectionString: url });
  const { rows } = await pool.query(`
    select id, title, category, ai_visible, coalesce(source_url,'') source_url, updated_at
    from knowledge_docs order by updated_at desc`);
  await pool.end();

  const dead = rows.filter(r => r.source_url.startsWith('blob:'));
  const contracts = rows.filter(r => /合同归档|合同$/.test(String(r.title || '')));
  const noCat = rows.filter(r => !r.category);

  console.log(`\n知识中心共 ${rows.length} 篇\n`);

  const show = (title, list, why) => {
    if (!list.length) { console.log(`✅ ${title}：没有`); return; }
    console.log(`⚠️  ${title}：${list.length} 篇 —— ${why}`);
    list.slice(0, 10).forEach(r => console.log(`      · ${String(r.title || r.id).slice(0, 40)}`));
    if (list.length > 10) console.log(`      …… 还有 ${list.length - 10} 篇`);
    console.log('');
  };

  show('打不开的（地址是 blob 临时链接）', dead,
    '文件从来没真的存下来，点开是空白。只能重新上传。');
  show('像是合同的', contracts,
    '合同的家应该是「合同管理」里那份记录，不是知识中心。全局搜索本来就能同时搜到两边。');
  show('没有分类的', noCat,
    '找不着。补个分类，或者并进已有那几类。');

  console.log('这个脚本只报告不删 —— 哪些该留、哪些该重传，你定。\n');
};
main().catch(e => { console.error('\n❌', e.message, '\n'); process.exit(1); });
