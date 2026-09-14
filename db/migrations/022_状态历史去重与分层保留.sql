-- 状态快照历史：去重 + 分层保留
--
-- ── 为什么（2026-09-14 金恩来：「数据库的备份怎么会有 4002 份这么多？」）──
--
-- 他说得对，这完全不合理。查下来根本不是"备份了 4002 次"，
-- 而是**同一份内容被重复存了几百遍**：
--
--     数据集                版本数   去重后   占用
--     leads_v8               382      43     191 MB
--     market_signals_v1      313       2      94 MB   ← 313 版只有 2 种内容
--     knowledge_docs_v8      311       4      13 MB
--     contracts_v8           341      20     3.4 MB
--
-- 前端是「整份数据集读、整份写回」的模式，不管有没有改动都写一次，
-- 每写一次这里就多一份**全量快照**。约 88% 是逐字节相同的副本。
--
-- ── 两件事一起做 ──
--
-- 1. content_hash：写之前先比哈希，和上一版一样就不写。
--    这一条就能砍掉绝大部分。
-- 2. 分层保留：近 7 天全留、7-30 天每天留最后一版、30-90 天每周留最后一版、
--    90 天以上删。由定时任务每天自动执行，不靠人记得去跑脚本
--    （原来有清理脚本，但从来没人跑过 —— 这就是 146MB 的由来）。
--
-- 哈希列可空：老数据没有哈希，回填一次即可；回填不了也不影响读写。

ALTER TABLE app_state_history ADD COLUMN IF NOT EXISTS content_hash text;

-- 回填历史数据的哈希（一次性，之后由写入路径维护）
UPDATE app_state_history SET content_hash = md5(dataset_value::text) WHERE content_hash IS NULL;

-- 写入时要按 (dataset_key, 最新一条) 查哈希，这个索引让那次查询是 O(1)
CREATE INDEX IF NOT EXISTS idx_app_state_history_key_hash
  ON app_state_history (dataset_key, id DESC);

COMMENT ON COLUMN app_state_history.content_hash IS
  '内容 md5。写入前与同 dataset_key 的最新一条比对，相同则跳过 —— 防止「同一份内容存几百遍」';
