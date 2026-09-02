const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');

const AUTH_STORE_PATH = path.resolve(
  process.cwd(),
  process.env.AUTH_STORE_PATH || process.env.XINYI_AUTH_STORE_PATH || '.runtime/auth_store.json'
);

const SESSION_TTL_MS = Math.max(10 * 60 * 1000, Number(process.env.XINYI_SESSION_TTL_MS || 8 * 60 * 60 * 1000));
const DEFAULT_SEED_EMAIL = String(process.env.XINYI_AUTH_SEED_ADMIN_EMAIL || 'admin@xinyi-iso.local').trim().toLowerCase();
const DEFAULT_SEED_PASSWORD = String(process.env.XINYI_AUTH_SEED_ADMIN_PASSWORD || '').trim();
const MAX_FAILED_LOGIN_ATTEMPTS = Math.max(3, Number(process.env.XINYI_AUTH_MAX_FAILED_LOGIN_ATTEMPTS || 5));
const LOGIN_LOCK_MS = Math.max(1000, Number(process.env.XINYI_AUTH_LOCK_MS || 15 * 60 * 1000));

let pool = null;
let backend = {
  mode: 'file',
  ready: false,
  reason: 'not-initialized',
  users: 0,
  path: AUTH_STORE_PATH
};
let storeReady = false;
let store = { users: [], sessions: [], auditLogs: [] };

const nowIso = () => new Date().toISOString();
const normalizeAccount = (raw) => String(raw || '').trim().toLowerCase();
/*
  合法角色**从权限矩阵（constants.ts 的 ROLE_CAPABILITIES）推导**，不在这里另列一份。

  2026-08-21 之前这里是写死的四个：ADMIN / MANAGER / CONSULTANT / FINANCE，
  而权限矩阵里有六个——少了 SALES 和 SYS_ADMIN。后果是**销售账号根本建不出来**：
  传 roles:['SALES'] 不报错，被 normalizeRoles 静默丢掉，落库变成 CONSULTANT。
  对一家销售驱动的公司来说，这等于所有销售都被建成了顾问，而且没有任何提示。

  两份清单必然漂移，所以只留一份。解析失败时退回硬编码兜底，
  但兜底里补齐了六个角色——宁可兜底也是全的，也不能再出现「少一个角色」。
*/
const FALLBACK_ROLES = ['ADMIN', 'SYS_ADMIN', 'MANAGER', 'SALES', 'CONSULTANT', 'FINANCE'];
const VALID_ROLES = (() => {
  try {
    const { loadCapabilities } = require('./authz/authorize');
    const keys = Object.keys(loadCapabilities() || {});
    if (keys.length) return new Set(keys);
  } catch (e) {
    console.warn('[authStore] 无法从权限矩阵读取角色，使用兜底清单:', e?.message);
  }
  return new Set(FALLBACK_ROLES);
})();
const VALID_STATUSES = new Set(['active', 'disabled']);
const isFutureIso = (value) => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && time > Date.now();
};
const parseBoolean = (raw, fallback = false) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};
// 会话滑动续期：只要还在用系统，会话就不断往后顺延，只有"连续闲置超过 TTL"才需要重新登录。
// 关掉它（XINYI_SESSION_SLIDING=false）就退回旧的固定过期行为。
const SESSION_SLIDING_ENABLED = parseBoolean(process.env.XINYI_SESSION_SLIDING, true);
// 剩余寿命低于这个阈值才续期，避免每个请求都写库/写盘。
const SESSION_RENEW_THRESHOLD_MS = Math.max(
  60 * 1000,
  Number(process.env.XINYI_SESSION_RENEW_THRESHOLD_MS || Math.floor(SESSION_TTL_MS / 2))
);
const shouldRenewSession = (expiresAt) => {
  if (!SESSION_SLIDING_ENABLED) return false;
  const time = Date.parse(expiresAt || '');
  if (!Number.isFinite(time)) return false;
  return time - Date.now() < SESSION_RENEW_THRESHOLD_MS;
};
const requireAuthPostgres = () => parseBoolean(process.env.XINYI_AUTH_REQUIRE_POSTGRES, false);
const usePostgres = () => Boolean(String(process.env.DATABASE_URL || '').trim());
/**
 * 把日期规整成 YYYY-MM-DD。
 *
 * **PG 的 DATE 列取出来是 JS Date 对象**，直接 String() 得到的是
 * "Thu Oct 01 2026 08:00:00 GMT+0800..." —— 截前 10 位就成了 "Thu Oct 0"，
 * 再写回库里报 `invalid input syntax for type date`。
 *
 * 前端传进来的又是 "2026-10-01" 字符串。两种都要认。
 */
const toDateOnly = (v) => {
  if (!v) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    /*
      **必须用本地日期部件，不能用 toISOString()。**

      PG 的 DATE 列没有时区，node-pg 把它解析成「本地时间的零点」。
      在东八区，2026-10-01 00:00+08:00 转成 UTC 是 2026-09-30 16:00，
      `toISOString().slice(0,10)` 就变成了 "2026-09-30"——**日期倒退一天**。

      实测踩到：存 2026-10-01 读回来是 2026-09-29，
      而且「到期日当天」会被判成已过期。
    */
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);   // 前端传的就是这种
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : toDateOnly(d);
};

