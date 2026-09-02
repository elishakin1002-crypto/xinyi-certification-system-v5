# 测试部署交付闭环计划

## 目标

到 2026-06-05 前，让系统达到“受控测试环境可部署、可验证、可回滚”的状态。若某阶段提前完成且验证通过，后续阶段顺延提前，不按自然周锁死。

真实测试环境需要业务方配合的控制台事项，统一记录在 `docs/test-deployment-collaboration-checklist.md`。后续执行时按该清单区分“业务方配置”和“开发侧验证”。

## 闭环规则

每个任务必须按同一闭环推进：

1. 明确任务范围和负责人。
2. 在独立分支完成变更。
3. 跑本地验证命令。
4. 区分验证路径：隔离测试环境、普通本地 `3000/3001`、真实测试域名不能互相替代。
5. 做代码审查，记录风险和测试证据。
6. 部署到测试环境或 mock 环境验证。
7. 验收通过后关闭任务；不通过则返工并补测试。

任务没有验收证据，不算完成。

涉及登录、数据源、权限、部署变量、API 灰度开关的任务，必须额外完成“重启后真实使用路径验收”。例如本地登录必须在普通本地 `3000/3001` 下执行 `npm run health:local-auth`，测试环境必须执行 `npm run health:test-env`。

## 2026-05-22 调整后计划

这次上下文中断后，计划按“可部署测试”重新收束为以下顺序。已经完成的能力保留，不返工；新的执行重点是防止隔离测试通过但真实使用路径失效。

| 优先级 | 任务 | 当前状态 | 交付证据 |
|---|---|---|---|
| P0 | 路径一致性验收 | 已补本地登录验收，继续纳入准入清单 | `npm run health:local-auth` |
| P1 | 本地交付准入 | 进行中，补齐本地真实路径、测试、构建、密钥扫描证据 | `npm run test`、`npm run health:local-auth`、`npm run health:deploy` |
| P2 | 腾讯云 PostgreSQL 测试数据源 | 已补实例、账号权限、安全组和首次验收清单，等待真实实例参数；业务方配合项已独立成清单 | `docs/tencent-postgres-test-datasource-checklist.md`、`docs/test-deployment-collaboration-checklist.md`、`DATABASE_URL`、`PGSSLMODE=require`、`users>=1` |
| P3 | 测试域名与部署参数 | 已补测试域名 DNS/HTTPS smoke 和业务方配合清单，待真实部署平台记录 DNS/环境变量 | `TEST_HOST=https://test-app.xinyi-iso.com npm run health:test-domain`、`docs/test-env-deployment-parameter-pack.md`、`docs/test-deployment-collaboration-checklist.md` |
| P4 | 首次测试环境自动验收 | 聚合脚本已包含测试域名检查，待真实域名执行 | `TEST_ENV_ACCEPTANCE_REPORT=... npm run health:test-env` |
| P5 | 人工业务验收 | 待真实测试环境后执行 | 登录、线索、客户、合同、项目、财务、员工改密、审计 |
| P6 | 上线前风险收口 | 待测试环境试用反馈 | 删除类能力边界、权限委派、数据库公网暴露策略、回滚记录 |

## 第 1 阶段：安全与部署底座

目标：测试环境不暴露服务端密钥，API 不裸奔，环境变量有清晰边界。

任务：

| 编号 | 任务 | 范围 | 验收标准 |
|---|---|---|---|
| S1 | 移除前端 AI key 暴露 | `vite.config.ts`, `services/aiService.ts`, `.env.example` | 前端 bundle 不包含 `KIMI_API_KEY` / `GEMINI_API_KEY`；AI 请求默认走同源 `/api/ai` |
| S2 | 后端 API 基础鉴权 | `server/app.js` 或拆分后的 routes | 设置 `XINYI_API_AUTH_TOKEN` 后，未授权访问 `/api/state/*`, `/api/ai/*`, `/api/intel/*` 返回 401/403 |
| S3 | CORS 白名单和请求限制 | 后端中间件 | 设置 `CORS_ALLOWED_ORIGINS` 后，非白名单 Origin 被拒绝；请求体按 `API_JSON_LIMIT` 限制 |
| S4 | 环境变量清单 | `.env.example`, README/runbook | 测试环境变量可按清单配置；服务端密钥不出现在 `VITE_*` |

验证命令：

```bash
npm run typecheck
npm run build
npm run security:bundle
npm run health:stack
```

## 第 2 阶段：状态存储与后端可测试性

目标：测试环境使用 PostgreSQL，后端可以被自动化测试导入，不依赖真实端口和 JSON 文件。

任务：

