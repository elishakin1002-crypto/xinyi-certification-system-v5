-- 清理孤儿提醒（P0-16 补漏）
-- 生成于 2026-08-17
--
-- 006 清理演示数据时，只删了 link_type = 'project' / 'customer' 的提醒，
-- 漏掉了 'contract' 和 'audit' 两种关联方式，留下 10 条指向已删记录的提醒。
-- 这些提醒在提醒中心里点开会跳到不存在的记录。
--
-- 是全站扫描 API 响应时发现的（库里查不出来——按 link_type 分类查漏了口径，
-- 但演示企业名还留在提醒标题和正文里）。教训：清理关联数据不能只想到
-- 「主要那几种关联」，要按 link_type 全枚举一遍。
--
-- 其中 REM-AUDIT-DEADLINE-AUD-1786946504171 指向的不符合项在 PG 里根本不存在
-- ——因为不符合项目前只写 state_store.json，不写 audit_issues 表（见待办 P0-19）。
-- 这条提醒指向的是已删除的演示项目「温州宏远包装 ISO 9001 认证项目」。

DELETE FROM reminders WHERE id IN (
  'REM-AUDIT-DEADLINE-AUD-1786946504171',
  'AUTO-AR-DUE-CONT-DEMO-001-REC-002',
  'AUTO-AR-OVER-L2-CONT-DEMO-001-REC-002',
  'AUTO-AR-OVER-L2-CONT-DEMO-001-REC-003',
  'AUTO-AR-OVER-L2-CONT-DEMO-002-REC-005',
  'AUTO-AR-OVER-L2-CONT-DEMO-002-REC-006',
  'AUTO-AR-OVER-L2-CONT-DEMO-003-REC-008',
  'AUTO-AR-OVER-L2-CONT-DEMO-003-REC-009',
  'AUTO-AR-OVER-L2-CT-2025-001-R2',
  'REMIND-002'
);