/** 今天（**本地**日期）。同样不能用 toISOString——东八区会算成昨天 */
const todayLocal = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const toUserProfile = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  username: user.username,
  roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : ['CONSULTANT'],
  activeRole: user.activeRole || (Array.isArray(user.roles) && user.roles[0]) || 'CONSULTANT',
  positionTags: Array.isArray(user.positionTags) ? user.positionTags : [],
  reportsToUserId: user.reportsToUserId,
  /*
    企业微信 userid。**不是姓名，也不是手机号**——是企业微信通讯录里的成员账号，
    管理员在「通讯录」里能看到，形如 ZhangSan 或 zhangsan001。

    没填就发不到这个人。系统不会因此报错，只会安静地不发——
    宁可不发，也不能像旧的模拟实现那样标记成「已推送」而实际没发。
  */
  wecomUserId: String(user.wecomUserId || '').trim(),
  /*
    ── 单项权限委派与账号有效期（2026-09-01，待办 P0-3/P0-4）────
    角色是打包的：给顾问加「销售」角色，他就连全公司合同金额一起看到了。
    而实际需求经常是「她能跟线索，但看不到金额」——
    那需要在角色之外单独加/减一两个动作。

    extraActions     在角色默认之外**额外给**的
    deniedActions    显式**收走**的，优先级最高（收走比给予更需要确定性）
    accountExpiresAt 账号有效期，给兼职和临时合作方用；空 = 永久
  */
  extraActions: Array.isArray(user.extraActions) ? user.extraActions : [],
  deniedActions: Array.isArray(user.deniedActions) ? user.deniedActions : [],
  accountExpiresAt: toDateOnly(user.accountExpiresAt),
  status: user.status || 'active',
  mustChangePassword: Boolean(user.mustChangePassword)
});

const toUserProfileFromRow = (row) => toUserProfile({
  id: row.id,
  name: row.name,
  email: row.email,
  username: row.username,
  roles: Array.isArray(row.roles) ? row.roles : ['CONSULTANT'],
  activeRole: row.active_role,
  positionTags: Array.isArray(row.position_tags) ? row.position_tags : [],
  reportsToUserId: row.reports_to_user_id,
  wecomUserId: row.wecom_user_id || '',
  extraActions: Array.isArray(row.extra_actions) ? row.extra_actions : [],
  deniedActions: Array.isArray(row.denied_actions) ? row.denied_actions : [],
  accountExpiresAt: toDateOnly(row.account_expires_at),
  status: row.status,
  mustChangePassword: row.must_change_password
});

const normalizeRoles = (rawRoles) => {
  const list = Array.isArray(rawRoles) ? rawRoles : [];
  const asked = list.map((role) => String(role || '').trim().toUpperCase()).filter(Boolean);

  /*
    传了不认识的角色要**报错**，不能静默丢掉。
    原来的写法是 filter 掉非法值再兜底成 CONSULTANT——
    传 SALES 建出来的是 CONSULTANT，调用方毫不知情。
    建账号是低频高危操作，宁可失败也不能默默建错身份。
  */
  const unknown = asked.filter((role) => !VALID_ROLES.has(role));
  if (unknown.length) {
    throw new Error(`未知角色：${unknown.join('、')}。可用角色：${[...VALID_ROLES].join('、')}`);
  }

  const roles = Array.from(new Set(asked));
  return roles.length > 0 ? roles : ['CONSULTANT'];   // 没指定角色时的默认值
};

const normalizeUserInput = (input = {}, { requirePassword = false } = {}) => {
  const name = String(input.name || '').trim();
  const email = normalizeAccount(input.email);
  const username = normalizeAccount(input.username);
  const password = String(input.password || '');
  const roles = normalizeRoles(input.roles);
  const activeRoleRaw = String(input.activeRole || input.active_role || '').trim().toUpperCase();
  const activeRole = roles.includes(activeRoleRaw) ? activeRoleRaw : roles[0];
  const positionTags = Array.isArray(input.positionTags || input.position_tags)
    ? (input.positionTags || input.position_tags).map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  const reportsToUserId = String(input.reportsToUserId || input.reports_to_user_id || '').trim();
  const statusRaw = String(input.status || 'active').trim().toLowerCase();
  const status = VALID_STATUSES.has(statusRaw) ? statusRaw : 'active';
  const mustChangePassword = Object.prototype.hasOwnProperty.call(input, 'mustChangePassword')
    ? parseBoolean(input.mustChangePassword, true)
    : parseBoolean(input.must_change_password, true);

  if (!name) throw new Error('name is required');
  if (!email && !username) throw new Error('email or username is required');
  if (requirePassword && password.length < 8) throw new Error('password must be at least 8 characters');

  return {
    name,
    email,
    username,
    password,
    roles,
    activeRole,
    positionTags,
    reportsToUserId,
    wecomUserId: String(input.wecomUserId || input.wecom_user_id || '').trim(),
    // 动作码统一大写，避免大小写不一致导致「配了但不生效」
    extraActions: (Array.isArray(input.extraActions || input.extra_actions) ? (input.extraActions || input.extra_actions) : [])
      .map((a) => String(a || '').trim().toUpperCase()).filter(Boolean),
    deniedActions: (Array.isArray(input.deniedActions || input.denied_actions) ? (input.deniedActions || input.denied_actions) : [])
      .map((a) => String(a || '').trim().toUpperCase()).filter(Boolean),
    accountExpiresAt: toDateOnly(input.accountExpiresAt || input.account_expires_at),
    status,
    mustChangePassword
  };
};

