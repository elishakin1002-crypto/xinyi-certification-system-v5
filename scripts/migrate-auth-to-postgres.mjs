/**
 * 把员工账号从 JSON 文件搬进 PostgreSQL。
 *
 * ── 为什么必须做（不是优化，是修 bug）────────────────────────
 * authStore 的文件模式把**整份账号表读进内存**（启动时读一次），
 * 每次写入都是把内存里那份**整个**倒回文件。
 *
 * 于是只要有两个进程同时持有这份数据，后写的就会静默销毁先写的改动。
 * 2026-08-28 已经这么丢过一次 11 个账号——没有任何报错，
 * 两天后有人问「账号建好了吗」才发现。
 *
 * 上线后这个风险更实在：守护进程重启时旧进程还没完全退出，
 * 两个进程各持一份副本，丢的是员工账号和所有人的登录会话。
 *
 * PG 模式是逐行 SQL 写入，没有「整份倒回」这回事，问题从根上消失。
 *
 * ── 这个脚本做什么 ────────────────────────────────────────────
 * 把 JSON 文件里的 users 和 sessions 搬进 auth_users / auth_sessions。
 * **不删原文件**——搬完之后它还在原地，切回文件模式随时能回退。
 *
 * 用法：
 *   node scripts/migrate-auth-to-postgres.mjs           # 预演
 *   node scripts/migrate-auth-to-postgres.mjs --apply   # 真搬
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

const env = {};
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const storePath = path.resolve(root, env.AUTH_STORE_PATH || env.XINYI_AUTH_STORE_PATH || '.runtime/auth_store.json');
/*
  目标库用 XINYI_DB_URL——和业务数据同一个库。
  账号和业务数据分两个库没有好处：备份要备两份、恢复要对两次时间点，
  而它们本来就该是同一个时间点的快照。
*/
const dbUrl = env.DATABASE_URL || env.XINYI_DB_URL;

const apply = process.argv.includes('--apply');

const main = async () => {
  if (!dbUrl) { console.error('\n没有配置 XINYI_DB_URL 或 DATABASE_URL，搬不了。\n'); process.exit(2); }
  if (!fs.existsSync(storePath)) { console.error(`\n找不到账号文件：${storePath}\n`); process.exit(2); }

  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const users = Array.isArray(raw.users) ? raw.users : [];
  const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];

  console.log(`\n源文件　${storePath}`);
  console.log(`目标库　${String(dbUrl).replace(/:\/\/[^@]*@/, '://***@')}\n`);
  console.log(`账号 ${users.length} 个、会话 ${sessions.length} 条`);
  for (const u of users) {
    console.log(`  ${String(u.name || '').padEnd(10)} ${String(u.username || u.email || '').padEnd(16)} ${(u.roles || []).join(',')}`);
  }

  if (!apply) {
    console.log('\n确认无误后加 --apply 真正搬迁。原文件不会被删除，随时能回退。');
    process.exit(0);
  }

  /*
    让 authStore 自己去建表——表结构定义在它里面（initPostgresAuthStore），
    这里另写一份 CREATE TABLE 就是第二处真相，迟早对不上。
  */
  process.env.DATABASE_URL = dbUrl;
  if (env.PGSSLMODE) process.env.PGSSLMODE = env.PGSSLMODE;
  const store = require(path.join(root, 'server/authStore.js'));
  await store.initAuthStore();

  const health = await store.getAuthHealth();
  if (health.mode !== 'postgres') {
    console.error(`\n❌ authStore 没有切到 postgres（当前 ${health.mode}：${health.reason}）\n`);
    process.exit(1);
  }

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: String(env.PGSSLMODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined,
  });

  let moved = 0;
  let skipped = 0;
  try {
    for (const u of users) {
      /*
        直接写库，不走 createUser——那个会**重新哈希密码**，
        而我们手上只有哈希值，没有原文。走它的话所有人都得改密码。
        ON CONFLICT DO NOTHING：重复跑一次不会覆盖已有账号。
      */
      const r = await pool.query(
        `INSERT INTO auth_users (
           id, email, username, name, password_hash, roles, active_role,
           position_tags, reports_to_user_id, status, must_change_password,
           failed_login_count, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,
                   COALESCE($13::timestamptz, NOW()), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          u.id, u.email || null, u.username || null, u.name,
          u.passwordHash || u.password_hash,
          JSON.stringify(u.roles || ['CONSULTANT']),
          u.activeRole || u.active_role || (u.roles || ['CONSULTANT'])[0],
          JSON.stringify(u.positionTags || u.position_tags || []),
          u.reportsToUserId || u.reports_to_user_id || null,
          u.status || 'active',
          Boolean(u.mustChangePassword ?? u.must_change_password),
          Number(u.failedLoginCount || u.failed_login_count || 0),
          u.createdAt || u.created_at || null,
        ]);
      if (r.rowCount > 0) { moved++; console.log(`  ✅ ${u.name}`); }
      else { skipped++; console.log(`  ·  ${u.name}（库里已有，跳过）`); }
    }

    /*
      会话也搬。不搬的话所有人当场被登出——
      对正在用系统的人来说，那是一次没有预告的中断。
    */
    let movedSessions = 0;
    for (const s of sessions) {
      const r = await pool.query(
        `INSERT INTO auth_sessions (id, user_id, created_at, expires_at)
         VALUES ($1,$2,COALESCE($3::timestamptz, NOW()),$4::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.userId || s.user_id, s.createdAt || s.created_at || null, s.expiresAt || s.expires_at]);
      if (r.rowCount > 0) movedSessions++;
    }

    const { rows } = await pool.query('SELECT count(*)::int n FROM auth_users');
    const { rows: sr } = await pool.query('SELECT count(*)::int n FROM auth_sessions');

    console.log(`\n搬迁完成：账号 ${moved} 新增 / ${skipped} 已存在，会话 ${movedSessions} 条`);
    console.log(`库里现有：auth_users ${rows[0].n} 行、auth_sessions ${sr[0].n} 行`);

    const ok = rows[0].n >= users.length;
    console.log(ok ? '\n✅ 数量对得上。' : `\n❌ 对不上：文件里 ${users.length} 个，库里只有 ${rows[0].n} 个`);
    if (!ok) process.exitCode = 1;

    console.log(`\n下一步：在 .env.local 里加一行`);
    console.log(`  DATABASE_URL=${String(dbUrl).replace(/:\/\/[^@]*@/, '://***@')}`);
    console.log('然后重启后端。原文件留在原地，出问题删掉那行就回退了。\n');
  } finally {
    await pool.end();
  }
  process.exit(process.exitCode || 0);
};

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
