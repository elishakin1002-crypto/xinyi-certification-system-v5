-- AI 用量计量（待办 P0-10；P3-17「按角色配额」依赖这张表）
--
-- ── 为什么要这个 ────────────────────────────────────────────────
-- 现在 AI 调用是**完全无记录**的：谁调的、调了多少次、花了多少 token，
-- 一概查不到。出问题的形态是这样的：某个页面写出一个循环、
-- 或者有人反复点某个按钮，等发现时账单已经出来了。
--
-- 这张表要回答三个问题：
--   ① 这个月花了多少（按 token，不是按次数——一次长对话抵得上几十次短问答）
--   ② 花在谁身上、花在哪个功能上
--   ③ 有没有人的调用量明显异常
--
-- ── 为什么记 token 而不是估算 ───────────────────────────────────
-- provider 返回体里带 usage.prompt_tokens / completion_tokens，是真实计费口径。
-- 用字符数估算会在中英文混排时差出几倍，那种数字拿来做预算判断还不如不要。
-- 取不到 usage 的时候如实存 NULL，**不要用估算值冒充**——
-- 假的精确比明说不知道更危险。

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id                TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 谁调的。没有会话的内部调用（定时任务等）记 actor_kind='system'
  actor_user_id     TEXT,
  actor_name        TEXT,
  actor_roles       TEXT,
  actor_kind        TEXT NOT NULL DEFAULT 'user',

  -- 调了什么
  endpoint          TEXT,              -- /api/ai/generate、/api/ai/chat …
  feature           TEXT,              -- 业务侧的用途，比如 monthly_review、contract_extract
  model_requested   TEXT,
  model_used        TEXT,              -- 可能和请求的不同：主力失败会回退

  -- 花了多少。取不到就是 NULL，见文件头
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,

  -- 结果
  ok                BOOLEAN NOT NULL DEFAULT TRUE,
  error_code        TEXT,
  duration_ms       INTEGER
);

-- 按人按天查配额，这是最热的一条路径
CREATE INDEX IF NOT EXISTS idx_ai_usage_actor_time ON ai_usage_log (actor_user_id, created_at DESC);
-- 按时间做月度汇总
CREATE INDEX IF NOT EXISTS idx_ai_usage_time ON ai_usage_log (created_at DESC);
