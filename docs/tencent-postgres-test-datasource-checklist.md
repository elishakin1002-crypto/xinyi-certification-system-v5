# 腾讯云 PostgreSQL 测试数据源接入清单

## 目标

把测试环境数据从本地文件模式切到腾讯云 PostgreSQL，并保证员工登录、session、审计日志、核心业务状态都能落库和读回。

本清单不改 UI、DOM、demo 结构或业务字段。

## 官方依据

- 腾讯云 PostgreSQL 外网地址：https://cloud.tencent.com/document/product/409/67114
- 腾讯云 PostgreSQL 安全组：https://www.tencentcloud.com/ind/document/product/409/40112
- Vercel Static IP：https://vercel.com/docs/connectivity/static-ips
- Vercel IP allowlist 说明：https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address

结论：腾讯云 PostgreSQL 可以开启外网地址并用安全组控制访问；Vercel 普通部署的出站 IP 不是固定来源，若数据库安全组要限制到固定 IP，需要 Static IP 等能力，或把后端部署到腾讯云同 VPC。

## 第一轮推荐路径

| 路径 | 是否推荐 | 说明 |
|---|---:|---|
| Vercel 应用 + 腾讯云 PostgreSQL 外网地址 | 可用于第一轮短期测试 | 部署快，但公网数据库暴露面更大，必须 SSL、强密码、最小权限、安全组、测试后复盘 |
| Vercel Static IP + 腾讯云 PostgreSQL 外网地址 | 推荐给较长测试周期 | 可以把数据库安全组限制到固定出站 IP |
| 后端部署到腾讯云同 VPC + 腾讯云 PostgreSQL 内网地址 | 推荐正式上线前评估 | 数据库不长期暴露公网，运维复杂度更高 |

## 腾讯云控制台步骤

1. 创建腾讯云 PostgreSQL 实例。
2. 创建独立测试数据库，例如 `xinyi_test`。
3. 创建专用应用账号，例如 `xinyi_app_test`，不要使用主账号直连应用。
4. 给应用账号授予测试库权限。
5. 开启 SSL 或确认实例支持 SSL 连接。
6. 如果应用后端暂在 Vercel，按腾讯云文档开启外网地址。
7. 配置安全组，只放通 PostgreSQL 端口给测试所需来源。
8. 记录外网地址、端口、数据库名、应用账号，用于生成 `DATABASE_URL`。

## 数据库权限要求

当前应用会在启动时自动创建和维护以下表：

| 表 | 用途 |
|---|---|
| `app_state_latest` | 最新业务状态快照 |
| `app_state_history` | 状态写入历史 |
| `auth_users` | 员工账号 |
| `auth_sessions` | 登录 session |
| `auth_audit_logs` | 员工账号与认证审计日志 |

因此第一轮测试账号至少需要：

- 连接测试数据库。
- 在测试库的 `public` schema 下创建表和索引。
- 对上述表进行 `SELECT`、`INSERT`、`UPDATE`、`DELETE`。

第一轮可让 `xinyi_app_test` 成为 `xinyi_test` 的 owner，降低初始化复杂度。测试稳定后，再拆成迁移账号和运行账号，运行账号不再持有建表权限。

## 环境变量

测试环境必须配置：

```bash
DATABASE_URL=postgres://xinyi_app_test:<password>@<host>:<port>/xinyi_test
PGSSLMODE=require
XINYI_REQUIRE_POSTGRES=true
XINYI_AUTH_REQUIRE_POSTGRES=true
XINYI_AUTH_SEED_ADMIN_EMAIL=<test-admin-email>
XINYI_AUTH_SEED_ADMIN_PASSWORD=<temporary-strong-password>
AUTH_SMOKE_ACCOUNT=<test-admin-email>
AUTH_SMOKE_PASSWORD=<final-or-temporary-test-admin-password>
VITE_AUTH_REQUIRED=1
```

不要把真实 `DATABASE_URL`、密码、token 写入仓库文档。

## 接入前本地预检

在能读取测试环境变量的终端里先跑：

```bash
npm run health:preflight:test
```

这一步会提前拦截：

- `DATABASE_URL` 缺失或不是 PostgreSQL 连接串。
- `DATABASE_URL` 指向 localhost。
- `PGSSLMODE` 不是 `require`。
- `XINYI_REQUIRE_POSTGRES` 或 `XINYI_AUTH_REQUIRE_POSTGRES` 未开启。
- 登录、session、CORS、AI key、模块 API 灰度变量漏配。

## 首次启动验收

部署后先看认证和状态模式：

```bash
TEST_HOST=https://test-app.xinyi-iso.com
DEPLOY_FRONTEND_BASE=$TEST_HOST DEPLOY_BACKEND_BASE=$TEST_HOST STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_EXPECTED_MIN_USERS=1 npm run health:deploy
AUTH_HEALTH_URL=$TEST_HOST/api/auth/health AUTH_EXPECTED_MODE=postgres AUTH_EXPECTED_MIN_USERS=1 npm run health:auth:postgres
STATE_SYNC_BASE=$TEST_HOST STATE_EXPECTED_MODE=postgres npm run health:state:persistence
```

通过标准：

- `/api/state/health` 返回 `mode=postgres`。
- `/api/auth/health` 返回 `mode=postgres` 且 `users>=1`。
- `state:persistence` 写入后能按 key 读回。

## 聚合验收

```bash
TEST_HOST=https://test-app.xinyi-iso.com
DEPLOY_FRONTEND_BASE=$TEST_HOST DEPLOY_BACKEND_BASE=$TEST_HOST STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_SMOKE_ACCOUNT=<test-admin-email> AUTH_SMOKE_PASSWORD='<test-admin-password>' TEST_ENV_ACCEPTANCE_REPORT=acceptance-reports/test-env-$(date +%Y%m%d-%H%M%S).json npm run health:test-env
```

生成验收记录：

```bash
npm run acceptance:record -- --report=acceptance-reports/test-env-YYYYMMDD-HHMMSS.json --out=acceptance-reports/test-env-YYYYMMDD-HHMMSS.md
```

## 首次管理员处理

1. 第一次部署可用 `XINYI_AUTH_SEED_ADMIN_EMAIL` / `XINYI_AUTH_SEED_ADMIN_PASSWORD` 初始化管理员。
2. 管理员首次登录后，立即在系统内修改或轮换密码。
3. 确认 `AUTH_SMOKE_ACCOUNT` / `AUTH_SMOKE_PASSWORD` 指向可用于验收的测试管理员。
4. 后续部署移除 `XINYI_AUTH_SEED_ADMIN_PASSWORD`，避免临时密码长期留在环境变量中。

## 风险与关闭条件

| 风险 | 控制措施 | 关闭条件 |
|---|---|---|
| 数据库外网暴露 | SSL、强密码、专用账号、安全组、短期测试 | 使用 Static IP allowlist 或后端迁到腾讯云同 VPC |
| 应用误落文件模式 | `XINYI_REQUIRE_POSTGRES=true`、`XINYI_AUTH_REQUIRE_POSTGRES=true` | `health:test-env` 显示 state/auth 都是 postgres |
| 空库无管理员 | `AUTH_EXPECTED_MIN_USERS=1` | `/api/auth/health users>=1` |
| 前端绕过登录 | `VITE_AUTH_REQUIRED=1`、测试环境 preflight | 未登录访问测试域名工作台跳登录 |
| 数据写入后丢失 | `health:state:persistence`、模块 API smoke | 聚合验收 `fail=0` |
