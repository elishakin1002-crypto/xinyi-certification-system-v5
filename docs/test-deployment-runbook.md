# 测试部署 Runbook

## 目的

统一“可交付到测试环境”的执行与验收标准，避免不同人使用不同口径。

接口契约参考：

- `docs/state-sync-api-contract.md`
- `docs/test-delivery-readiness-checklist.md`
- `docs/test-environment-checklist.md`
- `docs/test-env-deployment-parameter-pack.md`
- `docs/test-env-acceptance-record-template.md`
- `docs/employee-auth-plan.md`
- `docs/leads-api-contract.md`
- `docs/customers-api-contract.md`
- `docs/contracts-api-contract.md`
- `docs/projects-api-contract.md`

## 适用范围

- 本地开发验证
- Pull Request 质量门禁
- 测试环境部署验收
- 问题回滚

## 1. 本地提交前检查

在本地提交前，必须通过以下命令：

```bash
npm run verify:local
```

等价于：

```bash
npm run typecheck
npm run test
npm run build
npm run security:bundle
npm run health:preflight:dev
npm run e2e
```

如果本地前后端在运行，再执行：

```bash
npm run health:stack
npm run health:deploy
npm run health:state:persistence
AUTH_API_BASE=http://127.0.0.1:3001 AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:auth:api
```

通过标准：

- `typecheck` 0 error
- `test` 全部通过
- `build` 成功产出 `dist/`
- `security:bundle` 无前端密钥标记
- `health:stack` 后端和前端代理均为 200
- `health:auth:api` 使用管理员账号时显示 `total=5 pass=5 fail=0`

## 2. CI 门禁标准

CI 工作流文件：`.github/workflows/ci.yml`

CI 必跑步骤：

