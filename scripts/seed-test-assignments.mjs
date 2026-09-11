#!/usr/bin/env node
/**
 * 测试夹具：按行业把客户/项目/任务的归属分给几位顾问。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么需要这个
 * ══════════════════════════════════════════════════════════════
 *
 * 2026-09-10 生产实测：
 *
 *   项目负责人是真人      3 / 30
 *   任务负责人是真人      9 / 132
 *   客户有归属人          0 / 11
 *   线索有归属人          0 / 455
 *
 * 也就是说，同事明天登录进来：
 *   · 项目管理默认「与我相关」→ 30 个项目里 27 个看不见
 *   · 我的任务 → 132 条里 123 条不属于任何真人
 *   · 客户、线索 → 一条都不属于他
 *
 * **他会看到一片空白，然后得出「这系统没东西」的结论。**
 * 这种测试收回来的不是缺陷，是误判 —— 比不测更糟，因为它会让人
 * 对系统失去信心，而真正的问题一个都没暴露。
 *
 * 所以组织同事测试之前，必须先让数据「有主」。
 *
 * ── 分派规则 ──────────────────────────────────────────────────
 *
 * 按 src/modules/industry.ts 的 12 个行业大类分：
 * 谁负责哪个方向由业务方定，这里只提供**按行业分派**这个动作本身。
 *
 * ⚠️ 这是**测试夹具**，不是业务事实。真实归属只有业务方知道
 *    （谁跟的哪个客户、谁做的哪个项目）。生产上要按真实情况填，
 *    别拿这个脚本的结果当真账 —— 「谁做的」这条链一旦记错，
 *    比空着更糟：空着大家知道要补，记错了没人会去核对。
 *
 * ── 用法 ──────────────────────────────────────────────────────
 *   node scripts/seed-test-assignments.mjs             # 演练，不写库
 *   node scripts/seed-test-assignments.mjs --apply     # 真写
 *
 * 默认只认本机开发库；要跑生产必须显式加 --allow-prod（并且先想清楚）。
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

const url = process.env.DATABASE_URL || '';
if (!url) { console.error('DATABASE_URL 未设置'); process.exit(1); }
const isLocal = /localhost|127\.0\.0\.1/.test(url);
if (!isLocal && !ALLOW_PROD) {
  console.error('这看起来不是本机开发库。要对生产执行请显式加 --allow-prod。');
  process.exit(1);
}

/**
 * 方向 → 人 + 行业大类。
 *
 * 人不是随便挑的，是照《信义在职员工表》里的**岗位职责**对上的
 * （金恩来 2026-09-10 提供，测试人选也是他点的这四位）：
 *
 *   黄佳佳  「主要做食品厂的 SC 认证」        → 食品认证
 *   商春姿  「食包咨询，台账检验，设备校准」  → 食品包装（食包）
 *   黄邦煜  「体系认证」                      → 体系认证
 *   李智薇  「总经理助理」                    → 总助（不分归属，看的是全团队）
 *
 * 第一版我按姓名排序自动挑人，挑出来的三位跟实际方向对不上 ——
 * **专业方向这件事系统里根本没存**（position_tags 十个顾问全是「咨询师」），
 * 所以只能从花名册来。这本身就是个待补的洞，见报告。
 *
 * 行业大类的判定复用 src/modules/industry.ts，不在这里重写一套关键词
 * —— 两套规则一定会漂移。
 */
const DIRECTIONS = [
  { key: '食品认证方向', who: '黄佳佳', groups: ['食品农业'] },
  { key: '食品包装方向', who: '商春姿', groups: ['包装印刷'] },
  { key: '体系认证方向', who: '黄邦煜', groups: ['汽摩配', '金属制品', '机械设备', '科技服务', '塑料橡胶', '电子电气', '纺织服装皮革', '建筑工程', '商贸零售', '其他'] },
];

/** 总助不按行业分归属：她要看的是全团队的交付情况，不是自己的一摊 */
const MANAGER_NAME = '李智薇';

const loadIndustryModule = () => {
  const out = path.join(ROOT, '.runtime/industry.test.cjs');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(path.join(ROOT, 'node_modules/.bin/esbuild'), [
    path.join(ROOT, 'src/modules/industry.ts'),
    '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
  ], { stdio: 'pipe' });
  return require(out);
};

