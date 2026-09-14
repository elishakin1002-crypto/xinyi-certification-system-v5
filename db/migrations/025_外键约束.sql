-- 外键约束 —— 让「指向空气的记录」在数据库层面不可能出现
--
-- ── 为什么（2026-09-14 金恩来：「外键约束开始做吧！」）──────────
--
-- 在这之前，全库只有一个外键（auth_sessions → auth_users）。
-- 意思是：删掉一个客户，他名下的合同、项目上的 customer_id
-- **不会报错、不会级联，只会静悄悄变成指向空气的孤儿记录**。
-- 然后「客户管理里没有这家公司，合同管理里却有他的合同」，
-- 而且没有任何地方会告诉你出了这个岔子。
--
-- 他的原话点到了要害：
--   「删除要照顺序那创建呢？也要按照顺序？那问题就大了，
--     谁会在使用的时候记住并遵守某个使用顺序呢？这本身也是反人性的设计啊！」
--
-- 他是对的。**顺序不该由人记，该由数据库保证。**
-- 加上外键之后：删客户时如果底下还挂着合同，数据库直接拒绝并说明原因；
-- 日常使用（建客户、建合同、建项目）没有任何顺序要求，以后也不会有。
--
-- ── 为什么是现在做 ─────────────────────────────────────────────
--
-- 加外键要求现有数据先是干净的（不能有孤儿）。
-- 刚跑完 clean-pre-launch 清掉测试数据，库里只剩线索和账号 ——
-- **这是加外键风险最小的窗口**，错过了就要在有真实业务时动。
--
-- ── 删除行为为什么这么选 ───────────────────────────────────────
--
--   ON DELETE RESTRICT  客户 ← 合同 / 项目
--       删客户时底下还有合同，**直接拒绝**。
--       不用 CASCADE：合同是有法律意义的记录，不能因为清理客户就连坐删掉。
--       人看到「这个客户下面还有 3 份合同，先处理它们」，比东西悄悄没了好。
--
--   ON DELETE CASCADE   项目 ← 工作日志 / 结算
--       这些是项目的**组成部分**，项目没了它们单独存在没有意义。
--
--   ON DELETE SET NULL  合同 ← 不符合项
--       不符合项本身是独立的质量记录，合同删了它还该在，只是不再关联。
--
-- 所有外键都 NOT VALID + 随后 VALIDATE：
-- 这样加约束时只锁一瞬间，校验存量数据时不阻塞读写。
-- 现在数据少无所谓，但这个写法要留下来给以后照着抄。

-- ── 加之前先清理可能存在的孤儿（清理脚本跑过之后应该是 0 条）──
-- 不先清的话，加约束会直接失败并报一长串看不懂的 SQL 错误。
UPDATE contracts SET customer_id = NULL
 WHERE customer_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = contracts.customer_id);

UPDATE projects SET customer_id = NULL
 WHERE customer_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = projects.customer_id);

DELETE FROM project_work_logs
 WHERE project_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = project_work_logs.project_id);

UPDATE audit_issues SET contract_id = NULL
 WHERE contract_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = audit_issues.contract_id);

UPDATE audit_issues SET customer_id = NULL
 WHERE customer_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = audit_issues.customer_id);

UPDATE audit_issues SET project_id = NULL
 WHERE project_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = audit_issues.project_id);

-- ── 客户是根：删客户时底下还有东西就拒绝 ──
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS fk_contracts_customer;
ALTER TABLE contracts ADD CONSTRAINT fk_contracts_customer
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE contracts VALIDATE CONSTRAINT fk_contracts_customer;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS fk_projects_customer;
ALTER TABLE projects ADD CONSTRAINT fk_projects_customer
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE projects VALIDATE CONSTRAINT fk_projects_customer;

-- ── 工作日志是项目的组成部分：项目没了它们也没有意义 ──
ALTER TABLE project_work_logs DROP CONSTRAINT IF EXISTS fk_worklogs_project;
ALTER TABLE project_work_logs ADD CONSTRAINT fk_worklogs_project
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE project_work_logs VALIDATE CONSTRAINT fk_worklogs_project;

-- ── 不符合项是独立的质量记录：关联对象没了，它还在，只是不再关联 ──
ALTER TABLE audit_issues DROP CONSTRAINT IF EXISTS fk_audit_contract;
ALTER TABLE audit_issues ADD CONSTRAINT fk_audit_contract
  FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE audit_issues VALIDATE CONSTRAINT fk_audit_contract;

ALTER TABLE audit_issues DROP CONSTRAINT IF EXISTS fk_audit_customer;
ALTER TABLE audit_issues ADD CONSTRAINT fk_audit_customer
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE audit_issues VALIDATE CONSTRAINT fk_audit_customer;

ALTER TABLE audit_issues DROP CONSTRAINT IF EXISTS fk_audit_project;
ALTER TABLE audit_issues ADD CONSTRAINT fk_audit_project
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE audit_issues VALIDATE CONSTRAINT fk_audit_project;

/*
  外键列上要有索引，否则**删父记录会全表扫子表**。
  这条容易漏：约束加了、功能对了，但客户一多，删一个客户要几秒钟。
*/
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts (customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects (customer_id);
CREATE INDEX IF NOT EXISTS idx_worklogs_project ON project_work_logs (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_contract ON audit_issues (contract_id);
CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit_issues (customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_issues (project_id);
