#!/usr/bin/env node
// 上线前脏数据盘点（P0-16 / P0-17 的第一步）。
//
//   npm run data:plan
//
// 这个脚本**只读不写**。它把库里的数据分成「保留 / 建议删 / 需人工判断」三类，
// 输出一份清单。真正的删除动作写成迁移文件执行，不在这里做。
//
// 为什么要先出清单再动手：
//   删数据不可逆。哪些是测试数据、哪些是同事真在跟的业务，
//   光看 id 前缀猜不准——比如「认证到期挖角跟进」项目带着真实公司名，
//   可能是批量导入的垃圾，也可能是销售真在跟的线索。这个必须人来定。
import process from 'node:process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const ssl = () => (String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require'
  ? { rejectUnauthorized: false } : undefined);

const yuan = (fen) => `¥${(Number(fen || 0) / 100).toLocaleString()}`;
const line = (s = '') => console.log(s);
const rule = (t) => { line(); line(`━━━ ${t} ${'━'.repeat(Math.max(0, 58 - t.length))}`); };

/** 项目分类规则。改这里就能调整口径，改完重跑看清单。 */
const classifyProject = (p) => {
  if (p.contract_exists) return { bucket: 'keep', why: '有真实合同' };
  if (/^PROJ-DEMO-|^proj-cert-/.test(p.id)) return { bucket: 'drop', why: '演示数据（id 带 DEMO/cert 前缀）' };
  if (/（示例）|\(示例\)/.test(String(p.manager || ''))) return { bucket: 'drop', why: '负责人是「（示例）」账号' };
  if (/^\d+$/.test(String(p.name || '').trim())) return { bucket: 'drop', why: '项目名是纯数字，测试输入' };
  if (/^CT-2025-00\d$/.test(String(p.contract_ref || ''))) return { bucket: 'drop', why: '关联的是不存在的演示合同号' };
  if (/^P-FU-/.test(p.id)) return { bucket: 'ask', why: '「认证到期挖角跟进」批量生成，带真实公司名' };
  if (/^P-INTEL-/.test(p.id)) return { bucket: 'ask', why: '情报/线索自动转化生成' };
  return { bucket: 'ask', why: '无合同关联，来源不明' };
};

const main = async () => {
  const url = loadEnv();
  const pool = new pg.Pool({ connectionString: url, ssl: ssl() });

  line(`\n数据库：${maskUrl(url)}`);
  line('本脚本只读，不做任何修改。\n');

  // ── 项目 ──
  const { rows: projects } = await pool.query(`
    select p.id, p.name, p.customer_id, p.contract_ref, p.manager, p.project_status,
           p.project_amount, p.owner_user_id, (c.id is not null) as contract_exists
      from projects p left join contracts c on c.id = p.contract_ref
     order by p.created_at`);

  const buckets = { keep: [], drop: [], ask: [] };
  for (const p of projects) {
    const { bucket, why } = classifyProject(p);
    buckets[bucket].push({ ...p, why });
  }

  rule(`项目 ${projects.length} 个`);
  for (const [key, label] of [['keep', '保留'], ['drop', '建议删除'], ['ask', '需你判断']]) {
    const list = buckets[key];
    line(`\n【${label}】${list.length} 个`);
    for (const p of list) {
      line(`  ${p.id.padEnd(21)} ${String(p.name || '').trim().slice(0, 24).padEnd(26)} ${yuan(p.project_amount).padEnd(12)} ${p.why}`);
    }
    if (key === 'drop' && list.length) {
      const amt = list.reduce((s, p) => s + Number(p.project_amount || 0), 0);
      line(`  ── 合计金额 ${yuan(amt)}（删掉会从统计里消失）`);
    }
  }

  // ── 线索 ──
  const { rows: leadGroups } = await pool.query(`
    select case
             when id like 'LEAD-DEMO%' then 'demo'
             when id like 'L-IMP-%'    then 'import'
             when id like 'L-INTEL-%'  then 'intel'
             else 'other' end as kind,
           count(*)::int as n, count(owner_user_id)::int as with_owner
      from leads group by 1 order by 2 desc`);
  rule(`线索 ${leadGroups.reduce((s, g) => s + g.n, 0)} 条`);
  const leadLabel = { demo: '演示数据（LEAD-DEMO 前缀）→ 建议删除', import: '批量导入（L-IMP 前缀）→ 需你判断', intel: '情报转化（L-INTEL 前缀）→ 需你判断', other: '其他/手工录入 → 保留' };
  for (const g of leadGroups) line(`  ${String(g.n).padStart(4)} 条  ${leadLabel[g.kind] || g.kind}（有归属人 ${g.with_owner} 条）`);

  // ── 归属人回填（P0-17）──
  rule('归属人回填（P0-17）');
  const { rows: ownerGaps } = await pool.query(`
    select 'leads' t, count(*)::int total, count(owner_user_id)::int has from leads
    union all select 'projects', count(*)::int, count(owner_user_id)::int from projects
    union all select 'customers', count(*)::int, count(owner_user_id)::int from customers
    union all select 'contracts', count(*)::int, count(owner_user_id)::int from contracts
    union all select 'market_signals', count(*)::int, count(owner_user_id)::int from market_signals`);
  for (const r of ownerGaps) {
    line(`  ${r.t.padEnd(16)} ${String(r.has).padStart(4)} / ${String(r.total).padEnd(5)} 条有归属人  ${r.has === 0 ? '← 全为空' : ''}`);
  }

  const { rows: managers } = await pool.query(`
    select coalesce(manager, '(空)') m, count(*)::int n from projects group by 1 order by 2 desc`);
  line('\n  项目 manager 字段现有取值（回填时要映射到真实账号）：');
  for (const r of managers) line(`    ${String(r.m).padEnd(20)} ${r.n} 个`);

  rule('结论');
  line(`  可直接删除：${buckets.drop.length} 个项目 + ${leadGroups.find((g) => g.kind === 'demo')?.n || 0} 条演示线索`);
  line(`  需你判断：  ${buckets.ask.length} 个项目 + ${(leadGroups.find((g) => g.kind === 'import')?.n || 0) + (leadGroups.find((g) => g.kind === 'intel')?.n || 0)} 条导入/情报线索`);
  line(`  确认保留：  ${buckets.keep.length} 个项目（都有真实合同）`);
  line('\n  下一步：确认口径后写成迁移文件执行（npm run migrate:new 清理上线前测试数据），');
  line('  不用一次性脚本——迁移有执行记录，各环境口径一致，且执行前自动备份。\n');

  await pool.end();
};

main().catch((e) => { console.error('\n盘点失败：', e.message); process.exit(1); });
