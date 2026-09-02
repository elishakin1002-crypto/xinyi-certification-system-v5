-- ai_proposals 补 extra_fields 列
--
-- 仓库统一的 mapper（server/repos/_mapper.js）默认会把「未提升为独立列的字段」
-- 收进 extra_fields，其他业务表都有这一列。009 建表时漏了，导致 repo 写入报错。
-- 不改 009 是因为它已执行且校验和锁定——迁移历史只能往前加，不能改。

ALTER TABLE ai_proposals ADD COLUMN IF NOT EXISTS extra_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
