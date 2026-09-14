-- 外键改成「事务提交时才校验」
--
-- ── 为什么（025 上线当天就发现的）──────────────────────────────
--
-- 金恩来 2026-09-14：「删除要照顺序那创建呢？也要按照顺序？
--   那问题就大了，谁会在使用的时候记住并遵守某个使用顺序呢？
--   这本身也是反人性的设计啊！」
--
-- 025 加完外键，测试当场红了一片。逐个看下来，真因都是同一件事：
-- **一次保存里同时写好几张表，而写入顺序不是先父后子。**
--
-- 典型场景：销售在合同页面上「新建客户 + 录入合同」一起保存，
-- 前端把 contracts_v8 和 customers_v8 一起提交。
-- 回写关系表时如果先写合同，它指向的客户这一刻还不存在 —— 直接失败。
--
-- 加外键之前这不报错（库里多一条指向空气的合同，没人知道），
-- 所以这个顺序 bug **一直都在**，只是症状从"悄悄产生脏数据"
-- 变成了"保存失败"。后者刺眼，但前者更贵。
--
-- ── 两种改法，为什么选这个 ────────────────────────────────────
--
--   改法 A：在代码里排好顺序（已经做了，见 datasetMirror.js 的 MIRROR_ORDER）
--           缺点：**要人记住**。将来谁新加一种数据、忘了排进顺序表，
--           这个坑就复发一次。而且不止这一条写入路径。
--
--   改法 B（这个迁移）：**DEFERRABLE INITIALLY DEFERRED** ——
--           外键不在每条语句执行时校验，而是**等整个事务提交时**再一次性校验。
--           于是一个事务里先写合同后写客户完全没问题，
--           只要提交那一刻数据是自洽的就行。
--
-- 两个都要：B 是机制（不依赖人），A 是习惯（顺序对了性能也更好）。
-- 但保证由 B 提供 —— **凡是需要人记住的规矩，早晚会有人记不住。**
--
-- 保护强度没有降低：事务结束时该拦的照样拦，
-- 只是把"什么时候检查"从每条语句挪到了提交那一刻。

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS fk_contracts_customer;
ALTER TABLE contracts ADD CONSTRAINT fk_contracts_customer
  FOREIGN KEY (customer_id) REFERENCES customers(id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS fk_projects_customer;
ALTER TABLE projects ADD CONSTRAINT fk_projects_customer
  FOREIGN KEY (customer_id) REFERENCES customers(id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE project_work_logs DROP CONSTRAINT IF EXISTS fk_worklogs_project;
ALTER TABLE project_work_logs ADD CONSTRAINT fk_worklogs_project
  FOREIGN KEY (project_id) REFERENCES projects(id)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE audit_issues DROP CONSTRAINT IF EXISTS fk_audit_contract;
ALTER TABLE audit_issues ADD CONSTRAINT fk_audit_contract
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE audit_issues DROP CONSTRAINT IF EXISTS fk_audit_customer;
ALTER TABLE audit_issues ADD CONSTRAINT fk_audit_customer
  FOREIGN KEY (customer_id) REFERENCES customers(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE audit_issues DROP CONSTRAINT IF EXISTS fk_audit_project;
ALTER TABLE audit_issues ADD CONSTRAINT fk_audit_project
  FOREIGN KEY (project_id) REFERENCES projects(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
