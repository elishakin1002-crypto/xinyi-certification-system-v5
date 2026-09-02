#!/usr/bin/env node
// 数据体检：把「靠碰巧发现」的数据问题变成每次都能查出来的检查。
//
//   npm run health:data
//
// 每条检查都对应一次真实事故：
//   · 孤儿引用 —— 清理演示数据时只删了 project/customer 类提醒，漏掉 contract/audit，
//     留下 10 条点开跳空的提醒。而且我第一次还把「情报日报」提醒误判成孤儿
//     （它的 link_id 是日期不是信号 id），所以这里改成**枚举实际 link_type 再逐个确认口径**。
//   · 裂脑 —— 不符合项本体写 state_store.json、提醒写 PG，两边不一致；
//     工作日志 29 条在 JSON 里、PG 表是空的。这类问题不查就永远发现不了。
//   · 金额单位 —— 顶层金额列存分、JSONB 内部存元。曾用裸 SQL 往分列写了元的数值，
//     98000 元变成 980 元。
//   · 演示数据残留 —— 上线后混进真实数据里就分不清了。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const ssl = () => (String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require'
  ? { rejectUnauthorized: false } : undefined);

const issues = [];
const notes = [];
const bad = (title, detail, why) => issues.push({ title, detail, why });

/*
  ── 已知并接受的风险 ────────────────────────────────────────────
  上线前不可能把所有问题清零。行业做法是**显式登记并接受**，
  而不是假装不存在（那会让人不再相信告警），也不是让它一直挡着闸门
  （一个永远变不成绿的闸门等于没有闸门）。

  登记一条就要写清三件事：为什么可以带着上线、什么时候重新评估、后果是什么。
  加新条目要有明确理由——这张表变长就是在悄悄降低标准。
*/
const ACCEPTED = [
  {
    match: (i) => i.title === '数据只在状态存储里（没有专表）',
    why: '数据存在 JSONB 里不会丢，读写都正常；缺的是 SQL 统计能力和数据库约束。'
       + '按信义的数据量（工作日志 53 条、不符合项 1 条、任务模板 4 条）不影响使用。',
    revisit: '待办 P0-19：工作日志/不符合项/任务模板建专表。建议上线稳定后一个月内做。',
  },
];

const acceptedOf = (i) => ACCEPTED.find((a) => a.match(i));
const ok = (title, detail) => notes.push({ title, detail });

// link_type → 目标表。语义特殊的显式登记，避免又把日报当孤儿。
const LINK_TARGETS = {
  project: 'projects',
  customer: 'customers',
  contract: 'contracts',
  lead: 'leads',
  audit: 'audit_issues',
  signal: 'market_signals',
  intel: null,   // link_id 是日期（情报雷达日报），不指向具体记录
  system: null,  // 系统通知，无关联对象
};

/** 还没有专用 PG 表的对象，在状态存储里的数据集键。查孤儿时要兜底查这里。 */
const STATE_KEY_BY_TABLE = {
  audit_issues: 'audit_issues_v1',
  project_work_logs: 'project_work_logs_v1',
  task_templates: 'task_templates_v1',
};

const checkOrphans = async (db) => {
  const { rows: types } = await db.query(
    'select link_type, count(*)::int n from reminders group by 1 order by 2 desc');
  for (const { link_type: lt, n } of types) {
    if (!(lt in LINK_TARGETS)) {
      bad('未知的提醒关联类型', `link_type='${lt}'（${n} 条）没在 LINK_TARGETS 里登记`,
        '不登记就没法判断它是不是孤儿——要么补上映射，要么标成 null 说明它不指向记录');
      continue;
    }
    const tbl = LINK_TARGETS[lt];
    if (!tbl) { ok(`提醒 ${lt}`, `${n} 条，按设计不指向具体记录，跳过`); continue; }

    /*
      有些对象**还没有专用 PG 表**，只存在状态存储的 JSONB 里
      （不符合项、工作日志、任务模板，见待办 P0-19）。
      只查 PG 表会把它们全判成孤儿——2026-08-22 就误报过一条
      「不符合项临近截止」的提醒，而它指向的记录在状态存储里好好的。
      所以查不到时要再去状态存储里找一遍，两边都没有才算孤儿。
    */
    const { rows: dangling } = await db.query(
      `select r.link_id from reminders r where r.link_type=$1 and r.link_id is not null
         and not exists (select 1 from ${tbl} x where x.id = r.link_id)`, [lt]);
    let orphans = dangling.map((r) => r.link_id);

    if (orphans.length) {
      const key = STATE_KEY_BY_TABLE[tbl];
      if (key) {
        const { rows: st } = await db.query(
          'select dataset_value from app_state_latest where dataset_key=$1', [key]);
        let v = st[0]?.dataset_value;
        v = (v && !Array.isArray(v) && v.value) ? v.value : v;
        const ids = new Set((Array.isArray(v) ? v : []).map((x) => String(x?.id || '')));
        orphans = orphans.filter((id) => !ids.has(String(id)));
      }
    }

    if (orphans.length > 0) bad('孤儿提醒', `${orphans.length} 条 link_type='${lt}' 指向已不存在的记录（${orphans.slice(0, 3).join('、')}）`,
      '用户点开会跳到空白，且这类记录会一直留在提醒中心');
    else ok(`提醒 ${lt}`, `${n} 条，引用完整`);
  }
};

