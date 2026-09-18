#!/usr/bin/env node
/**
 * 安全网体检 —— 挨个往闸门里塞坏东西，看它红不红。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么需要它（2026-09-18）
 * ══════════════════════════════════════════════════════════════
 *
 * 2026-09-18 这一天连着发现六个问题，串在同一根线上：
 *
 *   CI 的测试 glob 写错 → 测试一条没跑过
 *   → 修好后发现 Node 版本是 20（生产是 22）
 *   → 修好后发现 CI 根本没有数据库，63 条全 ECONNREFUSED
 *   → 加了数据库发现这套迁移建不出新库（018 依赖没人建的表）
 *   → 测试终于跑起来，才发现权限闸门从来没执行过（/glossary 裸奔）
 *   → 权限过了，才发现 e2e 在断言四个**已经删掉**的功能
 *
 * 每一个都只有在前一个被修好之后才暴露 —— 因为后面的步骤一直被 skip。
 * 六个问题的形状完全一样：**看起来在工作，其实从没执行过。**
 *
 * 一条绿色的流水线只证明「命令退出码是 0」，
 * 不证明「它真的检查了东西」。要证明后者只有一个办法：
 * **故意塞个坏东西进去，看它红不红。**
 *
 * 这就是变异测试（mutation testing）用在闸门层：
 * 不是测代码有没有 bug，是测**检查代码的那层东西还活着没有**。
 *
 * ── 怎么用 ────────────────────────────────────────────────────
 *
 *   node scripts/safety-net-audit.mjs            # 全部
 *   node scripts/safety-net-audit.mjs --fast     # 跳过慢的（构建 / e2e / 全量测试）
 *   node scripts/safety-net-audit.mjs --only=typecheck,contract
 *
 * ── 安全保证 ──────────────────────────────────────────────────
 *
 * 这个脚本会**修改源文件**，所以：
 *   1. 工作区不干净就**直接拒绝跑**（否则还原时分不清哪些是你的改动）
 *   2. 每个变异跑完立刻还原，下一个变异才开始
 *   3. 结束时再验一次工作区干净；不干净就大声报出来
 *
 * 中途按 Ctrl-C 也会还原（监听了 SIGINT）。
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const has = (n) => process.argv.includes(`--${n}`);
const FAST = has('fast');
const ONLY = (arg('only') || '').split(',').filter(Boolean);

const p = (rel) => path.join(ROOT, rel);
const read = (rel) => fs.readFileSync(p(rel), 'utf8');

/* ══════════════════════════════════════════════════════════════
   闸门清单

   每一条要回答：**塞什么坏东西，这道闸门必须红。**
   坏东西要挑那种「真出过事」的，不是随便改个字符 ——
   随便改也能红，但红了不说明它盯的是对的东西。
   ══════════════════════════════════════════════════════════════ */