/*
  备份。**备份失败就中止** —— 没有可回退的东西时不许动数据。

  开发机上通常没装 pg_dump（库跑在 Docker 里），所以要能退到
  `docker exec xinyi-dev-db pg_dump`。第一版只试宿主机的 pg_dump，
  直接 ENOENT 中止 —— 中止是对的（总比不备份就写好），
  但对本机开发库来说这个失败完全可以绕开。
*/
const backup = () => {
  const dir = path.join(ROOT, '.runtime/backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pre-test-assign-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);

  const viaHost = () => execFileSync('pg_dump', ['-d', url, '-Fc', '-f', file], { stdio: 'pipe' });
  const viaDocker = () => {
    const out = execFileSync('docker', ['exec', 'xinyi-dev-db', 'pg_dump', '-d', url, '-Fc'], {
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024,
    });
    fs.writeFileSync(file, out);
  };

  try { viaHost(); } catch (hostErr) {
    if (!isLocal) throw hostErr;   // 生产上不猜，老老实实报错
    try { viaDocker(); } catch (dockerErr) {
      throw new Error(`宿主机和 Docker 里都备份不了（${hostErr.message} / ${dockerErr.message}）`);
    }
  }

  const size = fs.statSync(file).size;
  if (size < 10000) throw new Error(`备份只有 ${size} 字节，明显不对，已中止`);
  return { file, size };
};

const main = async () => {
  const { groupIndustry } = loadIndustryModule();
  const pool = new Pool({ connectionString: url });

  const { rows: users } = await pool.query("select id, name, roles::text roles from auth_users where status='active'");
  const byName = new Map(users.map((u) => [u.name, u]));

  // 找不到人就中止。**不许"就近找一个顶上"** —— 归属记错比空着更糟：
  // 空着大家知道要补，记错了没人会去核对。
  const assignment = DIRECTIONS.map((d) => {
    const user = byName.get(d.who);
    if (!user) throw new Error(`花名册里的「${d.who}」在系统里没有账号，已中止`);
    return { ...d, user };
  });
  const manager = byName.get(MANAGER_NAME);
  if (!manager) throw new Error(`找不到总助「${MANAGER_NAME}」的账号，已中止`);

  const { rows: customers } = await pool.query('select id, name, industry from customers');
  const plan = [];
  for (const c of customers) {
    const g = groupIndustry(c.industry);
    const hit = assignment.find((a) => a.groups.includes(g));
    if (hit) plan.push({ customer: c, group: g, to: hit });
  }

  console.log('\n按行业分派（客户 → 顾问）');
  console.log('='.repeat(78));
  for (const a of assignment) {
    const mine = plan.filter((p) => p.to.key === a.key);
    console.log(`\n${a.key}  →  ${a.user.name}   (${mine.length} 家客户)`);
    mine.forEach((m) => console.log(`   · ${m.customer.name}  [${m.customer.industry || '无行业'} → ${m.group}]`));
  }

  if (!APPLY) {
    console.log('\n[演练] 未写库。加 --apply 才真正执行。\n');
    await pool.end();
    return;
  }

  const b = backup();
  console.log(`\n已备份: ${b.file} (${(b.size / 1024 / 1024).toFixed(1)} MB)`);

  let cCount = 0, pCount = 0, tCount = 0;
  for (const { customer, to } of plan) {
    await pool.query('update customers set owner_user_id=$1, updated_at=NOW() where id=$2', [to.user.id, customer.id]);
    cCount += 1;

    // 项目跟着客户走：同一个客户的项目归同一个人，否则「与我相关」会把客户和项目拆散
    const r = await pool.query(
      'update projects set owner_user_id=$1, manager=$2, updated_at=NOW() where customer_id=$3 returning id, tasks',
      [to.user.id, to.user.name, customer.id]
    );
    pCount += r.rowCount;

    for (const proj of r.rows) {
      const tasks = Array.isArray(proj.tasks) ? proj.tasks : [];
      if (!tasks.length) continue;
      // 任务负责人也要落到真人身上，否则「我的任务」还是空的
      const next = tasks.map((t) => ({ ...t, owner: to.user.name }));
      await pool.query('update projects set tasks=$1::jsonb where id=$2', [JSON.stringify(next), proj.id]);
      tCount += next.length;
    }
  }

  console.log(`\n✓ 客户 ${cCount} 家、项目 ${pCount} 个、任务 ${tCount} 条已分派`);

  // 自检：分派完之后，每位顾问是不是真的「看得见东西」
  console.log('\n自检 —— 每位测试人登录后能看到多少：');
  {
    /*
      总助单独验：她不该按归属看，而是看**全团队**。
      如果她那几个数字也是 0，说明问题不在归属分派，在别处。
    */
    const { rows: [m] } = await pool.query(`
      select (select count(*) from projects) 全部项目,
             (select count(*) from projects p, jsonb_array_elements(coalesce(p.tasks,'[]'::jsonb)) t
               where coalesce(t->>'owner','')<>'') 有主任务,
             (select count(*) from project_work_logs) 工作日志`);
    console.log(`  ${Number(m.全部项目) > 0 ? '✅' : '❌'} ${MANAGER_NAME.padEnd(6)} 总助（看全团队）  项目 ${m.全部项目} / 有主任务 ${m.有主任务} / 日志 ${m.工作日志}`);
  }
  for (const a of assignment) {
    const { rows: [r] } = await pool.query(`
      select
        (select count(*) from customers where owner_user_id=$1) 客户,
        (select count(*) from projects  where owner_user_id=$1) 项目,
        (select count(*) from projects p, jsonb_array_elements(coalesce(p.tasks,'[]'::jsonb)) t
          where t->>'owner'=$2) 任务`, [a.user.id, a.user.name]);
    const ok = Number(r.客户) + Number(r.项目) > 0;
    console.log(`  ${ok ? '✅' : '❌'} ${a.user.name.padEnd(6)} ${a.key.padEnd(14)} 客户 ${r.客户} / 项目 ${r.项目} / 任务 ${r.任务}`);
    if (!ok) console.log('     ⚠️ 这位登录后是空的 —— 测试会变成误判，先补数据再叫人测');
  }
  console.log();
  await pool.end();
};

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