const checkRefs = async (db) => {
  const cases = [
    ['projects', 'customer_id', 'customers', '项目→客户'],
    ['contracts', 'customer_id', 'customers', '合同→客户'],
    ['audit_issues', 'customer_id', 'customers', '不符合项→客户'],
    ['knowledge_docs', 'link_id', null, '知识文档→关联对象'],
  ];
  for (const [tbl, col, target, label] of cases) {
    if (!target) continue;
    const { rows } = await db.query(
      `select count(*)::int n from ${tbl} t where t.${col} is not null and t.${col} <> ''
         and not exists (select 1 from ${target} x where x.id = t.${col})`);
    if (rows[0].n > 0) bad('悬空引用', `${label}：${rows[0].n} 条指向不存在的记录`, '级联统计会算错，页面上会显示「未关联」或空白');
    else ok(label, '引用完整');
  }
  // 项目的 contract_ref 是多态字段（CT-xxx / LEAD: / INTEL: / CUST: / 无关联），
  // 只有 CT- 开头的才应该能在合同表里找到
  const { rows } = await db.query(
    `select count(*)::int n from projects p where p.contract_ref like 'CT-%'
       and not exists (select 1 from contracts c where c.id = p.contract_ref)`);
  if (rows[0].n > 0) bad('悬空引用', `项目→合同：${rows[0].n} 条 contract_ref 以 CT- 开头但合同不存在`, '项目详情里的回款明细会整块消失');
  else ok('项目→合同', '引用完整');
};

const checkMoneyUnits = async (db) => {
  // 顶层金额列存「分」。真实合同最小也是几千元 = 几十万分。
  // 值小于 10000 分（100 元）的高度可疑：多半是把元当成分写进去了。
  const cases = [['contracts', 'amount', '合同金额'], ['projects', 'project_amount', '项目金额'], ['customers', 'total_amount', '客户累计额']];
  for (const [tbl, col, label] of cases) {
    const { rows } = await db.query(
      `select count(*)::int n from ${tbl} where ${col} is not null and ${col} > 0 and ${col} < 10000`);
    if (rows[0].n > 0) bad('金额单位可疑', `${label}（${tbl}.${col}）有 ${rows[0].n} 条小于 100 元`,
      '该列存的是「分」。疑似把元直接写进去了——写数据必须走 repo 层换算，不能用裸 SQL');
    else ok(label, '单位正常（无异常小值）');
  }
  // 回款合计不应超过合同金额
  const { rows: over } = await db.query(`
    select count(*)::int n from (
      select c.id, c.amount,
             (select coalesce(sum((r->>'amount')::numeric), 0) from jsonb_array_elements(coalesce(c.receivables,'[]'::jsonb)) r
               where r->>'status' = 'paid') * 100 as paid_fen
        from contracts c) t
     where t.amount > 0 and t.paid_fen > t.amount`);
  if (over[0].n > 0) bad('回款超过合同金额', `${over[0].n} 份合同的已到账合计超过合同总额`, '要么合同金额录错，要么回款节点重复');
  else ok('回款合计', '未超过合同金额');
};

const checkDemoLeftovers = async (db) => {
  const patterns = ['PROJ-DEMO-%', 'CUST-DEMO-%', 'CONT-DEMO-%', 'LEAD-DEMO-%', 'proj-cert-%', 'cust-cert-%', 'doc-cert-%', 'CT-2025-%'];
  const tables = ['projects', 'customers', 'contracts', 'leads', 'knowledge_docs', 'settlements'];
  let total = 0;
  const hits = [];
  for (const t of tables) {
    for (const p of patterns) {
      const { rows } = await db.query(`select count(*)::int n from ${t} where id like $1`, [p]);
      if (rows[0].n > 0) { total += rows[0].n; hits.push(`${t} 匹配 ${p}：${rows[0].n} 条`); }
    }
  }
  if (total > 0) bad('演示数据残留', hits.join('；'), '上线后和真实数据混在一起就分不清了，统计也会被污染');
  else ok('演示数据', '已清空（按已知 id 前缀检查）');
};

