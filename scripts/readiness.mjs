#!/usr/bin/env node
/*
  上线就绪闸门。一条命令跑完所有机器可验的检查，给出「能不能上线」。

    npm run readiness              全部闸门
    npm run readiness -- --gate 2  只跑第 2 道
    npm run readiness -- --fast    跳过耗时的（备份演练）

  ── 为什么要有这个 ──────────────────────────────────────────────
  改之前仓库里有 25 个以 health:/check: 开头的命令，散着。
  问题不是检查不够，是**没有闸门**：没人知道该跑哪几个、什么顺序、
  跑完算不算「可以上线」。检查多而无结论，等于没有检查。

  参考了两套成熟做法：
    · Google SRE 的 launch checklist —— 架构依赖、失效模式、容量、
      回滚、备份恢复，按风险分级评审
    · ERP/CRM 的 go-live gate —— 数据迁移必须由业务方验收、
      角色要按真实岗位场景测（不能只用管理员）、切换要演练、回滚要有时限

  信义的实际情况决定了权重：内部系统、几个人用、200-400 合同/年，
  **容量根本不是问题**；真正会出事的是「数据对不对」和「人能不能干活」。
  所以闸门按这两件事排，容量那类一笔带过。

  ── 这个脚本查不了什么 ──────────────────────────────────────────
  机器只能验「系统自己说自己是对的」。以下必须由人确认，见文末清单：
  业务数据的真实性、同事会不会用、出事时谁负责按回滚。
*/
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--gate'); return i > -1 ? Number(args[i + 1]) : null; })();
const fast = args.includes('--fast');

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

/**
 * 闸门定义。
 * blocking:true  = 不过就**不能上线**
 * blocking:false = 不过要有说法，但可以带着上线（记进已知问题）
 */
const GATES = [
  {
    n: 1, name: '数据就绪', why: '上线后第一天看到的数字必须是对的，错了没人再信这个系统',
    checks: [
      { cmd: 'npm run health:data', label: '数据体检（残留、孤儿、裂脑）', blocking: true },
      { cmd: 'npm run mirror:diff', label: 'PG 与状态镜像一致性', blocking: true },
      { cmd: 'npm run migrate:status', label: '数据库结构是最新的', blocking: true },
    ],
  },
  {
    n: 2, name: '身份与权限就绪', why: '切 enforce 那天，每个岗位都得能干自己的活',
    checks: [
      /*
        未登录访问检查放在最前面。

        前面几条测的都是「登录之后谁能干什么」，
        默认了「没登录的进不来」——**而那件事从来没被自动验证过**。
        2026-08-28 老板问「输网址不用登录就打开了」时，
        我只能临时手工扫一遍来回答。靠"我记得跑过"保证的安全属性等于没有保证。

        漏加鉴权中间件不会报错、功能照常工作，只是任何人都能读。
        这类错误没有任何症状，只能靠检查抓。

        非阻断：这条要后端在跑才能测，本地没起后端时不该把整个闸门卡死。
        但它会在结论里明确报出来，不会被当成通过。
      */
      { cmd: 'npm run health:auth:gate', label: '未登录一律挡住（16 个接口）', blocking: false },
      { cmd: 'npm run test:enforce', label: '岗位场景 + 板块衔接（enforce）', blocking: true },
      { cmd: 'npm run health:permissions', label: '权限矩阵自洽', blocking: true },
      { cmd: 'npm run authz:report', label: '观察期越权记录', blocking: false },
    ],
  },
  {
    n: 3, name: '代码就绪', why: '类型和测试是最便宜的一道网，破了后面几道都不用谈',
    checks: [
      { cmd: 'npm run typecheck', label: 'TypeScript 类型检查', blocking: true },
      { cmd: 'npm test', label: '全量测试（含真实 PG 路径）', blocking: true },
    ],
  },
  {
    n: 4, name: '界面就绪', why: '同事只通过界面用这个系统，界面错了等于系统错了；工作台尤其容易「看起来有」',
    checks: [
      { cmd: 'npm run health:ui', label: '界面文案与占位检查', blocking: false },
      { cmd: 'npm run health:dashboard', label: '工作台真实性（卡片点了有没有反应）', blocking: true },
      { cmd: 'npm run health:views', label: '各角色视图渲染', blocking: false },
    ],
  },
  {
    n: 5, name: '失效与恢复就绪', why: '备份没演练过等于没有备份',
    slow: true,
    checks: [
      { cmd: 'npm run backup:drill', label: '备份恢复演练', blocking: true },
    ],
  },
];

