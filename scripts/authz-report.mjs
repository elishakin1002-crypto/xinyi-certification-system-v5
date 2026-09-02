#!/usr/bin/env node
// 授权观察报表：看 observe 阶段积了哪些「本该被拦」的操作。
//
//   npm run authz:report              近 7 天
//   npm run authz:report -- --days 14
//   npm run authz:report -- --detail  逐条列出
//
// 这份报表要回答一个问题：**现在能不能切 enforce？**
//
// 判断依据不是「denied 多不多」，而是**每一条 denied 属于哪一类**：
//   · 真越权   —— 策略是对的，切了正好把它拦住
//   · 误配规则 —— 策略配错了，切了会把正常干活的人挡在门外
//
// 两者的区分靠**分布形态**，不靠人一条条看：
//   误配的特征是「同一条策略、多个不同的人、反复触发」——
//   那多半不是所有人同时想越权，是规则本身写错了。
import process from 'node:process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const argOf = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const days = Number(argOf('days', 7)) || 7;
const detail = process.argv.includes('--detail');

const ssl = () => (String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require'
  ? { rejectUnauthorized: false } : undefined);

const bar = (n, max, w = 24) => '█'.repeat(Math.max(1, Math.round((n / Math.max(max, 1)) * w)));

const main = async () => {
  const url = loadEnv();
  const pool = new pg.Pool({ connectionString: url, ssl: ssl() });
  const since = `now() - interval '${days} days'`;
/*
  排除测试/模拟数据。账本是追加式，写进去就删不掉——
  2026-08-21 验证报表的误配识别能力时写了 10 条模拟 denied，
  已用 ledger.correction 事件声明，这里按前缀排除，免得污染真实统计。
  真实员工 id 不会以 U-T 开头（见 employees 表命名）。
*/
const EXCLUDE_TEST = "AND actor_user_id NOT LIKE 'U-T%'";

  console.log(`\n授权观察报表（近 ${days} 天）  ${maskUrl(url)}`);
  console.log(`当前模式：${process.env.XINYI_AUTHZ_MODE || 'observe'}\n`);

  const { rows: total } = await pool.query(
    `SELECT count(*) FILTER (WHERE result = 'denied')::int AS denied,
            count(*)::int AS all_events
       FROM business_events WHERE occurred_at >= ${since} ${EXCLUDE_TEST}`);
  const d = total[0].denied;

  if (d === 0) {
    console.log('近期没有任何 denied 记录。');
    console.log('两种可能：① 权限配置和实际用法完全吻合；② 这些接口根本没被调用过。');
    console.log('切 enforce 前，建议先确认同事真的用过这些功能——没人用过不等于配置正确。\n');
    await pool.end();
    return;
  }

  console.log(`共 ${total[0].all_events} 条事件，其中 ${d} 条被判定为「本该拦下」\n`);

  // ── 按策略聚合：误配规则会在这里冒头 ──
  const { rows: byPolicy } = await pool.query(
    `SELECT coalesce(policy, '(未记录)') AS policy,
            count(*)::int AS n,
            count(DISTINCT actor_user_id)::int AS actors,
            count(*) FILTER (WHERE via_ai_agent)::int AS by_ai,
            min(occurred_at) AS first_at, max(occurred_at) AS last_at
       FROM business_events
      WHERE result = 'denied' AND occurred_at >= ${since} ${EXCLUDE_TEST}
      GROUP BY 1 ORDER BY n DESC`);

  const max = byPolicy[0]?.n || 1;
  console.log('━━ 按策略分布');
  console.log('   命中次数 / 涉及人数 / 其中 AI 发起\n');
  for (const r of byPolicy) {
    /*
      分类启发式（只是提示，最终要人判断）：
        多人反复触发同一条策略 → 更像规则配错了
        单人少量触发           → 更像真越权
    */
    const suspectMisconfig = r.actors >= 2 && r.n >= 5;
    const tag = suspectMisconfig ? '⚠ 疑似误配' : '· 疑似越权';
    console.log(`  ${bar(r.n, max)} ${String(r.n).padStart(4)}  ${tag}`);
    console.log(`     ${r.policy}`);
    console.log(`     涉及 ${r.actors} 人${r.by_ai ? `，其中 AI 发起 ${r.by_ai} 次` : ''}` +
      `　${r.first_at.toISOString().slice(5, 16)} → ${r.last_at.toISOString().slice(5, 16)}\n`);
  }

  // ── 按人聚合 ──
  const { rows: byActor } = await pool.query(
    `SELECT coalesce(nullif(actor_name, ''), actor_user_id, '(匿名)') AS who,
            count(*)::int AS n, count(DISTINCT policy)::int AS policies
       FROM business_events
      WHERE result = 'denied' AND occurred_at >= ${since} ${EXCLUDE_TEST}
      GROUP BY 1 ORDER BY n DESC LIMIT 10`);
  console.log('━━ 按人分布');
  for (const r of byActor) console.log(`  ${String(r.n).padStart(4)} 次  ${String(r.who).padEnd(16)} 触发 ${r.policies} 类策略`);

  // ── AI 分级分布 ──
  const { rows: byLevel } = await pool.query(
    `SELECT coalesce(ai_level, '(人工操作)') AS lvl, count(*)::int AS n
       FROM business_events
      WHERE result = 'denied' AND occurred_at >= ${since} ${EXCLUDE_TEST}
      GROUP BY 1 ORDER BY 1`);
  if (byLevel.length) {
    console.log('\n━━ AI 分级分布');
    for (const r of byLevel) console.log(`  ${String(r.lvl).padEnd(12)} ${r.n} 次`);
  }

  if (detail) {
    const { rows } = await pool.query(
      `SELECT occurred_at, event_type, coalesce(nullif(actor_name,''), actor_user_id) AS who,
              policy, reason, ai_level, subject_type, subject_id
         FROM business_events
        WHERE result = 'denied' AND occurred_at >= ${since} ${EXCLUDE_TEST}
        ORDER BY occurred_at DESC LIMIT 100`);
    console.log('\n━━ 明细（最多 100 条）');
    for (const r of rows) {
      console.log(`  ${r.occurred_at.toISOString().slice(5, 19)}  ${String(r.who || '-').padEnd(12)} ${r.event_type}`);
      console.log(`     ${r.policy}${r.ai_level ? ` [${r.ai_level}]` : ''}　${r.reason || ''}`);
    }
  }

  // ── 结论 ──
  const misconfig = byPolicy.filter((r) => r.actors >= 2 && r.n >= 5);
  console.log('\n━━ 能不能切 enforce？\n');
  if (misconfig.length) {
    console.log(`  ⚠️ 先别切。有 ${misconfig.length} 条策略疑似配错：\n`);
    for (const r of misconfig) console.log(`     ${r.policy}　（${r.actors} 人共触发 ${r.n} 次）`);
    console.log('\n  多人反复撞同一条规则，通常不是大家同时想越权，是规则写错了。');
    console.log('  先逐条确认这些操作在业务上是否正当：');
    console.log('    · 正当 → 调 constants.ts 的角色配置或 authz/policy.js');
    console.log('    · 不正当 → 保留规则，切 enforce 后正好拦住\n');
  } else {
    console.log('  ✅ 没有发现「多人反复触发同一条规则」的误配特征。');
    console.log('  逐条确认这些 denied 都属于真越权后，可以切 enforce：\n');
    console.log('    在 .env.local 设 XINYI_AUTHZ_MODE=enforce，重启后端\n');
    console.log('  ⚠️ 切之前还要改一处：middleware.js 里「判定异常时放行」的兜底，');
    console.log('     observe 阶段是刻意放行的，enforce 阶段应改成出错即拒绝。\n');
  }

  await pool.end();
};

main().catch((e) => { console.error('\n报表生成失败：', e.message); process.exit(1); });
