#!/usr/bin/env node
/*
  知识文档补标签：行业、标准、可信层级。

    npm run backfill:tags            看提议 + 体检，不改数据
    npm run backfill:tags -- --apply 采纳提议（自动先备份）

  ── 为什么要补 ────────────────────────────────────────────────
  一份《平阳油茶合作社 SC 认证复盘》同时属于「农业」「SC 标准」「客户复盘」
  「我们的经验」。放进任何**一个**分类都是错的，因为下次找它的人
  可能从任何一个维度进来。多维标签才能让「食品厂做 SC 要注意什么」
  这类问法检索得准。

  ── 可信层级为什么最要紧 ──────────────────────────────────────
  AI 引用时必须分清「标准这么写」和「我们以前这么做」：
    official      外部权威（标准原文、官方文件）—— 可以直接照着答
    ourExperience 公司自己的（复盘、手册、资料）—— 要说「据我们以往经验」
    aiDraft       AI 生成还没人审 —— 只配当提示，不配当依据
  不分层的后果：AI 把一份没人审过的草稿当成公司规定答给客户。
  **越是「记得清楚」的 AI，说错时越有说服力。**

  ── 这个脚本不做什么 ──────────────────────────────────────────
  不自动删重复文档、不自动改 aiVisible。它只**报出来**，删不删由人定——
  删文档是不可逆的，脚本不该替人做这个决定。
*/
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const apply = process.argv.includes('--apply');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

/** 标准号。信义业务上最有区分度的维度，也是同事最常用的检索词 */
const STANDARD_RULES = [
  [/ISO\s*9001/i, 'ISO 9001'],
  [/ISO\s*14001/i, 'ISO 14001'],
  [/ISO\s*45001/i, 'ISO 45001'],
  [/ISO\s*22000/i, 'ISO 22000'],
  [/HACCP/i, 'HACCP'],
  [/\bQS\b|食品相关产品生产许可/, 'QS'],
  [/\bSC\b|食品生产许可/, 'SC'],
  [/BRC/i, 'BRC'],
  [/FSC/i, 'FSC'],
];

/** 行业。先看关联客户的行业，取不到再按标题推 */
const INDUSTRY_RULES = [
  [/制袋|包装|纸品|纸箱|印刷|擦手纸/, '包装装潢及其他印刷'],
  [/塑编|编织袋/, '塑料丝、绳及编织品制造'],
  [/油茶|种植|合作社|农产品/, '农业'],
  [/食品|饮料|烘焙/, '食品制造业'],
  [/数字科技|软件|信息技术/, '其他科技推广服务业'],
  [/机械|设备|仪表|五金/, '通用设备制造业'],
];

const matchAll = (text, rules) => {
  const out = new Set();
  for (const [re, val] of rules) if (re.test(text)) out.add(val);
  return [...out];
};
const matchOne = (text, rules) => {
  for (const [re, val] of rules) if (re.test(text)) return val;
  return '';
};

/**
 * 可信层级。
 * 目前库里没有外部标准原文，所以不会推出 official——
 * 那类文档要人上传时自己标，脚本不该替它升级可信度。
 */
const trustOf = (doc) => {
  const t = String(doc.title || '');
  if (/情报雷达日报|AI\s*生成/i.test(t) || doc.category === 'AI生成') return 'aiDraft';
  if (doc.source === 'ai') return 'aiDraft';
  return 'ourExperience';
};

