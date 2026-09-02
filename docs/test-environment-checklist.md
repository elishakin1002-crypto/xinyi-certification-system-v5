# 测试环境配置清单

第一次搭建真实测试环境时，先使用 `docs/test-env-deployment-parameter-pack.md` 准备域名、腾讯云 PostgreSQL、管理员账号、密钥和验收命令。

腾讯云 PostgreSQL 实例、账号权限、安全组和首次验收步骤见 `docs/tencent-postgres-test-datasource-checklist.md`。

测试域名 DNS、HTTPS 和前端入口先用 `TEST_HOST=https://<host> npm run health:test-domain` 验证，再执行完整 `health:test-env`。

## 必填环境变量

| 变量 | 测试环境建议值 | 目的 |
|---|---|---|
| `DATABASE_URL` | 腾讯云 PostgreSQL 连接串，`postgres://` 或 `postgresql://` | 状态持久化数据源 |
| `PGSSLMODE` | `require` | PostgreSQL 连接启用 SSL，适配腾讯云外网地址 |
| `XINYI_REQUIRE_POSTGRES` | `true` | 禁止静默降级到文件存储 |
| `XINYI_AUTH_REQUIRE_POSTGRES` | `true` | 禁止员工与 session 数据落到文件存储 |
| `XINYI_API_AUTH_TOKEN` | 高强度随机 token，至少 24 字符 | 保护 `/api/ai/*`、`/api/state/*`、`/api/intel/*` |
| `XINYI_SESSION_AUTH_REQUIRED` | `true` | 强制受保护 API 需要员工会话（可与 token 共存） |
| `XINYI_SESSION_ROLE_ENFORCEMENT` | `true` | 开启受保护 API 的角色权限校验（如 intel 抓取） |
| `XINYI_SESSION_COOKIE_SECURE` | `true` | HTTPS 测试环境 cookie 必须带 Secure，否则登录 session 可能不可用 |
| `XINYI_SESSION_TTL_MS` | `604800000` | 登录态闲置失效时长；会话随使用自动顺延，默认 8 小时会导致每天重新登录 |
| `AUTH_SMOKE_ACCOUNT` | 测试管理员账号 | `health:auth:api` 只读验收登录、当前用户、员工列表和审计日志 |
| `AUTH_SMOKE_PASSWORD` | 测试管理员密码，至少 12 字符 | `health:auth:api` 使用；建议使用专用测试管理员，避免个人生产密码 |
| `CORS_ALLOWED_ORIGINS` | 测试前端域名，逗号分隔 | 只允许测试域名前端访问 API |
| `KIMI_API_KEY` 或 `GEMINI_API_KEY` | 服务端密钥 | AI health 与真实 AI 功能 |
| `VITE_AI_BACKEND_URL` | `/api/ai` | 前端走同源 API |
| `VITE_STATE_SYNC_ENABLED` | `1` | 开启前端状态同步写入 |
| `VITE_AUTH_REQUIRED` | `1` | 开启员工登录门禁 |
| `VITE_INTEL_LOCAL_FALLBACKS_ENABLED` | `0` | 禁止浏览器探测本机 legacy 端口 |
| `VITE_LEADS_API_ENABLED` | `1` | 线索模块写入走后端 API |
| `VITE_LEADS_API_READ_ENABLED` | `1` | 线索模块启动时从后端 API 读取 |
| `VITE_LEADS_API_VERIFY_WRITES_ENABLED` | `1` | 线索模块写入后读回确认，不一致则回滚前端 state |
| `VITE_CUSTOMERS_API_ENABLED` | `1` | 客户模块写入走后端 API |
| `VITE_CUSTOMERS_API_READ_ENABLED` | `1` | 客户模块启动时从后端 API 读取 |
| `VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED` | `1` | 客户模块写入后读回确认，不一致则回滚前端 state |
| `VITE_CONTRACTS_API_READ_ENABLED` | `1` | 合同模块启动时从后端 API 读取 |
| `VITE_CONTRACTS_API_WRITE_ENABLED` | `1` | 合同模块非破坏性写入和事务写入走后端 API |
| `VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED` | `1` | 合同模块写入后读回确认，不一致则回滚前端 state |
| `VITE_PROJECTS_API_READ_ENABLED` | `1` | 项目模块启动时从后端 API 读取 |
| `VITE_PROJECTS_API_WRITE_ENABLED` | `1` | 项目模块非破坏性写入走后端 API |
| `VITE_PROJECTS_API_VERIFY_WRITES_ENABLED` | `1` | 项目模块写入后读回确认，不一致则回滚前端 state |
| `XINYI_PUBLIC_LEAD_ENABLED` | 按需 `true` | 官网表单接入管理系统线索池 |
| `XINYI_PUBLIC_LEAD_TOKEN` | 高强度随机 token，至少 24 字符（官网服务端转发时） | 保护官网线索写入接口 |

