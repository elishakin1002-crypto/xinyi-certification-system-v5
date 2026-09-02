# 后端化阶段总审查

审查日期：2026-05-14

## 结论

线索、客户、合同、项目四个核心经营模块已经从“前端本地 state 为主”推进到“后端 API/事务写入 + 灰度开关 + 写后读回 + 部署前准入”的阶段。

当前适合进入测试环境联调，但还不适合直接承诺生产上线。主要原因不是基础链路不可用，而是仍有删除类能力、少数模块只覆盖样板链路、以及真实 PostgreSQL/域名/登录环境需要做部署验收。

## 已完成范围

| 模块 | 后端接口 | 前端读取 | 前端写入 | 事务一致性 | 写后读回 | 测试环境准入 |
|---|---|---:|---:|---:|---:|---:|
| 线索 | `/api/leads` | 已接入 | 已接入 | 暂不需要多数据集事务 | 已接入 | 已强制 |
| 客户 | `/api/customers` | 已接入 | 已接入 | 暂不需要多数据集事务 | 已接入 | 已强制 |
| 合同 | `/api/contracts`、`/api/contracts/transaction` | 已接入 | 已接入 | 已接入 | 已接入 | 已强制 |
| 项目 | `/api/projects`、`/api/projects/transaction` | 已接入 | 已接入 | 已接入 | 已接入 | 已强制 |

## 当前保留边界

这些操作仍不建议直接开放到后端持久化，必须单独说明影响范围后再做：

- 删除合同、删除附件
- 删除项目、删除任务、删除服务项、删除工作日志
- 服务项删除导致任务解绑，虽然不是删除任务，但会改变既有任务归属，也按破坏性/解绑类处理

## 主要风险

1. 删除类能力缺少产品规则

现在还没有明确哪些角色能删、是否软删除、是否保留审计、是否允许恢复、删除后关联数据如何处理。直接做硬删除风险高。

2. 状态同步与模块 API 仍会并行存在

当前保留 `stateSyncService` 是为了兼容旧模块和渐进迁移。测试环境必须开启模块 API 灰度和写后验证，否则会出现页面看似成功但没有真正验收模块 API 的问题。preflight 已补齐强制检查。

3. PostgreSQL 真环境仍需验收

本地多数验证运行在文件模式或本地运行态。测试环境必须执行 `health:state:persistence`、各模块 `health:*:api`、auth postgres health，确认数据不是落到文件。

4. 权限模型还需要继续从“角色导航权限”升级到“业务动作权限”

员工登录、角色和基础 API 角色校验已完成，员工账号管理已开始拆成动作级后端守卫，默认仍只授予 `ADMIN`。删除、项目/客户数据范围、以及给前台/助理等岗位开放哪些员工管理动作，还需要单独确认规则后再放开。

5. UI 合约虽然有 E2E 防线，但未覆盖所有细粒度交互

当前 E2E 覆盖核心入口、线索/客户 UI 合约、合同闭环、项目事务主链路。财务、审改、知识中心、战略管理等仍主要依赖类型检查和既有页面加载检查。

## 下一步建议顺序

1. 先跑测试环境部署验收

目标是验证真实域名、登录、PostgreSQL、API token、CORS、模块 API 灰度和健康脚本能闭环。

必须跑：

```bash
npm run health:preflight:test
DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:test-env
DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres npm run health:deploy
STATE_SYNC_BASE=https://<host> STATE_EXPECTED_MODE=postgres npm run health:state:persistence
AUTH_HEALTH_URL=https://<host>/api/auth/health AUTH_EXPECTED_MODE=postgres npm run health:auth:postgres
AUTH_API_BASE=https://<host> AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:auth:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:leads:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:customers:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:contracts:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:projects:api
```

2. 再做权限模型细化

已新增 `docs/action-permission-matrix.md` 固化当前动作权限，并把员工账号管理拆成 `EMPLOYEE_*` 与 `AUTH_AUDIT_VIEW` 动作。下一步如果要覆盖前台、总经理助理、人事负责人等非 `ADMIN` 员工承担账号管理的场景，需要先确认每个岗位能查看、创建、更新、停用、重置密码、查看审计日志中的哪些动作。

3. 再决定删除类能力

删除类建议统一采用软删除/归档优先，并补审计日志。不要先做硬删除。

4. 再扩展剩余模块后端化

优先顺序建议：财务回款台账、知识中心、审核整改、AI 配置中心。原因是这些模块与合同/项目/客户联动较多，越早后端化越能减少状态分裂。

## 阶段准入判断

- 本地开发准入：已达到
- 测试环境部署准备：基本达到，等待真实环境验证
- 小范围业务试用：需要先完成测试环境验收和账号/权限配置
- 生产上线：仍需删除类规则、动作权限、备份恢复、监控告警、真实数据迁移方案
