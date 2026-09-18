-- 只由运行时代码创建、迁移里却没有的那几张表 —— 把地基补进迁移。
--
-- ══════════════════════════════════════════════════════════════
-- 为什么会有一个 000（2026-09-18）
-- ══════════════════════════════════════════════════════════════
--
-- auth_users / auth_sessions 这两张表**从来没有任何迁移创建过** ——
-- 它们由 server/authStore.js 的 initAuthStore() 在服务启动时现建。
-- 而 018（会话来源字段）和 025（外键约束）都要 ALTER 这两张表。
--
-- 生产库之所以一直没事，是**顺序上的巧合**：服务先跑过、表已经在了，
-- 018 才被写出来。换句话说，这套迁移**没法从零建出一个可用的库**：
--
--     createdb xinyi_x && npm run migrate
--     → 018 执行失败：relation "auth_sessions" does not exist
--
-- 2026-09-18 给 CI 配数据库时当场撞上。这不是 CI 的问题 ——
-- 任何一次「换台服务器重建环境」都会撞上同一堵墙，
-- 而那种时候通常是出事之后，最不该再卡住的时刻。
--
-- ── 为什么编号是 000 而不是排在最后 ──────────────────────────
--
-- 排在最后没用：全新库上 018 仍然先跑、仍然炸。必须排在 018 前面。
-- 而 018 早就在生产执行过了，改它会被 migrate.mjs 的校验和检查判成
-- 「已执行的迁移被改动」（那个检查是对的，不该绕过）。
--
-- 所以新增一个版本号更小的文件。migrate.mjs 只看「这个版本在不在
-- schema_migrations 里」，不要求按号入座，于是：
--   · 生产库：000 不在记录里 → 会执行一次 → 表已存在 → **全是空操作**
--   · 全新库：000 排最前 → 建表 → 018/025 才有东西可 ALTER
--
-- ── 这个文件只管「建出来」，不管「长成什么样」 ────────────────
--
-- 列的演进仍然归 authStore.js（它有一长串 ALTER ... IF NOT EXISTS）。
-- 这里**只抄它的基础定义**，多抄一列就多一处会分叉的地方。
-- 两处定义这件事本身是个隐患，authStore.js 里已经写明了；
-- 彻底的做法是把认证表的结构也收进迁移、让 authStore 只读不建，
-- 但那是改动面很大的重构，不该在上线前一晚做。

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

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 账号操作审计（server/authStore.js 建）。
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

-- ── 前端状态镜像（server/stateStore.js 建）────────────────────
-- 同一个毛病：迁移 022（状态历史去重与分层保留）要 ALTER app_state_history，
-- 而这张表也只有运行时代码建过。全新库上 022 同样炸。
CREATE TABLE IF NOT EXISTS app_state_latest (
  dataset_key TEXT PRIMARY KEY,
  dataset_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  actor_user_id TEXT,
  client_id TEXT,
  app_version TEXT
);

CREATE TABLE IF NOT EXISTS app_state_history (
  id BIGSERIAL PRIMARY KEY,
  dataset_key TEXT NOT NULL,
  dataset_value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  actor_user_id TEXT,
  client_id TEXT,
  app_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_state_history_dataset_time
  ON app_state_history (dataset_key, created_at DESC);
