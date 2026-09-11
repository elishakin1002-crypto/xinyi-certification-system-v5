#!/usr/bin/env node
/**
 * 按服务类型回填项目/客户的归属人。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么是「按服务类型」而不是「谁跟哪个客户」
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来 2026-09-10：「客户不是根据服务类型确定及分配的吗？」
 *
 * 对的，而且这条规则可推导 —— 服务类型定了，负责人就定了，
 * 不需要谁去维护一张会过期的对照表。
 * 我之前按「谁跟哪个客户」去问，那是销售式归属，不是信义的分法。
 *
 * ── 这件事为什么非做不可 ──────────────────────────────────────
 *
 * 生产实测（2026-09-10）：
 *   项目负责人是真人  3 / 30
 *   客户有归属人      0 / 11
 *
 * 后果有两层：
 *   ① 同事登录进来，「与我相关」是空的 —— 测试会变成误判
 *   ② **建议负责人的最强信号失效** —— 那条信号是「这家客户的这类服务
 *      以前是谁做的」，没有历史就没有「以前」。拿生产数据实测，
 *      「老客户续期」和「新客户」给出一模一样的结果。
 *
 * ── 服务类型从哪来 ────────────────────────────────────────────
 *
 * 按可靠性排，取第一个认得出的：
 *   ① 关联合同的 service_line —— 最可靠，是人填的业务字段
 *   ② 项目服务项的 name
 *   ③ 项目名
 *   ④ 客户的 last_project_type
 *
 * 之所以要四个来源轮着试：服务项名称有一大半是项目名
 * （默认服务项拿项目名命名），单靠它认不出多少。
 *
 * ── 不做的事 ──────────────────────────────────────────────────
 *
 * · **已经有真人负责人的不动** —— 那是事实，不是待填的空
 * · **走第三方的不派内部人**（医疗器械、饲料添加剂）
 * · **认不出服务类型的不猜** —— 列出来让人工定，宁可留空
 *
 * 用法：
 *   node scripts/backfill-owner-by-service.mjs                        # 演练
 *   node scripts/backfill-owner-by-service.mjs --apply                # 写本地库
 *   node scripts/backfill-owner-by-service.mjs --apply --allow-prod   # 写生产
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const urlArg = (process.argv.find((a) => a.startsWith('--url=')) || '').split('=')[1];
const url = urlArg || process.env.DATABASE_URL || '';
if (!url) { console.error('DATABASE_URL 未设置'); process.exit(1); }
const isLocal = /localhost|127\.0\.0\.1/.test(url);
if (!isLocal && !ALLOW_PROD) {
  console.error('这看起来不是本机开发库。要对生产执行请显式加 --allow-prod。');
  process.exit(1);
}

const bundle = (src, out) => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(path.join(ROOT, 'node_modules/.bin/esbuild'),
    [path.join(ROOT, src), '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`], { stdio: 'pipe' });
  return require(out);
};
const { groupServiceLine, isOutsourced, SERVICE_OWNERS } = bundle('src/modules/serviceLine.ts', path.join(ROOT, '.runtime/sl.backfill.cjs'));

const backup = () => {
  const dir = path.join(ROOT, '.runtime/backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pre-owner-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  const viaHost = () => execFileSync('pg_dump', ['-d', url, '-Fc', '-f', file], { stdio: 'pipe' });
  const viaDocker = () => {
    const out = execFileSync('docker', ['exec', 'xinyi-dev-db', 'pg_dump', '-d', url, '-Fc'],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
    fs.writeFileSync(file, out);
  };
  try { viaHost(); } catch (e) {
    if (!isLocal) throw e;          // 生产上不猜，老老实实报错
    viaDocker();
  }
  const size = fs.statSync(file).size;
  if (size < 10000) throw new Error(`备份只有 ${size} 字节，明显不对，已中止`);
  return { file, size };
};

const main = async () => {
  const pool = new Pool({ connectionString: url });

  const { rows: users } = await pool.query(
    "select id, name from auth_users where status='active' and roles::text like '%CONSULTANT%' and name not like '预览%'"
  );
  const byName = new Map(users.map((u) => [u.name, u]));
  const realNames = new Set(users.map((u) => u.name));

  const { rows: projects } = await pool.query(`
    select p.id, p.name, p.customer_id, p.manager, p.owner_user_id, p.contract_ref,
           p.service_items, c.service_line, cu.last_project_type
      from projects p
      left join contracts c on c.id = p.contract_ref
      left join customers cu on cu.id = p.customer_id`);

  /** 服务类型按可靠性依次取，第一个认得出的胜出；同时记下是从哪认出来的 */
  const resolveService = (p) => {
    const items = Array.isArray(p.service_items) ? p.service_items.map((si) => String(si?.name || '')) : [];
    const sources = [
      ['合同服务类型', p.service_line],
      ...items.map((n) => ['服务项名称', n]),
      ['项目名', p.name],
      ['客户最近服务', p.last_project_type],
    ];
    for (const [from, text] of sources) {
      if (!text) continue;
      const g = groupServiceLine(text);
      if (g !== '未分类') return { group: g, from, text };
    }
    return { group: '未分类', from: null, text: null };
  };

  const plan = [];
  const skipped = { 已有真人: [], 走第三方: [], 认不出: [], 无人对应: [] };

  for (const p of projects) {
    if (realNames.has(String(p.manager || '').trim()) && p.owner_user_id) {
      skipped.已有真人.push(p); continue;
    }
    const { group, from, text } = resolveService(p);
    if (group === '未分类') { skipped.认不出.push({ p }); continue; }
    if (isOutsourced(group)) { skipped.走第三方.push({ p, group }); continue; }
    const owner = (SERVICE_OWNERS[group] || [])[0];
    const user = owner ? byName.get(owner) : null;
    if (!user) { skipped.无人对应.push({ p, group }); continue; }
    plan.push({ p, group, from, text, user });
  }

  const pad = (s, n) => { const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0); return String(s) + ' '.repeat(Math.max(0, n - w)); };

  /*
    标题要说清在动哪个库。

    2026-09-11 实测到一个危险的误标：在**服务器上**跑时，
    DATABASE_URL 指向的是服务器本机的 postgres，于是 isLocal 为真，
    标题打出「本机开发库」—— 而它动的是生产。

    安全提示说谎比没有提示更糟：它会让人放心地按下 --apply。
    所以判据改成**意图**（有没有加 --allow-prod），不是 URL 长什么样。
  */
  console.log(`\n按服务类型回填归属 —— ${ALLOW_PROD ? '⚠️⚠️ 生产库（--allow-prod）' : '本机开发库'}`);
  console.log('='.repeat(86));
  console.log(`项目总数 ${projects.length}　可回填 ${plan.length}　已有真人 ${skipped.已有真人.length}　`
    + `走第三方 ${skipped.走第三方.length}　认不出 ${skipped.认不出.length}　无人对应 ${skipped.无人对应.length}\n`);

  const byOwner = new Map();
  plan.forEach((x) => { const k = x.user.name; byOwner.set(k, [...(byOwner.get(k) || []), x]); });
  [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([name, items]) => {
    console.log(`${name}  ${items.length} 个项目`);
    items.forEach((x) => console.log(`   · ${pad(x.p.name.slice(0, 34), 36)} [${pad(x.group, 12)} ← ${x.from}]`));
  });

  if (skipped.认不出.length) {
    console.log(`\n认不出服务类型，需人工指定（${skipped.认不出.length} 个）：`);
    skipped.认不出.slice(0, 12).forEach(({ p }) => console.log(`   · ${p.name.slice(0, 50)}`));
  }
  if (skipped.走第三方.length) {
    console.log(`\n走第三方合作，不派内部人（${skipped.走第三方.length} 个）：`);
    skipped.走第三方.forEach(({ p, group }) => console.log(`   · ${p.name.slice(0, 44)} [${group}]`));
  }

  if (!APPLY) {
    console.log('\n[演练] 未写库。加 --apply 才真正执行。\n');
    await pool.end();
    return;
  }

  const b = backup();
  console.log(`\n已备份: ${b.file} (${(b.size / 1024 / 1024).toFixed(1)} MB)`);

  let pn = 0, tn = 0, cn = 0;
  for (const { p, user } of plan) {
    await pool.query('update projects set manager=$1, owner_user_id=$2, updated_at=NOW() where id=$3',
      [user.name, user.id, p.id]);
    pn += 1;

    /*
      任务负责人也要落到真人身上，否则「我的任务」还是空的。
      **只改没有真人负责人的那些** —— 已经派给具体某人的任务是事实，不能覆盖。
    */
    const { rows: [row] } = await pool.query('select tasks from projects where id=$1', [p.id]);
    const tasks = Array.isArray(row?.tasks) ? row.tasks : [];
    if (tasks.length) {
      const next = tasks.map((t) => (realNames.has(String(t?.owner || '').trim()) ? t : { ...t, owner: user.name }));
      const changed = next.filter((t, i) => t.owner !== tasks[i]?.owner).length;
      if (changed) {
        await pool.query('update projects set tasks=$1::jsonb where id=$2', [JSON.stringify(next), p.id]);
        tn += changed;
      }
    }

    // 客户归属跟着项目走：同一客户由做过他项目的人负责
    if (p.customer_id) {
      const r = await pool.query(
        "update customers set owner_user_id=$1, updated_at=NOW() where id=$2 and coalesce(owner_user_id,'')=''",
        [user.id, p.customer_id]);
      cn += r.rowCount;
    }
  }

  console.log(`\n✓ 项目 ${pn} 个、任务 ${tn} 条、客户 ${cn} 家已回填`);

  const { rows: [v] } = await pool.query(`
    select (select count(*) from projects where owner_user_id is not null and owner_user_id<>'') 有主项目,
           (select count(*) from projects) 项目总数,
           (select count(*) from customers where owner_user_id is not null and owner_user_id<>'') 有主客户,
           (select count(*) from customers) 客户总数`);
  console.log(`\n自检：项目 ${v.有主项目}/${v.项目总数} 有主　客户 ${v.有主客户}/${v.客户总数} 有主\n`);
  await pool.end();
};

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
