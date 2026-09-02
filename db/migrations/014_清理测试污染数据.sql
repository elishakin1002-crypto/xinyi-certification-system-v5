-- 清理测试写进生产库的数据
-- 生成于 2026-08-21
--
-- 根因：测试从来没有独立数据库。两个测试助手都直连 .env.local 里的
-- XINYI_DB_URL —— 也就是装着 455 条真实线索、13 份真实合同的那个生产库。
-- 事务测试建了 fixture，断言失败后没回滚干净，就留在了库里。
--
-- 写脏数据只是表症。真正的风险是：测试里但凡有删除或清理逻辑，
-- 删的就是真实业务数据。这次运气好，只留了 6 条。
--
-- 已修：tests/helpers/testDb.js 强制库名必须以 _test 结尾，
--       否则测试直接抛错拒绝启动，两个 helper 都从那里取环境变量。
--
-- 删除范围（删前逐条核过，scripts 里的引用检查确认是自引用闭环，
-- 没有任何真实记录指向它们；删前已 npm run backup）：
--   customers      C-P-TXN-1（项目事务客户）、C-TXN-1（合同事务客户）
--   contracts      CT-TXN-1  → customer_id 指向 C-TXN-1
--   projects       P-TXN-1   → customer_id 指向 C-TXN-1，contract_ref 指向 CT-TXN-1
--   reminders      REM-P-TXN-1 → link_id 指向 C-P-TXN-1
--   knowledge_docs DOC-P-TXN-1
--
-- 沿用 006/007 的做法：显式 ID 清单，不用 LIKE 'TXN%' 之类的前缀匹配。
-- 前缀匹配在这种场合太危险——真实客户名里出现同样的字符就会被误删。
--
-- 【关于校验和】本文件在生产库执行过一次后改动过一次，属于刻意为之：
-- 初版直接 DELETE app_state_latest，而那张表是运行时懒建的，
-- 全新库上不存在，导致 npm run test:db:setup 在新环境上必然失败。
-- 处理方式是删掉 schema_migrations 里 014 的记录后重跑（本文件全部语句
-- 都是幂等的，行已删干净，重跑是空操作），而不是手改校验和——
-- 重跑能真的验证新 SQL 可执行。此后本文件同样不可再改。

-- 先删引用方，再删被引用方
DELETE FROM reminders      WHERE id = 'REM-P-TXN-1';
DELETE FROM knowledge_docs WHERE id = 'DOC-P-TXN-1';
DELETE FROM projects       WHERE id = 'P-TXN-1';
DELETE FROM contracts      WHERE id = 'CT-TXN-1';
DELETE FROM customers      WHERE id IN ('C-P-TXN-1', 'C-TXN-1');

-- 状态存储里的探针键，来自 state sync 测试。
--
-- 必须判存在：app_state_latest / app_state_history 不是迁移建的，
-- 是 stateStore 在服务启动时 CREATE TABLE IF NOT EXISTS 懒建的。
-- 全新库（比如 xinyi_test）上没跑过服务，这两张表就不存在，
-- 直接 DELETE 会让整个迁移在新环境上失败。
DO $$
BEGIN
  IF to_regclass('public.app_state_latest') IS NOT NULL THEN
    DELETE FROM app_state_latest
     WHERE dataset_key = 'camel_case_key' OR dataset_key LIKE 'test\_probe\_%';
  END IF;
  IF to_regclass('public.app_state_history') IS NOT NULL THEN
    DELETE FROM app_state_history
     WHERE dataset_key = 'camel_case_key' OR dataset_key LIKE 'test\_probe\_%';
  END IF;
END $$;
