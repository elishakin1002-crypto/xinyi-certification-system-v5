/**
 * 把 admin 账号一分为二：老板归老板，管理员归管理员。
 *
 * ── 为什么要分 ────────────────────────────────────────────────
 * 现在一个 admin 账号既是曾云俊（总经理）又被金恩来（技术负责人）在用。
 * 后果不是"不方便"，是**审计账本失效**：
 * 谁改了合同金额、谁确认了回款，记录里全写着同一个人。
 * 出了争议翻账本，翻出来的是一笔糊涂账。
 *
 * ── 这个系统里 ADMIN ≠ 管理员 ─────────────────────────────────
 *   ADMIN      = 老板       全局视野，关注风险与利润        → 曾云俊
 *   SYS_ADMIN  = 系统管理员  系统维护、账号与配置            → 金恩来
 * 名字容易误导，分配角色前先看 constants.ts 的 SYSTEM_ROLES。
 *
 * ── 用法 ──────────────────────────────────────────────────────
 *   node scripts/split-admin-account.mjs --passwords=/tmp/pw.json [--apply]
 * 不带 --apply 只演练，不写库。
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const pwArg = process.argv.find((a) => a.startsWith('--passwords='));

/*
  邮箱也必须跟着分 —— 这是 2026-09-09 补的，也是第一版最大的漏。

  登录判定是 `WHERE lower(email) = $1 OR lower(username) = $1`
  （server/authStore.js），**邮箱和用户名是同一个口子**。
  第一版只把 username 从 admin 改成 zengyunjun，却把
  admin@xinyi-iso.local 这个邮箱留在了老板账号上，结果生产上：

    输 admin                  → 进金恩来（系统管理员）
    输 admin@xinyi-iso.local  → 进曾云俊（总经理）

  两个长得一模一样的凭据通向两个人，而且通向的是**权限最大的那个**。
  金恩来 2026-09-09 就是这么撞上的。

  「分开账号」这件事只改一半比不改更危险：不改的话大家知道
  admin 是共用的、会当心；改一半会让人以为已经分开了。
*/
const BOSS = { name: '曾云俊', username: 'zengyunjun', email: 'zengyunjun@xinyi-iso.local', title: '总经理' };
const SYSADMIN = { name: '金恩来', username: 'admin', email: 'admin@xinyi-iso.local', roles: ['SYS_ADMIN'], title: '系统管理员' };

/*
  这个脚本既要能在服务器上跑（/opt/xinyi），也要能在开发机上跑。

  第一版把路径写死成 /opt/xinyi/... —— 于是它只在生产跑过，
  **本机开发库一直停在拆分前的状态**：一个 admin 账号身兼四个角色。
  开发库和生产不一致本身就是个坑：在本地验的东西不代表线上的样子，
  反过来也是。2026-09-09 就因为这个白查了一轮。
*/
const SERVER_ROOT = '/opt/xinyi';
const onServer = fs.existsSync(path.join(SERVER_ROOT, 'server/authStore.js'));
// 必须走 fileURLToPath：仓库目录名是中文，URL 里是百分号编码，直接取 pathname 会拿到乱码路径
const ROOT = onServer ? SERVER_ROOT : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_DIR = onServer ? path.join(SERVER_ROOT, 'backups') : path.join(ROOT, '.runtime/backups');

/*
  模块解析要锚在 ROOT，不能锚在脚本自己身上。

  否则从别处（比如临时拷到 /tmp）跑这个脚本时，
  `require('dotenv')` 会去 /tmp/node_modules 底下找，直接 MODULE_NOT_FOUND。
  锚在 ROOT/package.json 上，脚本放哪儿都能正确找到项目的依赖。
*/
const require = createRequire(path.join(ROOT, 'package.json'));