const main = async () => {
  const url = loadEnv();
  const pool = new pg.Pool({ connectionString: url });
  console.log(`\n${C.b}知识文档补标签${C.x}　${C.d}${maskUrl(url)}${C.x}`);
  console.log(`${C.d}${apply ? '执行模式' : '预演模式（不改数据，加 --apply 才写库）'}${C.x}\n`);

  const { rows: docs } = await pool.query(
    `select id, title, category, source, link_type, link_id,
            coalesce(content,'') content, coalesce(ai_visible,false) ai_visible,
            industry, standards, trust_level
       from knowledge_docs order by title`);

  // 关联客户的行业（比按标题猜可靠）
  const { rows: custs } = await pool.query("select id, name, industry from customers");
  const custById = new Map(custs.map((c) => [c.id, c]));

  // ── 先体检：这些问题标签解决不了，要人决定 ──
  const issues = [];
  const byTitle = new Map();
  for (const d of docs) {
    const key = `${d.title}|${d.content.length}`;
    if (byTitle.has(key)) issues.push(`重复文档：《${d.title}》（${d.content.length} 字）出现在多个分类里`);
    else byTitle.set(key, d);
  }
  for (const d of docs) {
    if (d.content.trim().length === 0) issues.push(`空正文：《${d.title}》—— 是名单/附件还是抽取失败？`);
  }

  if (issues.length) {
    console.log(`${C.y}先看这几处，标签解决不了，要你决定：${C.x}\n`);
    [...new Set(issues)].forEach((i) => console.log(`  ${C.y}!${C.x} ${i}`));
    console.log(`\n  ${C.d}重复文档会在检索时占掉两个位置，把真正相关的挤下去。${C.x}`);
    console.log(`  ${C.d}空正文的文档进不了 AI 语料（服务端已拦），留着只占列表。${C.x}\n`);
  }

  // ── 标签提议 ──
  const plan = [];
  for (const d of docs) {
    const text = `${d.title} ${d.content.slice(0, 500)}`;
    const linkedCust = d.link_type === 'customer' ? custById.get(d.link_id) : null;

    const standards = matchAll(text, STANDARD_RULES);
    const industry = String(linkedCust?.industry || '').trim() || matchOne(text, INDUSTRY_RULES);
    const trust = trustOf(d);

    const needs = (!d.industry && industry) || (!d.standards?.length && standards.length)
      || (!d.trust_level);
    if (!needs) continue;
    plan.push({ id: d.id, title: d.title, industry, standards, trust,
                fromCustomer: Boolean(linkedCust?.industry) });
  }

  if (!plan.length) {
    console.log(`${C.g}✅ 所有文档的标签都齐了。${C.x}\n`);
    await pool.end();
    return;
  }

  console.log(`${C.b}标签提议${C.x}（${plan.length} 份）\n`);
  for (const p of plan) {
    console.log(`  ${p.title.slice(0, 40)}`);
    const bits = [];
    if (p.industry) bits.push(`行业=${p.industry}${p.fromCustomer ? `${C.g}（取自关联客户，可靠）${C.x}` : `${C.d}（按标题推）${C.x}`}`);
    if (p.standards.length) bits.push(`标准=${p.standards.join('、')}`);
    bits.push(`可信=${p.trust === 'aiDraft' ? `${C.y}AI 草稿${C.x}` : '我们的经验'}`);
    console.log(`    ${bits.join('   ')}\n`);
  }

  if (!apply) {
    console.log(`${C.d}行业标「按标题推」的请扫一眼。确认后执行：${C.x}`);
    console.log(`  npm run backfill:tags -- --apply\n`);
    await pool.end();
    return;
  }

  console.log(`${C.d}先备份…${C.x}`);
  const b = spawnSync('npm', ['run', 'backup'], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(`${C.r}⛔ 备份失败，中止。${C.x}`); process.exit(1); }
  console.log(`${C.g}备份完成${C.x}\n`);

  for (const p of plan) {
    await pool.query(
      `update knowledge_docs
          set industry = coalesce(nullif($2,''), industry),
              standards = case when $3::text <> '' then $3::jsonb else standards end,
              trust_level = coalesce(trust_level, $4),
              updated_at = NOW()
        where id = $1`,
      [p.id, p.industry, p.standards.length ? JSON.stringify(p.standards) : '', p.trust]);
  }
  console.log(`${C.g}✅ 已补 ${plan.length} 份文档的标签${C.x}\n`);
  await pool.end();
};

main().catch((e) => { console.error(`\n${C.r}补标签失败：${C.x}`, e.message); process.exit(1); });
