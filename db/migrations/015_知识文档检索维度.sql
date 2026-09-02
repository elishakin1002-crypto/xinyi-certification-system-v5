-- 知识文档补检索维度：行业、标准、可信层级、时效
-- 生成于 2026-08-24
--
-- 为什么加这几列而不是做文件夹式分类：
-- 一份《平阳油茶合作社 SC 认证复盘》同时属于「农业」「SC 标准」「客户复盘」
-- 「我们的经验」——放进任何**一个**文件夹都是错的，因为下次找它的人
-- 可能从任何一个维度进来。多维标签才能让「食品厂做 SC 要注意什么」检索得准。
--
-- 其中 trust_level 是最要紧的一个。AI 引用时必须分清：
--   official      外部权威（标准原文、官方文件）—— 可以直接照着答
--   ourExperience 公司自己的（复盘、手册）—— 要说明「据我们以往经验」
--   aiDraft       AI 生成还没人审 —— 只配当提示，不配当依据
-- 不分层的后果是 AI 把没人审过的草稿当公司规定答给客户，
-- 而越是「记得清楚」的 AI，说错时越有说服力。
--
-- 全部可空，存量文档不受影响；检索里没标 trust_level 的按 ourExperience 处理（从严）。

ALTER TABLE knowledge_docs
  ADD COLUMN IF NOT EXISTS industry    text,
  ADD COLUMN IF NOT EXISTS standards   jsonb,
  ADD COLUMN IF NOT EXISTS trust_level text,
  -- 标准会改版。过期的知识**比没有知识更危险**——它看起来仍然权威。
  -- 检索时降权到三成并标出「可能已过期」，不直接排除（旧版有时仍有参考价值）。
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS reviewed_at date,
  ADD COLUMN IF NOT EXISTS reviewed_by text;

-- 按行业和标准检索是最常见的两种问法，建索引
CREATE INDEX IF NOT EXISTS idx_knowledge_industry ON knowledge_docs (industry);
CREATE INDEX IF NOT EXISTS idx_knowledge_trust    ON knowledge_docs (trust_level);