const publicUser = (user) => {
  const profile = toUserProfile(user);
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email || '',
    username: profile.username || '',
    roles: profile.roles,
    activeRole: profile.activeRole,
    positionTags: profile.positionTags || [],
    reportsToUserId: profile.reportsToUserId || '',
    wecomUserId: profile.wecomUserId || '',
    /*
      publicUser 是**白名单式**的：只有列在这里的字段才会发到前端。
      新加字段忘了补这里的话，接口照样 200、页面上就是空的——
      表单里配好的权限委派存进去了却读不出来，看起来像「没存上」。
    */
    extraActions: profile.extraActions || [],
    deniedActions: profile.deniedActions || [],
    accountExpiresAt: profile.accountExpiresAt || '',
    status: profile.status || 'active',
    mustChangePassword: Boolean(profile.mustChangePassword)
  };
};

const publicUserFromRow = (row) => publicUser({
  id: row.id,
  name: row.name,
  email: row.email,
  username: row.username,
  roles: Array.isArray(row.roles) ? row.roles : ['CONSULTANT'],
  activeRole: row.active_role,
  positionTags: Array.isArray(row.position_tags) ? row.position_tags : [],
  reportsToUserId: row.reports_to_user_id,
  wecomUserId: row.wecom_user_id || '',
  extraActions: Array.isArray(row.extra_actions) ? row.extra_actions : [],
  deniedActions: Array.isArray(row.denied_actions) ? row.denied_actions : [],
  accountExpiresAt: toDateOnly(row.account_expires_at),
  status: row.status,
  mustChangePassword: row.must_change_password
});

const sanitizeAuditMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const blocked = new Set(['password', 'passwordHash', 'password_hash']);
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !blocked.has(String(key)))
      .map(([key, value]) => [key, value])
  );
};

const publicAuditLogFromRow = (row) => ({
  id: row.id,
  actorUserId: row.actor_user_id || '',
  actorName: row.actor_name || '',
  action: row.action,
  targetUserId: row.target_user_id || '',
  targetName: row.target_name || '',
  metadata: sanitizeAuditMetadata(row.metadata || {}),
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')
});

const ensureDir = async () => {
  await fs.mkdir(path.dirname(AUTH_STORE_PATH), { recursive: true });
};

const readStore = async () => {
  try {
    const raw = await fs.readFile(AUTH_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    store = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : []
    };
  } catch {
    store = { users: [], sessions: [], auditLogs: [] };
  }
};

const writeStore = async () => {
  await ensureDir();
  await fs.writeFile(AUTH_STORE_PATH, JSON.stringify({ updatedAt: nowIso(), ...store }, null, 2));
};

