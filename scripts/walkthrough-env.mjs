#!/usr/bin/env node
/**
 * 走查环境 —— 让「随便造假数据、随便删」变成安全的事。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来 2026-09-11：「问题是我自己都没有测过主链路，
 * 怎么能直接上线让同事测呢？」以及「直接填假的数据？假的数据会污染系统吗？」
 *
 * 两个问题其实是同一个：**他缺一个可以放开手脚的环境。**
 *
 * 正规做法是三套环境 dev → staging → prod，测试环境里造多少假数据都无所谓。
 * 信义只有本地和生产两套，但**本地这套完全可以当 staging 用** ——
 * 前提是「搞坏了能一键还原」。没有这一条，人就不敢乱点，
 * 而**不敢乱点的走查是查不出问题的**。
 *
 * ── 这个项目被测试数据坑过 4 次 ────────────────────────────────
 *
 * 迁移 006 / 007 / 014 / 021 都是在清理测试残留。
 * 014 的根因写得很清楚：「测试从来没有独立数据库」。
 * 021 是 2026-09-11 清掉的 6 个 `11111` / `空任务项目`。
 *
 * 所以这个脚本的全部意义是：**把假数据关在本地，并且随时能一键抹掉。**
 *
 * ── 用法 ──────────────────────────────────────────────────────
 *   npm run walkthrough:snapshot   走查前拍一张基线快照
 *   npm run walkthrough:reset      随时回到基线（假数据一扫而空）
 *   npm run walkthrough:status     看基线是什么时候的、现在差了多少
 *
 * ⚠️ 只对本机开发库生效。连到生产会直接拒绝执行 —— 这不是提示，是硬拦。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));

const url = process.env.DATABASE_URL || '';
const BASELINE = path.join(ROOT, '.runtime/walkthrough-baseline.dump');
const META = path.join(ROOT, '.runtime/walkthrough-baseline.json');
const DOCKER_DB = 'xinyi-dev-db';

/*
  硬拦：这个脚本会整库覆盖，连错环境的后果是**把生产抹掉**。
  所以不是「提示一下」，是直接退出。
  这个项目已经因为「测试直连生产库」吃过一次亏（迁移 014）。
*/
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('\n❌ 拒绝执行：DATABASE_URL 不是本机地址。\n');
  console.error('   这个脚本会整库覆盖。连到生产上跑，等于把真实业务数据抹掉。');
  console.error('   走查请在本地做 —— 那正是本地环境存在的意义。\n');
  process.exit(1);
}

const dockerPgDump = () => execFileSync('docker', ['exec', DOCKER_DB, 'pg_dump', '-d', url, '-Fc'],
  { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024 });

/*
  ── 账号表不参与还原（2026-09-11 踩的坑）────────────────────────

  症状：跑完 reset 之后，走查账号**一个都登不进去**，
  连试几次直接变成「密码连续输错多次，账号已暂时锁定」。

  真因：基线是 06:38 拍的，而走查账号的密码是那之后才设的。
  pg_restore --clean 把 auth_users 整张表倒回旧样子，
  密码自然跟着回到旧值 —— 于是拿着密码本也登不进去，
  再试五次就把自己锁了。

  **这是最糟的一种失败**：reset 的全部意义就是「放心乱点，一键还原」，
  结果它把人锁在门外，而错误信息说的是「密码输错」，
  人只会怀疑自己记错了密码，根本想不到是刚才那条还原命令干的。

  所以还原**只倒业务数据，不碰账号**。谁能登录、密码是什么、
  有没有被锁 —— 这些不是「走查造出来的脏数据」，
  它们是走查的**前提条件**。
*/
const AUTH_TABLES = ['auth_users', 'auth_sessions', 'auth_audit_logs'];

