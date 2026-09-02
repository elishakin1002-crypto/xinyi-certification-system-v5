-- 清理上线前演示与测试数据（P0-16）
-- 生成于 2026-08-17，经业务方逐项确认
--
-- 为什么用明确 ID 而不是前缀匹配：
--   前缀匹配（如 id like 'P-INTEL-%'）会把将来产生的真实记录一起删掉。
--   这个迁移是一次性的历史清理，删的对象已经全部人工核对过，写死 ID 最安全。
--
-- 盘点依据（npm run data:plan）与人工确认结论：
--   · 保留 12 份真实合同及其项目（CT-17* 系列，温州/平阳/东莞真实企业）
--   · 保留 454 条「快启获客」批量导入线索 —— 统一码全部唯一且属苍南/平阳/龙港，
--     带完整工商信息，是真实销售管道，不是测试数据
--   · 保留 11 个「认证到期挖角跟进」项目 —— 与 11 条 Converted 线索一对一对应，
--     每条有 2-3 次跟进记录，是真实转化轨迹
--   · 保留情报跟进项目 P-INTEL-1783483544446（平阳温州康田包装，真实企业机会）
--
-- 删除顺序按依赖从叶到根。库里没有外键约束，顺序只为可读性。
--
-- 不写 BEGIN/COMMIT：迁移运行器已经把每个文件包在自己的事务里，
-- 文件内再开事务会让内层 COMMIT 提前提交外层，失败时就回滚不干净。

-- ① 提醒：指向待删项目/客户的提醒，不删会让提醒中心指向不存在的记录
DELETE FROM reminders
 WHERE (link_type = 'project' AND link_id IN (
         'proj-cert-001','proj-cert-002',
         'PROJ-DEMO-001','PROJ-DEMO-002','PROJ-DEMO-003','PROJ-DEMO-004',
         'P001','P002',
         'P-1772012244982','P-1772076775079','P-1772075250928',
         'P-INTEL-1770988913439','P-INTEL-1771897508619','P-INTEL-1771902840728'))
    OR (link_type = 'customer' AND link_id IN (
         'C001','CUST-DEMO-001','CUST-DEMO-002','CUST-DEMO-003',
         'cust-cert-001','cust-cert-002','cust-cert-003'));

-- ② 知识文档：挂在待删演示客户上的证书档案
DELETE FROM knowledge_docs
 WHERE id IN ('doc-cert-001','doc-cert-002','doc-cert-003','doc-cert-004');

-- ③ 结算：演示种子造的三条（demoDataSeeder.ts 里有同名 id，contract_ref 与 month 均为空）
DELETE FROM settlements WHERE id IN ('SETTLE-001','SETTLE-002','SETTLE-003');

-- ④ 项目
--   演示项目 6 个 + 演示合同项目 2 个 + 纯数字测试名 2 个 + 试手录入 1 个
--   + 情报误转项目 3 个（其中两个来源是新闻资讯——「温州龙港经营主体突破13万户」
--     「温州市公共资源交易网」根本不是可执行的认证项目；第三个指向已删除的线索）
DELETE FROM projects
 WHERE id IN (
   'proj-cert-001','proj-cert-002',
   'PROJ-DEMO-001','PROJ-DEMO-002','PROJ-DEMO-003','PROJ-DEMO-004',
   'P001','P002',
   'P-1772012244982','P-1772076775079','P-1772075250928',
   'P-INTEL-1770988913439','P-INTEL-1771897508619','P-INTEL-1771902840728');

-- ⑤ 合同：科诺华（深圳，演示编号 CT-2025-001）+ 三份 CONT-DEMO
DELETE FROM contracts
 WHERE id IN ('CT-2025-001','CONT-DEMO-001','CONT-DEMO-002','CONT-DEMO-003');

-- ⑥ 客户：演示客户 7 个
DELETE FROM customers
 WHERE id IN (
   'C001','CUST-DEMO-001','CUST-DEMO-002','CUST-DEMO-003',
   'cust-cert-001','cust-cert-002','cust-cert-003');

-- ⑦ 线索：演示线索 3 条（与 CUST-DEMO 同一批演示企业）
DELETE FROM leads WHERE id IN ('LEAD-DEMO-001','LEAD-DEMO-002','LEAD-DEMO-003');