/*
  两边都要读 .env.local。

  我一开始以为服务器上环境变量由 systemd 注入，就跳过了 dotenv ——
  结果 `systemctl cat xinyi` 里只有 NODE_ENV=production，
  数据库连接串其实也在 /opt/xinyi/.env.local 里。
  不读它的后果不是报错，是 authStore **静默退回非 postgres 模式**，
  然后报「找不到曾云俊」—— 看起来像数据不对，其实是连错了库。
*/
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config({ path: path.join(ROOT, '.env') });

/**
 * 改动账号前必须先备份。
 * 2026-08-28 丢过 11 个账号，那次的教训不是"手要稳"，
 * 是**没有可回退的东西**——出事时只能靠回忆重建。
 *
 * 直接调 scripts/backup.mjs，不再自己拼 pg_dump ——
 * 原来那行写死的 `pg_dump` 在开发机上根本找不到（PATH 里没有），
 * 备份必失败、脚本必中止，等于这个脚本在本地压根跑不起来。
 * 而 backup.mjs 里已经有找 pg_dump 的逻辑和版本校验，重复一遍只会漂移。
 */
const backup = () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/backup.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /*
    抓 backup.mjs 打出的落盘路径 —— **说不出备份在哪就等于没备份**。
    只认「✅ 备份完成」那一行后面的绝对路径：
    第一版用了个宽松的 /backups|备份/ 正则，结果抓到的是上面那行
    「备份目标库：postgres://...」，报出来的"备份位置"其实是条连接串。
  */
  const file = (out.match(/备份完成\s+(\/\S+)/) || [])[1];
  if (!file || !fs.existsSync(file)) {
    throw new Error(`备份脚本没报出可核对的落盘路径，已中止 —— 不能在没有退路的情况下改账号。\n${out.slice(-500)}`);
  }
  return { file };
};

