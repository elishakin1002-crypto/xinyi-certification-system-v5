-- AI 待确认队列（把「AI 分析给你看」改成「AI 替你做、人只做确认」）
--
-- 现状问题：
--   · AI 诊断出的高优先级动作**直接自动执行**，人不知道 AI 改了什么；
--   · 其余动作压根不执行，只在页面上展示（AIActionType 声明了 5 种，
--     实际只实现 2 种，UPDATE_RISK / UPDATE_STATUS / CREATE_CONTRACT 静默落空）。
--   两头都错：该受监督的偷偷做了，该产生价值的只是摆着看。
--
-- 收口后：AI 一律只提案 → 人一键批准/驳回 → 批准才执行。
-- AI 从「填表工具」变成「受监督的助手」，能力可以放开而不失控。
--
-- reject_reason 是这张表最值钱的列：它记录 AI 哪里想错了，
-- 攒起来是让 AI 变准的真实依据——和任务「跳过原因」是同一个道理。

CREATE TABLE IF NOT EXISTS ai_proposals (
  id            text PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  source        text        NOT NULL,
  source_ref    text        NOT NULL DEFAULT '',
  title         text        NOT NULL DEFAULT '',
  -- 可执行动作 { type, payload, reason }，批准后交给执行器
  action        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reason        text        NOT NULL DEFAULT '',
  confidence    text,
  status        text        NOT NULL DEFAULT 'pending',
  -- 代表谁做的决定。AI 服务账号代表员工调用时，这里记被代表人
  decided_by    text,
  decided_at    timestamptz,
  reject_reason text,
  -- 执行结果留痕：批准后是否真的落地、失败原因
  executed_at   timestamptz,
  execute_error text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 队列页最常见的查询：按状态取待办、按来源筛选、按时间倒序
CREATE INDEX IF NOT EXISTS idx_ai_proposals_status  ON ai_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_source  ON ai_proposals(source, source_ref);

COMMENT ON TABLE  ai_proposals            IS 'AI 提案待确认队列：AI 只提案，人确认后才执行';
COMMENT ON COLUMN ai_proposals.reject_reason IS '驳回原因——记录 AI 哪里想错了，是让 AI 变准的训练依据';