/**
 * 检查 state store 与 PG 业务表是否裂脑。
 *
 * **必须读线上真正在用的那个 state store**，不能读 JSON 文件。
 * 2026-08-21 之前这里读的是 .runtime/state_store.json —— 而线上早就切成
 * PG 后端了（stateStore 的 mode 是 postgres，数据在 app_state_latest 表里），
 * 那个文件只是备份产物和历史残留，最后一次更新停在 8 月 17 日。
 * 结果是这个体检项拿真实数据去和一份死文件比，报出「项目 24 vs 27」
 * 「提醒 223 vs 226」这类根本不存在的差异——而我据此把它们当成真问题查了半天。
 *
 * 体检脚本自己报假警比不报警更糟：它会让人不再相信真的告警。
 */
const checkSplitBrain = async (db) => {
  // 线上用哪个后端，就查哪个
  const { rows: modeRows } = await db.query(
    "select to_regclass('public.app_state_latest') is not null as pg_backed");
  const pgBacked = Boolean(modeRows[0]?.pg_backed);

  let ds = {};
  if (pgBacked) {
    const { rows } = await db.query('select dataset_key, dataset_value from app_state_latest');
    for (const r of rows) ds[r.dataset_key] = r.dataset_value;
  } else {
    const candidates = [
      path.resolve(process.cwd(), '.runtime/state_store.json'),
      path.resolve(process.cwd(), 'server/state_store.json'),
    ];
    const file = candidates.find((f) => fs.existsSync(f));
    if (!file) { ok('state store', '未找到文件，跳过'); return; }
    try { ds = JSON.parse(fs.readFileSync(file, 'utf8')).datasets || {}; }
    catch { bad('state store 读取失败', file, '读不了就无法判断裂脑'); return; }
  }

  const count = (k) => { const v = ds[k]; const val = v && v.value !== undefined ? v.value : v; return Array.isArray(val) ? val.length : 0; };
  const pairs = [
    ['project_work_logs_v1', 'project_work_logs', '工作日志'],
    ['audit_issues_v1', 'audit_issues', '不符合项'],
    ['task_templates_v1', 'task_templates', '任务模板'],
    ['leads_v8', 'leads', '线索'],
    ['projects_v8', 'projects', '项目'],
    ['contracts_v8', 'contracts', '合同'],
    ['customers_v8', 'customers', '客户'],
    ['reminders_v8', 'reminders', '提醒'],
  ];
  for (const [sk, tbl, label] of pairs) {
    const s = count(sk);
    const { rows } = await db.query(`select count(*)::int n from ${tbl}`);
    const p = rows[0].n;
    if (s > 0 && p === 0) {
      bad('数据只在状态存储里（没有专表）', `${label}：状态存储 ${s} 条，PG 表 ${tbl} 为空`,
        '数据在 JSONB 里存着，不会丢，但没法用 SQL 统计和加约束；整份读写还有并发覆盖风险（P0-19）');
    } else if (s !== p) {
      bad('两边数量不一致', `${label}：状态存储 ${s} 条 vs PG 表 ${p} 条`,
        '同一份数据两处存储且不同步，页面显示取决于哪边先加载。用 npm run mirror:diff 看具体差哪些');
    } else {
      ok(label, `两边一致（${p} 条）`);
    }
  }
};

const main = async () => {
  const url = loadEnv();
  const pool = new pg.Pool({ connectionString: url, ssl: ssl() });
  const db = await pool.connect();
  console.log(`\n数据体检：${maskUrl(url)}\n`);
  try {
    await checkOrphans(db);
    await checkRefs(db);
    await checkMoneyUnits(db);
    await checkDemoLeftovers(db);
    await checkSplitBrain(db);
  } finally { db.release(); await pool.end(); }

  if (issues.length === 0) {
    console.log(`✅ 全部通过（${notes.length} 项检查）\n`);
    for (const n of notes) console.log(`   ✓ ${n.title.padEnd(18)} ${n.detail}`);
    console.log('');
    return;
  }
  const blocking = issues.filter((i) => !acceptedOf(i));
  const accepted = issues.filter((i) => acceptedOf(i));

  if (blocking.length) {
    console.log(`发现 ${blocking.length} 个问题：\n`);
    blocking.forEach((i, n) => {
      console.log(`${n + 1}. ${i.title}`);
      console.log(`   ${i.detail}`);
      console.log(`   → ${i.why}\n`);
    });
  } else {
    console.log('✅ 没有阻断上线的数据问题。\n');
  }

  if (accepted.length) {
    console.log(`已知并接受的风险（${accepted.length} 项，不阻断上线）：\n`);
    const seen = new Set();
    accepted.forEach((i) => {
      console.log(`   · ${i.detail}`);
      const a = acceptedOf(i);
      if (!seen.has(a.why)) {
        seen.add(a.why);
        console.log(`     为什么可以带着上线：${a.why}`);
        console.log(`     什么时候解决：${a.revisit}`);
      }
    });
    console.log('');
  }

  console.log(`另有 ${notes.length} 项检查通过。\n`);
  if (blocking.length) process.exitCode = 1;
};

main().catch((e) => { console.error('\n数据体检失败：', e.message); process.exit(1); });
