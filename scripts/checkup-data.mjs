#!/usr/bin/env node
/**
 * 上线就绪体检（数据维度）—— 铺开那天，每个模块打开有没有用？
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个，和 npm run checkup 有什么不同
 * ══════════════════════════════════════════════════════════════
 *
 * `npm run checkup` 量的是**代码有没有**（空状态、样例、帮助、手机端）。
 * 但代码齐了不等于能用 —— 2026-09-09 实测：11 个客户，**0 个填了证书到期日**，
 * 而「排跟进提醒」唯一的输入就是到期日，按钮点下去只会说
 * 「排不了 —— 在『证书』那一栏把到期日填上」（pages/Customers.tsx:218 的原话）。
 * 功能是好的，是数据没配齐所以整条复购提醒链空转。
 *
 * 空转的功能比没有功能更伤：人点了一次没反应，就再也不点了。
 *
 * 用法：npm run checkup:data
 *
 * ── 判据怎么定的，以及我在这上面栽过的一次 ────────────────────
 *
 * 每条检查必须回答：**缺了它，哪个功能会空转？**
 * 而且这个答案要**去代码里核实过**，不能凭印象。
 *
 * 第一版我写的是「455 条线索没有跟进人 → 销售打开『与我相关』是空的」。
 * 去查才发现线索页根本没有「与我相关」这个筛选（那是项目页的），
 * 线索的 isMyLead 只喂给一个没有任何地方触发的 dashboardFocus 分支。
 * 也就是说这条**当时并不会坏掉任何东西**，是我把项目页的行为
 * 想当然套到了线索页上。
 *
 * 教训：这张表最大的风险不是漏检，是**报一个听起来很严重的假警**——
 * 它会让人去补一堆当下没用的数据，下次就不信这张表了。
 * 所以每条的 breaks 都要能指到具体文件行，指不到的就降级成「说明」。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(root, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(root, 'node_modules/pg'));

/**
 * 每条：一句 SQL 算出「总数 / 达标数」，外加一句「缺了会怎样」。
 *
 * level 两档，区别是**有没有一个具体功能会因此空转**：
 *   'breaks'  有。低于 warnBelow 就报 ❌，breaks 里要写清是哪个文件哪一行的功能。
 *   'quality' 没有。数据是薄的，但今天不影响任何人用，只报 ⚠️ 不拦上线。
 * 这两档分开，是为了别再出现「听起来很严重的假警」（见文件头）。
 */