const GATES = [
  {
    id: 'typecheck',
    name: '类型检查',
    cmd: 'npm run typecheck',
    slow: false,
    /** 塞的坏东西 —— 一句人话，报告里要打出来 */
    bug: '把字符串赋给 number 类型的变量',
    mutate: () => patch('src/modules/cashBasis.ts', (s) => s + '\nconst __mutantTypeError: number = "字符串不是数字";\n')
  },
  {
    id: 'test',
    name: '单元测试（全量）',
    cmd: 'npm test',
    slow: true,
    bug: '把「本月实收」改回按到期日算 —— 正是 9/18 修掉的那个财务口径 bug',
    mutate: () => patch('src/modules/cashBasis.ts', (s) => {
      const from = "    .filter(r => isPaid(r) && monthOf(r.paidAt) === monthKey)";
      const to = "    .filter(r => isPaid(r) && monthOf(r.dueDate) === monthKey)";
      return replaceOnce(s, from, to, 'cashBasis.receivedInMonth');
    })
  },
  {
    id: 'build',
    name: '前端构建',
    cmd: 'npm run build',
    slow: true,
    bug: '引用一个不存在的模块',
    mutate: () => patch('index.tsx', (s) => "import './__mutant_missing_module__';\n" + s)
  },
  {
    id: 'security',
    name: '前端密钥扫描',
    // 它扫的是 dist/，所以必须先构建 —— 不构建的话它扫的是上一次的产物，
    // 那就变成「测了个假的」，正是这个脚本要防的事。
    cmd: 'npm run build && npm run security:bundle',
    slow: true,
    bug: '把 KIMI_API_KEY 写进前端代码，让它进构建产物',
    mutate: () => patch('index.tsx', (s) => s + "\nconsole.log('KIMI_API_KEY');\n")
  },
  {
    id: 'migrate',
    name: '迁移文件检查',
    cmd: 'npm run migrate:lint',
    slow: false,
    bug: '加一个版本号重复的迁移文件',
    mutate: () => {
      const f = 'db/migrations/026_变异重复版本.sql';
      fs.writeFileSync(p(f), '-- 变异测试用，应当被版本号重复检查拦下\nSELECT 1;\n');
      return () => fs.unlinkSync(p(f));
    }
  },
  {
    id: 'permissions',
    name: '权限矩阵体检',
    cmd: 'npm run health:permissions',
    slow: false,
    bug: '把一条路由的守卫去掉（直接输网址就能进）',
    mutate: () => patch('App.tsx', (s) => {
      const from = '<Route path="/glossary" element={<ProtectedRoute permission="NAV_KNOWLEDGE"><Glossary /></ProtectedRoute>} />';
      const to = '<Route path="/glossary" element={<Glossary />} />';
      return replaceOnce(s, from, to, 'App.tsx 的 /glossary 守卫');
    })
  },
  {
    id: 'contract',
    name: '字段契约',
    cmd: 'node --test tests/data-contract.test.js',
    slow: false,
    bug: '把合同表的 title 字段改名 —— 线上旧数据是按旧名字存的',
    mutate: () => patch('server/repos/contractRepo.js', (s) => {
      const from = "{ api: 'title', col: 'title', kind: 'text' }";
      const to = "{ api: 'titleRenamed', col: 'title', kind: 'text' }";
      return replaceOnce(s, from, to, 'contractRepo 的 title 映射');
    })
  },
  {
    id: 'preflight',
    name: '部署预检',
    cmd: 'npm run health:preflight:test',
    slow: false,
    bug: '把接口鉴权令牌从环境里拿掉',
    // 这一条不改文件，改环境变量：预检本来就是检查环境的
    env: (base) => { const e = { ...base }; delete e.XINYI_API_AUTH_TOKEN; return e; },
    mutate: () => () => {}
  },
  {
    id: 'e2e',
    name: '端到端（合同主线）',
    cmd: 'npx playwright test e2e/smoke.spec.ts --project=chromium -g "contract entry"',
    slow: true,
    bug: '把「录入合同」按钮的文案改掉 —— 模拟有人改了界面没改测试',
    mutate: () => patch('pages/Contracts.tsx', (s) => {
      const from = '录入合同';
      if ((s.match(new RegExp(from, 'g')) || []).length < 1) throw new Error('找不到「录入合同」');
      return s.replace(from, '录入合同变异');   // 只换第一处就够
    })
  }
];

/* ── 工具 ───────────────────────────────────────────────────── */

function replaceOnce(src, from, to, what) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`变异点命中 ${n} 次（应当恰好 1 次）：${what}`);
  return src.replace(from, to);
}

/** 改一个文件，返回「还原」函数 */
function patch(rel, fn) {
  const before = read(rel);
  fs.writeFileSync(p(rel), fn(before));
  return () => fs.writeFileSync(p(rel), before);
}

