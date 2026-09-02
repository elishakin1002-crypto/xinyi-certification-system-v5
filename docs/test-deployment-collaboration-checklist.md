# 测试部署协作清单

## 目的

这份清单用于把真实测试环境上线前的工作拆成可执行步骤，并明确哪些需要业务方在控制台配合，哪些由开发侧完成和验证。

本清单不改 UI、DOM、demo 结构或业务字段。

## 当前结论

下一步不是只做域名，而是并行推进三条前置线：

| 线 | 是否需要先完成 | 主要负责人 | 说明 |
|---|---:|---|---|
| 测试域名 `test-app.xinyi-iso.com` | 是 | 业务方提供 DNS 控制台权限或代操作，开发侧验收 | 不需要购买新域名，只在现有 `xinyi-iso.com` 下加子域名记录 |
| 腾讯云 PostgreSQL 测试库 | 是 | 业务方购买/创建实例，开发侧给参数要求并验收 | 没有真实数据库，无法证明员工、session、业务状态已持久化 |
| 部署平台环境变量 | 是 | 业务方提供平台权限或代配置，开发侧校验 | 变量漏配会导致登录、数据库、AI、API 鉴权在测试环境失效 |

三条线可以并行准备。只要其中任意一条缺失，就不能算“真实测试环境可交付”。

## 步骤 1：确认部署平台

目标：确定管理系统部署在哪里，并拿到平台给出的域名绑定记录。

推荐第一轮仍按现有 Vercel 形态走，原因是当前项目已经有 `vercel.json`，最快能形成测试闭环。数据库先用腾讯云 PostgreSQL 外网地址。正式上线前再评估是否迁到腾讯云同 VPC。

需要你配合：

- 确认是否使用 Vercel 作为第一轮测试部署平台。
- 如果使用 Vercel，需要提供项目访问权限，或你按我给的参数在控制台配置。
- 如果不用 Vercel，需要先确认替代平台能支持 Node API、环境变量、HTTPS、自定义域名。

我来做：

- 核对部署命令、构建产物和 API 入口。
- 给出环境变量清单。
- 跑部署前检查和部署后 smoke。

完成标准：

- 部署平台里已有测试项目。
- Build Command 为 `npm run build`。
- Output Directory 为 `dist`。
- API 入口可处理 `/api/*`。

## 步骤 2：配置测试域名

目标：让 `https://test-app.xinyi-iso.com` 指向测试管理系统。

需要你配合：

- 确认 `xinyi-iso.com` 的 DNS 在哪个平台管理，例如阿里云、腾讯云、Cloudflare 或域名注册商控制台。
- 进入 DNS 控制台，新增部署平台要求的记录。常见记录是：
  - 主机记录：`test-app`
  - 记录类型：按部署平台要求，通常为 `CNAME`
  - 记录值：部署平台给出的目标值
- 等待部署平台显示域名验证通过和 HTTPS 证书签发完成。

我来做：

- 告诉你不要新买 `test-app.xinyi-iso.com`。它是 `xinyi-iso.com` 的子域名。
- 不猜测 DNS 目标值，按部署平台控制台显示的目标值配置。
- 配置完成后执行验收：

```bash
TEST_HOST=https://test-app.xinyi-iso.com npm run health:test-domain
```

完成标准：

- `dns-resolves` 通过。
- `https-required` 通过。
- `non-localhost-domain` 通过。
- `frontend-root-loads` 通过。

## 步骤 3：创建腾讯云 PostgreSQL 测试库

目标：让测试环境使用真实 PostgreSQL，而不是本地 JSON 文件。

需要你配合：

- 在腾讯云创建 PostgreSQL 测试实例。
- 创建测试数据库，例如 `xinyi_test`。
- 创建应用账号，例如 `xinyi_app_test`。
- 记录外网地址、端口、数据库名、账号。
- 设置强密码，不要发到公开文档或聊天截图里。
- 如果第一轮后端部署在 Vercel，需要开启腾讯云 PostgreSQL 外网地址，并配置安全组。

我来做：

- 给出最小权限要求。
- 生成 `DATABASE_URL` 的格式说明，但不把真实密码写进仓库。
- 验证测试环境是否真正使用 PostgreSQL：

```bash
AUTH_HEALTH_URL=https://test-app.xinyi-iso.com/api/auth/health AUTH_EXPECTED_MODE=postgres AUTH_EXPECTED_MIN_USERS=1 npm run health:auth:postgres
STATE_SYNC_BASE=https://test-app.xinyi-iso.com STATE_EXPECTED_MODE=postgres npm run health:state:persistence
```

完成标准：