/** 人工确认项：机器验不了，但不确认就上线是赌博 */
const HUMAN_GATES = [
  ['数据真实性', '抽 10 条真实客户/合同，由老板或经办人当面核对金额、日期、负责人'],
  ['岗位试用', '每个岗位的同事用自己的账号，把当天的活真跑一遍（不是看演示）'],
  ['回滚决定权', '出事时谁有权喊停、多久内必须恢复到旧方式——写下来并让所有人知道'],
  ['观察期安排', '上线后头两周谁盯、每天看什么、发现问题找谁（行业里叫 hypercare）'],
  ['旧方式并行', '前两周旧的记录方式（表格/微信）是否保留，作为对不上时的退路'],
];

const run = (cmd) => {
  const t0 = Date.now();
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return { ok: r.status === 0, ms: Date.now() - t0, out };
};

/** 从输出里挑一行最能说明问题的，避免刷屏 */
const gist = (out, ok) => {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  if (ok) {
    const good = lines.reverse().find((l) => /✅|全部完成|一致|通过|pass \d/.test(l));
    return good ? good.slice(0, 84) : '';
  }
  const bad = lines.find((l) => /⛔|❌|失败|error|not ok|fail/i.test(l));
  return (bad || lines[lines.length - 1] || '').slice(0, 84);
};

const main = () => {
  console.log(`\n${C.b}信义认证系统 · 上线就绪检查${C.x}`);
  console.log(`${C.d}${new Date().toLocaleString('zh-CN')}${C.x}\n`);

  const blockers = [];
  const warnings = [];

  for (const gate of GATES) {
    if (only && gate.n !== only) continue;
    if (fast && gate.slow) {
      console.log(`${C.y}⏭  闸门 ${gate.n} ${gate.name}${C.x} ${C.d}（--fast 跳过）${C.x}\n`);
      continue;
    }
    console.log(`${C.b}闸门 ${gate.n} · ${gate.name}${C.x}`);
    console.log(`${C.d}   ${gate.why}${C.x}`);

    for (const chk of gate.checks) {
      const { ok, ms, out } = run(chk.cmd);
      const mark = ok ? `${C.g}✓${C.x}` : (chk.blocking ? `${C.r}✗${C.x}` : `${C.y}!${C.x}`);
      console.log(`   ${mark} ${chk.label.padEnd(28)} ${C.d}${(ms / 1000).toFixed(1)}s${C.x}`);
      const g = gist(out, ok);
      if (g) console.log(`     ${C.d}${g}${C.x}`);
      if (!ok) (chk.blocking ? blockers : warnings).push(`闸门${gate.n} ${chk.label}　（${chk.cmd}）`);
    }
    console.log('');
  }

  console.log(`${C.b}━━ 结论${C.x}\n`);
  if (blockers.length) {
    console.log(`${C.r}${C.b}  不能上线${C.x}　${blockers.length} 项阻断：\n`);
    blockers.forEach((b) => console.log(`   ${C.r}✗${C.x} ${b}`));
    console.log('');
  } else {
    console.log(`${C.g}${C.b}  机器可验的部分全部通过${C.x}\n`);
  }
  if (warnings.length) {
    console.log(`${C.y}  ${warnings.length} 项非阻断问题（可以带着上线，但要记进已知问题）：${C.x}`);
    warnings.forEach((w) => console.log(`   ${C.y}!${C.x} ${w}`));
    console.log('');
  }

  console.log(`${C.b}  以下机器验不了，必须由人确认：${C.x}\n`);
  HUMAN_GATES.forEach(([k, v]) => console.log(`   ${C.d}□${C.x} ${C.b}${k}${C.x}　${v}`));
  console.log(`\n${C.d}  「机器全绿」只说明系统自己没发现问题，不等于可以上线。${C.x}`);
  console.log(`${C.d}  上面这五条一条没做就上线，出事时没有退路。${C.x}\n`);

  process.exit(blockers.length ? 1 : 0);
};

main();