## 禁止配置

| 配置 | 原因 |
|---|---|
| `CORS_ALLOWED_ORIGINS=*` | 测试环境 API 不应对任意来源开放 |
| `CORS_ALLOWED_ORIGINS` 包含 `http://` | HTTPS 测试环境应只允许 HTTPS 来源，否则登录 cookie 与跨域策略不稳定 |
| `CORS_ALLOWED_ORIGINS` 包含 `localhost` / `127.0.0.1` | 测试环境不能把本机开发地址加入白名单 |
| `DATABASE_URL` 指向 `localhost` / `127.0.0.1` | 云端测试环境会连接自己的本机，不会连接真实 PostgreSQL |
| `DATABASE_URL` 不是 `postgres://` / `postgresql://` | 测试环境只接受 PostgreSQL 连接串 |
| `PGSSLMODE` 不是 `require` | 腾讯云 PostgreSQL 外网连接应启用 SSL，避免测试环境漏配加密连接 |
| 未配置 `KIMI_API_KEY` 且未配置 `GEMINI_API_KEY` | AI health 会失败，真实 AI 功能不可用 |
| `XINYI_API_AUTH_REQUIRED=false` | 会显式关闭受保护 API 鉴权 |
| `XINYI_API_AUTH_TOKEN` 少于 24 字符 | token 太短，测试/预发/生产不允许使用弱 token |
| `AUTH_SMOKE_PASSWORD` 少于 12 字符 | 测试管理员密码太短，不适合测试/预发/生产 |
| `XINYI_AUTH_SEED_ADMIN_PASSWORD` 已配置但少于 12 字符 | 种子管理员临时密码太短，不适合首次初始化 |
| `/api/auth/health` 的 `users=0` | 腾讯云 PostgreSQL 空库尚未初始化管理员，业务人员无法登录 |
| `XINYI_SESSION_AUTH_REQUIRED=false` | 会绕过员工会话鉴权 |
| `XINYI_SESSION_ROLE_ENFORCEMENT=false` | 会关闭角色权限校验 |
| `XINYI_SESSION_COOKIE_SECURE=false` | HTTPS 测试环境登录 cookie 不带 Secure，容易出现登录态不稳定 |
| `XINYI_REQUIRE_POSTGRES=false` | 可能把测试数据落到文件模式 |
| `XINYI_AUTH_REQUIRE_POSTGRES=false` | 可能把员工与 session 数据落到文件模式 |
| `VITE_AI_BACKEND_URL=http://localhost:3001` | 用户浏览器会请求自己的本机后端 |
| `VITE_*API_KEY` / `VITE_*SECRET` / `VITE_*TOKEN` | `VITE_*` 会进入浏览器构建产物，不能放服务端密钥或 token |
| `VITE_INTEL_LOCAL_FALLBACKS_ENABLED=1` | 会在测试环境产生本机端口探测噪音 |
| `VITE_AUTH_REQUIRED=0` | 会绕过员工登录门禁 |
| `VITE_LEADS_API_ENABLED=0` | 测试环境线索写入会停留在前端 state，无法验证后端化样板 |
| `VITE_LEADS_API_READ_ENABLED=0` | 测试环境线索读取不会走后端，刷新保留验证不完整 |
| `VITE_LEADS_API_VERIFY_WRITES_ENABLED=0` | 测试环境无法发现“前端显示成功但后端未落库”的问题 |
| `VITE_CUSTOMERS_API_ENABLED=0` | 测试环境客户写入会停留在前端 state，无法验证后端化样板 |
| `VITE_CUSTOMERS_API_READ_ENABLED=0` | 测试环境客户读取不会走后端，刷新保留验证不完整 |
| `VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED=0` | 测试环境无法发现“客户页面显示成功但后端未落库”的问题 |
| `VITE_CONTRACTS_API_READ_ENABLED=0` | 测试环境合同读取不会走后端，合同 API 只读灰度无法验收 |
| `VITE_CONTRACTS_API_WRITE_ENABLED=0` | 测试环境合同事务写入会停留在前端 state，无法验证合同后端化样板 |
| `VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED=0` | 测试环境无法发现“合同页面显示成功但后端未落库”的问题 |
| `VITE_PROJECTS_API_READ_ENABLED=0` | 测试环境项目读取不会走后端，项目 API 只读灰度无法验收 |
| `VITE_PROJECTS_API_WRITE_ENABLED=0` | 测试环境项目写入会停留在前端 state，无法验证项目后端化样板 |
| `VITE_PROJECTS_API_VERIFY_WRITES_ENABLED=0` | 测试环境无法发现“项目页面显示成功但后端未落库”的问题 |
| `XINYI_PUBLIC_LEAD_ENABLED=true` 且未配置 `XINYI_PUBLIC_LEAD_TOKEN` | 官网线索接口会暴露给公网，必须先配置高强度 token |
| `XINYI_PUBLIC_LEAD_TOKEN` 少于 24 字符 | 官网公网入口 token 太短，不适合测试/预发/生产 |
| `XINYI_PUBLIC_LEAD_ENABLED=true` 且无来源控制 | 官网线索接口必须配合 CORS、官网服务端转发或反垃圾策略 |

