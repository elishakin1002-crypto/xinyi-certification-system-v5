# 测试交付准入清单

## 目的

这份清单用于判断当前版本是否已经达到“可以部署到测试环境给业务验证”的最低标准。任何一项没有证据，都不视为已交付。

真实测试环境第一次部署前，先按 `docs/test-env-deployment-parameter-pack.md` 准备部署参数。

需要业务方配合的 DNS、数据库、部署平台权限和账号准备，按 `docs/test-deployment-collaboration-checklist.md` 执行。

部署后按 `docs/test-env-acceptance-record-template.md` 留存验收记录。没有记录版本、环境、自动验收、人工验收和风险结论，不算完成测试交付。

## 1. 代码准入

| 检查项 | 验收标准 | 证据 |
|---|---|---|
| TypeScript | `npm run typecheck` 通过 | 命令输出 |
| 单元/API 测试 | `npm run test` 全部通过 | 命令输出 |
| 构建 | `npm run build` 成功 | `dist/` 产物 |
| 前端密钥扫描 | `npm run security:bundle` 通过 | 无服务端密钥标记 |
| 本地预检 | `npm run health:preflight:dev` 通过 | 配置风险可见 |
| 本地真实登录路径 | 普通本地 `3000/3001` 下，`/#/dashboard` 自动跳转 `/#/login`，且认证用户数 `users>=1` | `npm run health:local-auth` |
| E2E | `npm run e2e` 通过，至少覆盖 dashboard、核心业务页面入口、线索转跟进项目、合同到客户/项目/回款链路 | Playwright 输出 |

本地聚合命令用于隔离测试与构建校验。普通本地真实登录路径需要在 `3000/3001` 已启动时单独执行。

```bash
npm run verify:local
npm run health:local-auth
```

## 2. 测试环境准入

| 检查项 | 验收标准 | 证据 |
|---|---|---|
| 环境变量 | `npm run health:preflight:test` 通过 | CI 或部署日志 |
| 测试域名 | DNS 可解析、入口为 HTTPS、前端壳可打开，且不是误测 localhost | `TEST_HOST=https://<host> npm run health:test-domain` |
| 后端健康 | `/api/ai/health` 返回成功 envelope | curl/health 输出 |
| 认证 API | 管理员可登录并读取当前用户、员工列表、审计日志 | `AUTH_API_BASE=https://<host> AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:auth:api` |
| 状态存储 | `/api/state/health` 返回 `mode=postgres` | health 输出 |
| 状态持久化 | 探针数据写入后可按 key 读回 | `STATE_SYNC_BASE=https://<host> STATE_EXPECTED_MODE=postgres npm run health:state:persistence` |
| 情报接口 | `/api/intel/latest` 不返回 500 | health 输出 |
| 前端页面 | `/dashboard` 可打开 | E2E 或人工截图 |
| 登录门禁 | 未登录访问 `/dashboard` 必须跳转 `/login` | 浏览器检查或人工截图 |
| API 代理 | 前端同源 `/api` 可访问后端 | `npm run health:deploy` |
| 聚合验收 | 部署、状态、认证、核心模块 smoke 一次性通过 | `npm run health:test-env` |

测试环境推荐命令：

```bash
npm run health:preflight:test
TEST_HOST=https://<host> npm run health:test-domain
DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:test-env
DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres npm run health:deploy
AUTH_API_BASE=https://<host> AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:auth:api
STATE_SYNC_BASE=https://<host> STATE_EXPECTED_MODE=postgres npm run health:state:persistence
```

聚合验收按 PostgreSQL 模式执行时，`DEPLOY_FRONTEND_BASE` 和 `DEPLOY_BACKEND_BASE` 必须显式传入，不能依赖默认本机地址。

验收证据建议保存：

```bash
TEST_ENV_ACCEPTANCE_REPORT=acceptance-reports/test-env-<date>.json npm run health:test-env
```

报告会保存聚合验收结果，并对常见密码、token、数据库连接串做脱敏。

生成 Markdown 验收记录草稿：

```bash
npm run acceptance:record -- --report=acceptance-reports/test-env-<date>.json --out=acceptance-reports/test-env-<date>.md
```

## 3. 核心业务验收

| 链路 | 验收标准 | 当前状态 |
|---|---|---|
| 线索 | 能新增、保存、刷新后保留 | 新增线索与线索转跟进项目已由 E2E 覆盖；刷新后保留由测试环境 `health:state:persistence` 和人工链路共同验收 |
| 客户 | 能从线索转入或新增客户 | 合同自动创建客户主体已由 E2E 覆盖；线索转正式客户仍待手工/后续 E2E |
| 合同 | 能基于客户创建合同 | 合同录入已由 E2E 覆盖 |
| 项目 | 合同能进入项目管理链路 | 自动交付项目已由 E2E 覆盖 |
| 财务 | 回款状态能更新并保留 | 回款台账展示与“确认到账 -> 已核销”已由 E2E 覆盖；刷新后保留由测试环境 `health:state:persistence` 和人工链路共同验收 |

说明：这部分涉及业务 UI 和字段流转，后续如果需要改 UI、demo 结构或字段，会先说明变更原因和影响，再等确认。

## 4. 风险清单

| 风险 | 影响 | 当前控制措施 | 关闭条件 |
|---|---|---|---|
| 测试环境未接 PostgreSQL | 数据可能落回文件模式 | `XINYI_REQUIRE_POSTGRES=true`、`health:state:postgres` | `/api/state/health` 显示 `mode=postgres` |
| API 未开启鉴权 | 测试环境接口裸露 | `XINYI_API_AUTH_TOKEN`、鉴权测试 | 未授权请求返回 401/403 |
| 前端重新暴露密钥 | 服务端密钥泄漏 | `security:bundle` | bundle 扫描通过 |
| 外部 AI 不稳定 | 测试流程被真实模型阻塞 | API health 与 mock 测试分离 | 基础测试不依赖真实生成 |
| E2E 覆盖不足 | 业务链路问题发现滞后 | 已有 dashboard smoke | 核心链路 E2E 或人工验收补齐 |

## 5. 交付结论格式

```text
版本/提交：
环境：
CI：
本地验证：
测试环境验证：
核心业务验收：
未关闭风险：
回滚方式：
结论：可进入测试 / 暂缓进入测试
```
