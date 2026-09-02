-- 补齐 owner_user_id 索引
-- 生成于 2026-08-17
--
-- 背景：leads 表早就有 owner_user_id 索引，但 customers / projects / contracts /
-- market_signals 四张表没有。P0-17 回填历史 owner_user_id 之后，「我的客户」
-- 「我的项目」「我的线索」这类按归属人过滤的查询会大量落在这几张表上。
--
-- 现在数据量还小（客户 18、项目 38、情报 349），加索引不解决任何当下的性能问题。
-- 现在加纯粹是因为便宜：表小的时候建索引是瞬间的事，等到几千上万行再补
-- 就得考虑 CONCURRENTLY 和锁表时间。属于顺手做掉、以后省事。

CREATE INDEX IF NOT EXISTS idx_customers_owner      ON customers(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner       ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_owner      ON contracts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_market_signals_owner ON market_signals(owner_user_id);
