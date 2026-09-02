#!/usr/bin/env node
/*
  客户行业补录。

    npm run backfill:industry            看提议，不改数据
    npm run backfill:industry -- --apply 采纳提议写库（自动先备份）

  ── 为什么需要 ────────────────────────────────────────────────
  11 个客户里 8 个行业是空的，所以财务工作台的「回款来源行业分布」
  永远显示「未分类 100%」。对一家按行业做认证的公司，
  这个维度填上才有意义——哪个行业的单最赚钱、哪个行业回款最慢。

  ── 取值从哪来 ────────────────────────────────────────────────
  分类口径**沿用线索表里已有的行业值**（455 条线索全部有行业，
  用的是国民经济行业分类的标准名称，像「包装装潢及其他印刷」
  「塑料丝、绳及编织品制造」，应该是从工商数据导入时带进来的）。
  另起一套分类会导致同一个行业在两处叫不同名字，统计时对不上。

  ── 这里不做什么 ──────────────────────────────────────────────
  **不查外部工商接口。** 那能拿到权威的登记行业，但意味着把客户名单
  发给第三方。要不要这么做是业务方的决定，不是脚本该替他做的。
  需要的话另说，接口是现成的。

  所以这里只按公司名提议，**每一条都要人确认**。提议错了改一下就行，
  但不能不看就写进去——行业字段会进统计、进分析、进将来的定价判断。
*/
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const apply = process.argv.includes('--apply');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

/*
  按公司名里的关键词提议行业。
  关键词 → 行业名，行业名必须是线索表里已经在用的取值，不能自造。
  匹配不上的留空，交给人填——**宁可空着也不猜**。
*/
const RULES = [
  [/制袋|包装|纸品|纸箱|印刷/, '包装装潢及其他印刷'],
  [/塑编|编织袋|塑料.*编织/, '塑料丝、绳及编织品制造'],
  [/塑料|塑胶/, '塑料零件及其他塑料制品制造'],
  [/食品|饮料|烘焙|粮油/, '食品制造业'],
  [/农产品|种植|合作社|油茶|茶叶/, '农业'],
  [/汽车|车业|零部件/, '汽车零部件及配件制造'],
  [/科技|数字|软件|信息/, '其他科技推广服务业'],
  [/机械|设备|仪表|五金/, '通用设备制造业'],
  [/生物|医药|药业/, '医药制造业'],
];

const propose = (name) => {
  for (const [re, industry] of RULES) if (re.test(name)) return industry;
  return '';
};

const main = async () => {
  const url = loadEnv();
  const pool = new pg.Pool({ connectionString: url });
  console.log(`\n${C.b}客户行业补录${C.x}　${C.d}${maskUrl(url)}${C.x}`);
  console.log(`${C.d}${apply ? '执行模式' : '预演模式（不改数据，加 --apply 才写库）'}${C.x}\n`);

  // 现有取值，用来核对提议是否落在已有分类里
  const { rows: existing } = await pool.query(
    "select distinct industry from leads where coalesce(nullif(industry,''),'')<>''");
  const known = new Set(existing.map((r) => r.industry));

  const { rows } = await pool.query(
    "select id, name from customers where coalesce(nullif(industry,''),'')='' order by name");

  if (!rows.length) {
    console.log(`${C.g}✅ 所有客户都填了行业。${C.x}\n`);
    await pool.end();
    return;
  }

  const plan = rows.map((r) => ({ ...r, industry: propose(r.name) }));
  const matched = plan.filter((p) => p.industry);
  const unmatched = plan.filter((p) => !p.industry);

  console.log(`${rows.length} 个客户缺行业，按公司名提议如下：\n`);
  for (const p of matched) {
    const inTaxonomy = known.has(p.industry);
    const mark = inTaxonomy ? `${C.g}✓${C.x}` : `${C.y}!${C.x}`;
    console.log(`  ${mark} ${p.name.padEnd(24)} ${C.b}${p.industry}${C.x}`
      + (inTaxonomy ? '' : `  ${C.y}（线索表里没这个取值，确认是否要新增分类）${C.x}`));
  }
  if (unmatched.length) {
    console.log(`\n${C.y}以下按名称推不出来，需要人工填：${C.x}`);
    for (const p of unmatched) console.log(`  ${C.d}−${C.x} ${p.name}`);
  }

  console.log(`\n${C.b}合计${C.x}：可提议 ${matched.length} 个，需人工 ${unmatched.length} 个\n`);

  if (!apply) {
    console.log(`${C.d}这些是**按公司名推的**，不是工商登记数据。请逐条看一眼再决定。${C.x}`);
    console.log(`${C.d}确认无误后执行：${C.x}  npm run backfill:industry -- --apply\n`);
    await pool.end();
    return;
  }

  if (!matched.length) {
    console.log(`${C.y}没有可自动补的，全部需要人工填写。${C.x}\n`);
    await pool.end();
    return;
  }

  console.log(`${C.d}先备份…${C.x}`);
  const b = spawnSync('npm', ['run', 'backup'], { encoding: 'utf8' });
  if (b.status !== 0) {
    console.error(`${C.r}⛔ 备份失败，中止。${C.x}`);
    process.exit(1);
  }
  console.log(`${C.g}备份完成${C.x}\n`);

  for (const p of matched) {
    await pool.query('update customers set industry=$2, updated_at=NOW() where id=$1', [p.id, p.industry]);
  }
  console.log(`${C.g}✅ 已补录 ${matched.length} 个客户的行业${C.x}`);
  if (unmatched.length) {
    console.log(`${C.y}仍有 ${unmatched.length} 个需要在客户档案里手工填。${C.x}`);
  }
  console.log('');
  await pool.end();
};

main().catch((e) => { console.error(`\n${C.r}补录失败：${C.x}`, e.message); process.exit(1); });
