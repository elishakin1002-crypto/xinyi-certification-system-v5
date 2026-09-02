-- 业务事件流：记录「过程」，而不只是「当前状态」
--
-- 为什么需要：
--   系统现在存的是快照——「项目截止日是 9 月 13 日」。
--   但没存过程——「8 月 20 日把它从 8 月底推到 9 月中，因为客户厂房在装修」。
--   人看快照能猜，AI 看快照只能看到一个日期，理解不了为什么。
--
--   而且**事件不可补录**。今天不记，这段历史就永远没有了。
--   跟备份同理：等需要的时候才想起来，就已经晚了。
--
-- 与 auth 审计日志的区别：那个记「谁登录了、谁调了哪个接口」（安全视角）；
-- 这个记「业务上发生了什么、为什么」（理解视角）。两者不互相替代。
--
-- reason 是这张表的核心列，不是可选备注：
--   任务为什么跳过、提案为什么被驳回、截止日为什么推迟——
--   这些是「人的判断」，是 AI 学不到也编不出来的那部分。

CREATE TABLE IF NOT EXISTS business_events (
  id            text        PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- 事件类型，点分命名：task.skipped / project.completed / proposal.rejected / receivable.confirmed
  event_type    text        NOT NULL,

  -- 事件作用在哪个对象上
  subject_type  text        NOT NULL,
  subject_id    text        NOT NULL,

  -- 谁做的。AI 代表员工执行时，actor 记被代表人，via_ai_agent 标记来源
  actor_user_id text        NOT NULL DEFAULT '',
  actor_name    text        NOT NULL DEFAULT '',
  via_ai_agent  boolean     NOT NULL DEFAULT false,
  on_behalf_of  text,

  -- 一句人话，时间线上直接显示这个
  summary       text        NOT NULL DEFAULT '',
  -- 结构化细节，通常是 { before, after } 或动作参数
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- 为什么这么做 —— 最值钱的一列
  reason        text,

  extra_fields  jsonb       NOT NULL DEFAULT '{}'::jsonb
);

-- 查某个对象的时间线（项目详情页要用）
CREATE INDEX IF NOT EXISTS idx_events_subject ON business_events(subject_type, subject_id, occurred_at DESC);
-- 查某个人做了什么（AI 要理解这个人的工作习惯）
CREATE INDEX IF NOT EXISTS idx_events_actor   ON business_events(actor_user_id, occurred_at DESC);
-- 按类型统计（例如：这个月跳过了多少任务、各是什么原因）
CREATE INDEX IF NOT EXISTS idx_events_type    ON business_events(event_type, occurred_at DESC);

COMMENT ON TABLE  business_events        IS '业务事件流：记录过程与原因，事件不可补录';
COMMENT ON COLUMN business_events.reason IS '为什么这么做——人的判断，AI 学不到也编不出来的部分';
