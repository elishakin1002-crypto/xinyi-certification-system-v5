-- 关闭无价值文档的 AI 可见性（P0-13 存量部分）
--
-- 新建文档的默认值已在代码里改好（情报日报/合同占位符/空白 PDCA 一律 false，
-- 审计避坑锦囊保持 true——那是真正该进 RAG 的护城河数据）。
-- 这里处理存量：14 篇全是 true，其中 6 篇不该开放。
--
-- 关掉的两类：
--   ① 正文 0 字的空文档 —— 没有内容却在被 AI 摘要，纯花钱，检索命中它也是噪音
--   ② 情报雷达日报 —— 新闻资讯不是可复用知识，4 篇加起来近 2 万字，
--      占着检索权重，把真正有用的培训手册和客户复盘挤下去
--
-- 保留的：培训手册（5970 字真内容）、客户复盘 PDCA（已填写）、检测报告、客户资料。
-- 只改 ai_visible，不删文档——文档本身有归档价值，只是不该进 AI 检索。

UPDATE knowledge_docs
   SET ai_visible = false
 WHERE ai_visible IS DISTINCT FROM false
   AND (
     -- ① 空文档
     coalesce(length(content), 0) = 0
     -- ② 情报雷达日报
     OR title LIKE '情报雷达日报%'
   );