const initPostgresAuthStore = async () => {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.PGSSLMODE || '').toLowerCase() === 'require'
      ? { rejectUnauthorized: false }
      : undefined
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      username TEXT UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      roles JSONB NOT NULL DEFAULT '["CONSULTANT"]'::jsonb,
      active_role TEXT NOT NULL DEFAULT 'CONSULTANT',
      position_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      reports_to_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      must_change_password BOOLEAN NOT NULL DEFAULT false,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      last_failed_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
  `);
  // 单项权限委派与账号有效期（2026-09-01）
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS extra_actions JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS denied_actions JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS account_expires_at DATE;`);
  await pool.query(`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS wecom_user_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  /*
    会话来源字段。

    ⚠️ **表结构在两个地方定义**：这里，和 db/migrations/。
    生产库走迁移，而测试和全新环境走的是上面这段 CREATE TABLE ——
    2026-09-02 加 ip/user_agent 时只改了迁移，结果生产正常、
    测试全线报「column "ip" does not exist」。

    所以新增列要两边都写。用 ALTER ... IF NOT EXISTS 而不是塞进 CREATE TABLE：
    CREATE TABLE IF NOT EXISTS 对**已存在**的表什么都不做，
    写在里面对老库无效，只有新库才有 —— 那就是另一种版本不一致。
    tests/session-origin.test.js 会检查两边同步。
  */
  await pool.query(`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip           TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent   TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth_sessions (expires_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_name TEXT,
      action TEXT NOT NULL,
      target_user_id TEXT,
      target_name TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at
    ON auth_audit_logs (created_at DESC);
  `);
};

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const iterations = 210000;
  const digest = 'sha256';
  const derived = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, digest).toString('hex');
  return `pbkdf2$${iterations}$${digest}$${salt}$${derived}`;
};

const verifyPassword = (password, passwordHash) => {
  const parts = String(passwordHash || '').split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const [, iterationsRaw, digest, salt, expected] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0 || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password || ''), salt, iterations, Buffer.from(expected, 'hex').length, digest).toString('hex');
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const markFileLoginFailure = async (user) => {
  const idx = store.users.findIndex((item) => item.id === user.id);
  if (idx < 0) return;
  const failedLoginCount = Number(store.users[idx].failedLoginCount || 0) + 1;
  store.users[idx] = {
    ...store.users[idx],
    failedLoginCount,
    lastFailedLoginAt: nowIso(),
    lockedUntil: failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS
      ? new Date(Date.now() + LOGIN_LOCK_MS).toISOString()
      : store.users[idx].lockedUntil || ''
  };
  await writeStore();
};

const clearFileLoginFailures = async (user) => {
  const idx = store.users.findIndex((item) => item.id === user.id);
  if (idx < 0) return;
  if (!store.users[idx].failedLoginCount && !store.users[idx].lockedUntil && !store.users[idx].lastFailedLoginAt) return;
  store.users[idx] = {
    ...store.users[idx],
    failedLoginCount: 0,
    lockedUntil: '',
    lastFailedLoginAt: ''
  };
};

const markPostgresLoginFailure = async (userId) => {
  await pool.query(
    `
      UPDATE auth_users
      SET failed_login_count = failed_login_count + 1,
          last_failed_login_at = NOW(),
          locked_until = CASE
            WHEN failed_login_count + 1 >= $2 THEN NOW() + ($3::int * INTERVAL '1 millisecond')
            ELSE locked_until
          END,
          updated_at = NOW()
      WHERE id = $1;
    `,
    [userId, MAX_FAILED_LOGIN_ATTEMPTS, LOGIN_LOCK_MS]
  );
};

const clearPostgresLoginFailures = async (userId) => {
  await pool.query(
    `
      UPDATE auth_users
      SET failed_login_count = 0,
          locked_until = NULL,
          last_failed_login_at = NULL,
          updated_at = NOW()
      WHERE id = $1;
    `,
    [userId]
  );
};

const seedAdminIfConfigured = async () => {
  if (!DEFAULT_SEED_PASSWORD || !DEFAULT_SEED_EMAIL) return;
  const exists = store.users.some((user) => normalizeAccount(user.email) === DEFAULT_SEED_EMAIL || normalizeAccount(user.username) === DEFAULT_SEED_EMAIL);
  if (exists) return;

  store.users.push({
    id: 'U-AUTH-ADMIN',
    email: DEFAULT_SEED_EMAIL,
    username: 'admin',
    name: '系统管理员',
    passwordHash: hashPassword(DEFAULT_SEED_PASSWORD),
    roles: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE'],
    activeRole: 'ADMIN',
    positionTags: ['系统管理员'],
    status: 'active',
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: '',
    lastFailedLoginAt: '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  await writeStore();
};

const seedAdminPostgresIfConfigured = async () => {
  if (!DEFAULT_SEED_PASSWORD || !DEFAULT_SEED_EMAIL) return;
  await pool.query(
    `
      INSERT INTO auth_users (
        id, email, username, name, password_hash, roles, active_role, position_tags, status, must_change_password, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING;
    `,
    [
      'U-AUTH-ADMIN',
      DEFAULT_SEED_EMAIL,
      'admin',
      '系统管理员',
      hashPassword(DEFAULT_SEED_PASSWORD),
      JSON.stringify(['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']),
      'ADMIN',
      JSON.stringify(['系统管理员']),
      'active',
      false
    ]
  );
};

const initAuthStore = async () => {
  if (storeReady) return backend;

  if (!usePostgres()) {
    if (requireAuthPostgres()) {
      backend = {
        mode: 'file',
        ready: false,
        reason: 'auth-postgres-required-but-database-url-missing',
        users: 0,
        path: AUTH_STORE_PATH
      };
      throw new Error('XINYI_AUTH_REQUIRE_POSTGRES=true but DATABASE_URL is not configured');
    }
    await readStore();
    await seedAdminIfConfigured();
    storeReady = true;
    backend = {
      mode: 'file',
      ready: true,
      reason: 'DATABASE_URL not configured',
      users: store.users.length,
      path: AUTH_STORE_PATH
    };
    return backend;
  }

  try {
    await initPostgresAuthStore();
    await seedAdminPostgresIfConfigured();
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM auth_users;');
    storeReady = true;
    backend = {
      mode: 'postgres',
      ready: true,
      reason: 'connected',
      users: Number(count.rows?.[0]?.count || 0),
      path: ''
    };
    return backend;
  } catch (error) {
    if (requireAuthPostgres()) {
      backend = {
        mode: 'postgres',
        ready: false,
        reason: `auth-postgres-required-connect-failed: ${error?.message || 'unknown'}`,
        users: 0,
        path: ''
      };
      throw error;
    }
  }

  await readStore();
  await seedAdminIfConfigured();
  storeReady = true;
  backend = {
    mode: 'file',
    ready: true,
    reason: 'postgres-failed-fallback-file',
    users: store.users.length,
    path: AUTH_STORE_PATH
  };
  return backend;
};

const cleanupSessions = () => {
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => Date.parse(session.expiresAt || '') > now);
};

const findUserByAccount = (account) => {
  const normalized = normalizeAccount(account);
  if (!normalized) return null;
  return store.users.find((user) =>
    normalizeAccount(user.email) === normalized ||
    normalizeAccount(user.username) === normalized
  ) || null;
};

const findUserByAccountPostgres = async (account) => {
  const normalized = normalizeAccount(account);
  if (!normalized) return null;
  const result = await pool.query(
    `
      SELECT id, email, username, name, password_hash, roles, active_role, position_tags, reports_to_user_id, status, must_change_password, failed_login_count, locked_until, last_failed_login_at,
             extra_actions, denied_actions, account_expires_at
      FROM auth_users
      WHERE lower(email) = $1 OR lower(username) = $1
      LIMIT 1;
    `,
    [normalized]
  );
  return result.rows?.[0] || null;
};

const findFileUserDuplicate = ({ email, username }, excludedId = '') => (
  store.users.find((user) => (
    user.id !== excludedId &&
    (
      (email && normalizeAccount(user.email) === email) ||
      (username && normalizeAccount(user.username) === username)
    )
  )) || null
);

const listUsers = async () => {
  await initAuthStore();
  if (backend.mode === 'postgres' && pool) {
    const result = await pool.query(`
      SELECT id, email, username, name, roles, active_role, position_tags, reports_to_user_id, status, must_change_password,
             extra_actions, denied_actions, account_expires_at
      FROM auth_users
      ORDER BY created_at ASC, id ASC;
    `);
    return result.rows.map(publicUserFromRow);
  }
  return store.users.map(publicUser);
};

const createUser = async (input) => {
  await initAuthStore();
  const normalized = normalizeUserInput(input, { requirePassword: true });
  const id = String(input.id || `U-AUTH-${crypto.randomBytes(8).toString('hex').toUpperCase()}`).trim();

  if (backend.mode === 'postgres' && pool) {
    const result = await pool.query(
      `
        INSERT INTO auth_users (
          id, email, username, name, password_hash, roles, active_role, position_tags, reports_to_user_id, wecom_user_id, status, must_change_password,
          extra_actions, denied_actions, account_expires_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, NOW(), NOW())
        RETURNING id, email, username, name, roles, active_role, position_tags, reports_to_user_id, wecom_user_id, status, must_change_password,
                  extra_actions, denied_actions, account_expires_at;
      `,
      [
        id,
        normalized.email || null,
        normalized.username || null,
        normalized.name,
        hashPassword(normalized.password),
        JSON.stringify(normalized.roles),
        normalized.activeRole,
        JSON.stringify(normalized.positionTags),
        normalized.reportsToUserId || null,
        normalized.wecomUserId || null,
        normalized.status,
        normalized.mustChangePassword,
        JSON.stringify(normalized.extraActions),
        JSON.stringify(normalized.deniedActions),
        normalized.accountExpiresAt || null
      ]
    ).catch((error) => {
      if (String(error?.code || '') === '23505') throw new Error('email or username already exists');
      throw error;
    });
    return publicUserFromRow(result.rows[0]);
  }

  if (store.users.some((user) => user.id === id)) throw new Error('user id already exists');
  if (findFileUserDuplicate(normalized)) throw new Error('email or username already exists');
  const now = nowIso();
  const user = {
    id,
    extraActions: normalized.extraActions,
    deniedActions: normalized.deniedActions,
    accountExpiresAt: normalized.accountExpiresAt,
    email: normalized.email || '',
    username: normalized.username || '',
    name: normalized.name,
    passwordHash: hashPassword(normalized.password),
    roles: normalized.roles,
    activeRole: normalized.activeRole,
    positionTags: normalized.positionTags,
    reportsToUserId: normalized.reportsToUserId || undefined,
    status: normalized.status,
    mustChangePassword: normalized.mustChangePassword,
    createdAt: now,
    updatedAt: now
  };
  store.users.push(user);
  await writeStore();
  return publicUser(user);
};

const updateUser = async (userId, updates) => {
  await initAuthStore();
  const id = String(userId || '').trim();
  if (!id) throw new Error('user id is required');

  if (backend.mode === 'postgres' && pool) {
    const existing = await pool.query(
      'SELECT id, email, username, name, roles, active_role, position_tags, reports_to_user_id, status, must_change_password, extra_actions, denied_actions, account_expires_at FROM auth_users WHERE id = $1 LIMIT 1;',
      [id]
    );
    const row = existing.rows?.[0];
    if (!row) return null;
    const merged = normalizeUserInput({
      name: Object.prototype.hasOwnProperty.call(updates, 'name') ? updates.name : row.name,
      email: Object.prototype.hasOwnProperty.call(updates, 'email') ? updates.email : row.email,
      username: Object.prototype.hasOwnProperty.call(updates, 'username') ? updates.username : row.username,
      roles: Object.prototype.hasOwnProperty.call(updates, 'roles') ? updates.roles : row.roles,
      activeRole: Object.prototype.hasOwnProperty.call(updates, 'activeRole') ? updates.activeRole : row.active_role,
      positionTags: Object.prototype.hasOwnProperty.call(updates, 'positionTags') ? updates.positionTags : row.position_tags,
      reportsToUserId: Object.prototype.hasOwnProperty.call(updates, 'reportsToUserId') ? updates.reportsToUserId : row.reports_to_user_id,
      status: Object.prototype.hasOwnProperty.call(updates, 'status') ? updates.status : row.status,
      mustChangePassword: Object.prototype.hasOwnProperty.call(updates, 'mustChangePassword') ? updates.mustChangePassword : Boolean(row.must_change_password),
      /*
        这三个也要参与合并，否则**只改姓名就会把权限委派清空**——
        normalizeUserInput 对没传的字段一律给空数组/空串。
        「改一个字段顺手抹掉另一个」是最难查的那类 bug：不报错，事后也想不到是这里。
      */
      extraActions: Object.prototype.hasOwnProperty.call(updates, 'extraActions') ? updates.extraActions : row.extra_actions,
      deniedActions: Object.prototype.hasOwnProperty.call(updates, 'deniedActions') ? updates.deniedActions : row.denied_actions,
      accountExpiresAt: Object.prototype.hasOwnProperty.call(updates, 'accountExpiresAt') ? updates.accountExpiresAt : row.account_expires_at
    });

    const result = await pool.query(
      `
        UPDATE auth_users
        SET email = $2,
            username = $3,
            name = $4,
            roles = $5::jsonb,
            active_role = $6,
            position_tags = $7::jsonb,
            reports_to_user_id = $8,
            status = $9,
            must_change_password = $10,
            extra_actions = $11::jsonb,
            denied_actions = $12::jsonb,
            account_expires_at = $13,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, username, name, roles, active_role, position_tags, reports_to_user_id, status, must_change_password,
                  extra_actions, denied_actions, account_expires_at;
      `,
      [
        id,
        merged.email || null,
        merged.username || null,
        merged.name,
        JSON.stringify(merged.roles),
        merged.activeRole,
        JSON.stringify(merged.positionTags),
        merged.reportsToUserId || null,
        merged.status,
        merged.mustChangePassword,
        JSON.stringify(merged.extraActions),
        JSON.stringify(merged.deniedActions),
        merged.accountExpiresAt || null
      ]
    ).catch((error) => {
      if (String(error?.code || '') === '23505') throw new Error('email or username already exists');
      throw error;
    });
    return publicUserFromRow(result.rows[0]);
  }

  const idx = store.users.findIndex((user) => user.id === id);
  if (idx < 0) return null;
  const existing = store.users[idx];
  const merged = normalizeUserInput({
    name: Object.prototype.hasOwnProperty.call(updates, 'name') ? updates.name : existing.name,
    email: Object.prototype.hasOwnProperty.call(updates, 'email') ? updates.email : existing.email,
    username: Object.prototype.hasOwnProperty.call(updates, 'username') ? updates.username : existing.username,
    roles: Object.prototype.hasOwnProperty.call(updates, 'roles') ? updates.roles : existing.roles,
    activeRole: Object.prototype.hasOwnProperty.call(updates, 'activeRole') ? updates.activeRole : existing.activeRole,
    positionTags: Object.prototype.hasOwnProperty.call(updates, 'positionTags') ? updates.positionTags : existing.positionTags,
    reportsToUserId: Object.prototype.hasOwnProperty.call(updates, 'reportsToUserId') ? updates.reportsToUserId : existing.reportsToUserId,
    status: Object.prototype.hasOwnProperty.call(updates, 'status') ? updates.status : existing.status,
    mustChangePassword: Object.prototype.hasOwnProperty.call(updates, 'mustChangePassword') ? updates.mustChangePassword : Boolean(existing.mustChangePassword)
  });
  if (findFileUserDuplicate(merged, id)) throw new Error('email or username already exists');
  const next = {
    ...existing,
    email: merged.email || '',
    username: merged.username || '',
    name: merged.name,
    roles: merged.roles,
    activeRole: merged.activeRole,
    positionTags: merged.positionTags,
    reportsToUserId: merged.reportsToUserId || undefined,
    status: merged.status,
    mustChangePassword: merged.mustChangePassword,
    updatedAt: nowIso()
  };
  store.users[idx] = next;
  await writeStore();
  return publicUser(next);
};

const resetUserPassword = async (userId, password) => {
  await initAuthStore();
  const id = String(userId || '').trim();
  const nextPassword = String(password || '');
  if (!id) throw new Error('user id is required');
  if (nextPassword.length < 8) throw new Error('password must be at least 8 characters');

  if (backend.mode === 'postgres' && pool) {
    const result = await pool.query(
      `
        UPDATE auth_users
        SET password_hash = $2,
            must_change_password = true,
            failed_login_count = 0,
            locked_until = NULL,
            last_failed_login_at = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, username, name, roles, active_role, position_tags, reports_to_user_id, status, must_change_password;
      `,
      [id, hashPassword(nextPassword)]
    );
    if (!result.rows?.[0]) return null;
    await pool.query('DELETE FROM auth_sessions WHERE user_id = $1;', [id]);
    return publicUserFromRow(result.rows[0]);
  }

  const idx = store.users.findIndex((user) => user.id === id);
  if (idx < 0) return null;
  store.users[idx] = {
    ...store.users[idx],
    passwordHash: hashPassword(nextPassword),
    mustChangePassword: true,
    failedLoginCount: 0,
    lockedUntil: '',
    lastFailedLoginAt: '',
    updatedAt: nowIso()
  };
  store.sessions = store.sessions.filter((session) => session.userId !== id);
  await writeStore();
  return publicUser(store.users[idx]);
};

const changeOwnPassword = async ({ userId, currentPassword, nextPassword, keepSessionId = '' }) => {
  await initAuthStore();
  const id = String(userId || '').trim();
  const current = String(currentPassword || '');
  const next = String(nextPassword || '');
  if (!id) throw new Error('user id is required');
  if (!current) throw new Error('current password is required');
  if (next.length < 8) throw new Error('new password must be at least 8 characters');

  if (backend.mode === 'postgres' && pool) {
    const existing = await pool.query(
      `
        SELECT id, email, username, name, password_hash, roles, active_role, position_tags, reports_to_user_id, status, must_change_password,
               extra_actions, denied_actions, account_expires_at
        FROM auth_users
        WHERE id = $1
        LIMIT 1;
      `,
      [id]
    );
    const row = existing.rows?.[0];
    if (!row || row.status === 'disabled') return null;
    if (!verifyPassword(current, row.password_hash)) throw new Error('current password is incorrect');

    const result = await pool.query(
      `
        UPDATE auth_users
        SET password_hash = $2,
            must_change_password = false,
            failed_login_count = 0,
            locked_until = NULL,
            last_failed_login_at = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, username, name, roles, active_role, position_tags, reports_to_user_id, status, must_change_password;
      `,
      [id, hashPassword(next)]
    );
    await pool.query('DELETE FROM auth_sessions WHERE user_id = $1 AND id <> $2;', [id, String(keepSessionId || '')]);
    return publicUserFromRow(result.rows[0]);
  }

  const idx = store.users.findIndex((user) => user.id === id);
  if (idx < 0 || store.users[idx].status === 'disabled') return null;
  if (!verifyPassword(current, store.users[idx].passwordHash)) throw new Error('current password is incorrect');
  store.users[idx] = {
    ...store.users[idx],
    passwordHash: hashPassword(next),
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: '',
    lastFailedLoginAt: '',
    updatedAt: nowIso()
  };
  store.sessions = store.sessions.filter((session) => session.userId !== id || session.id === String(keepSessionId || ''));
  await writeStore();
  return publicUser(store.users[idx]);
};

const appendAuthAuditLog = async ({ actorUser, action, targetUser, metadata = {} }) => {
  await initAuthStore();
  const normalizedAction = String(action || '').trim().toUpperCase();
  if (!normalizedAction) throw new Error('audit action is required');
  const safeMetadata = sanitizeAuditMetadata(metadata);
  const log = {
    id: `AUTH-AUDIT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
    actorUserId: actorUser?.id || '',
    actorName: actorUser?.name || '',
    action: normalizedAction,
    targetUserId: targetUser?.id || '',
    targetName: targetUser?.name || '',
    metadata: safeMetadata,
    createdAt: nowIso()
  };

  if (backend.mode === 'postgres' && pool) {
    const result = await pool.query(
      `
        INSERT INTO auth_audit_logs (
          id, actor_user_id, actor_name, action, target_user_id, target_name, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
        RETURNING id, actor_user_id, actor_name, action, target_user_id, target_name, metadata, created_at;
      `,
      [
        log.id,
        log.actorUserId || null,
        log.actorName || null,
        log.action,
        log.targetUserId || null,
        log.targetName || null,
        JSON.stringify(log.metadata)
      ]
    );
    return publicAuditLogFromRow(result.rows[0]);
  }

  store.auditLogs.unshift(log);
  store.auditLogs = store.auditLogs.slice(0, 1000);
  await writeStore();
  return log;
};

const listAuthAuditLogs = async ({ limit = 100 } = {}) => {
  await initAuthStore();
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));

  if (backend.mode === 'postgres' && pool) {
    const result = await pool.query(
      `
        SELECT id, actor_user_id, actor_name, action, target_user_id, target_name, metadata, created_at
        FROM auth_audit_logs
        ORDER BY created_at DESC
        LIMIT $1;
      `,
      [safeLimit]
    );
    return result.rows.map(publicAuditLogFromRow);
  }

  return store.auditLogs.slice(0, safeLimit).map((item) => ({
    id: item.id,
    actorUserId: item.actorUserId || '',
    actorName: item.actorName || '',
    action: item.action,
    targetUserId: item.targetUserId || '',
    targetName: item.targetName || '',
    metadata: sanitizeAuditMetadata(item.metadata || {}),
    createdAt: item.createdAt || ''
  }));
};

