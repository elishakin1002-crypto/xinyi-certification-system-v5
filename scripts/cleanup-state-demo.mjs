/**
 * 清掉 state store 里残留的演示数据与孤儿记录。
 *
 * ── 为什么之前没清掉 ──────────────────────────────────────────
 * 2026-08-17 的迁移 006/007 清过一轮演示数据，**但只清了 PG 业务表**。
 * 不符合项、工作日志这些当时只存在 state store 里，检查器也只查 PG，
 * 所以它们既没被清、也没被发现——直到 2026-08-28 把这些数据投影进
 * 关系表之后，数据体检立刻报出一条悬空引用。
 *
 * 教训：**检查器覆盖不到的地方，脏数据可以安静地待很久。**
 *
 * ── 只删这三类，别的一律不碰 ──────────────────────────────────
 * ① 不符合项里带 EXAMPLE 证据 + 指向 CUST-DEMO/PROJ-DEMO 的
 * ② 工作日志指向已经不存在的项目（演示的和被 006/007 删掉的都算）
 * ③ 情报里 SIG-MOCK-* 且标着「演示」的
 *
 * **刻意不删**负责人写着「老板（示例）」的线索/客户/合同/项目——
 * 那些是**真实业务记录**，只是负责人字段是个占位字符串。
 * 删掉就是销毁真数据。它们该走的是「回填负责人」（待办 P0-17），不是清理。
 *
 * 用法：
 *   node scripts/cleanup-state-demo.mjs           # 预演
 *   node scripts/cleanup-state-demo.mjs --apply   # 真删（会先备份）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^(XINYI_DB_URL|PGSSLMODE)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const pool = require(path.join(root, 'server/db/pool.js'));
const { getStateBatch, upsertStateBatch } = require(path.join(root, 'server/stateStore.js'));

const apply = process.argv.includes('--apply');
const KEYS = ['audit_issues_v1', 'project_work_logs_v1', 'market_signals_v1'];

const main = async () => {
  const { rows: pr } = await pool.query('select id from projects');
  const liveProjects = new Set(pr.map((r) => r.id));
  const { rows: cu } = await pool.query('select id from customers');
  const liveCustomers = new Set(cu.map((r) => r.id));

  const state = await getStateBatch(KEYS);
  const ds = state?.datasets || {};
  const arr = (k) => (Array.isArray(ds[k]) ? ds[k] : []);

  const plan = {};

  // ① 不符合项：客户和项目都不存在的，是演示留下的
  plan.audit_issues_v1 = arr('audit_issues_v1').filter((r) => {
    const badCustomer = r.customerId && !liveCustomers.has(r.customerId);
    const badProject = r.projectId && !liveProjects.has(r.projectId);
    return badCustomer && badProject;
  });

  // ② 工作日志：指向的项目已经不存在
  plan.project_work_logs_v1 = arr('project_work_logs_v1')
    .filter((r) => r.projectId && !liveProjects.has(r.projectId));

  // ③ 情报：mock 且标着演示
  plan.market_signals_v1 = arr('market_signals_v1')
    .filter((r) => /^SIG-MOCK-/i.test(String(r.id || '')) && /演示/.test(JSON.stringify(r)));

  console.log(`\n${apply ? '开始清理' : '预演（不写库）'}\n`);
  let total = 0;
  for (const k of KEYS) {
    const hits = plan[k];
    total += hits.length;
    console.log(`  ${k.padEnd(24)} ${String(hits.length).padStart(3)} / ${arr(k).length} 条要删`);
    for (const h of hits.slice(0, 6)) {
      const why = k === 'project_work_logs_v1' ? `项目 ${h.projectId} 不存在`
        : k === 'audit_issues_v1' ? `客户 ${h.customerId} 和项目 ${h.projectId} 都不存在`
        : '演示情报';
      console.log(`      ${String(h.id).padEnd(30)} ${why}`);
    }
    if (hits.length > 6) console.log(`      …另有 ${hits.length - 6} 条`);
  }
  console.log(`\n合计 ${total} 条`);

  if (total === 0) { console.log('没有要清的。'); process.exit(0); }

  if (!apply) {
    console.log('\n确认无误后加 --apply 真正删除。');
    console.log('注意：负责人写着「老板（示例）」的线索/客户/合同是**真实业务**，本脚本不碰它们。');
    process.exit(0);
  }

  console.log('\n先备份…');
  execFileSync('npm', ['run', 'backup'], { cwd: root, stdio: 'ignore' });
  console.log('备份完成');

  const next = {};
  for (const k of KEYS) {
    const drop = new Set(plan[k].map((r) => String(r.id)));
    next[k] = arr(k).filter((r) => !drop.has(String(r.id)));
  }

  // 写回 state store。投影会自动把关系表跟着更新（挂在 upsertStateBatch 上）
  // allowClear：这是**有意清空**，让投影层也把关系表里的行删掉。
  // 不声明的话「空数组不清表」的保护会挡住，留下孤儿行（2026-09-01 踩过）
  await upsertStateBatch(next, { source: 'cleanup-script', clientId: 'cleanup-state-demo', allowClear: true });

  console.log('\n复核：');
  for (const k of KEYS) console.log(`  ${k.padEnd(24)} 剩 ${next[k].length} 条`);
  const { rows } = await pool.query('select count(*)::int n from audit_issues');
  console.log(`  audit_issues 表           剩 ${rows[0].n} 行`);
  console.log('\n跑一次数据体检确认：npm run health:data');
  process.exit(0);
};

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