| 编号 | 任务 | 范围 | 验收标准 |
|---|---|---|---|
| D1 | PostgreSQL 测试数据源 | `server/stateStore.js` | `/api/state/health` 返回 `mode=postgres` |
| D2 | 后端拆分为可测试 app | `server/app.js`, `server/*` | 测试可导入 app 而不监听端口 |
| D3 | JSON store 运行时隔离 | `server/state_store.json`, `server/intel_store.json` | 测试/部署不把运行态 JSON 当正式数据源 |
| D4 | 状态同步契约 | state routes/service | POST/GET state sync 有 API 测试覆盖 |

验证命令：

```bash
npm run typecheck
npm run test
npm run health:stack
```

## 第 3 阶段：自动化测试与 CI

目标：PR 能自动证明基础质量，不依赖真实 AI key、余额、外部网络。

任务：

| 编号 | 任务 | 范围 | 验收标准 |
|---|---|---|---|
| T1 | 引入 Vitest | `package.json`, test config | `npm test` 可运行 |
| T2 | 后端 API mock 测试 | state/AI/intel routes | AI 和情报测试使用 mock，不访问真实模型 |
| T3 | 前端核心逻辑测试 | import, dashboard, search, permission | 关键纯逻辑有覆盖 |
| T4 | CI 基线 | GitHub Actions 或等价 CI | `npm ci`, `typecheck`, `test`, `build` 全绿 |

