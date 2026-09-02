# 测试环境部署参数包

## 目标

这份参数包用于第一次搭建真实测试环境。目标不是生产上线，而是把管理系统部署到一个受控测试域名，让员工登录、PostgreSQL 持久化、核心模块 API 和验收脚本形成闭环。

本参数包不改 UI、DOM、demo 结构或业务字段。

腾讯云 PostgreSQL 实例、账号权限、安全组和首次验收步骤见 `docs/tencent-postgres-test-datasource-checklist.md`。

真实测试环境需要业务方配合的控制台操作、账号准备和验收分工见 `docs/test-deployment-collaboration-checklist.md`。

## 推荐环境

| 项 | 建议值 | 说明 |
|---|---|---|
| 测试域名 | `test-app.xinyi-iso.com` | 这是现有 `xinyi-iso.com` 下的子域名，不需要重新购买域名，只需要在域名 DNS 里添加记录 |
| 正式管理系统域名 | `app.xinyi-iso.com` | 等测试环境验收通过后再启用 |
| 官网域名 | `www.xinyi-iso.com` | 继续独立作为官网，不和管理系统登录绑定 |
| 数据库 | 腾讯云 PostgreSQL | 测试环境必须使用真实 PostgreSQL，不允许静默落回文件模式 |
| 管理系统部署 | 一个前端 + `/api` 后端项目 | 当前 `vercel.json` 已把 `/api/*` 转发到 `api/index.js`，其他路径转到 `index.html` |

DNS 记录的目标值由部署平台给出。不要手写猜测 CNAME/A 目标，按平台控制台提供的记录配置。

## 测试域名 DNS/HTTPS 验收

测试域名不需要重新购买域名。`test-app.xinyi-iso.com` 是 `xinyi-iso.com` 下面的子域名，只要当前域名的 DNS 管理权在手里，就在现有域名的 DNS 控制台新增部署平台要求的记录。

配置步骤：

1. 在部署平台绑定 `test-app.xinyi-iso.com`。
2. 复制部署平台给出的 DNS 记录目标值。
3. 到 `xinyi-iso.com` 的 DNS 控制台新增对应记录，常见是 `test-app` 的 CNAME。
4. 等待部署平台显示域名验证通过，并确认 HTTPS 证书签发完成。
5. 本地执行域名 smoke：

```bash
TEST_HOST=https://test-app.xinyi-iso.com npm run health:test-domain
```

通过标准：

- `dns-resolves` 通过，证明测试域名已能解析。
- `https-required` 通过，证明测试入口使用 HTTPS。
- `non-localhost-domain` 通过，证明没有误测本机地址。
- `frontend-root-loads` 通过，证明测试域名能打开当前管理系统前端壳。

`health:test-env` 已包含同一域名检查。真实测试环境验收时，`TEST_HOST`、`DEPLOY_FRONTEND_BASE`、`DEPLOY_BACKEND_BASE` 应保持同一个测试域名，避免域名检查和 API 检查跑到不同环境。

## 腾讯云 PostgreSQL 数据方案

当前选择腾讯云作为测试数据存储。推荐先用腾讯云 PostgreSQL 独立承载数据，应用仍可按现有 Vercel 形态部署。

| 方案 | 适用阶段 | 优点 | 风险/代价 |
|---|---|---|---|
| Vercel 应用 + 腾讯云 PostgreSQL 外网地址 | 第一轮测试环境 | 部署最快，不需要改现有 Vercel 项目结构 | 数据库需开放外网；必须使用强密码、SSL、最小权限账号和安全组 |
| Vercel Static IP + 腾讯云 PostgreSQL 外网地址 | 测试环境稳定后 | 可把数据库安全组限制到固定出站 IP | 需要 Vercel 对应付费能力 |
| 后端迁到腾讯云同 VPC，前端仍可放 Vercel 或腾讯云 | 正式上线前评估 | 数据库可走腾讯云内网，安全边界更清晰 | 部署复杂度更高，需要服务器/容器运行与运维 |

第一轮建议：先用“Vercel 应用 + 腾讯云 PostgreSQL 外网地址”完成测试闭环；如果要给更多员工长期试用，再升级到 Static IP 或腾讯云内网架构。

腾讯云 PostgreSQL 配置要点：

- 创建 PostgreSQL 实例和独立测试数据库。
- 创建专用测试数据库账号，不使用主账号直连应用。
- 如果 Vercel 连接数据库，需开启腾讯云 PostgreSQL 外网地址，并配置安全组。
- `DATABASE_URL` 使用腾讯云 PostgreSQL 的外网地址、端口、库名和测试账号。
- `PGSSLMODE=require`，让应用连接 PostgreSQL 时启用 SSL。
- 生产上线前重新评估是否把后端迁到腾讯云同 VPC，避免数据库长期暴露公网。

## 部署平台参数

如果使用 Vercel 或同类平台，第一轮按以下形态配置：

| 项 | 建议 |
|---|---|
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| API 入口 | `api/index.js` |
| Node 运行时 | 使用平台默认 Node LTS |
| 环境 | 先只配置测试环境，不直接配置生产域名 |