- `/api/state/health` 返回 `mode=postgres`。
- `/api/auth/health` 返回 `mode=postgres` 且 `users>=1`。
- 状态写入后可以读回。

## 步骤 4：配置测试环境变量

目标：测试环境不靠本地 `.env.local`，所有必要变量都在部署平台配置。

需要你配合：

- 在部署平台配置环境变量，或给我可操作权限。
- 准备至少一个服务端 AI key：`KIMI_API_KEY` 或 `GEMINI_API_KEY`。
- 准备测试管理员邮箱和临时强密码。
- 配置数据库连接串、API token、CORS 来源、登录门禁和模块 API 开关。

我来做：

- 用脚本检查变量是否漏配：

```bash
npm run health:preflight:test
```

- 确认没有把服务端密钥配置成 `VITE_*`。
- 确认测试环境不会静默落回文件模式。

完成标准：

- `health:preflight:test` 通过。
- 没有 `VITE_*API_KEY`、`VITE_*SECRET`、`VITE_*TOKEN`、`VITE_*PASSWORD`。
- `CORS_ALLOWED_ORIGINS=https://test-app.xinyi-iso.com`。

## 步骤 5：首次部署并初始化管理员

目标：测试域名能打开，数据库有管理员账号，员工登录可用。

需要你配合：

- 提供首次测试管理员邮箱。
- 提供临时强密码，或在控制台自行配置。
- 首次登录后及时修改或轮换密码。

我来做：

- 部署后检查认证库是否初始化。
- 确认未登录访问工作台会跳转登录。
- 确认 session、员工列表、审计日志可用。

完成标准：

- `/api/auth/health users>=1`。
- 管理员可以登录。
- 登录后可以访问工作台。
- 后续移除或轮换 `XINYI_AUTH_SEED_ADMIN_PASSWORD`。

## 步骤 6：自动验收

目标：用脚本证明测试环境的关键链路可用。

需要你配合：

- 确认可以用测试管理员账号跑自动验收。
- 如果验证码、风控、第三方登录等以后加入，需要提前告知，否则自动验收会被阻断。

我来做：

- 执行聚合验收：

```bash
TEST_HOST=https://test-app.xinyi-iso.com
DEPLOY_FRONTEND_BASE=$TEST_HOST DEPLOY_BACKEND_BASE=$TEST_HOST STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_SMOKE_ACCOUNT=<test-admin-email> AUTH_SMOKE_PASSWORD='<test-admin-password>' TEST_ENV_ACCEPTANCE_REPORT=acceptance-reports/test-env-$(date +%Y%m%d-%H%M%S).json npm run health:test-env
```

- 生成验收记录：

```bash
npm run acceptance:record -- --report=acceptance-reports/test-env-YYYYMMDD-HHMMSS.json --out=acceptance-reports/test-env-YYYYMMDD-HHMMSS.md
```

完成标准：

- 聚合验收 `fail=0`。
- 报告已保存且敏感信息已脱敏。
- 线索、客户、合同、项目 API smoke 都通过。

## 步骤 7：人工业务验收

目标：确认业务人员真实使用链路没有断。

需要你配合：

- 安排一个测试账号或测试管理员参与人工验收。
- 按真实业务流程操作一次。
- 对发现的问题提供页面、操作步骤、期望结果和截图。

我来做：

- 不擅自改 UI、DOM、demo 结构或字段。
- 如果发现必须改 UI、字段或 demo 结构，会先说明原因、影响范围和验证方式，得到确认后再改。
- 修复后补自动化测试或人工验收记录。

人工验收范围：

1. 登录后进入工作台。
2. 新增线索，刷新后仍存在。
3. 线索转客户或生成跟进项目。
4. 新建合同，确认客户、项目、财务链路出现。
5. 回款状态更新后刷新仍保留。
6. 创建普通测试员工，确认首次登录强制改密。
7. 查看审计日志，确认员工相关动作有记录。

完成标准：

- 人工链路通过。
- 未关闭风险被记录。
- 结论明确为“可进入业务测试”或“暂缓”。

## 现在最需要你先做的事

按优先级：

1. 确认第一轮是否继续用 Vercel 部署测试管理系统。
2. 确认 `xinyi-iso.com` 的 DNS 管理入口在哪里，以及你是否能添加 `test-app` 子域名记录。
3. 创建或准备创建腾讯云 PostgreSQL 测试实例。
4. 准备测试管理员邮箱、临时强密码、服务端 AI key。

我在这些信息齐全前，会继续做本地可完成的交付工作：脚本验收、文档闭环、风险清单、测试覆盖和部署前自检，不会改 UI、DOM、demo 结构或业务字段。