验证命令：

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run security:bundle
```

## 第 4 阶段：E2E 与测试环境交付

目标：测试环境可被业务人员打开并验证核心流程。

任务：

| 编号 | 任务 | 范围 | 验收标准 |
|---|---|---|---|
| E1 | Playwright E2E | `e2e/*` | dashboard 可打开且无关键 console error |
| E2 | 核心业务链路 | 线索、客户、合同、项目、财务 | 线索 -> 客户 -> 合同 -> 项目 -> 回款链路通过 |
| E3 | 预发 smoke | health scripts | AI health、state health、intel latest 通过 |
| E4 | 部署 runbook 和回滚 | docs | 有部署、验证、回滚步骤 |

最终验收命令：

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run security:bundle
npm run e2e
```

测试环境验收：

| 检查项 | 通过标准 |
|---|---|
| `/api/ai/health` | 返回成功，且不暴露密钥 |
| `/api/state/health` | 返回 PostgreSQL 模式 |
| `/api/intel/latest` | 返回 envelope，不报 500 |
| `/dashboard` | 页面可打开 |
| 核心链路 | 线索 -> 客户 -> 合同 -> 项目 -> 回款通过 |

## 多 agent 分工

| Agent | 负责范围 | 输出 |
|---|---|---|
| 主 agent | 任务拆分、集成、最终审查 | 每轮合并结果和验收记录 |
| 安全 agent | 鉴权、CORS、密钥治理 | 安全变更和未授权测试 |
| 存储 agent | PostgreSQL、状态同步 | schema、迁移、状态测试 |
| AI agent | AI 网关、mock、脱敏 | 不依赖前端 key 的 AI 调用 |
| 测试 agent | Vitest、API 测试、E2E | CI 可执行测试 |
| 部署 agent | 环境变量、健康检查、runbook | 测试部署说明 |

## 当前验收记录

| 日期 | 变更 | 验证 |
|---|---|---|
| 2026-05-06 | 启动 S1：前端 AI key 收口，默认 `/api/ai`，新增 bundle 密钥检查 | `npm run typecheck && npm run build && npm run security:bundle` 通过 |
| 2026-05-06 | 启动 S2/S3：新增可配置 API token 鉴权、CORS 白名单、请求体限制；health 脚本支持带 token | 临时端口验证：无 token 401、错误 token 403、正确 token 200、非白名单 Origin 403；`npm run typecheck && npm run build && npm run security:bundle` 通过；临时启动全栈后 `npm run health:stack` 通过 |
| 2026-05-06 | 启动 D3：运行态 JSON 从 `server/*_store.json` 切到 `.runtime/*_store.json`（可通过 env 覆盖） | 重启全栈后 `npm run health:stack` 通过；`.runtime/state_store.json`、`.runtime/intel_store.json` 自动生成并可读写 |
| 2026-05-06 | 启动 D2/T1：`server/app.js` 改为仅在直接运行时监听端口；新增 `npm test` 基线与健康接口测试 | `npm run test` 通过（1 passing）；`npm run typecheck` 通过；全栈运行下 `npm run health:stack` 通过 |
| 2026-05-06 | 推进 T2：补充 API 级测试（`/api/ai/health`、`/api/state/health`、`/api/state/sync` 校验与读写） | `npm run test` 通过（5 passing）；`npm run typecheck` 通过；`npm run health:stack` 通过 |
| 2026-05-06 | 推进 T2：补充鉴权与 CORS 场景测试（`401/403/200`） | `npm run test` 通过（7 passing）；`npm run typecheck` 通过；`npm run health:stack` 通过 |
| 2026-05-06 | 推进 T4：新增 GitHub Actions CI（`typecheck -> test -> build -> security:bundle`） | 工作流文件 `.github/workflows/ci.yml` 已提交；本地 `npm run test`、`npm run typecheck` 通过 |
| 2026-05-06 | 推进 E4：新增测试部署 Runbook（验收、排查、回滚） | 文档 `docs/test-deployment-runbook.md` 已新增，可直接用于测试发布流程 |
| 2026-05-06 | 推进 D1：新增强制 PostgreSQL 开关与状态模式检查脚本（防止静默降级） | `npm run test` 通过（8 passing，含“require postgres”场景）；`STATE_EXPECTED_MODE=file node scripts/check-state-mode.mjs` 通过；`npm run health:stack` 通过 |
| 2026-05-06 | 推进 D1/T4：新增部署前配置自检脚本（preflight）并接入 runbook + CI | 新增 `health:preflight:test`、`health:preflight:dev`；本地 preflight/test/typecheck/health 均通过；CI 已加入 preflight 步骤 |
| 2026-05-06 | 推进 D4：新增 state sync API 契约文档 + 键标准化边界测试 | 文档 `docs/state-sync-api-contract.md` 已新增；`api-state` 测试新增 key 规范化、written 计数、metadata/source 校验 |
| 2026-05-06 | 推进 T4：补充脚本级测试（`check-state-mode`、`preflight`） | `npm run test` 通过（13 passing）；覆盖脚本成功/失败分支；全栈恢复后 `npm run health:stack` 通过 |
| 2026-05-06 | 推进 E3：新增部署 smoke 脚本（只读健康检查，不触发 AI 生成/情报抓取/状态写入） | 新增 `npm run health:deploy`；覆盖 frontend/backend/state/intel latest/proxy；`npm run test` 通过（15 passing）；本地真实全栈 `npm run health:deploy` 通过（5/5） |
| 2026-05-06 | 推进 E1：新增 Playwright 最小 E2E（dashboard 加载、主导航存在、关键错误检查） | `npm run e2e` 通过（1 passing）；修正 intel 默认本地端口 fallback 噪音；CI 已加入 Playwright E2E |
| 2026-05-06 | 补齐交付闭环：新增测试交付准入清单，加入本地聚合验证命令，忽略 Playwright 生成目录 | 新增 `docs/test-delivery-readiness-checklist.md`；新增 `npm run verify:local`；`test-results/`、`playwright-report/` 已加入 `.gitignore`，未删除本地目录 |
| 2026-05-06 | 验证交付闭环 | `npm run verify:local` 通过（typecheck、15 个测试、build、security:bundle、preflight、1 个 E2E）；`npm run health:stack` 通过；`npm run health:deploy` 通过（5/5） |
| 2026-05-06 | 推进 E2：补充核心业务页面入口 E2E，并修复财务页表格 DOM 告警 | E2E 覆盖 dashboard、线索、客户、合同、项目、财务入口；`pages/Finance.tsx` 仅整理 JSX 表格标签，无字段/demo/业务结构变更；`npm run verify:local` 通过（2 个 E2E）；`npm run health:stack`、`npm run health:deploy` 通过 |
| 2026-05-06 | 推进 E2：补充核心业务链路 E2E | 新增隔离态 Playwright 用例，拦截 `/api/state/sync` 写入；覆盖合同录入 -> 自动客户主体 -> 自动交付项目 -> 财务回款台账；`npm run e2e` 通过（3 passing） |
| 2026-05-06 | 推进 E2：补充财务确认到账 E2E | 在核心链路用例内覆盖“确认到账 -> 已核销”；`npm run e2e` 通过（3 passing） |
| 2026-05-06 | 推进 E2：补充线索转跟进项目 E2E，并修复项目页表格 DOM 告警 | E2E 覆盖新增线索 -> 生成跟进项目 -> 项目页展示“跟进项目”；`pages/Projects.tsx` 仅整理 JSX 表格标签，无字段/demo/业务结构变更；`npm run e2e` 通过（4 passing） |
| 2026-05-07 | 推进测试环境持久化验收：新增 state persistence smoke | 新增 `npm run health:state:persistence`，写入探针数据并读回比对；脚本测试覆盖成功与读回不一致失败分支；本地运行通过（mode=file）；测试环境用 `STATE_EXPECTED_MODE=postgres` 强制验收 |
| 2026-05-07 | 推进测试环境配置收口：新增配置清单并收紧 preflight | 新增 `docs/test-environment-checklist.md`；preflight 在 test/staging/prod 下拒绝 CORS `*`、显式关闭鉴权、开启 intel 本地 fallback、关闭 state sync；脚本测试覆盖不安全配置失败分支 |
| 2026-05-07 | 启动员工登录系统：新增后端认证基础 | 新增 `/api/auth/login`、`/api/auth/me`、`/api/auth/logout`；支持 HttpOnly session cookie 与临时种子管理员；新增 `docs/employee-auth-plan.md`；`npm run test` 通过（20 passing） |
| 2026-05-07 | 推进员工登录系统：新增前端登录门禁 | 新增 `/login` 页面、`authService`、`VITE_AUTH_REQUIRED` 门禁；AppProvider 可接收后端认证员工；preflight 要求测试/预发/生产开启登录门禁；新增 auth-required E2E |
| 2026-05-07 | 推进员工登录系统：锁定登录身份并隔离 E2E 服务 | 登录模式下隐藏 demo 用户切换，状态同步不能覆盖当前登录员工；Playwright 默认用 `3100/3101` 独立测试服务；修复微信模拟推送渲染期副作用；`npm run typecheck`、`npm run test`、`npm run e2e`、`npm run build`、`npm run security:bundle`、`npm run health:deploy` 通过 |
| 2026-05-08 | 推进员工登录系统：落地后端会话鉴权（A4-1） | 新增 `XINYI_SESSION_AUTH_REQUIRED`，受保护 API 支持会话鉴权并可与 token 共存；preflight/CI/环境清单同步；新增 session 鉴权测试（含 token+session 共存场景）；`npm run test`（22 passing）与 `npm run e2e`（5 passing）通过 |
| 2026-05-08 | 推进员工登录系统：落地角色级 API 权限（A4-2） | 新增会话角色校验中间件；`/api/intel/fetch`、`/api/ai/selftest` 限制为 `ADMIN/MANAGER`（token 自动化通道保持可用）；新增角色鉴权测试（FINANCE 拒绝、MANAGER 允许、token 旁路）；preflight 增加 `XINYI_SESSION_ROLE_ENFORCEMENT` 强制校验；`npm run test` 与 `npm run e2e` 通过 |
| 2026-05-08 | 推进员工登录系统：认证存储 PostgreSQL 化（A5-1） | `authStore` 支持 `auth_users` / `auth_sessions` PostgreSQL 表；新增 `/api/auth/health`、`npm run health:auth:postgres`、`XINYI_AUTH_REQUIRE_POSTGRES` 强制模式；deploy smoke 增加 auth health；测试覆盖缺少 `DATABASE_URL` 时启动失败与 auth mode 检查 |
| 2026-05-08 | 推进员工登录系统：员工账号管理 API（A5-2） | 新增管理员账号管理接口：员工列表、创建员工、更新员工资料/角色/状态、重置密码；重置密码会清除该员工旧 session；普通员工访问账号管理返回 403；防止当前管理员禁用自己或移除自己的 `ADMIN` 角色；`npm run test` 通过（30 passing） |
| 2026-05-08 | 推进员工登录系统：员工账号管理页面（A5-3） | 新增 `/employees` 页面与侧边栏“员工账号”入口；仅 `ADMIN` 角色显示入口；页面支持员工列表、新建、编辑、状态维护与重置密码；新增 E2E 覆盖管理员登录后创建员工账号 |
| 2026-05-08 | 推进员工登录系统：账号审计日志（A5-4） | 新增 `auth_audit_logs` / 文件模式 `auditLogs`；记录管理员创建、更新、禁用、启用、重置密码等动作；新增 `/api/auth/audit-logs` 管理员接口；测试覆盖普通员工 403 与日志不包含密码明文；`npm run test` 通过（30 passing） |
| 2026-05-08 | 推进员工登录系统：首次登录强制改密（A5-5） | 新增 `mustChangePassword` 字段与 `/api/auth/change-password`；新员工和被重置密码员工必须先改密；新增 `/change-password` 页面；E2E 覆盖管理员创建员工 -> 员工临时密码登录 -> 强制改密 -> 进入工作台 |
| 2026-05-08 | 推进员工登录系统：登录失败临时锁定（A5-6） | 新增内部字段 `failedLoginCount`、`lockedUntil`、`lastFailedLoginAt`；默认连续 5 次失败锁定 15 分钟；支持 `XINYI_AUTH_MAX_FAILED_LOGIN_ATTEMPTS` / `XINYI_AUTH_LOCK_MS` 配置；测试覆盖锁定期正确密码拒绝、锁定期后恢复登录；`npm run test` 通过（31 passing） |
| 2026-05-08 | 推进员工登录系统：审计日志页面（A5-7） | 新增 `/auth-audit` 管理页面与侧边栏“审计日志”入口；仅 `ADMIN` 角色显示；页面展示最近 100 条审计日志，字段包括时间、动作、操作人、对象、详情；E2E 覆盖创建员工后可看到“创建员工”日志 |
| 2026-05-09 | 推进官网线索接入（A6-1） | 新增 `POST /api/public/website-leads`，默认关闭；支持 `XINYI_PUBLIC_LEAD_ENABLED` 与可选 `XINYI_PUBLIC_LEAD_TOKEN`；官网字段映射到现有 `Lead` 字段和系统跟进记录；重复提交追加跟进记录；新增契约文档与 API 测试；`npm run test` 通过（33 passing） |
| 2026-05-09 | 启动线索模块后端化前置保护 | 新增 `docs/leads-module-ui-contract.md` 固定当前线索模块 UI、字段、DOM 行为边界；新增 E2E 覆盖新增线索、搜索、详情、编辑保存、跟进记录，作为后续替换数据来源的回归闸门；单条线索回归已通过 |
| 2026-05-09 | 推进线索模块后端化：新增后端 Lead API | 新增 `/api/leads`、`/api/leads/:id`、`/api/leads/:id/follow-ups`，继续读写现有 `leads_v8` 数据集，返回当前 `Lead` 字段形状；新增 `docs/leads-api-contract.md`；前端暂未接入，UI、DOM、demo 结构无变更；`npm run test` 通过（35 passing） |
| 2026-05-09 | 推进线索模块后端化：新增前端 Lead API 适配层 | 新增 `services/leadService.ts` 与 `VITE_LEADS_API_ENABLED` 灰度开关；默认关闭，不改变现有页面；打开后 `addLead`、`updateLead`、`addLeadFollowUp` 乐观更新后调用 `/api/leads` 校准；`npm run typecheck`、`npm run test`（35 passing）、`npm run e2e`（7 passing）、`npm run build`、`npm run security:bundle` 通过；`VITE_LEADS_API_ENABLED=1` 单条线索契约 E2E 通过，并确认 3 次 `/api/leads` 写请求 |
| 2026-05-09 | 推进线索模块后端化：新增前端 Lead API 读取灰度 | 新增 `VITE_LEADS_API_READ_ENABLED`，默认关闭；打开后启动时从 `GET /api/leads` 拉取线索，失败回落本地线索；E2E 补充读取请求断言；`npm run typecheck`、`npm run e2e`（7 passing）、`npm run test`（35 passing）、`npm run build`、`npm run security:bundle` 通过；`VITE_LEADS_API_ENABLED=1 VITE_LEADS_API_READ_ENABLED=1` 单条线索契约 E2E 通过 |
| 2026-05-09 | 推进线索模块后端化：新增写后读回一致性保护 | 新增 `VITE_LEADS_API_VERIFY_WRITES_ENABLED`，默认关闭；打开后新增、编辑、追加跟进会再 `GET /api/leads/:id` 读回确认，不一致或读回失败时回滚到写入前的前端 state；E2E 补充 3 次写后读回断言；`npm run typecheck`、`npm run e2e`（7 passing）、`npm run test`（35 passing）、`npm run build`、`npm run security:bundle` 通过；三项线索 API 开关全开时单条线索契约 E2E 通过 |
| 2026-05-09 | 固定线索模块测试环境样板验收 | 新增 `npm run health:leads:api`，覆盖线索列表读取、新增、读回、编辑、读回、追加跟进、读回、`leads_v8` 读回；preflight 在 test/staging/prod 强制开启线索 API 读写和写后验证；更新测试环境清单与 runbook；本地真实后端 `health:leads:api` 通过（8/8，创建 1 条 SMOKE 线索）；`npm run test`（37 passing）、`npm run typecheck`、`npm run e2e`（7 passing）、`npm run build`、`npm run security:bundle` 通过 |
| 2026-05-09 | 启动客户模块后端化：新增后端 Customer API | 新增 `/api/customers`、`/api/customers/:id`、`/api/customers/:id/follow-ups`，继续读写现有 `customers_v8` 数据集，返回当前 `Customer` 字段形状；新增 `docs/customers-api-contract.md`；前端暂未接入，UI、DOM、demo 结构无变更；单独客户 API 测试通过 |
| 2026-05-09 | 推进客户模块后端化：新增前端 Customer API 适配层 | 新增 `services/customerService.ts` 与 `VITE_CUSTOMERS_API_ENABLED` / `VITE_CUSTOMERS_API_READ_ENABLED` / `VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED` 灰度开关；默认关闭，不改变现有客户页面 UI、DOM、demo 结构和字段；打开后客户新增、编辑、追加跟进会写入 `/api/customers` 并可读回校验；单条客户 UI 合约 E2E 与三项开关全开 E2E 均通过 |
| 2026-05-09 | 固定客户模块测试环境样板验收 | 新增 `npm run health:customers:api`，覆盖客户列表读取、新增、读回、编辑、读回、追加跟进、读回、`customers_v8` 读回；preflight 在 test/staging/prod 强制开启客户 API 读写和写后验证；更新测试环境清单与 runbook |
| 2026-05-09 | 启动合同模块后端化：新增后端 Contract API | 新增 `/api/contracts`、`/api/contracts/:id`、`/api/contracts/:id/attachments`，继续读写现有 `contracts_v8` 数据集，返回当前 `Contract` 字段形状；不提供删除合同/删除附件等破坏性接口；新增 `docs/contracts-api-contract.md`；前端暂未接入，UI、DOM、demo 结构无变更 |
| 2026-05-09 | 固定合同模块后端 API 验收 | 新增 `npm run health:contracts:api`，覆盖合同列表读取、新增、读回、编辑、读回、追加附件、读回、`contracts_v8` 读回；更新测试环境清单与 runbook |
| 2026-05-09 | 推进合同模块后端化：新增前端 Contract API 只读灰度 | 新增 `services/contractService.ts` 与 `VITE_CONTRACTS_API_READ_ENABLED`；默认关闭，不改变现有合同页面 UI、DOM、demo 结构和字段；打开后合同页面启动时从 `/api/contracts` 读取，写入仍保留现有前端联动流程，避免客户/项目/回款半落库 |
| 2026-05-10 | 推进合同写入一致性：新增事务提交接口 | 新增 `POST /api/contracts/transaction`，只允许一次性提交 `contracts_v8`、`customers_v8`、`projects_v8`、`leads_v8`；用于后续合同写入灰度，避免合同、自动客户、自动项目、线索状态半落库；新增 API 测试覆盖成功提交、忽略不支持数据集、缺少合同集和 contractId 不匹配失败 |
| 2026-05-11 | 推进合同写入一致性：前端接入事务写入灰度 | `addContract` 保留当前本地联动计算，新增 `VITE_CONTRACTS_API_WRITE_ENABLED` / `VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED`；打开写入灰度后一次性提交 `contracts_v8`、`customers_v8`、`projects_v8`、`leads_v8` 到 `/api/contracts/transaction`；验证开关打开时 E2E 能捕获事务写入请求 |
| 2026-05-11 | 扩展合同事务写入灰度：非破坏性操作 | 合同归档、客户绑定、附件追加接入 `POST /api/contracts/transaction`；删除合同/删除附件继续不做；回款状态切换暂缓，需先处理客户 PDCA 与知识文档一致性 |
| 2026-05-12 | 扩展合同事务写入灰度：回款状态切换 | 回款状态切换接入 `POST /api/contracts/transaction`，同步提交 `contracts_v8`、`customers_v8`、`projects_v8`、`knowledge_docs_v8`，覆盖合同回款状态、项目回款状态、客户 PDCA 累计和 PDCA 知识记录；删除合同/删除附件继续不做 |
| 2026-05-12 | 启动项目模块后端化：新增后端 Project API | 新增 `/api/projects`、`/api/projects/:id`、`/api/projects/:id/tasks`、`/api/projects/:id/tasks/:taskId`，继续读写现有 `projects_v8` 数据集，返回当前 `Project` 字段形状；不提供删除项目/删除任务/删除服务项/删除工作日志等破坏性接口；新增 `docs/projects-api-contract.md`、API 测试与 `npm run health:projects:api` |
| 2026-05-12 | 推进项目模块后端化：新增前端 Project API 只读灰度 | 新增 `services/projectService.ts` 与 `VITE_PROJECTS_API_READ_ENABLED`；默认关闭，不改变现有项目页面 UI、DOM、demo 结构和字段；打开后项目页面启动时从 `/api/projects` 读取，写入仍保留现有状态同步流程 |
| 2026-05-13 | 推进项目模块后端化：非破坏性写入灰度 | 新增 `VITE_PROJECTS_API_WRITE_ENABLED` / `VITE_PROJECTS_API_VERIFY_WRITES_ENABLED`；新增项目、指派负责人、任务新增、成本确认接入项目 API 写入与读回校验；任务完成、服务项、删除类操作暂不接入 |
| 2026-05-13 | 推进项目复杂联动一致性：新增项目事务接口 | 新增 `POST /api/projects/transaction`，只允许一次性提交 `projects_v8`、`customers_v8`、`reminders_v8`、`project_work_logs_v1`、`knowledge_docs_v8`；用于后续任务完成、项目完结、客户 PDCA、提醒与工作日志一致性；前端暂未接入 |
| 2026-05-13 | 推进项目事务前端接入：任务状态与工作日志 | 任务状态变更接入 `POST /api/projects/transaction`；任务完成且未触发项目自动完结时，同步提交 `projects_v8` 与 `project_work_logs_v1` 并支持读回校验；项目自动完结链路仍保留原逻辑，后续单独接入客户 PDCA/提醒事务 |
| 2026-05-13 | 推进项目事务前端接入：项目完结与客户 PDCA | 项目完结接入 `POST /api/projects/transaction`；手工完结同步提交 `projects_v8`、`customers_v8`、`reminders_v8`，任务完成触发自动完结时额外同步 `project_work_logs_v1`；写后验证覆盖完成记录、客户、提醒和自动日志 |
| 2026-05-13 | 推进项目事务前端接入：服务项与自动任务 | 服务项新增/更新接入 `POST /api/projects/transaction`；新增服务项时同步提交 `serviceItems` 与自动生成任务；删除服务项仍不接入，因会解绑已有任务，需单独确认 |
| 2026-05-14 | 推进项目事务前端接入：重新打开项目 | 重新打开项目接入 `POST /api/projects/transaction`；同步提交项目状态回滚、客户字段回滚，并仅移除 `completionRecord.generatedReminderIds` 指向的本次完成事件自动提醒 |
| 2026-05-14 | 修复项目重新打开客户 PDCA 回滚 | 补齐 `completionRecord.customerPatchBefore` 快照，重新打开项目时同步回滚客户合作次数、累计金额、年度金额、最近项目、下一次机会与客户等级，避免撤销完成后客户指标残留偏高 |
| 2026-05-14 | 收口测试环境后端化准入 | `preflight` 在 test/staging/prod 下强制开启合同与项目 API 读写和写后验证开关，避免测试环境漏开灰度导致仍走前端本地 state；环境清单与 runbook 同步 |
| 2026-05-14 | 完成核心模块后端化阶段总审查 | 新增 `docs/backendization-stage-review.md`，汇总线索、客户、合同、项目后端化完成度、保留边界、主要风险和下一步验收顺序；同步修正合同/项目契约中的陈旧描述 |
| 2026-05-14 | 启动动作权限矩阵收口 | 新增 `docs/action-permission-matrix.md`，固化当前角色动作、数据范围、删除类边界和员工账号管理委派建议；`checkActionPermission` 抽出为纯函数 `checkRoleActionPermission`，便于后续后端动作权限对齐 |
| 2026-05-14 | 推进员工账号管理委派伏笔 | 新增 `EMPLOYEE_*` / `AUTH_AUDIT_VIEW` 动作权限码；员工账号管理 API 从仅 `ADMIN` 改为动作权限守卫，默认仍只有 `ADMIN` 拥有这些动作；补充普通员工创建、更新、重置密码、查看审计被拒测试；无 UI、DOM、demo 结构变更 |
| 2026-05-14 | 补权限契约回归防线 | 新增 `tests/permissions-contract.test.js`，校验 `ActionCode`、`ROLE_CAPABILITIES` 与后端员工账号管理动作清单一致，并锁定员工管理动作默认仅 `ADMIN` 拥有；无 UI、DOM、demo 结构变更 |
| 2026-05-14 | 加固员工管理委派边界 | 后端补充 `ADMIN` 账号目标保护：即使未来向非管理员委派员工管理动作，也不能修改或重置 `ADMIN` 账号；权限契约测试同步覆盖该保护；无 UI、DOM、demo 结构变更 |
| 2026-05-15 | 梳理岗位/个人附加权限设计 | 新增 `docs/permission-delegation-design.md`，明确前台、总经理助理、人事负责人等委派权限模型、验收标准和 UI/字段实施边界；本轮只做设计，不改 UI、DOM、demo 结构或业务字段 |
| 2026-05-15 | 补认证 API 测试环境 smoke | 新增 `npm run health:auth:api`，只读验证认证健康、管理员登录、`/api/auth/me`、员工列表和审计日志；新增脚本测试，部署清单与 runbook 同步；无 UI、DOM、demo 结构变更 |
| 2026-05-19 | 收紧认证 smoke 预检 | `preflight:test` 要求配置 `AUTH_SMOKE_ACCOUNT` / `AUTH_SMOKE_PASSWORD`，避免测试环境部署后才发现认证 API smoke 无法执行；`.env.example`、测试环境清单与 runbook 同步；无 UI、DOM、demo 结构变更 |
| 2026-05-19 | 新增测试环境聚合验收 | 新增 `npm run health:test-env`，串联 preflight、deploy、state persistence、auth mode、auth api、线索/客户/合同/项目 API smoke；保留分项命令用于排查；无 UI、DOM、demo 结构变更 |
| 2026-05-19 | 补聚合验收证据留存 | `health:test-env` 支持 `TEST_ENV_ACCEPTANCE_REPORT=<path>` 输出 JSON 报告；报告对常见密码、token、数据库连接串脱敏；`acceptance-reports/` 加入 `.gitignore`；runbook 与准入清单同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧真实测试环境验收防呆 | `health:test-env` 在 `STATE_EXPECTED_MODE=postgres` 或 `AUTH_EXPECTED_MODE=postgres` 时要求显式传入 `DEPLOY_FRONTEND_BASE` / `DEPLOY_BACKEND_BASE`，避免误测本机默认地址；runbook 与准入清单同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 新增真实测试环境部署参数包 | 新增 `docs/test-env-deployment-parameter-pack.md`，集中域名、部署平台、PostgreSQL、认证、AI、模块 API 开关、验收命令和发布结论模板；runbook、环境清单、准入清单增加入口；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧 HTTPS 登录 Cookie 部署预检 | `preflight:test` 要求 `XINYI_SESSION_COOKIE_SECURE=true`，避免测试域名下登录 session cookie 不稳定；`.env.example`、runbook、环境清单同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 同步 CI 测试环境门禁变量 | `.github/workflows/ci.yml` 的 `health:preflight:test` 补齐认证 smoke、HTTPS cookie、状态同步和核心模块 API 灰度变量，确保 CI 门禁与真实测试环境准入一致；本地模拟 CI preflight 通过；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧测试环境 CORS 来源 | `preflight:test` 拒绝 `CORS_ALLOWED_ORIGINS` 中的 `http://`、`localhost`、`127.0.0.1`，避免 HTTPS 测试域名下跨域与登录 cookie 不稳定；runbook、环境清单、参数包同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧官网线索公开入口预检 | `preflight:test` 在 `XINYI_PUBLIC_LEAD_ENABLED=true` 时要求配置 `XINYI_PUBLIC_LEAD_TOKEN`，避免测试/预发/生产误开无 token 的公网线索写入接口；runbook、环境清单、参数包同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧部署 token 强度预检 | `preflight:test` 要求 `XINYI_API_AUTH_TOKEN` 以及启用官网线索入口时的 `XINYI_PUBLIC_LEAD_TOKEN` 至少 24 字符，避免弱 token 进入测试/预发/生产；CI 与文档同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧前端环境密钥预检 | `preflight:test` 拒绝有值的 `VITE_*API_KEY`、`VITE_*SECRET`、`VITE_*TOKEN`、`VITE_*PASSWORD` 等前端密钥变量，避免服务端密钥进入浏览器构建产物；runbook、环境清单、参数包同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧数据库连接串预检 | `preflight:test` 要求 `DATABASE_URL` 使用 `postgres://` / `postgresql://`，且不能指向 `localhost`、`127.0.0.1` 或 `[::1]`；CI 假连接串改为非本机域名；runbook、环境清单、参数包同步；无 UI、DOM、demo 结构变更 |
| 2026-05-21 | 补齐腾讯云 PostgreSQL SSL 门禁 | `preflight:test` 要求测试/预发/生产配置 `PGSSLMODE=require`；CI、`.env.example`、runbook、环境清单和参数包同步；现有 `stateStore`/`authStore` 已支持该开关；无 UI、DOM、demo 结构变更 |
| 2026-05-21 | 补真实测试空库管理员验收 | `health:test-env` 在 PostgreSQL 认证模式下自动要求 `/api/auth/health` 的 `users>=1`；`health:auth:postgres` 和 `health:deploy` 支持 `AUTH_EXPECTED_MIN_USERS`；参数包补首次管理员初始化步骤；无 UI、DOM、demo 结构变更 |
| 2026-05-22 | 补本地登录启动验收 | 新增 `npm run health:local-auth`，直接验证普通本地 `3000/3001` 启动下 `/dashboard` 会跳转 `/login`，且 `/api/auth/health` 的 `users>=1`，避免 E2E 独立登录环境通过但普通本地启动漏配；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧测试环境 AI key 预检 | `preflight:test` 在 test/staging/prod 下要求至少配置一个服务端 `KIMI_API_KEY` 或 `GEMINI_API_KEY`，避免部署后 `/api/ai/health` 才失败；CI 使用占位 key 验证门禁；runbook、环境清单、参数包同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 收紧测试管理员密码预检 | `preflight:test` 要求 `AUTH_SMOKE_PASSWORD` 至少 12 字符；如配置 `XINYI_AUTH_SEED_ADMIN_PASSWORD`，也要求至少 12 字符，避免弱密码进入测试/预发/生产；`.env.example`、runbook、环境清单、参数包同步；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 新增测试环境验收记录模板 | 新增 `docs/test-env-acceptance-record-template.md`，固定版本、环境、部署参数、自动验收、人工业务验收、风险与交付结论记录口径；runbook、准入清单、参数包同步入口；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 新增验收记录生成脚本 | 新增 `npm run acceptance:record`，可从 `health:test-env` JSON 报告生成 Markdown 验收记录草稿；新增脚本测试并同步 runbook、准入清单、参数包；无 UI、DOM、demo 结构变更 |
| 2026-05-20 | 明确腾讯云 PostgreSQL 数据方案 | 测试环境数据存储选择腾讯云 PostgreSQL；参数包补充 Vercel 应用连接腾讯云 PostgreSQL 外网地址、Static IP、腾讯云同 VPC 后端三种路径及风险；runbook、环境清单同步；无 UI、DOM、demo 结构变更 |
