-- contractRef 职责分离：只存真实合同 ID，来源统一走 source_type / source_ref
-- 生成于 2026-08-24
--
-- ── 问题 ────────────────────────────────────────────────────────
-- contract_ref 被当成多态字段用：
--   CT-xxx    真实合同 ID
--   LEAD:xxx  来源前缀（线索）
--   INTEL:xxx 来源前缀（情报）
--   CUST:xxx  来源前缀（客户）
-- 而后加的 source_type + source_ref 表达的是同一件事。
-- 同一份信息两处存储，必然漂移——实测已出现「前缀写 CUST 而 source_type 是 customer」
-- 这类对不上的记录（大小写口径都不统一）。
--
-- ── 迁移前已核对 ────────────────────────────────────────────────
-- 27 个项目中：12 个是真实合同（CT-）、12 个是来源前缀、3 个为空。
-- 那 12 个前缀记录的来源信息**全部已在 source_type / source_ref 里**，
-- 逐条比对零缺失（前缀里的 ID 与 source_ref 完全一致），
-- 所以清空前缀不丢任何信息。
--
-- ── 代码侧已先改 ────────────────────────────────────────────────
-- · convertSignal.js 不再写 `INTEL:${id}` 到 contractRef
-- · completeProject.js 找客户时改读 source_type/source_ref，前缀只作旧数据兜底
-- 先改读取方、再清数据，顺序不能反。

-- 清空当成来源前缀用的 contract_ref。
-- 只清能确认来源信息已存在别处的，其余保持原样（宁可留着也不能丢信息）。
UPDATE projects
   SET contract_ref = '',
       updated_at = NOW()
 WHERE contract_ref ~ '^(LEAD|INTEL|CUST|CUSTCERT):'
   AND coalesce(nullif(source_type, ''), '') <> ''
   AND coalesce(nullif(source_ref, ''), '') <> '';

-- 「无关联」是另一种占位写法，同样归一成空
UPDATE projects
   SET contract_ref = '', updated_at = NOW()
 WHERE trim(contract_ref) = '无关联';