const main = async () => {
  const store = require(path.join(ROOT, 'server/authStore.js'));
  await store.initAuthStore();

  /*
    先确认连的是真库，再谈改账号。

    authStore 连不上 postgres 时会**静默退回文件/内存模式**，
    listUsers() 照样返回一份（空的或过期的）名单 ——
    于是脚本报的是「找不到曾云俊」，看着像数据不对，
    实际是连错了地方。2026-09-09 在生产上就这么被绕了一圈。
    改账号这种事，宁可因为看不清而停下，也不能对着错的库动手。
  */
  const health = await store.getAuthHealth();
  if (health.mode !== 'postgres') {
    throw new Error(`账号库当前是「${health.mode}」模式，不是 postgres。已中止 —— 多半是 DATABASE_URL 没读到（检查 ${path.join(ROOT, '.env.local')}）。`);
  }
  console.log(`账号库: ${health.mode} · ${health.users} 个账号\n`);

  const users = await store.listUsers();
  const boss = users.find((u) => u.name === BOSS.name);
  const sysadmin = users.find((u) => u.name === SYSADMIN.name);
  if (!boss) throw new Error(`找不到「${BOSS.name}」的账号。已中止 —— 情况和假设不符时不要硬改。`);

  /*
    两种局面都要能处理，因为它们真实存在过：

      全新拆分  开发库这种：一个 admin 账号身兼四角，还没分过。
      补邮箱    生产这种：username 已经分开了，但 admin@ 这个邮箱
                还挂在老板账号上 —— 分了一半，比没分更容易骗人。

    第一版只认第一种，遇到第二种直接「已经跑过了」退出，
    于是生产那半个坑就一直留着。
  */
  const needsSplit = !sysadmin;
  const strayEmail = String(boss.email || '').toLowerCase() === SYSADMIN.email.toLowerCase();

  console.log('当前:');
  console.log(`  ${boss.name}  username=${boss.username}  email=${boss.email || '(无)'}  roles=${boss.roles.join(',')}`);
  if (sysadmin) console.log(`  ${sysadmin.name}  username=${sysadmin.username}  email=${sysadmin.email || '(无)'}  roles=${sysadmin.roles.join(',')}`);

  if (!needsSplit && !strayEmail) {
    console.log('\n✅ 两个账号已经分干净了（用户名和邮箱都不重叠），无需改动。');
    return;
  }

  console.log('\n改成:');
  console.log(`  ${BOSS.name}  username=${BOSS.username}  email=${BOSS.email}  ← ${BOSS.title}（沿用原账号，历史记录不断）`);
  console.log(`  ${SYSADMIN.name}  username=${SYSADMIN.username}  email=${SYSADMIN.email}  roles=${SYSADMIN.roles.join(',')}  ← ${SYSADMIN.title}${needsSplit ? '（新建）' : '（已存在，补邮箱）'}`);
  if (strayEmail) {
    console.log(`\n  ⚠️ 重点：${SYSADMIN.email} 现在指向的是「${boss.name}」——`);
    console.log('     登录判定是 email OR username，所以这个邮箱是进老板账号的第二道门。');
  }

  if (!APPLY) {
    console.log('\n[演练] 未写库。加 --apply 才真正执行。');
    return;
  }

  const passwords = pwArg ? JSON.parse(fs.readFileSync(pwArg.split('=')[1], 'utf8')) : {};
  if (needsSplit && (!passwords.boss || !passwords.sysadmin)) {
    throw new Error('全新拆分需要 --passwords=<文件>，且文件里要有 boss / sysadmin 两个密码');
  }

  const b = backup();
  console.log(`\n已备份: ${b.file}`);

  /*
    顺序不能反：必须先把邮箱和用户名从老板账号上摘掉，
    才能挪到系统管理员账号上 —— 两张表里这两个字段都是唯一的。
  */
  await store.updateUser(boss.id, { username: BOSS.username, email: BOSS.email });
  console.log(`\n✓ ${BOSS.name} → username=${BOSS.username}  email=${BOSS.email}`);

  if (needsSplit) {
    await store.resetUserPassword(boss.id, passwords.boss);
    console.log(`  密码已重置，下次登录强制改密`);
    const created = await store.createUser({
      name: SYSADMIN.name,
      username: SYSADMIN.username,
      email: SYSADMIN.email,
      password: passwords.sysadmin,
      roles: SYSADMIN.roles,
      activeRole: SYSADMIN.roles[0],
      mustChangePassword: true
    });
    console.log(`✓ ${SYSADMIN.name} → username=${SYSADMIN.username}  email=${SYSADMIN.email}  id=${created.id}，下次登录强制改密`);
  } else {
    // 只补邮箱：**不碰密码**。人家正在用的账号，没理由因为一次修数据就要重新登录
    await store.updateUser(sysadmin.id, { email: SYSADMIN.email });
    console.log(`✓ ${SYSADMIN.name} → email=${SYSADMIN.email}（密码没动，不用重新登录）`);
  }

  const after = await store.listUsers();
  console.log(`\n账号总数: ${after.length}`);
  for (const u of after.filter((x) => ['ADMIN', 'SYS_ADMIN'].some((r) => x.roles.includes(r)))) {
    console.log(`  ${u.name.padEnd(8)} ${String(u.username).padEnd(14)} ${String(u.email || '(无邮箱)').padEnd(28)} ${u.roles.join(',').padEnd(34)} ${u.mustChangePassword ? '需改密' : '已设密'}`);
  }

  /*
    自检：确认「同一个凭据不会通向两个人」这件事真的成立了。
    上一版就是因为只验了 username、没验 email，才把半个坑留到了生产。
  */
  const logins = new Map();
  for (const u of after) {
    for (const key of [u.username, u.email].filter(Boolean).map((s) => String(s).toLowerCase())) {
      if (logins.has(key)) throw new Error(`凭据 ${key} 同时属于「${logins.get(key)}」和「${u.name}」—— 拆分没成功`);
      logins.set(key, u.name);
    }
  }
  console.log(`\n✅ 自检通过：${logins.size} 个登录凭据，各自只指向一个人。`);
};

main().then(() => process.exit(0)).catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