const cleanupSessionsPostgres = async () => {
  await pool.query('DELETE FROM auth_sessions WHERE expires_at <= NOW();');
};


/**
 * 账号是否已过有效期。
 *
 * **一个不生效的到期日比没有更糟**：管理员填了日期以为管住了，
 * 实际那个人到期后照样能登。所以登录和会话校验两处都要判。
 *
 * 按「日期」比而不是时刻：到期日当天仍然有效，第二天零点起失效。
 * 这符合人对「有效期到 X 月 X 日」的理解。
 */
const isAccountExpired = (expiresAt) => {
  const d = toDateOnly(expiresAt);
  if (!d) return false;                       // 空 = 永久有效
  return d < todayLocal();
};

/**
 * 截断来源信息。
 *
 * User-Agent 可以很长，而且是**客户端能随便写的字符串** ——
 * 不截断的话，一次登录就能往库里塞几十 KB。
 * 记录来源是为了「事后能认出是哪台设备」，够用就行。
 */
const trimOrigin = (v, max) => String(v || '').trim().slice(0, max);

const authenticateUser = async ({ account, password, ip = '', userAgent = '' }) => {
  await initAuthStore();
  if (backend.mode === 'postgres' && pool) {
    const user = await findUserByAccountPostgres(account);
    if (!user || user.status === 'disabled') return null;
    if (isAccountExpired(user.account_expires_at)) return null;
    if (isFutureIso(user.locked_until)) return null;
    if (!verifyPassword(password, user.password_hash)) {
      await markPostgresLoginFailure(user.id);
      return null;
    }

    await clearPostgresLoginFailures(user.id);
    await cleanupSessionsPostgres();
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await pool.query(
      `
        INSERT INTO auth_sessions (id, user_id, created_at, expires_at, ip, user_agent, last_seen_at)
        VALUES ($1, $2, NOW(), $3::timestamptz, $4, $5, NOW());
      `,
      [sessionId, user.id, expiresAt, trimOrigin(ip, 64), trimOrigin(userAgent, 300)]
    );
    return { sessionId, user: toUserProfileFromRow(user), expiresAt };
  }

  const user = findUserByAccount(account);
  if (!user || user.status === 'disabled') return null;
  if (isAccountExpired(user.accountExpiresAt)) return null;
  if (isFutureIso(user.lockedUntil)) return null;
  if (!verifyPassword(password, user.passwordHash)) {
    await markFileLoginFailure(user);
    return null;
  }

  cleanupSessions();
  const sessionId = crypto.randomBytes(32).toString('hex');
  const session = {
    id: sessionId,
    userId: user.id,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  store.sessions.push(session);
  await clearFileLoginFailures(user);
  await writeStore();
  return { sessionId, user: toUserProfile(user), expiresAt: session.expiresAt };
};

const getSessionUser = async (sessionId) => {
  await initAuthStore();
  if (backend.mode === 'postgres' && pool) {
    await cleanupSessionsPostgres();
    const result = await pool.query(
      `
        SELECT
          s.expires_at,
          u.id,
          u.email,
          u.username,
          u.name,
          u.roles,
          u.active_role,
          u.position_tags,
          u.reports_to_user_id,
          u.status,
          u.must_change_password,
          u.extra_actions,
          u.denied_actions,
          u.account_expires_at
        FROM auth_sessions s
        JOIN auth_users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > NOW()
        LIMIT 1;
      `,
      [String(sessionId || '')]
    );
    const row = result.rows?.[0];
    if (!row || row.status === 'disabled') return null;
    /*
      **会话还没到期，但账号过期了。**

      只在登录时判有效期是不够的：兼职在到期前登进来，
      会话滑动续期会让他一直待着，到期日形同虚设。
      这里再判一次，过期即视为未登录。
    */
    if (isAccountExpired(row.account_expires_at)) return null;
    let expiresAt = new Date(row.expires_at).toISOString();
    let renewed = false;
    if (shouldRenewSession(expiresAt)) {
      /*
        顺带更新 last_seen_at。
        只在续期时写，不是每个请求都写 —— 每请求一次 UPDATE，
        一个人开着页面就是持续的写入压力，而「最后活跃」精确到分钟毫无意义。
        续期是有节流的（shouldRenewSession），正好蹭它的节奏。
      */
      expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      await pool.query(
        'UPDATE auth_sessions SET expires_at = $2::timestamptz, last_seen_at = NOW() WHERE id = $1;',
        [String(sessionId || ''), expiresAt]
      );
      renewed = true;
    }
    return { user: toUserProfileFromRow(row), expiresAt, renewed };
  }

  cleanupSessions();
  const session = store.sessions.find((item) => item.id === String(sessionId || ''));
  if (!session) return null;
  const user = store.users.find((item) => item.id === session.userId);
  if (!user || user.status === 'disabled') return null;
  if (isAccountExpired(user.accountExpiresAt)) return null;   // 同上，会话有效不代表账号有效
  let renewed = false;
  if (shouldRenewSession(session.expiresAt)) {
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await writeStore();
    renewed = true;
  }
  return { user: toUserProfile(user), expiresAt: session.expiresAt, renewed };
};

const revokeSession = async (sessionId) => {
  await initAuthStore();
  if (backend.mode === 'postgres' && pool) {
    await pool.query('DELETE FROM auth_sessions WHERE id = $1;', [String(sessionId || '')]);
    return;
  }

  const before = store.sessions.length;
  store.sessions = store.sessions.filter((item) => item.id !== String(sessionId || ''));
  if (store.sessions.length !== before) await writeStore();
};

const getAuthHealth = async () => {
  if (!storeReady) await initAuthStore();
  if (backend.mode === 'postgres' && pool) {
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM auth_users;');
    return { ...backend, users: Number(count.rows?.[0]?.count || 0) };
  }
  return { ...backend, users: store.users.length };
};

module.exports = {
  AUTH_STORE_PATH,
  hashPassword,
  initAuthStore,
  getAuthHealth,
  authenticateUser,
  getSessionUser,
  revokeSession,
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  changeOwnPassword,
  appendAuthAuditLog,
  listAuthAuditLogs
};
