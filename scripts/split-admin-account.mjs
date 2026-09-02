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

const require = createRequire(import.meta.url);
const APPLY = process.argv.includes('--apply');
const pwArg = process.argv.find((a) => a.startsWith('--passwords='));

const BOSS = { name: '曾云俊', username: 'zengyunjun', title: '总经理' };
const SYSADMIN = { name: '金恩来', username: 'admin', roles: ['SYS_ADMIN'], title: '系统管理员' };

/**
 * 改动账号前必须先备份。
 * 2026-08-28 丢过 11 个账号，那次的教训不是"手要稳"，
 * 是**没有可回退的东西**——出事时只能靠回忆重建。
 */
const backup = () => {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL 未设置');
  const dir = path.resolve('/opt/xinyi/backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pre-account-split-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  execFileSync('pg_dump', ['-d', url, '-Fc', '-f', file], { stdio: 'pipe' });
  const size = fs.statSync(file).size;
  if (size < 10000) throw new Error(`备份文件只有 ${size} 字节，明显不对`);
  return { file, size };
};

const main = async () => {
  const store = require('/opt/xinyi/server/authStore.js');
  await store.initAuthStore();

  const users = await store.listUsers();
  const current = users.find((u) => u.username === 'admin');
  if (!current) throw new Error('找不到 username=admin 的账号');
  if (current.name !== BOSS.name) {
    throw new Error(`admin 账号的姓名是「${current.name}」，不是预期的「${BOSS.name}」。已中止 —— 情况和假设不符时不要硬改。`);
  }
  if (users.some((u) => u.username === BOSS.username)) {
    throw new Error(`${BOSS.username} 已存在，说明这个脚本跑过了。已中止。`);
  }

  console.log('当前:');
  console.log(`  ${current.name}  username=admin  roles=${current.roles.join(',')}`);
  console.log('\n改成:');
  console.log(`  ${BOSS.name}      username=${BOSS.username}  roles=${current.roles.join(',')}   ← ${BOSS.title}（沿用原账号，历史记录不断）`);
  console.log(`  ${SYSADMIN.name}      username=${SYSADMIN.username}  roles=${SYSADMIN.roles.join(',')}                    ← ${SYSADMIN.title}（新建）`);

  if (!APPLY) {
    console.log('\n[演练] 未写库。加 --apply 才真正执行。');
    return;
  }

  const passwords = JSON.parse(fs.readFileSync(pwArg.split('=')[1], 'utf8'));
  if (!passwords.boss || !passwords.sysadmin) throw new Error('密码文件缺少 boss / sysadmin');

  const b = backup();
  console.log(`\n已备份: ${b.file}  (${(b.size / 1024 / 1024).toFixed(1)} MB)`);

  // 顺序不能反：先把 admin 这个名字腾出来，才能建新的 admin
  await store.updateUser(current.id, { username: BOSS.username });
  await store.resetUserPassword(current.id, passwords.boss);
  console.log(`\n✓ ${BOSS.name} → username=${BOSS.username}，密码已重置，下次登录强制改密`);

  const created = await store.createUser({
    name: SYSADMIN.name,
    username: SYSADMIN.username,
    password: passwords.sysadmin,
    roles: SYSADMIN.roles,
    activeRole: SYSADMIN.roles[0],
    mustChangePassword: true
  });
  console.log(`✓ ${SYSADMIN.name} → username=${SYSADMIN.username}  id=${created.id}，下次登录强制改密`);

  const after = await store.listUsers();
  console.log(`\n账号总数: ${after.length}`);
  for (const u of after.filter((x) => ['ADMIN', 'SYS_ADMIN'].some((r) => x.roles.includes(r)))) {
    console.log(`  ${u.name.padEnd(8)} ${String(u.username).padEnd(14)} ${u.roles.join(',').padEnd(34)} ${u.mustChangePassword ? '需改密' : '已设密'}`);
  }
};

main().then(() => process.exit(0)).catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
