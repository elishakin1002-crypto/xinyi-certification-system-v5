-- Action Ledger：补齐责任字段 + 强制追加式（四层机制第一阶段）
--
-- business_events 已覆盖 actor / onBehalfOf / resource / action / reason / timestamp 六项，
-- 补齐剩下四项即可，不需要新表。
--
-- 关于追加式：repo 层现在只有 INSERT（已核实 0 处 UPDATE/DELETE），
-- 但那是**约定**不是**约束**。用触发器在数据库层挡住，代码写错也改不了历史。
--
-- 注意触发器的作用范围：它是 FOR EACH ROW，只拦 UPDATE/DELETE 数据行，
-- 不影响 ALTER TABLE 这类 DDL。所以将来仍可加列，但**不能回填历史数据**——
-- 这正是想要的：账本可以扩展结构，不能篡改内容。

ALTER TABLE business_events
  -- 命中的授权规则，回答「凭什么允许/拒绝」。没有它，Ledger 只能说「做了什么」，说不出「为什么被允许」
  ADD COLUMN IF NOT EXISTS policy   text,
  -- L3 场景下的批准人。与 actor 分开：AI 代表张三执行、李四批准，是三个不同的人
  ADD COLUMN IF NOT EXISTS approver text,
  -- success / failed / denied。denied 才是安全审计最该看的——谁试图越权、被哪条策略挡下
  ADD COLUMN IF NOT EXISTS result   text NOT NULL DEFAULT 'success',
  -- 本次判定的 AI 分级（L0-L4），人工操作为 NULL
  ADD COLUMN IF NOT EXISTS ai_level text;

-- before/after 不另开列，约定放进已有的 detail：{ "before": {...}, "after": {...} }
COMMENT ON COLUMN business_events.detail IS
  '结构化细节。变更类事件约定放 { before, after }；动作类放入参';
COMMENT ON COLUMN business_events.result IS
  'success / failed / denied。denied 是安全审计的重点：谁试图越权、被哪条策略挡下';

-- 查「被拒绝的操作」是安全审计的高频动作，单独建索引
CREATE INDEX IF NOT EXISTS idx_events_denied
  ON business_events (occurred_at DESC) WHERE result <> 'success';

-- ── 追加式强制 ──
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '责任记录只能追加，不能修改或删除（表 %）', TG_TABLE_NAME
    USING HINT = '如需更正，追加一条订正事件，不要改历史';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_events_append_only ON business_events;
CREATE TRIGGER trg_business_events_append_only
  BEFORE UPDATE OR DELETE ON business_events
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