/*
  怎么排除：**用 TOC 清单，不是 --exclude-table-data。**

  第一版我写的是 `--exclude-table-data` + `-T` —— 那是 pg_dump 的参数，
  pg_restore 根本不认（-T 在 pg_restore 里是「触发器」）。
  结果 reset 直接 `spawnSync docker EPIPE` 失败。

  好在它是**响亮地失败**：库没被动，账号也没事。
  真正该怕的是另一种写法 —— 参数被悄悄忽略、还原照跑，
  那样账号又会被倒回去，而屏幕上一切正常。

  pg_restore 支持的办法是 `-l` 导出目录、过滤掉不要的条目、再用 `-L` 回灌。
  把账号相关的条目整行删掉，DROP 和 COPY 就都不会执行。
*/
const dockerPgRestore = (file) => {
  const inC = '/tmp/wt-restore.dump';
  const listC = '/tmp/wt-restore.list';
  execFileSync('docker', ['cp', file, `${DOCKER_DB}:${inC}`], { stdio: 'pipe' });

  const toc = execFileSync('docker', ['exec', DOCKER_DB, 'pg_restore', '-l', inC],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).toString('utf8');

  const re = new RegExp(`\\b(${AUTH_TABLES.join('|')})\\b`);
  const kept = toc.split('\n').filter((line) => line.startsWith(';') || !re.test(line));
  const dropped = toc.split('\n').filter((l) => !l.startsWith(';') && re.test(l)).length;
  if (dropped === 0) {
    throw new Error('基线里找不到账号表的条目 —— 排除规则可能失效了，中止还原以免又把账号倒回去');
  }

  execFileSync('docker', ['exec', '-i', DOCKER_DB, 'sh', '-c', `cat > ${listC}`],
    { input: kept.join('\n'), stdio: ['pipe', 'pipe', 'pipe'] });

  execFileSync('docker', ['exec', DOCKER_DB, 'pg_restore', '-d', url,
    '--clean', '--if-exists', '--no-owner', '-L', listC, inC],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024 });

  execFileSync('docker', ['exec', DOCKER_DB, 'rm', '-f', inC, listC], { stdio: 'pipe' });
  return dropped;
};

/*
  还原本身不该把人锁在门外，所以顺手把锁定计数清零。
  走查期间连错几次是常态（五个账号轮着登），
  而「等 15 分钟」在走查中间等于把人赶走。
*/
const clearLockouts = async () => {
  const pool = new Pool({ connectionString: url });
  try {
    const { rowCount } = await pool.query(
      `update auth_users set failed_login_count = 0, locked_until = null
       where failed_login_count > 0 or locked_until is not null`);
    return rowCount;
  } catch { return 0; } finally { await pool.end(); }
};

/*
  ── 还原完，自检「走查账号还登得进去吗」（2026-09-11）──────────

  排除账号表已经堵住了已知的那条路。但这里要堵的是**下一条还不知道的路**。

  金恩来问得对：「如何防止类似事情再次发生？」
  光修这一次不够 —— 真正危险的是「还原」这个动作本身：
  它把库倒回过去，而**登录所依赖的一切也在库里**。
  今天是密码，明天可能是角色、状态、有效期、会话表结构。
  再加一条排除规则只能挡住我已经想到的那一种。

  所以改成验结果，不验原因：**还原完，拿密码本挨个真登一次**。
  登不进去就当场喊出来，并给出修复命令 ——
  不让人在十分钟后对着「密码输错」怀疑自己记错了密码。

  这和部署脚本末尾那 7 项自检是同一个思路：
  动作做完不算完，**得证明原本能用的东西还能用**。
*/
const verifyWalkthroughLogins = async () => {
  const book = path.join(ROOT, '.runtime/走查账号密码.json');
  if (!fs.existsSync(book)) return null;          // 没建过走查账号，不适用
  let accounts;
  try { accounts = Object.entries(JSON.parse(fs.readFileSync(book, 'utf8')).账号 || {}); }
  catch { return null; }
  if (!accounts.length) return null;

  /*
    **不许"拿不到校验函数就当通过"**。
    那种回退正是这个项目最常见的失败方式：自检静默降级成
    「这个账号存在吗」，于是密码错了它照样绿。
    拿不到就直接抛，宁可自检报错，也不要假的绿。
  */
  const { verifyPassword } = require(path.join(ROOT, 'server/authStore.js'));
  if (typeof verifyPassword !== 'function') {
    throw new Error('authStore 没有导出 verifyPassword —— 自检无法进行，不做降级');
  }

  const pool = new Pool({ connectionString: url });
  const broken = [];
  try {
    for (const [who, a] of accounts) {
      const { rows: [u] } = await pool.query(
        'select password_hash, status, locked_until from auth_users where lower(username) = lower($1)',
        [a.登录名]);
      const locked = u?.locked_until && new Date(u.locked_until) > new Date();
      const ok = Boolean(u) && verifyPassword(a.密码, u.password_hash)
        && u.status === 'active' && !locked;
      if (!ok) broken.push(`${a.登录名}（${who}）`);
    }
  } finally { await pool.end(); }
  return broken;
};

