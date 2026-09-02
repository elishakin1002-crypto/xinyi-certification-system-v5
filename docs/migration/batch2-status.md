# 批次2（项目交付）后端进度

## 已完成 ✅（纯后端，未碰前端）

| 项 | 文件 |
|---|---|
| PG 表 | `db/init/002_batch2_projects.sql`：projects/reminders/knowledge_docs/project_work_logs/task_templates |
| 映射增强 | `server/repos/_mapper.js`：加 `bool` 类型 + 通用 insert/update 构建器 |
| repo | `server/repos/projectRepo.js` `reminderRepo.js` `knowledgeRepo.js`（含 `*With(runner)` 事务方法） |
| 完成级联 | `server/services/completeProject.js`：忠实移植 AppContext.completeProject，单事务 |
| 路由 | `server/routes/batch2.js`：项目 CRUD + 任务 + 进度重算 + `/complete`；DB 未配自动回退 |
| 挂载 | `server/app.js`：`app.use(batch2Router)` |
| 迁移 | `scripts/batch2-migrate.mjs`：已迁 36 项目 + 304 提醒 + 14 知识文档 |

### 验证（HTTP 端到端全绿）
- 进度=核心任务完成率；`PATCH status=Completed` 被拒（强制走 /complete）。
- 费用门(T-001)：costStatus≠已确认 或 projectAmount≤0 → 409。
- 完成级联：项目→Completed+completionRecord；客户分级/累计额/serviceCount 更新；证书到期(认证类)或复购提醒；PDCA 知识文档。单事务原子。
- 评级：普通 S/A/B、情报跟进 A/B/C；客户 level 元阈值 10万/3万。

## 接口（已就绪，可供 MCP 写工具包装）
```
GET   /api/projects   /api/projects/:id
POST  /api/projects
PATCH /api/projects/:id            （非级联字段；禁改 Completed）
POST  /api/projects/:id/tasks
PATCH /api/projects/:id/tasks/:taskId   （重算进度）
POST  /api/projects/:id/complete   ⚠️ 原子级联
```

## 待办 / 已知事项
- `buildProjectFromInput`/`buildWorkflowTasks`（按服务项/模板自动生成任务）尚未后端化；当前 create 仅存传入字段。可后续补 `apply-template`。
- 合同仍在旧 state store：完成级联读合同走 legacy（只读，用于费用提示/PDCA上下文），批次3 迁移后改读 PG。
- `convertSignalToFollowUpProject`、project_work_logs/task_templates 的 repo 与迁移留待后续。
- `/api/projects/transaction`（前端旧批量写）仍走 legacy；批次2 前端切换后废弃。
- 过渡期：项目读写经 batch2(PG)，但 /transaction 经 legacy(state store)，存在并存，前端切换后统一。