## 部署前验证

```bash
npm run health:preflight:test
```

通过后再部署。部署完成后执行：

```bash
DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:test-env
```

`STATE_EXPECTED_MODE=postgres` 或 `AUTH_EXPECTED_MODE=postgres` 时必须显式传 `DEPLOY_FRONTEND_BASE` 和 `DEPLOY_BACKEND_BASE`，防止把本机服务误当成测试环境。

可选：通过 `TEST_ENV_ACCEPTANCE_REPORT=acceptance-reports/<name>.json` 保存聚合验收 JSON 报告，便于交付留痕。报告会对常见密码、token、数据库连接串做脱敏。

如需分项排查，可逐条执行：

```bash
DEPLOY_FRONTEND_BASE=https://<host> DEPLOY_BACKEND_BASE=https://<host> STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres npm run health:deploy
STATE_SYNC_BASE=https://<host> STATE_EXPECTED_MODE=postgres npm run health:state:persistence
AUTH_HEALTH_URL=https://<host>/api/auth/health AUTH_EXPECTED_MODE=postgres AUTH_EXPECTED_MIN_USERS=1 npm run health:auth:postgres
AUTH_API_BASE=https://<host> AUTH_SMOKE_ACCOUNT=<admin-account> AUTH_SMOKE_PASSWORD=<admin-password> npm run health:auth:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:leads:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:customers:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:contracts:api
DEPLOY_BACKEND_BASE=https://<host> npm run health:projects:api
```

如果测试环境开启了 API token，命令前加：

```bash
XINYI_API_AUTH_TOKEN=<token>
```

说明：聚合验收会调用线索、客户、合同、项目 API smoke，并写入带 `SMOKE` 前缀的测试记录。只在测试环境或专用验收环境运行。

## 验收结论

只有以下结果同时满足，才算通过测试环境配置验收：

| 检查 | 通过标准 |
|---|---|
| preflight | 0 error |
| test env acceptance | 聚合验收 `fail=0` |
| deploy smoke | `total=6 pass=6 fail=0` |
| state mode | `mode=postgres` |
| auth mode | `mode=postgres` |
| auth api smoke | 管理员登录、当前用户、员工列表和审计日志全部通过 |
| state persistence | `readback=match` |
| auth guard | 未授权请求返回 401/403 |
| leads api smoke | 新增、编辑、追加跟进、写后读回和 `leads_v8` 读回全部通过 |
| customers api smoke | 新增、编辑、追加跟进、写后读回和 `customers_v8` 读回全部通过 |
| contracts api smoke | 新增、编辑、追加附件、写后读回和 `contracts_v8` 读回全部通过 |
| projects api smoke | 新增、编辑、任务追加、任务更新、写后读回和 `projects_v8` 读回全部通过 |
