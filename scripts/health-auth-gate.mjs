/**
 * 未登录访问检查：不带任何凭据打一遍接口，**必须全部被挡住**。
 *
 * ── 为什么要有这条 ────────────────────────────────────────────
 * 2026-08-28 老板问「输网址不用登录就打开了，是不是有漏洞」。
 * 查下来不是漏洞——他自己是登录状态（会话 7 天有效）。
 * 但这件事暴露了一个真问题：**当时我只能临时手工扫一遍来回答他**。
 *
 * 一个靠"我记得我跑过"来保证的安全属性，等于没有保证。
 * 尤其是加新接口的时候——忘记加鉴权中间件不会报错，
 * 功能照常工作，只是**任何人都能读**。这类错误没有任何症状。
 *
 * ── 判定标准 ──────────────────────────────────────────────────
 * 未登录访问业务接口，必须返回 401/403。
 * 返回 200 就是漏了鉴权，直接判红。
 *
 * ── 这条检查有意不做发现式扫描 ─────────────────────────────────
 * 想过自动枚举 app.js 里所有路由来测，但那样会把公开接口
 * （健康检查、官网线索提交）也算进去，然后要维护一张例外名单——
 * 例外名单会越来越长，最后没人知道某一条为什么在里面。
 * 明确列出「这些必须挡住」更可靠：加新接口时要手动加一行，
 * 那一行强迫作者想一次「这个接口该不该公开」。
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.XINYI_HEALTH_BASE || 'http://localhost:3001';

/** 必须挡住的接口。加新业务接口时在这里补一行 */
const MUST_BE_PROTECTED = [
  ['/api/state/sync', '整份业务数据'],
  ['/api/leads', '线索'],
  ['/api/customers', '客户'],
  ['/api/contracts', '合同（含金额）'],
  ['/api/projects', '项目'],
  ['/api/settlements', '结算提成'],
  ['/api/knowledge', '知识文档'],
  ['/api/reminders', '提醒'],
  ['/api/dashboard/metrics', '工作台指标'],
  ['/api/intel/latest', '情报'],
  ['/api/ai-proposals', 'AI 提案'],
  ['/api/auth/users', '员工账号'],
  ['/api/auth/me', '当前登录人'],
  ['/api/auth/audit-logs', '账号审计日志'],
  ['/api/review/monthly', '经营快照'],
  ['/api/ai/usage', 'AI 用量'],
];

const probe = (path) => {
  try {
    const out = execFileSync('curl', [
      '-s', '-o', '/dev/null', '-w', '%{http_code}',
      '--max-time', '8', `${BASE}${path}`,
    ], { encoding: 'utf8' });
    return Number(String(out).trim()) || 0;
  } catch {
    return 0;
  }
};

const main = () => {
  // 先确认服务在跑，否则「全部 000」会被误读成「全都挡住了」——
  // 那是最糟的一种绿灯：什么都没测，但看起来通过了
  if (probe('/api/auth/me') === 0) {
    console.error(`\n后端没有响应（${BASE}）。这条检查需要后端在跑。`);
    console.error('先启动后端：npm start\n');
    process.exit(2);
  }

  console.log(`\n未登录访问检查　${BASE}\n`);
  const leaks = [];
  for (const [path, label] of MUST_BE_PROTECTED) {
    const code = probe(path);
    const blocked = code === 401 || code === 403;
    if (!blocked) leaks.push({ path, label, code });
    console.log(`  ${blocked ? '✅' : '❌'} ${String(code).padEnd(4)} ${path.padEnd(26)} ${label}`);
  }

  if (leaks.length > 0) {
    console.error(`\n❌ ${leaks.length} 个接口未登录也能访问：`);
    for (const l of leaks) console.error(`   ${l.path}（${l.label}）返回 ${l.code}`);
    console.error('\n这些接口漏了鉴权中间件。功能不会报错，但任何人都能读到数据。\n');
    process.exit(1);
  }

  console.log(`\n✅ ${MUST_BE_PROTECTED.length} 个接口未登录一律挡住。\n`);
  process.exit(0);
};

main();
