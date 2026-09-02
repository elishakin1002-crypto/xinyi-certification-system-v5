-- 回填默认服务项（项目管理审查⑥）
--
-- 背景：服务项原本是可选的，结果 24 个项目里 16 个没有服务项、任务直接挂项目上。
-- 系统里同时存在两种项目结构，进度/分组/负责人/结算的下游逻辑都要处理两种情况，
-- 界面也长得不一样——这是复杂度和 bug 的来源。
--
-- 服务项这层本身是必要的：一个合同可能含 ISO9001 + ISO14001 + HACCP，
-- 交付负责人和任务流完全不同。所以不是去掉这层，而是让它必然存在：
-- 每个项目自动带一个与项目同名的默认服务项，单体系项目用户感知不变。
--
-- 新建项目已在 AppContext 里自动创建默认服务项，这里只处理存量数据。
-- 幂等：只对 service_items 为空的项目生效，重复执行不会产生第二个默认服务项。

-- ① 给没有服务项的项目补一个与项目同名的默认服务项
UPDATE projects
   SET service_items = jsonb_build_array(
         jsonb_build_object(
           'id',                'SVC-DEFAULT-' || id,
           'name',              name,
           'owner',             coalesce(manager, ''),
           'status',            'Pending',
           'autoGenerateTasks', false
         )
       )
 WHERE service_items IS NULL
    OR jsonb_array_length(coalesce(service_items, '[]'::jsonb)) = 0;

-- ② 把没有归属服务项的任务挂到默认服务项下，避免任务「悬空」
--    只补 serviceItemId 缺失或为空的任务，已归属的不动。
UPDATE projects p
   SET tasks = (
         SELECT jsonb_agg(
                  CASE
                    WHEN coalesce(t->>'serviceItemId', '') = ''
                      THEN t || jsonb_build_object('serviceItemId', 'SVC-DEFAULT-' || p.id)
                    ELSE t
                  END
                  ORDER BY ord
                )
           FROM jsonb_array_elements(p.tasks) WITH ORDINALITY AS x(t, ord)
       )
 WHERE jsonb_array_length(coalesce(p.tasks, '[]'::jsonb)) > 0
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(p.tasks) AS t
          WHERE coalesce(t->>'serviceItemId', '') = ''
       );