说明：Vite 的 `VITE_*` 变量是构建期变量，修改后必须重新构建部署。

不要配置 `VITE_*API_KEY`、`VITE_*SECRET`、`VITE_*TOKEN`、`VITE_*PASSWORD`。`VITE_*` 会进入浏览器构建产物，服务端密钥只能使用无 `VITE_` 前缀的环境变量。

## 必填环境变量

以下变量需要配置到测试环境。真实密钥不要写进仓库文档。

| 变量 | 测试环境值 | 说明 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串，`postgres://` 或 `postgresql://` | 状态、员工、session、审计日志都依赖它；不能指向 localhost |
| `PGSSLMODE` | `require` | PostgreSQL 连接启用 SSL，尤其适用于腾讯云外网地址 |
| `XINYI_REQUIRE_POSTGRES` | `true` | 状态存储必须是 PostgreSQL |
| `XINYI_AUTH_REQUIRE_POSTGRES` | `true` | 员工认证存储必须是 PostgreSQL |
| `XINYI_API_AUTH_TOKEN` | 高强度随机值，至少 24 字符 | 自动化/API 保护 token |
| `XINYI_API_AUTH_REQUIRED` | `true` | 显式开启 API token 鉴权 |
| `CORS_ALLOWED_ORIGINS` | `https://test-app.xinyi-iso.com` | 只允许测试管理系统域名调用 API；测试环境必须使用 HTTPS 来源，不加入 localhost |
| `XINYI_SESSION_AUTH_REQUIRED` | `true` | 受保护 API 必须有员工 session |
| `XINYI_SESSION_ROLE_ENFORCEMENT` | `true` | 开启角色权限校验 |
| `XINYI_SESSION_COOKIE_SECURE` | `true` | HTTPS 测试环境 cookie 必须带 Secure |
| `XINYI_SESSION_TTL_MS` | `604800000` | 登录态"闲置多久失效"；会话随使用自动顺延，`604800000` = 7 天 |
| `XINYI_SESSION_SLIDING` | `true` | 滑动续期开关；设为 `false` 则回到固定到期（到点必须重新登录） |
| `XINYI_AUTH_SEED_ADMIN_EMAIL` | 测试管理员邮箱 | 首次初始化管理员账号 |
| `XINYI_AUTH_SEED_ADMIN_PASSWORD` | 临时强密码，至少 12 字符 | 仅首次初始化使用，测试通过后应在系统内改密并轮换 |
| `AUTH_SMOKE_ACCOUNT` | 测试管理员邮箱 | 验收脚本登录账号 |
| `AUTH_SMOKE_PASSWORD` | 测试管理员密码，至少 12 字符 | 验收脚本登录密码，建议使用专用测试管理员 |
| `KIMI_API_KEY` 或 `GEMINI_API_KEY` | 至少一个有效 key | AI health 与 AI 功能需要 |
| `VITE_AI_BACKEND_URL` | `/api/ai` | 浏览器走同源 API |
| `VITE_AUTH_REQUIRED` | `1` | 开启前端登录门禁 |
| `VITE_STATE_SYNC_ENABLED` | `1` | 开启状态同步 |
| `VITE_INTEL_LOCAL_FALLBACKS_ENABLED` | `0` | 禁止测试环境探测本机端口 |
| `VITE_LEADS_API_ENABLED` | `1` | 线索写入后端 |
| `VITE_LEADS_API_READ_ENABLED` | `1` | 线索从后端读取 |
| `VITE_LEADS_API_VERIFY_WRITES_ENABLED` | `1` | 线索写后读回 |
| `VITE_CUSTOMERS_API_ENABLED` | `1` | 客户写入后端 |
| `VITE_CUSTOMERS_API_READ_ENABLED` | `1` | 客户从后端读取 |
| `VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED` | `1` | 客户写后读回 |
| `VITE_CONTRACTS_API_READ_ENABLED` | `1` | 合同从后端读取 |
| `VITE_CONTRACTS_API_WRITE_ENABLED` | `1` | 合同事务写入后端 |
| `VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED` | `1` | 合同写后读回 |
| `VITE_PROJECTS_API_READ_ENABLED` | `1` | 项目从后端读取 |
| `VITE_PROJECTS_API_WRITE_ENABLED` | `1` | 项目写入后端 |
| `VITE_PROJECTS_API_VERIFY_WRITES_ENABLED` | `1` | 项目写后读回 |

可选但建议配置：

测试环境至少要配置一个服务端 AI key，否则 `health:preflight:test` 会失败。不要使用 `VITE_*` 前缀配置 AI key。

| 变量 | 建议值 | 说明 |
|---|---|---|
| `API_JSON_LIMIT` | `25mb` | 请求体大小限制 |
| `INTEL_CRON_ENABLED` | `false` | Serverless 测试环境先关闭常驻定时抓取，避免运行时模型不匹配 |
| `XINYI_PUBLIC_LEAD_ENABLED` | `false` | 官网线索接入未验收前保持关闭 |
| `XINYI_PUBLIC_LEAD_TOKEN` | 空 | 官网线索接入关闭时留空；如果 `XINYI_PUBLIC_LEAD_ENABLED=true`，必须配置至少 24 字符的高强度 token |

