#!/usr/bin/env node
/*
  历史项目补录：把「真做过但当时只是在系统里测试」的项目改成真实状态。

    npm run backfill:projects            只看方案，不改数据
    npm run backfill:projects -- --apply 真的执行（自动先备份）

  ── 处理原则：不伪造执行记录 ────────────────────────────────────
  这批项目的活是真干过的，但当时没在系统里记过程。
  补录时**不能把任务直接标成「已完成」**——那等于凭空造出
  「某人某天勾了这个任务」的记录，而实际没有人勾过。

  所以标成**跳过 + 原因「系统上线前完成，无过程记录」**，说的是实话：
  活干了，过程记录没有。将来查「这一步当时谁做的」，
  看到的是「无过程记录」，而不是一条查无此人的假记录。

  跳过的任务不计入进度分母，所以补录后进度会变成 100%，
  同时那 39 个逾期任务会从延误率里消失——延误率才能重新变成一个有意义的指标。
*/
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const apply = process.argv.includes('--apply');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

/** 只处理有合同关联的项目——那是真做过的活的标志 */
const isRealProject = (row) => String(row.contract_ref || '').startsWith('CT-');

const main = async () => {
  const url = loadEnv();
  const pool = new pg.Pool({ connectionString: url });
  console.log(`\n${C.b}历史项目补录${C.x}　${C.d}${maskUrl(url)}${C.x}`);
  console.log(`${C.d}${apply ? '执行模式' : '预演模式（不改数据，加 --apply 才执行）'}${C.x}\n`);

  const { rows } = await pool.query(
    'select id, name, project_status, progress, contract_ref, tasks, completion_record from projects');
  const targets = rows.filter(isRealProject);

  const plan = [];
  for (const p of targets) {
    const tasks = Array.isArray(p.tasks) ? p.tasks : [];
    const unresolved = tasks.filter((t) => t.status !== 'Completed' && t.status !== 'Skipped');
    if (!unresolved.length && p.project_status === 'Completed') continue;   // 已经干净了
    plan.push({
      id: p.id,
      name: p.name,
      status: p.project_status,
      progress: p.progress,
      total: tasks.length,
      unresolved: unresolved.length,
      needStatusChange: p.project_status !== 'Completed',
    });
  }

  if (!plan.length) {
    console.log(`${C.g}✅ 没有需要补录的项目。${C.x}\n`);
    await pool.end();
    return;
  }

  console.log(`共 ${targets.length} 个有合同的项目，其中 ${plan.length} 个需要补录：\n`);
  for (const p of plan) {
    const mark = p.needStatusChange ? `${C.y}改为已完成${C.x}` : `${C.d}已是完成态${C.x}`;
    console.log(`  ${p.name.slice(0, 28)}`);
    console.log(`    ${C.d}当前 ${p.status} / 进度 ${p.progress}% / 共 ${p.total} 个任务${C.x}`);
    console.log(`    → ${p.unresolved} 个未交代的任务标为「系统上线前完成，无过程记录」，${mark}\n`);
  }

  const totalTasks = plan.reduce((s, p) => s + p.unresolved, 0);
  console.log(`${C.b}合计${C.x}：${plan.length} 个项目、${totalTasks} 个任务\n`);

  if (!apply) {
    console.log(`${C.d}这是预演。确认无误后执行：${C.x}`);
    console.log(`  npm run backfill:projects -- --apply\n`);
    await pool.end();
    return;
  }

  // ── 执行前先备份 ──
  console.log(`${C.d}先备份…${C.x}`);
  const b = spawnSync('npm', ['run', 'backup'], { encoding: 'utf8' });
  if (b.status !== 0) {
    console.error(`${C.r}⛔ 备份失败，中止补录。${C.x}\n${b.stdout || ''}${b.stderr || ''}`);
    process.exit(1);
  }
  console.log(`${C.g}备份完成${C.x}\n`);

  const nowIso = new Date().toISOString();
  let changedProjects = 0;
  let changedTasks = 0;

  for (const p of plan) {
    const row = targets.find((t) => t.id === p.id);
    const tasks = (Array.isArray(row.tasks) ? row.tasks : []).map((t) => {
      if (t.status === 'Completed' || t.status === 'Skipped') return t;
      changedTasks++;
      return {
        ...t,
        status: 'Skipped',
        skipReason: 'LegacyBackfill',
        skipNote: `${nowIso.slice(0, 10)} 批量补录：项目已实际交付，系统上线前无过程记录`,
      };
    });

    // 跳过的不计入分母；全部交代完 → 100
    const core = tasks.filter((t) => t.category === 'Core' && t.status !== 'Skipped');
    const progress = core.length === 0
      ? 100
      : Math.round((core.filter((t) => t.status === 'Completed').length / core.length) * 100);

    const completion = row.completion_record && Object.keys(row.completion_record).length
      ? row.completion_record
      : {
          eventId: `EVT-BACKFILL-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          completedAt: nowIso,
          actualEndDate: nowIso.slice(0, 10),
          /* 明确标注这是补录，不是系统里真实走完的流程 */
          backfilled: true,
          backfillNote: '系统上线前已实际交付，本记录为批量补录',
        };

    await pool.query(
      `update projects set project_status='Completed', progress=$2, tasks=$3::jsonb,
              completion_record=$4::jsonb, updated_at=NOW() where id=$1`,
      [p.id, progress, JSON.stringify(tasks), JSON.stringify(completion)]);
    changedProjects++;
  }

  console.log(`${C.g}✅ 补录完成${C.x}：${changedProjects} 个项目、${changedTasks} 个任务\n`);
  console.log(`${C.d}接着跑一遍体检确认：npm run health:data${C.x}\n`);
  await pool.end();
};

main().catch((e) => { console.error(`\n${C.r}补录失败：${C.x}`, e.message); process.exit(1); });