const counts = async () => {
  const pool = new Pool({ connectionString: url });
  const out = {};
  for (const [k, t] of [['客户', 'customers'], ['线索', 'leads'], ['合同', 'contracts'], ['项目', 'projects'], ['不符合项', 'audit_issues'], ['工作日志', 'project_work_logs']]) {
    try { const { rows } = await pool.query(`select count(*) c from ${t}`); out[k] = Number(rows[0].c); }
    catch { out[k] = null; }
  }
  await pool.end();
  return out;
};

const cmd = process.argv[2] || 'status';

const snapshot = async () => {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  const buf = dockerPgDump();
  if (buf.length < 10000) throw new Error(`快照只有 ${buf.length} 字节，明显不对`);
  fs.writeFileSync(BASELINE, buf);
  const c = await counts();
  fs.writeFileSync(META, JSON.stringify({ at: new Date().toISOString(), size: buf.length, counts: c }, null, 2));
  console.log(`\n✅ 基线已保存  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`\n现在可以放开手脚走查了 —— 建项目、填假数据、传文件、乱点，`);
  console.log(`搞乱了随时 npm run walkthrough:reset 回到这一刻。\n`);
};

const reset = async () => {
  if (!fs.existsSync(BASELINE)) {
    console.error('\n❌ 还没有基线快照。先跑 npm run walkthrough:snapshot\n');
    process.exit(1);
  }
  const before = await counts();
  dockerPgRestore(BASELINE);
  const unlocked = await clearLockouts();
  const after = await counts();
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  console.log(`\n✅ 已还原到基线（${meta.at.slice(0, 16).replace('T', ' ')}）\n`);
  for (const k of Object.keys(after)) {
    const d = (before[k] ?? 0) - (after[k] ?? 0);
    console.log(`   ${k.padEnd(6)} ${String(before[k]).padStart(5)} → ${String(after[k]).padStart(5)}  ${d > 0 ? `（清掉 ${d} 条走查数据）` : ''}`);
  }
  console.log(`\n   账号密码不受影响（账号表不参与还原）${unlocked ? `，顺便解开了 ${unlocked} 个被锁的账号` : ''}`);

  // 自检：还原完，走查账号是不是真的还登得进去
  const broken = await verifyWalkthroughLogins();
  if (broken === null) {
    console.log('   （没有走查密码本，跳过登录自检）');
  } else if (broken.length === 0) {
    console.log('   ✅ 登录自检：走查账号全部仍可登录');
  } else {
    console.log(`\n   ❌ 登录自检不通过：${broken.join('、')} 登不进去了`);
    console.log('      跑这条修回来（改前自动备份）：');
    console.log('        npm run walkthrough:accounts -- --fix\n');
  }

  console.log('\n⚠️ 页面上可能还留着旧数据 —— 刷新一下浏览器。\n');
};

const status = async () => {
  if (!fs.existsSync(META)) {
    console.log('\n还没有基线快照。走查前先跑：npm run walkthrough:snapshot\n');
    return;
  }
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  const now = await counts();
  console.log(`\n基线时间：${meta.at.slice(0, 16).replace('T', ' ')}   大小 ${(meta.size / 1024 / 1024).toFixed(1)} MB\n`);
  console.log('           基线    现在    差异');
  for (const k of Object.keys(now)) {
    const b = meta.counts[k] ?? 0; const n = now[k] ?? 0; const d = n - b;
    console.log(`  ${k.padEnd(6)} ${String(b).padStart(6)} ${String(n).padStart(7)} ${d === 0 ? '' : `  ${d > 0 ? '+' : ''}${d}`}`);
  }
  console.log('\n差异就是走查期间造出来的数据。npm run walkthrough:reset 一键清掉。\n');
};

const main = { snapshot, reset, status }[cmd];
if (!main) { console.error(`未知命令 ${cmd}，可用：snapshot / reset / status`); process.exit(1); }
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