const runGate = (cmd, env) => {
  const r = spawnSync('bash', ['-c', cmd], {
    cwd: ROOT,
    env: env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 15 * 60 * 1000
  });
  return { code: r.status === null ? 124 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

const gitClean = () => execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim() === '';

/* ── 主流程 ─────────────────────────────────────────────────── */

const main = async () => {
  if (!gitClean()) {
    console.error('⛔ 工作区不干净，拒绝跑。');
    console.error('   这个脚本会改源文件再还原；工作区有未提交改动时，');
    console.error('   还原一旦出问题就分不清哪些是你的。请先提交或 stash。\n');
    process.exit(1);
  }

  /*
    预检的环境：CI 里这一步带着一长串环境变量跑。本机没有那些，
    所以这里自带一份**和 CI 一致**的最小集合 —— 否则基线本身就是红的，
    变异测试就毫无意义（红的东西再变异还是红，看不出闸门有没有用）。
  */
  const preflightEnv = {
    ...process.env,
    XINYI_REQUIRE_POSTGRES: 'true',
    XINYI_AUTH_REQUIRE_POSTGRES: 'true',
    DATABASE_URL: 'postgres://dummy:dummy@db.example.test:5432/dummy',
    PGSSLMODE: 'require',
    KIMI_API_KEY: 'audit-kimi-key-placeholder',
    XINYI_API_AUTH_TOKEN: 'audit-token-for-preflight-check',
    AUTH_SMOKE_ACCOUNT: 'admin@example.test',
    AUTH_SMOKE_PASSWORD: 'admin-pass-123',
    XINYI_SESSION_AUTH_REQUIRED: '1',
    XINYI_SESSION_ROLE_ENFORCEMENT: '1',
    XINYI_SESSION_COOKIE_SECURE: '1',
    CORS_ALLOWED_ORIGINS: 'https://example.test',
    VITE_AI_BACKEND_URL: '/api/ai',
    VITE_AUTH_REQUIRED: '1',
    VITE_INTEL_LOCAL_FALLBACKS_ENABLED: '0',
    VITE_STATE_SYNC_ENABLED: '1',
    VITE_LEADS_API_ENABLED: '1',
    VITE_LEADS_API_READ_ENABLED: '1',
    VITE_LEADS_API_VERIFY_WRITES_ENABLED: '1',
    VITE_CUSTOMERS_API_ENABLED: '1',
    VITE_CUSTOMERS_API_READ_ENABLED: '1',
    VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED: '1',
    VITE_CONTRACTS_API_READ_ENABLED: '1',
    VITE_CONTRACTS_API_WRITE_ENABLED: '1',
    VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED: '1',
    VITE_PROJECTS_API_READ_ENABLED: '1',
    VITE_PROJECTS_API_WRITE_ENABLED: '1',
    VITE_PROJECTS_API_VERIFY_WRITES_ENABLED: '1'
  };

  const picked = GATES.filter((g) => (ONLY.length ? ONLY.includes(g.id) : true)).filter((g) => !(FAST && g.slow));

  console.log(`\n安全网体检 —— 共 ${picked.length} 道闸门${FAST ? '（--fast，已跳过慢的）' : ''}\n`);

  const results = [];
  let restore = () => {};
  const bail = () => { try { restore(); } catch {} };
  process.on('SIGINT', () => { bail(); console.log('\n已还原，退出。'); process.exit(130); });

  for (const g of picked) {
    const baseEnv = g.id === 'preflight' ? preflightEnv : process.env;
    process.stdout.write(`  ${g.name.padEnd(18)} 基线…`);
    const base = runGate(g.cmd, baseEnv);

    if (base.code !== 0) {
      /*
        基线就是红的 —— 这时候**不能**做变异测试。
        红的东西再塞坏东西还是红，看起来「闸门有效」，其实什么都没证明。
        这种情况本身就是个发现：这道闸门现在是坏的。
      */
      console.log(` ❌ 基线就红了`);
      results.push({ ...g, verdict: '基线失败', detail: base.out.trim().split('\n').slice(-3).join(' / ') });
      continue;
    }

    process.stdout.write(` 绿 → 塞坏东西…`);
    let mutantCode;
    try {
      restore = g.mutate();
      const mutEnv = g.env ? g.env(baseEnv) : baseEnv;
      mutantCode = runGate(g.cmd, mutEnv).code;
    } catch (e) {
      console.log(` ⚠️ 变异点失效：${e.message}`);
      results.push({ ...g, verdict: '变异点已失效', detail: e.message });
      try { restore(); } catch {}
      restore = () => {};
      continue;
    }
    try { restore(); } catch {}
    restore = () => {};

    if (mutantCode !== 0) {
      console.log(` ✅ 红了（抓到）`);
      results.push({ ...g, verdict: '有效' });
    } else {
      console.log(` ❌ 还是绿的 —— 这道闸门抓不到`);
      results.push({ ...g, verdict: '失效', detail: '塞了坏东西它照样通过' });
    }
  }

  // ── 报告 ──
  console.log('\n' + '─'.repeat(78));
  console.log('闸门'.padEnd(20) + '结论'.padEnd(16) + '塞进去的坏东西');
  console.log('─'.repeat(78));
  for (const r of results) {
    const mark = r.verdict === '有效' ? '✅ 有效' : `❌ ${r.verdict}`;
    console.log(r.name.padEnd(20) + mark.padEnd(16) + r.bug);
    if (r.detail) console.log(' '.repeat(20) + `   ↳ ${r.detail}`);
  }
  console.log('─'.repeat(78));

  const bad = results.filter((r) => r.verdict !== '有效');
  console.log(`\n${results.length - bad.length}/${results.length} 道闸门确认有效。`);

  if (!gitClean()) {
    console.error('\n⛔⛔ 工作区没还原干净！立刻检查 git status 并手工还原。');
    process.exit(2);
  }
  console.log('工作区已还原干净。\n');

  process.exit(bad.length ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(2); });
