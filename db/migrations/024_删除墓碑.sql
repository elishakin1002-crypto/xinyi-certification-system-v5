-- 删除墓碑 —— 让「删了刷新又回来」在架构上不可能发生
--
-- ── 病根（2026-09-14 金恩来：「我希望合同删了又回来了是真的解决了」）──
--
-- 这个项目有两套存储：
--   关系表   contracts / customers / … —— 服务端 repo 写，SQL 统计读
--   状态库   app_state_latest 里一整个 JSON 数组 —— 前端整份读、整份写回
--
-- 后端删掉一条 → 状态库那份数组里还在 → 前端下次整份写回 → **它回来了**。
-- 而且没有任何报错：删除接口返回 200，人看着也确实消失了，
-- 刷新之后才发现它又在列表里。
--
-- 我昨天就栽了一次：金恩来下令删的 6 篇死链知识文档，
-- 我只删了关系表那一半，还向他报告「已删除」——
-- 那 6 条其实一直躺在状态库里等着被写回来。
--
-- ── 为什么不是"每次比对一下再修" ──────────────────────────────
--
-- 对账脚本能**发现**不一致，但发现是事后的，而且要人去看。
-- 真正的解法要让这件事**不可能发生**，而不是发生了能查出来。
--
-- 墓碑是这类问题的标准解法（分布式系统里叫 tombstone）：
-- 删除不只是"把行去掉"，而是**留下一条「这个 id 已经被删了」的记录**。
-- 之后任何一次整份写回，都先拿墓碑过一遍，被删的条目直接剔掉。
-- 前端写回什么都无所谓了 —— 删掉的东西在架构上回不来。
--
-- 附带的好处：墓碑本身就是「谁在什么时候删了什么」的凭据。
-- 这个项目的第一条铁律是「谁做的这条链不能断」，
-- 而在此之前，删除是整个系统里**唯一没有留痕**的动作。

CREATE TABLE IF NOT EXISTS deleted_records (
  entity_type   text        NOT NULL,   -- 'contract' / 'customer' / 'knowledge' …
  entity_id     text        NOT NULL,
  deleted_at    timestamptz NOT NULL DEFAULT NOW(),
  deleted_by    text,                    -- 操作人 user id，取不到就留空
  deleted_by_name text,
  reason        text,                    -- 为什么删（清理测试数据 / 死链 / 重复录入…）
  PRIMARY KEY (entity_type, entity_id)
);

-- 写回时要按 (entity_type, entity_id) 批量查，主键就是这个顺序，够用。
-- 另建一个按时间的索引，给「最近删了什么」这类审计查询用。
CREATE INDEX IF NOT EXISTS idx_deleted_records_time ON deleted_records (deleted_at DESC);

COMMENT ON TABLE deleted_records IS
  '删除墓碑。删除不只是去掉行，还要在这里留一条 —— 状态库整份写回时按它过滤，删掉的条目不会被写回来。同时是「谁删了什么」的唯一凭据';

/*
  把已知的历史删除补登进来。

  2026-09-13 按金恩来指令删的 6 篇死链知识文档：关系表删了、状态库没删，
  我昨天手工补删了状态库那一半。补上墓碑是为了**万一有旧版前端**
  拿着更早的缓存写回来，也不会把它们带回来。
*/
INSERT INTO deleted_records (entity_type, entity_id, deleted_by_name, reason)
VALUES
  ('knowledge', 'DOC-1770551149881', '金恩来', '附件是 blob 死链，点开打不开'),
  ('knowledge', 'DOC-1770626482771', '金恩来', '附件是 blob 死链，点开打不开'),
  ('knowledge', 'DOC-1770626583511', '金恩来', '附件是 blob 死链，点开打不开'),
  ('knowledge', 'DOC-1770626651942', '金恩来', '附件是 blob 死链，点开打不开'),
  ('knowledge', 'DOC-1771914623907', '金恩来', '附件是 blob 死链，点开打不开'),
  ('knowledge', 'DOC-1771914652357', '金恩来', '附件是 blob 死链，点开打不开')
ON CONFLICT (entity_type, entity_id) DO NOTHING;
