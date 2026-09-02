#!/usr/bin/env node
// 比对 PG 业务表与 state store 数据集镜像的差异，按方向列出来。
//
//   npm run mirror:diff
//
// 为什么不做成「一键同步」：差异是**有方向**的。
//   PG 多出来的  → 镜像落后了，同步过去是对的
//   镜像多出来的 → 这些记录 PG 里根本没有，覆盖镜像等于把它们抹掉
// 实测两种方向同时存在（线索是镜像多 3 条，项目和提醒是 PG 多 3 条），
// 所以只报差异、不自动改，改哪边由人来定。
import process from 'node:process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const PAIRS = [
  ['leads', 'leads_v8', '线索'],
  ['customers', 'customers_v8', '客户'],
  ['contracts', 'contracts_v8', '合同'],
  ['projects', 'projects_v8', '项目'],
  ['reminders', 'reminders_v8', '提醒'],
  ['knowledge_docs', 'knowledge_docs_v8', '知识文档'],
];

const idsOf = (v) => {
  const arr = Array.isArray(v) ? v : (v && Array.isArray(v.value) ? v.value : []);
  return new Set(arr.map((x) => String(x?.id || '')).filter(Boolean));
};

const main = async () => {
  const url = loadEnv();
  const pool = new pg.Pool({ connectionString: url });
  console.log(`\nPG 与镜像差异比对  ${maskUrl(url)}\n`);

  let clean = true;
  for (const [table, key, label] of PAIRS) {
    let pgIds;
    try {
      pgIds = new Set((await pool.query(`select id from ${table}`)).rows.map((r) => String(r.id)));
    } catch { continue; }                     // 表不存在就跳过

    const r = await pool.query('select dataset_value from app_state_latest where dataset_key=$1', [key]);
    const mirrorIds = idsOf(r.rows[0]?.dataset_value);

    const onlyPg = [...pgIds].filter((id) => !mirrorIds.has(id));
    const onlyMirror = [...mirrorIds].filter((id) => !pgIds.has(id));
    if (!onlyPg.length && !onlyMirror.length) continue;

    clean = false;
    console.log(`━━ ${label}　PG ${pgIds.size} 条 / 镜像 ${mirrorIds.size} 条`);
    if (onlyPg.length) {
      console.log(`   镜像里缺 ${onlyPg.length} 条（PG 有、镜像没有）→ 镜像落后，同步过去即可`);
      onlyPg.slice(0, 5).forEach((id) => console.log(`      ${id}`));
    }
    if (onlyMirror.length) {
      console.log(`   ⚠ 镜像独有 ${onlyMirror.length} 条（PG 里没有）→ 覆盖镜像会抹掉它们，先查清来源`);
      onlyMirror.slice(0, 5).forEach((id) => console.log(`      ${id}`));
    }
    console.log('');
  }

  if (clean) console.log('✅ PG 与镜像一致。\n');
  else console.log('处理建议：先确认「镜像独有」那批是不是该进 PG，再决定同步方向。\n');

  await pool.end();
};

main().catch((e) => { console.error('\n比对失败：', e.message); process.exit(1); });
