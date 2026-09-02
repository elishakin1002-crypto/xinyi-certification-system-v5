# 项目后端 API 契约

## 目标

项目模块后端化继续使用渐进迁移方式：后端 API 继续读写现有 `projects_v8` 数据集；前端通过读写灰度和事务写入接入，避免改变当前 UI、DOM、demo 结构和业务字段。

本阶段不提供删除项目、删除任务、删除服务项、删除工作日志等破坏性接口。此类能力需要单独说明影响范围并确认后再做。

## 数据边界

- 数据集：`projects_v8`
- 返回对象：保持当前 `Project` 形状
- 不新增、不重命名、不删除现有业务字段
- 更新操作为浅合并，`id` 以 URL 参数为准，不允许通过 body 改写
- 常规项目 API 不直接管理项目工作日志 `project_work_logs_v1`
- 多数据集联动通过项目事务接口提交

## 接口

### `GET /api/projects`

返回全部项目：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {
    "projects": []
  }
}
```

### `GET /api/projects/:id`

返回单个项目；不存在时返回 `404`。

### `POST /api/projects`

创建项目。推荐请求格式：

```json
{
  "project": {
    "name": "ISO 9001 认证交付项目",
    "customerId": "C-001",
    "contractRef": "CT-001",
    "projectCategory": "Delivery",
    "manager": "张三",
    "deadline": "2026-06-30",
    "projectType": "Self-Operated",
    "tasks": []
  }
}
```

创建默认值与当前项目数据兼容：

- `status=Active`
- `paymentStatus=unpaid`
- `progress` 优先使用传入值；未传入时按任务完成率计算
- `projectCategory=Delivery`
- `projectType=Self-Operated`
- `duration=30`
- `tasks=[]`
- `serviceItems=[]`
- `settlementConfig={ rule: "Ratio", value: 10, base: "Revenue" }`

### `PATCH /api/projects/:id`

更新项目。推荐请求格式：

```json
{
  "project": {
    "manager": "李四",
    "deadline": "2026-07-15",
    "projectAmount": 98000,
    "costStatus": "已确认"
  }
}
```

不存在时返回 `404`。

### `POST /api/projects/:id/tasks`

追加项目任务。推荐请求格式：

```json
{
  "task": {
    "title": "资料收集",
    "deadline": "2026-05-20",
    "status": "Pending",
    "priority": "High",
    "category": "Core",
    "owner": "张三"
  }
}
```

后端会生成 `task.id`，追加后重新计算 `project.progress`。

### `PATCH /api/projects/:id/tasks/:taskId`

更新项目任务。推荐请求格式：

```json
{
  "task": {
    "status": "Completed"
  }
}
```

更新后重新计算 `project.progress`；项目或任务不存在时返回 `404`。

### `POST /api/projects/transaction`

提交项目复杂联动引发的多数据集结果。该接口用于后续任务完成、项目完结、客户 PDCA、提醒、工作日志等场景，避免只保存项目、遗漏工作日志或客户状态的半落库状态。

只允许写入以下数据集：

- `projects_v8`
- `customers_v8`
- `reminders_v8`
- `project_work_logs_v1`
- `knowledge_docs_v8`

请求格式：

```json
{
  "projectId": "P-001",
  "datasets": {
    "projects_v8": [],
    "customers_v8": [],
    "reminders_v8": [],
    "project_work_logs_v1": [],
    "knowledge_docs_v8": []
  }
}
```

规则：

- `projects_v8` 必须存在且必须是数组
- `projectId` 可选；传入时必须能在 `projects_v8` 中找到
- 不在允许列表内的数据集会被忽略
- PostgreSQL 模式下由 `upsertStateBatch` 在一个数据库事务内写入
- 文件模式下会在一次文件写入中保存本批次数据

## 鉴权

`/api/projects` 属于受保护 API：

- 测试/预发/生产应开启 `XINYI_API_AUTH_REQUIRED` 或 `XINYI_SESSION_AUTH_REQUIRED`
- 自动化任务可继续使用 API token
- 员工登录模式下可通过 HttpOnly session 访问

## 前端灰度开关

默认值为 `0`，不会改变现有项目页面的数据来源与演示行为。

| 环境变量 | 作用 |
|---|---|
| `VITE_PROJECTS_API_READ_ENABLED` | 页面启动时从 `GET /api/projects` 读取项目数据 |
| `VITE_PROJECTS_API_WRITE_ENABLED` | 新增项目、负责人指派、任务新增、成本确认、任务状态变更、服务项新增/更新、项目重新打开完成本地计算后写入项目 API/事务 API |
| `VITE_PROJECTS_API_VERIFY_WRITES_ENABLED` | 写入后读取 `GET /api/projects/:id` 校验；失败时回滚前端状态 |

当前已接入项目 API 只读灰度和部分非破坏性写入灰度。

当前已接入写入灰度的前端操作：

- 新增项目
- 指派负责人
- 新增任务
- 成本确认
- 任务状态变更
- 任务完成自动工作日志（未触发项目自动完结时）
- 项目完结：同步提交项目完成记录、客户 PDCA 指标与提醒
- 任务完成触发项目自动完结：同步提交项目完成记录、客户 PDCA 指标、提醒与任务自动工作日志
- 服务项新增：同步提交服务项与自动生成任务
- 服务项更新：同步提交服务项最新状态
- 项目重新打开：同步提交项目状态回滚、客户 PDCA 指标回滚，并移除本次完成事件自动生成的提醒

当前暂不接入写入灰度的操作：

- 服务项删除：会解绑已有任务，属于删除/解绑类操作，需要单独确认后再做
- 删除项目、删除任务、删除工作日志：破坏性操作，需要单独确认后再做

后续继续接入前，需要先固定项目页面 UI 合约，再按以下顺序推进：

1. 破坏性操作：删除项目、删除任务、删除服务项、删除工作日志，需单独确认后实现

## 回归要求

每次接入或修改项目后端化相关逻辑，至少运行：

```bash
npm run test
npm run health:projects:api
VITE_PROJECTS_API_READ_ENABLED=1 npm run e2e -- --project=chromium --grep "core business routes"
VITE_PROJECTS_API_READ_ENABLED=1 VITE_PROJECTS_API_WRITE_ENABLED=1 VITE_PROJECTS_API_VERIFY_WRITES_ENABLED=1 npm run e2e -- --project=chromium --grep "project create"
```
