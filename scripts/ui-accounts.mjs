/**
 * 六个角色的验收账号 —— 保证存在，密码不进对话、不进提示词。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-09-17）
 * ══════════════════════════════════════════════════════════════
 *
 * 之前每轮清点都在提示词里写「自己建六个 uat- 账号」，
 * 结果是两个问题叠在一起：
 *
 *   1. 库里攒了一堆没人清的号 —— uat-、vfadmin-、uicheck-、
 *      csboard-、iuv- ……每轮一套，没人记得哪套是哪轮的。
 *   2. **密码得写进脚本或提示词**。项目规矩第二条是
 *      「密码和密钥永远不进对话、不进仓库」，上一轮那个
 *      `btn-*` 账号的密码就明晃晃写在清点脚本里。
 *
 * 改法：账号固定六个（`ui-<角色小写>`），密码随机生成一次，
 * 存进 `.runtime/ui-accounts.json`（`.runtime/` 已 gitignore）。
 * 谁要用就 `loginAs(ctx, 'SALES')` —— **调用方从头到尾看不到密码**，
 * 也就没有「不小心贴进报告」这条路。
 *
 * 账号故意不删：删了下轮还得重建，而且经手过记录的账号本来就删不掉
 * （见 CLAUDE.md 第一条）。要停就在员工账号页停用。
 *
 * ── 怎么用 ────────────────────────────────────────────────────
 *
 *   node scripts/ui-accounts.mjs          # 确保六个号都在，打印用户名（不打印密码）
 *   node scripts/ui-accounts.mjs --reset  # 重置密码（忘了/被锁时用）
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });

const CREDS = path.join(ROOT, '.runtime/ui-accounts.json');

export const ROLES = {
  ADMIN: '总经理',
  SYS_ADMIN: '系统管理员',
  MANAGER: '总助',
  SALES: '销售',
  CONSULTANT: '咨询顾问',
  FINANCE: '财务'
};

/** 读密码本。给 ui-agent.mjs 的 loginAs 用 —— 它只往浏览器里填，不往外打印 */
export const credentials = () => {
  try {
    return JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  } catch {
    return null;
  }
};

const url = process.env.DATABASE_URL || '';

const main = async () => {
  /*
    只在本机开发库上动账号。
    改密码这种事不在生产上用脚本做 —— 和 walkthrough-accounts.mjs 同一条线。
  */
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('\n❌ 拒绝执行：DATABASE_URL 不是本机地址。验收账号只在本机建。\n');
    process.exit(1);
  }

  const reset = process.argv.includes('--reset');
  const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
  const { hashPassword } = require(path.join(ROOT, 'server/authStore.js'));
  const pool = new Pool({ connectionString: url });

  const book = credentials() || {};
  const report = [];

  try {
    for (const [role, 中文] of Object.entries(ROLES)) {
      const username = `ui-${role.toLowerCase().replace('_', '-')}`;
      const found = await pool.query('select id, status, locked_until from auth_users where username = $1', [username]);

      // 32 位随机密码。人不用记，也就没有「设个好记的」这条退路
      const password = book[role]?.password && !reset
        ? book[role].password
        : crypto.randomBytes(24).toString('base64url').slice(0, 24) + 'aA1!';

      if (found.rowCount === 0) {
        const id = `U-AUTH-UI-${role}`;
        await pool.query(
          `insert into auth_users (id, username, name, password_hash, roles, active_role, position_tags,
             status, must_change_password, extra_actions, denied_actions, created_at, updated_at)
           values ($1,$2,$3,$4,$5::jsonb,$6,'[]'::jsonb,'active',false,'[]'::jsonb,'[]'::jsonb,NOW(),NOW())`,
          [id, username, `验收-${中文}`, hashPassword(password), JSON.stringify([role]), role]
        );
        report.push(`建号 ${username}（${中文}）`);
      } else if (reset || !book[role]) {
        /*
          没有密码本 = 这个号是以前建的、密码无从得知，必须重置。
          顺手解锁：连试几次登录失败会锁 15 分钟，而锁着的号
          报的错是「密码不对」，人只会怀疑自己记错（踩过）。
        */
        await pool.query(
          `update auth_users set password_hash=$1, locked_until=null, failed_login_count=0,
             must_change_password=false, status='active', updated_at=NOW() where username=$2`,
          [hashPassword(password), username]
        );
        report.push(`重置 ${username}（${中文}）`);
      } else {
        report.push(`已有 ${username}（${中文}）`);
      }
      book[role] = { username, password };
    }

    fs.mkdirSync(path.dirname(CREDS), { recursive: true });
    fs.writeFileSync(CREDS, JSON.stringify(book, null, 2), 'utf8');
    fs.chmodSync(CREDS, 0o600);

    report.forEach((line) => console.log('  ' + line));
    console.log(`\n✅ 六个验收账号就绪。密码存在 ${path.relative(ROOT, CREDS)}（已 gitignore，权限 600）。`);
    console.log('   用法：import { loginAs } from "./scripts/ui-agent.mjs"; await loginAs(ctx, "SALES");');
    console.log('   ⚠️ 不要打印这个文件的内容，也不要把密码写进报告。');
  } finally {
    await pool.end();
  }
};

// 被 import 时不执行，只有直接 node 跑才建号
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