1. `npm ci`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`
5. `npm run security:bundle`
6. `npm run health:preflight:test`
7. `npm run e2e`

PR 合并条件（建议）：

- CI 全绿
- 至少 1 名 reviewer 通过
- 变更说明包含测试证据

## 3. 测试环境部署前置条件

第一次搭建真实测试环境时，先按 `docs/test-env-deployment-parameter-pack.md` 准备域名、腾讯云 PostgreSQL、管理员账号和环境变量。

当前数据存储选择腾讯云 PostgreSQL。若应用先部署在 Vercel，第一轮测试需要使用腾讯云 PostgreSQL 外网地址；正式上线前再评估是否把后端迁到腾讯云同 VPC，减少数据库公网暴露。

后端关键环境变量：

- `KIMI_API_KEY` 或 `GEMINI_API_KEY`（至少配置一个服务端 AI key；不要使用 `VITE_*` 前缀）
- `DATABASE_URL`（测试环境建议必配，使用腾讯云 PostgreSQL 连接串，不能指向 localhost）
- `PGSSLMODE=require`（PostgreSQL 连接启用 SSL，适配腾讯云外网地址）
- `XINYI_REQUIRE_POSTGRES=true`（测试/预发建议开启，禁止静默降级到 file）
- `XINYI_API_AUTH_TOKEN`（建议开启，至少 24 字符）
- `XINYI_SESSION_COOKIE_SECURE=true`（HTTPS 测试环境必须开启）
- `AUTH_SMOKE_ACCOUNT` / `AUTH_SMOKE_PASSWORD`（测试管理员账号，用于只读认证 API smoke；密码至少 12 字符）
- `CORS_ALLOWED_ORIGINS`（配置 HTTPS 测试域名，不包含 `*`、`localhost` 或 `127.0.0.1`）
- `API_JSON_LIMIT`（默认 `25mb`，按需求调整）
- `STATE_STORE_PATH`、`INTEL_STORE_PATH`（可选，默认 `.runtime/*`）
- `XINYI_PUBLIC_LEAD_TOKEN`（仅当 `XINYI_PUBLIC_LEAD_ENABLED=true` 时必填，至少 24 字符）

前端关键环境变量：

- `VITE_AI_BACKEND_URL=/api/ai`
- `VITE_STATE_SYNC_ENABLED=1`
- `VITE_LEADS_API_ENABLED=1`（线索样板模块写入后端）
- `VITE_LEADS_API_READ_ENABLED=1`（线索样板模块从后端读取）
- `VITE_LEADS_API_VERIFY_WRITES_ENABLED=1`（线索样板模块写后读回）
- `VITE_CUSTOMERS_API_ENABLED=1`（客户样板模块写入后端）
- `VITE_CUSTOMERS_API_READ_ENABLED=1`（客户样板模块从后端读取）
- `VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED=1`（客户样板模块写后读回）
- `VITE_CONTRACTS_API_READ_ENABLED=1`（合同模块从后端读取）
- `VITE_CONTRACTS_API_WRITE_ENABLED=1`（合同模块事务写入后端）
- `VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED=1`（合同模块写后读回）
- `VITE_PROJECTS_API_READ_ENABLED=1`（项目模块从后端读取）
- `VITE_PROJECTS_API_WRITE_ENABLED=1`（项目模块非破坏性写入后端）
- `VITE_PROJECTS_API_VERIFY_WRITES_ENABLED=1`（项目模块写后读回）

禁止配置 `VITE_*API_KEY`、`VITE_*SECRET`、`VITE_*TOKEN`、`VITE_*PASSWORD`，因为 `VITE_*` 会进入浏览器构建产物。

## 4. 测试环境验收清单

### 4.1 API 验收

```bash
npm run health:preflight:test
TEST_HOST=https://<host> npm run health:test-domain
DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:test-env
```

注意：测试环境按 PostgreSQL 模式验收时，必须显式传 `TEST_HOST`、`DEPLOY_FRONTEND_BASE` 和 `DEPLOY_BACKEND_BASE`，避免误测本机 `127.0.0.1` 或把域名检查与 API 检查跑到不同环境。

建议留存 JSON 验收报告：

```bash
TEST_HOST=https://<host> DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> TEST_ENV_ACCEPTANCE_REPORT=acceptance-reports/test-env-$(date +%Y%m%d-%H%M%S).json npm run health:test-env
```

报告会记录每个 smoke 的 stdout/stderr，并对常见密码、token、数据库连接串做脱敏。

生成 Markdown 验收记录草稿：

```bash
npm run acceptance:record -- --report=acceptance-reports/test-env-YYYYMMDD-HHMMSS.json --out=acceptance-reports/test-env-YYYYMMDD-HHMMSS.md
```

如果聚合验收失败，再按分项命令排查：

```bash
TEST_HOST=https://<host> npm run health:test-domain
DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres npm run health:deploy
STATE_SYNC_BASE=https://<host> STATE_EXPECTED_MODE=postgres npm run health:state:persistence
curl -i https://<host>/api/ai/health
curl -i https://<host>/api/state/health
curl -i https://<host>/api/intel/latest
STATE_HEALTH_URL=https://<host>/api/state/health npm run health:state:postgres
AUTH_HEALTH_URL=https://<host>/api/auth/health AUTH_EXPECTED_MODE=postgres AUTH_EXPECTED_MIN_USERS=1 npm run health:auth:postgres
AUTH_API_BASE=https://<host> AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:auth:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:leads:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:customers:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:contracts:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:projects:api
```

说明：`health:test-env` 会调用线索、客户、合同、项目 API smoke，这些分项会写入带 `SMOKE` 前缀的测试记录。该聚合命令只用于测试环境或专用验收环境，不用于生产环境。

通过标准：

- 返回统一 envelope：`{ ok, code, message, data }`
- `/api/state/health` 的 `data.mode` 为 `postgres`（测试环境目标）
- `/api/auth/health` 的 `data.mode` 为 `postgres`，且 `data.users>=1`
- 开启鉴权后，无 token 请求应返回 401/403

### 4.2 前端验收

- 打开 `/dashboard` 正常加载
- 主要路由可访问（按权限配置）
- 前端调用 `/api` 无跨域错误

### 4.3 核心链路验收（手工）

1. 新建线索
2. 线索转客户
3. 客户创建合同
4. 合同生成项目
5. 财务回款状态更新

通过标准：

- 数据能保存并刷新后保留
- 无阻断性前端错误
- 后端日志无持续性 5xx
- `health:leads:api` 显示 `total=8 pass=8 fail=0`
- `health:auth:api` 显示 `total=5 pass=5 fail=0`
- `health:test-env` 聚合验收显示 `fail=0`
- `health:customers:api` 显示 `total=8 pass=8 fail=0`
- `health:contracts:api` 显示 `total=8 pass=8 fail=0`
- `health:projects:api` 显示 `total=7 pass=7 fail=0`

## 5. 故障排查顺序

1. 先看 `health:stack`
2. 再跑 `health:deploy` 检查前端、后端、state、intel latest 与代理
3. 再跑 `health:state:persistence` 检查状态写入后是否能读回
4. 再跑 `health:state:postgres` 检查状态存储模式是否符合预期
5. 再看 `/api/state/health` 的 `mode` 与 `reason`
6. 核对 `XINYI_API_AUTH_TOKEN` 与请求头
7. 核对 `CORS_ALLOWED_ORIGINS` 是否包含前端来源
8. 查看后端日志中的 `AI`、`StateStore`、`IntelRadar` 关键报错

## 6. 回滚策略

### 6.1 代码回滚

- 回滚到上一个 CI 全绿版本
- 重新部署后重复执行“测试环境验收清单”

### 6.2 配置回滚

- 若鉴权引发访问中断：
  - 临时关闭：`XINYI_API_AUTH_REQUIRED=false`
  - 修复后再恢复
- 若数据库异常：
  - 检查 `DATABASE_URL` 与网络权限
  - 必要时临时降级到文件模式（仅用于紧急恢复，不作为长期方案）

## 7. 交付结论模板

每次测试部署后，发布结论应包含：

1. 版本/提交号
2. CI 结果
3. 验收清单结果
4. 未解决风险
5. 回滚入口

建议直接使用 `docs/test-env-acceptance-record-template.md` 填写完整验收记录。
