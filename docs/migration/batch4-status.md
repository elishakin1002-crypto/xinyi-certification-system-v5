# 批次4（情报+审计+战略）后端进度

## 已完成 ✅（纯后端，未碰前端）

| 项 | 文件 |
|---|---|
| PG 表 | `db/init/004_batch4_intel_audit_strategy.sql`：market_signals、audit_issues、strategic_tasks |
| 通用工厂 | `server/repos/_factory.js`：makeRepo（CRUD 样板复用） |
| repo | `server/repos/batch4Repos.js`：signalRepo / auditRepo / strategicRepo |
| 路由 | `server/routes/batch4.js`：三模块 CRUD（list/get/create/patch）；DB 未配自动回退 |
| 挂载 | `server/app.js`：`app.use(batch4Router)`，三路径纳入受保护 |
| 迁移 | `scripts/batch4-migrate.mjs`：已迁 328 情报（审计/战略源为空） |
| MCP 工具 | 读 list_market_signals/list_audit_issues/list_strategic_tasks；写 update_market_signal/create+update_audit_issue/create+update_strategic_task（MCP 共 35 工具） |

### 验证
- GET /api/signals?status=new&urgency=high → 32 条（top score 98）。
- 审计问题 create→patch(status=Rectifying) 正常。
- 经 MCP 实调 list_market_signals 拿到 32 条高优情报。

## 待办 / 已知事项（跨实体级联，未实现，按需补）
- `convertSignalToFollowUpProject`（情报→跟进项目）：可做 `POST /api/signals/:id/convert`，内部建 PG 项目并回写 signal.convertedTo。
- `syncAuditRectificationTask`（审计问题↔项目整改任务同步）：可在 audit-issue 创建/更新时联动项目任务。
- `generateAuditPlan`（按周期生成审核节点）、`generateStrategicTasksFromInsight`（AI 生成战略任务）。
- ai_decision_logs / strategic_insight 未迁（低频，按需）。
- 当前为 CRUD + 状态流转，足够 Agent 查看与基本操作；上述级联为增强项。