const CHECKS = [
  {
    name: '登录凭据不重叠',
    level: 'breaks',
    /*
      同一个字符串不能同时是甲的邮箱和乙的用户名。

      登录判定是 `WHERE lower(email) = $1 OR lower(username) = $1`
      （server/authStore.js）—— 邮箱和用户名共用一个口子。
      2026-09-09 生产上就撞了：admin@xinyi-iso.local 是老板曾云俊的邮箱，
      admin 是系统管理员金恩来的用户名。看着像同一个账号，
      进去的却是**权限最大的那个人**，而且审计记的是他的名字。

      这条查的是「有没有两个人共用一个凭据」，
      不是「有没有人没填邮箱」—— 没填邮箱不影响任何事。
    */
    sql: `with ids as (
            select id, name, lower(email) k from auth_users where coalesce(email,'') <> ''
            union all
            select id, name, lower(username) k from auth_users where coalesce(username,'') <> ''
          )
          select count(*) total,
                 count(*) filter (where cnt = 1) ok
          from (select k, count(distinct id) cnt from ids group by k) t`,
    warnBelow: 1,
    breaks: '两个人共用一个登录凭据 —— 输进去进的是哪个账号说不准，'
      + '而「谁做的」审计链记的是实际进去的那个人',
    fix: '跑 node scripts/split-admin-account.mjs 看它怎么说；它会列出重叠的凭据并给出修法',
  },
  {
    name: '客户有证书到期日',
    level: 'breaks',
    // 光有 certificates 数组不算数 —— 排提醒读的是 expiryDate，空着一样排不出来
    sql: `select count(*) total,
                 count(*) filter (where exists (
                   select 1 from jsonb_array_elements(coalesce(certificates,'[]'::jsonb)) c
                   where coalesce(c->>'expiryDate','') <> ''
                 )) ok
          from customers`,
    warnBelow: 0.6,
    breaks: '「排跟进提醒」（到期前 30/15/7 天）唯一的输入就是到期日。'
      + '没有它，pages/Customers.tsx:218 只会回一句「排不了」—— 而续期是最稳的复购来源',
    fix: '在客户详情的「证书」栏补到期日，一家几十秒',
  },
  {
    name: '收费项目有金额',
    level: 'breaks',
    sql: `select count(*) total, count(*) filter (where coalesce(project_amount,0)>0) ok
          from projects where project_category='Delivery'`,
    warnBelow: 0.7,
    breaks: '没金额的收费项目算不进营收，老板工作台的数字就是错的',
    fix: '在项目里补合同金额',
  },
  {
    name: '项目任务有截止日',
    level: 'breaks',
    sql: `select count(*) total, count(*) filter (where coalesce(t->>'deadline','')<>'') ok
          from projects p, jsonb_array_elements(coalesce(p.tasks,'[]'::jsonb)) t`,
    warnBelow: 0.9,
    breaks: '「我的任务」按 已超期/今天/本周 分栏。没日期的任务排不进任何一栏，也算不进延误率',
    fix: '补截止日期；实在定不了就先给个粗的，好过空着',
  },
  {
    name: '线索有跟进人',
    level: 'quality',
    sql: `select count(*) total, count(*) filter (where coalesce(owner_user_id,'')<>'') ok from leads`,
    warnBelow: 0.5,
    // 核实过：线索页没有「与我相关」筛选（那是项目页的），服务端也不按 owner 收窄，
    // 所以今天谁都看得见全部线索 —— 不算功能空转，算管理上没人认领。
    breaks: '今天不影响谁看得见什么（线索列表对所有人全量可见）。'
      + '问题是 455 条线索没有一条有归属人 —— 谁跟丢了都查不出是谁的',
    fix: '铺开前按行业或区域分给销售；系统里改一次归属，跟进记录才认得出人',
  },
  {
    name: '线索有电话',
    level: 'quality',
    sql: `select count(*) total, count(*) filter (where coalesce(mobile,'')<>'') ok from leads`,
    warnBelow: 0.8,
    breaks: '没号码的线索跟不了 —— 它占着列表位置，却是死的',
    fix: '导入时补齐，或把没号码的标成「暂缓」让它沉下去',
  },
  {
    name: '项目任务有负责人',
    level: 'quality',
    sql: `select count(*) total, count(*) filter (where coalesce(t->>'owner','')<>'') ok
          from projects p, jsonb_array_elements(coalesce(p.tasks,'[]'::jsonb)) t`,
    warnBelow: 0.9,
    // MyTasks 里任务没负责人会退回算项目负责人的，所以不会没人看见 —— 只是责任糊。
    breaks: '不至于没人看见（没负责人的任务会算到项目负责人头上），但责任是糊的',
    fix: '在项目详情里给任务指派负责人',
  },
  {
    name: '客户有归属行业',
    level: 'quality',
    sql: `select count(*) total, count(*) filter (where coalesce(industry,'')<>'') ok from customers`,
    warnBelow: 0.8,
    breaks: '「同行业做过就能复用」靠它。没行业的客户，检索和经验推荐都带不上',
    fix: '客户详情里补，或从工商数据同步',
  },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const rows = [];
for (const c of CHECKS) {
  try {
    const { rows: [r] } = await pool.query(c.sql);
    rows.push({ ...c, total: Number(r.total), ok: Number(r.ok) });
  } catch (e) {
    rows.push({ ...c, total: 0, ok: 0, error: e.message.split('\n')[0] });
  }
}
await pool.end();

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)));

console.log(`\n上线就绪体检（数据）—— ${new Date().toISOString().slice(0, 10)}`);
console.log('='.repeat(70));

const blocking = [];
const thin = [];
rows.forEach((r) => {
  if (r.error) { console.log(`  ${pad(r.name, 18)} ⚠️ 查不了：${r.error}`); return; }
  const rate = r.total === 0 ? 1 : r.ok / r.total;
  const under = r.total > 0 && rate < r.warnBelow;
  // 只有「会让功能空转」那一档才配拿 ❌ —— 假警比漏检更贵
  const flag = r.total === 0 ? '－' : under ? (r.level === 'breaks' ? '❌' : '⚠️') : rate < 1 ? '·' : '✅';
  console.log(`  ${flag} ${pad(r.name, 18)} ${String(r.ok).padStart(4)}/${String(r.total).padEnd(5)} ${(rate * 100).toFixed(0)}%`);
  if (under) (r.level === 'breaks' ? blocking : thin).push(r);
});

if (blocking.length) {
  console.log('\n❌ 这几项会让已经做好的功能空转 —— 空转比没有更伤：');
  console.log('   人点了一次没反应，就再也不点了。\n');
  blocking.forEach((r) => {
    console.log(`  ● ${r.name}（${r.ok}/${r.total}）`);
    console.log(`    会坏掉什么：${r.breaks}`);
    console.log(`    怎么补：${r.fix}\n`);
  });
}
if (thin.length) {
  console.log('⚠️ 这几项今天不影响谁用，但数据是薄的，铺开前值得补：\n');
  thin.forEach((r) => {
    console.log(`  ● ${r.name}（${r.ok}/${r.total}）：${r.breaks}`);
    console.log(`    ${r.fix}\n`);
  });
}
if (!blocking.length && !thin.length) {
  console.log('\n✅ 数据就绪。每个模块打开都有东西可看。\n');
}
