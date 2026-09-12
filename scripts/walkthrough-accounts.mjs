/**
 * 走查账号救援 —— 把密码本里的密码重新写回库，并解开锁定。
 *
 * ── 为什么需要这个脚本（2026-09-11）───────────────────────────
 *
 * `walkthrough:reset` 曾经把 auth_users 一起倒回基线，
 * 而走查账号的密码是基线之后才设的 —— 于是还原完，
 * **拿着密码本也登不进去**，再试几次直接锁 15 分钟。
 * 报错说的是「密码输错」，人只会怀疑自己记错，
 * 想不到是刚才那条还原命令干的。
 *
 * reset 本身已经改成不碰账号表了（见 walkthrough-env.mjs），
 * 但已经被倒回去的库需要一个能修回来的办法，所以留下这个脚本。
 *
 * 用法：
 *   npm run walkthrough:accounts          看看密码本里的账号现在能不能登
 *   npm run walkthrough:accounts -- --fix 把密码写回去 + 解锁
 *
 * ⚠️ 只对本机开发库生效 —— 和 walkthrough-env 一样硬拦生产。
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
const { hashPassword } = require(path.join(ROOT, 'server/authStore.js'));

const url = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('\n❌ 拒绝执行：DATABASE_URL 不是本机地址。改密码这种事不在生产上用脚本做。\n');
  process.exit(1);
}

const CREDS = path.join(ROOT, '.runtime/走查账号密码.json');
if (!fs.existsSync(CREDS)) {
  console.error(`\n❌ 找不到密码本：${CREDS}\n`);
  process.exit(1);
}
const accounts = Object.entries(require(CREDS).账号);
const fix = process.argv.includes('--fix');

/*
  改数据前先备份 —— 这条是项目规矩，不是客套。
  备份失败就中止，不许"先改了再说"。
*/
const backup = () => {
  const dir = path.join(ROOT, '.runtime');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `auth_users-备份-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.sql`);
  const buf = execFileSync('docker', ['exec', 'xinyi-dev-db', 'pg_dump', '-d', url, '-t', 'auth_users'],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  if (buf.length < 500) throw new Error(`备份只有 ${buf.length} 字节，明显不对`);
  fs.writeFileSync(file, buf);
  return file;
};

const main = async () => {
  const pool = new Pool({ connectionString: url });
  const rows = [];
  for (const [who, a] of accounts) {
    const { rows: [u] } = await pool.query(
      'select id, username, status, failed_login_count, locked_until from auth_users where lower(username) = lower($1)',
      [a.登录名]);
    rows.push({ who, login: a.登录名, pwd: a.密码, u });
  }

  console.log('');
  for (const r of rows) {
    const locked = r.u?.locked_until && new Date(r.u.locked_until) > new Date();
    const state = !r.u ? '❌ 库里没有这个账号'
      : locked ? `🔒 锁定中（到 ${new Date(r.u.locked_until).toLocaleTimeString('zh-CN')}）`
      : r.u.status !== 'active' ? `⚠️ 状态 ${r.u.status}`
      : '✅ 正常';
    console.log(`  ${r.login.padEnd(12)} ${r.who.padEnd(16)} ${state}`);
  }

  if (!fix) {
    console.log('\n（只是看看。要把密码写回去并解锁，加 --fix）\n');
    await pool.end();
    return;
  }

  const file = backup();
  console.log(`\n已备份 auth_users → ${path.relative(ROOT, file)}`);

  /*
    ── 说清楚这条命令会覆盖掉什么（2026-09-12）────────────────────

    金恩来：「为什么我的 admin 的账号进不去了？」

    因为这个脚本会把**密码本里的密码写进每一个列出来的账号**，
    包括 admin。而 admin 是他自己天天用的账号，有他自己的密码 ——
    我上一轮跑 `--fix` 救走查账号时，顺手把它也覆盖了，没说一声。

    他下次登录用的是自己记得的那个密码，当然进不去，
    而且系统只会说「账号或密码不对」，看不出是被人改过。

    改不了这个脚本的职责（它就是用来重置密码的），
    但可以让它**把要覆盖的账号明明白白列出来**，
    尤其点名 admin —— 覆盖之后那个账号的旧密码就作废了。
  */
  console.log('\n⚠️  下面这些账号的密码会被**改成密码本里的值**，原来的密码作废：');
  rows.filter(r => r.u).forEach(r => {
    const warn = r.login === 'admin' ? '   ← 这是你自己常用的管理员账号' : '';
    console.log(`      ${r.login}${warn}`);
  });
  console.log('   改完之后，登录一律用 .runtime/走查账号密码.json 里的密码。\n');

  let n = 0;
  for (const r of rows) {
    if (!r.u) continue;
    await pool.query(
      `update auth_users
          set password_hash = $2,
              must_change_password = false,   -- 走查账号是给人按手册走流程的，别在第一步就卡改密码
              failed_login_count = 0,
              locked_until = null,
              last_failed_login_at = null,
              status = 'active',
              updated_at = now()
        where id = $1`,
      [r.u.id, hashPassword(r.pwd)]);
    n++;
  }
  // 会话一并清掉：密码变了还留着旧会话，等于密码没变
  await pool.query('delete from auth_sessions');
  await pool.end();
  console.log(`✅ ${n} 个走查账号的密码已按密码本写回，锁定已解除，旧会话已清空。\n`);
};

main().catch((e) => { console.error('\n❌', e.message, '\n'); process.exit(1); });