生成随机 token 的本地命令：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 部署前检查

在配置好环境变量但正式给业务人员使用前，先在能读取同一套测试环境变量的本地或 CI 环境里跑：

```bash
npm run health:preflight:test
```

如果这一步失败，不要部署给业务测试。先按错误信息补环境变量。

## 首次管理员初始化

腾讯云 PostgreSQL 第一次为空库时，需要先用种子管理员完成初始化：

1. 测试环境配置 `XINYI_AUTH_SEED_ADMIN_EMAIL` 和 `XINYI_AUTH_SEED_ADMIN_PASSWORD`。
2. 第一次启动后访问 `/api/auth/health`，确认 `data.mode=postgres` 且 `data.users>=1`。
3. 用该管理员登录测试管理系统，立即在系统内修改/轮换密码。
4. 后续部署移除 `XINYI_AUTH_SEED_ADMIN_PASSWORD`，保留 `AUTH_SMOKE_ACCOUNT` / `AUTH_SMOKE_PASSWORD` 作为验收脚本账号。

`health:test-env` 在 PostgreSQL 认证模式下会自动要求 `AUTH_EXPECTED_MIN_USERS=1`，防止空库部署后才发现无法登录。

## 部署后验收

把 `TEST_HOST` 改成真实测试域名：

```bash
TEST_HOST=https://test-app.xinyi-iso.com
DEPLOY_FRONTEND_BASE=$TEST_HOST DEPLOY_BACKEND_BASE=$TEST_HOST STATE_EXPECTED_MODE=postgres AUTH_EXPECTED_MODE=postgres AUTH_SMOKE_ACCOUNT=admin@example.com AUTH_SMOKE_PASSWORD='replace-with-test-password' TEST_ENV_ACCEPTANCE_REPORT=acceptance-reports/test-env-$(date +%Y%m%d-%H%M%S).json npm run health:test-env
```

注意：本地 `npm run health:local-auth` 只验证普通本地 `3000/3001`。真实测试域名必须执行上面的 `health:test-env`，不能用 E2E 或本地检查替代。

用 JSON 报告生成 Markdown 验收记录草稿：

```bash
npm run acceptance:record -- --report=acceptance-reports/test-env-YYYYMMDD-HHMMSS.json --out=acceptance-reports/test-env-YYYYMMDD-HHMMSS.md
```

通过标准：

- 聚合验收显示 `fail=0`
- `/api/state/health` 为 `mode=postgres`
- `/api/auth/health` 为 `mode=postgres`
- `/api/auth/health` 的 `users>=1`
- `health:auth:api` 显示 `total=5 pass=5 fail=0`
- 线索、客户、合同、项目 smoke 全部通过
- JSON 报告已保存，且不包含明文密码、token、数据库连接串

## 人工验收

自动验收通过后，再用测试管理员账号登录 `https://test-app.xinyi-iso.com`，按顺序人工验证：

1. 登录后进入工作台。
2. 新增线索，刷新后仍存在。
3. 线索转客户或生成跟进项目。
4. 新建合同，确认客户、项目、财务链路出现。
5. 回款状态更新后刷新仍保留。
6. 创建一个普通测试员工，确认首次登录强制改密。
7. 查看审计日志，确认创建员工、重置密码等动作有记录。

涉及 UI、字段或 demo 结构异常时，不直接改动，先记录截图、路径、账号、操作步骤和期望结果。

## 不通过时的处理

| 现象 | 优先检查 |
|---|---|
| `mode=file` | `DATABASE_URL`、`XINYI_REQUIRE_POSTGRES`、`XINYI_AUTH_REQUIRE_POSTGRES` |
| 数据库连接失败 | `DATABASE_URL` 协议、账号密码、网络白名单；测试环境不能使用 localhost 地址 |
| 登录失败 | `XINYI_AUTH_SEED_ADMIN_EMAIL`、`XINYI_AUTH_SEED_ADMIN_PASSWORD`、账号是否已改密 |
| API 401/403 | `XINYI_API_AUTH_TOKEN`、session cookie、角色权限 |
| 浏览器跨域错误 | `CORS_ALLOWED_ORIGINS` 是否等于测试域名 |
| 官网线索写入 403 | `XINYI_PUBLIC_LEAD_TOKEN` 与官网服务端转发 token 是否一致 |
| 页面能打开但数据刷新丢失 | `VITE_*_API_*` 开关和 `health:test-env` 结果 |
| AI health 失败 | `KIMI_API_KEY` / `GEMINI_API_KEY`、模型名、上游额度 |

## 发布结论模板

正式填写时使用 `docs/test-env-acceptance-record-template.md`。

```text
环境：test-app.xinyi-iso.com
版本/提交：
数据库：PostgreSQL mode 已确认 / 未确认
登录：管理员登录已确认 / 未确认
聚合验收：pass / fail，报告路径：
人工链路：pass / fail
未关闭风险：
结论：可进入业务测试 / 暂缓
```
