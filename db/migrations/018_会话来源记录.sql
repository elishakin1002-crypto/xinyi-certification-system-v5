-- 给会话记上「从哪来的」。
--
-- ── 为什么现在就要加 ──────────────────────────────────────────
-- auth_sessions 原来只有 id / user_id / created_at / expires_at。
-- 同一个账号可以在任意多个地方同时登录，而**没有任何人能看出来**。
--
-- 更要紧的是：不记的话，痕迹是补不回来的。
-- 等哪天怀疑「我的账号是不是被别人用了」，翻不出任何东西 ——
-- 那时候再加字段，也只能从那一刻开始记。
--
-- 这一步**只记录，不改变任何行为**：
-- 允许几个地方同时登录、要不要踢人，是另一个决定，由业务方定。
-- 但没有这份记录，那个决定就没有依据可谈。

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip           text NOT NULL DEFAULT '';
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent   text NOT NULL DEFAULT '';
-- 最后活跃时间：会话是滑动续期的，created_at 只说明「什么时候登的」，
-- 判断「这个登录还在不在用」要看最后一次请求。
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);
