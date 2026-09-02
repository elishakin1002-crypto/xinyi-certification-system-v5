# 批次1（线索 + 客户 CRM）后端进度

## 已完成 ✅（后端真相源化）

| 项 | 文件 | 说明 |
|---|---|---|
| PG 表 | `db/init/001_batch1_leads_customers.sql` | `leads`(30列)/`customers`(35列)，含 `extra_fields` 兜底列 |
| 本地 DB | `db/docker-compose.dev-db.yml` | 容器 `xinyi-dev-db`，postgres:16-alpine（国内 daocloud 源） |
| 连接池 | `server/db/pool.js` | 读 `XINYI_DB_URL`，与全局 `DATABASE_URL` 解耦；未配则禁用 |
| 映射工具 | `server/repos/_mapper.js` | camelCase↔snake_case、元↔分、日期、JSON、extra_fields |
| repo | `server/repos/leadRepo.js` `customerRepo.js` | CRUD + findByUscc/Name + addFollowUp |
| 路由 | `server/routes/batch1.js` | leads/customers/convert；**DB 未启用自动 next('router') 落回旧逻辑** |
| 挂载 | `server/app.js` | `app.use(batch1Router)`（auth 中间件后、旧路由前） |
| 迁移 | `scripts/batch1-migrate.mjs` | state_store→PG，幂等；已迁 458 线索 + 16 客户 |
| 冒烟 | `scripts/batch1-repo-smoke.mjs` | repo 层断言全过 |

### 验证结论
- HTTP 端到端全绿：创建/读/列表/过滤/跟进/**线索转客户级联**。
- 金额 DB 实存为「分」（50000元→5000000分），API 仍返回「元」。
- 迁移幂等（复跑全部走更新）。
- 鉴权仍文件模式，`ai-agent`/`admin` 账号不受影响。

### 连接信息
- `XINYI_DB_URL=postgres://xinyi:xinyi_dev_pwd@localhost:5432/xinyi`（已写入 `.env.local`）
- 启动 DB：`docker compose -f db/docker-compose.dev-db.yml up -d`
- 起后端：`PORT=3001 node server/app.js`（日志 `.runtime/batch1-server.log`）

## 批次1 待办 ⬜

1. **前端切换**：启用 `VITE_LEADS_API_ENABLED/READ` 等开关，让前端从后端读写（目前前端仍 localStorage 优先）。
2. **新增动作接口的前端接入**：`POST /api/leads/:id/convert`（前端转化按钮走后端级联）。
3. **回归**：跑 `npm run health:leads:api` / `customers:api` 等既有冒烟（确认未破坏旧契约）。
4. **MCP 只读工具可先做**：leads/customers/get 读接口已稳定，可据此先做 MCP 只读工具打通 Agent 链路。

## 已知事项 / 风险
- 客户分级(level)/累计额公式属**批次2** `completeProject` 级联（见 phase0 §7.1），批次1 仅持久化字段、不计算。
- convert 级联目前是顺序写（非单事务）；低频动作，批次2 可加事务硬化。
- 单位换算：批次2 在 PG 上算 level 时阈值需用「分」(1000万/300万)。
