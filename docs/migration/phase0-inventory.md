# 阶段0 逻辑盘点：需迁移清单 + 目标后端 API 契约

> 目的：把当前压在前端的「真相源 / 业务规则 / 多实体级联」盘清楚，定义一套**后端权威 API 契约**。
> 这套契约 = 后端迁移要实现的目标，也 = 将来 MCP server 要包的接口。一次成型，避免返工。
>
> 生成于阶段0，作为后续所有迁移批次和 MCP 集成的基准。范围基线由 `core/rules_v1.md`（铁骨架）继承。

---

## 〇、当前架构定性（为什么必须先迁）

| 层 | 现状 | 问题 |
|---|---|---|
| 真相源 | **浏览器 localStorage**（`dataService.ts`），后端只是快照备份 | Agent 没有浏览器，无法参与；多用户整批 last-write-wins 会互相覆盖 |
| 业务大脑 | **`context/AppContext.tsx`（4501 行）** 持有全量状态并跑所有级联 | 逻辑在客户端，Agent / 其他端无法复现 |
| 前端 service | `leadService/customerService/projectService` 已是薄 `fetch('/api/*')` 客户端，但被 `VITE_*_API_ENABLED` 默认关闭 | 通道已搭好，缺的是后端把逻辑接住 |
| 后端 | `server/app.js` 接口是**薄 CRUD/整批 upsert**，几乎无业务逻辑 | 直接调写接口会绕过所有规则，数据不一致 |

**结论**：写操作必须等逻辑迁到后端；只读可先行。

---

## 一、真相源数据集清单（localStorage → Postgres 表）

`AppContext.tsx` 中的 15 个 key，每个都要落成后端权威表（命名遵循 `rules_v1.md` §7：小写下划线、`*_id`/`created_at`/`updated_at`/`*_amount`/`*_status`）。

| localStorage key | 含义 | 目标表（建议） | 优先级 |
|---|---|---|---|
| `leads_v8` | 线索 | `leads` | 批次1 |
| `customers_v8` | 客户 | `customers` | 批次1 |
| `contracts_v8` | 合同 | `contracts` | 批次3 |
| `projects_v8` | 项目 | `projects`（任务内联或拆 `project_tasks`） | 批次2 |
| `project_work_logs_v1` | 项目工作日志 | `project_work_logs` | 批次2 |
| `reminders_v8` | 提醒 | `reminders` | 批次2（级联依赖） |
| `settlements_v8` | 结算 | `settlements` | 批次3 |
| `audit_issues_v1` | 审计问题 | `audit_issues` | 批次4 |
| `knowledge_docs_v8` | 知识库（含 PDCA 文档） | `knowledge_docs` | 批次2 |
| `market_signals_v1` | 情报信号 | `market_signals` | 批次4 |
| `task_templates_v1` | 任务模板 | `task_templates` | 批次2 |
| `user_profiles_v1` | 用户档案 | 并入 `auth_users`（已存在） | 批次1 |
| `ai_decision_logs_v1` | AI 决策日志 | `ai_decision_logs` | 批次4 |
| `strategic_tasks_v1` | 战略任务 | `strategic_tasks` | 批次4 |
| `strategic_insight_v1` | 战略洞察 | `strategic_insight` | 批次4 |

> 金额字段一律存「分」(integer)，遵循 `rules_v1.md` §4。

---

## 二、业务逻辑 / 级联清单（AppContext.tsx → 后端 service）

标记 ⚠️ 的是「会被 Agent 写操作绕过、必须后端化」的关键级联。

| 函数（行号） | 作用 | 迁移目标 | 影响 MCP 写工具？ |
|---|---|---|---|
| `deriveReceivableStatus` (504) | 回款状态推导（按到期日） | 后端纯函数 | 间接 |
| `deriveProjectPaymentStatus` (510) | 项目付款状态推导 | 后端纯函数 | 间接 |
| `calculateProjectProgress` (1756) | 进度=核心任务完成率 | 后端纯函数（写任务时重算） | ✅ 是 |
| `buildProjectFromInput` (1765) | 建项目（含服务项展开） | `POST /projects` 内部 | ✅ 是 |
| `buildWorkflowTasks` (2370) | 按服务项/模板生成任务 | 建项目/加服务项时后端生成 | ✅ 是 |
| `applyTemplateToProject` (3181) | 套用任务模板 | `POST /projects/:id/apply-template` | ✅ 是 |
| ⚠️ `completeProject` (2677) | **完成项目大级联**（见下） | `POST /projects/:id/complete` | ✅ 是（核心） |
| ⚠️ `applyCustomerPDCAUpdate` (2670) | 完成后更新客户 PDCA/分级/累计额 | 并入 complete 级联 | ✅ 是 |
| `buildPdcaKnowledgeDoc` (2576) | 完成后生成 PDCA 知识文档 | 并入 complete 级联 | ✅ 是 |
| ⚠️ `convertSignalToFollowUpProject` (1182) | 情报→跟进项目 | `POST /signals/:id/convert` | 批次4 |
| `convertIntelProjectToLead` (1266) | 情报项目→线索 | `POST /projects/:id/to-lead` | 批次4 |
| `generateAuditPlan` (4138) | 按周期规则生成审核节点 | 后端纯函数 | 批次4 |
| `syncAuditRectificationTask` (3906) | 审计问题↔整改任务同步 | `POST /audit-issues` 内部级联 | 批次4 |
| `generateProjectSettlement` (4313) | 项目结算计算 | 并入 complete 或独立接口 | 批次3 |
| `generateStrategicTasksFromInsight` (4106) | AI 洞察→战略任务 | 后端（调 AI 代理） | 批次4 |

### ⚠️ 旗舰级联：`completeProject`（必须原子化到后端）

一次「完成项目」内部串了：
1. **费用关闭校验**（T-001）：非情报跟进项目，`costStatus` 必须 `已确认` 且 `projectAmount > 0`，否则禁止完结；已有回款时给特定文案。
2. **评级计算**：
   - 普通项目：延期任务数 `0→S`，`<3→A`，否则 `B`
   - 情报跟进项目：`0→A`，`<3→B`，否则 `C`（且可跳过费用校验）
   - `taskCompletionRate = 完成任务/总任务`，`duration` 由项目 id 时间戳推算
3. **PDCA 绑定客户**：按 `customerId` / `contractRef`（`CUST:`/`LEAD:` 前缀）查找或新建客户。
4. **更新客户**：`serviceCount`、`cooperationCount`、`lastProjectAt/Type`、`totalAmount`、`yearAmount`、`level(A/B/C)`、`status`。
5. **生成 PDCA 知识文档**写入 `knowledge_docs`。
6. **生成提醒**写入 `reminders`。
7. **事务提交 + 回读校验**（写完再读回确认 `eventId` 一致）。
8. 30 秒内可撤销（`rules_v1.md` §9）。

→ 后端必须做成**单个原子接口** `POST /projects/:id/complete`，在一个事务里完成 1–7。这是「Agent 能否正确完成项目」的关键。

---

## 三、目标后端 API 契约（迁移目标 = MCP 包装对象）

全部遵循统一返回包 `{ ok, code, message, data }`（`rules_v1.md` §2/§6）。鉴权见下「权限契约」。

### 读（幂等，可先行做 MCP 只读工具）
```
GET  /api/leads            列表（支持 ?status=&owner=&q=）
GET  /api/leads/:id
GET  /api/customers        （?level=&riskStatus=）
GET  /api/customers/:id
GET  /api/projects         （?status=&manager=）
GET  /api/projects/:id
GET  /api/contracts        （?customerId=&status=）
GET  /api/contracts/:id
GET  /api/dashboard/metrics  （后端化 buildDashboardMetrics）
GET  /api/intel/latest
```

### 写（必须等逻辑后端化）
```
# 线索 CRM（批次1）
POST   /api/leads
PATCH  /api/leads/:id
POST   /api/leads/:id/follow-ups
POST   /api/leads/:id/convert          → 线索转客户（级联）

# 客户 CRM（批次1）
POST   /api/customers
PATCH  /api/customers/:id
POST   /api/customers/:id/follow-ups

# 项目交付（批次2）—— 动作式接口，封装级联，禁止裸 PATCH 改状态
POST   /api/projects
PATCH  /api/projects/:id               （仅限非级联字段）
POST   /api/projects/:id/tasks
PATCH  /api/projects/:id/tasks/:taskId （改完后端重算 progress）
POST   /api/projects/:id/apply-template
POST   /api/projects/:id/complete      ⚠️ 原子级联（见上）
POST   /api/projects/:id/complete/undo （30s 内）

# 合同/财务（批次3）
POST   /api/contracts
PATCH  /api/contracts/:id
POST   /api/contracts/:id/attachments
POST   /api/contracts/:id/receivables/:rid/confirm
```

> **设计原则**：凡是带级联的操作，一律做成「动作式」端点（`/complete`、`/convert`、`/confirm`），不暴露能绕过规则的裸字段 PATCH。这样 MCP 工具与真人前端走同一套权威逻辑。

---

## 四、权限契约（把前端的数据范围搬到后端守卫）

当前 `dataScope` / 金额可见性在前端控制（等于未控）。后端化时按角色加路由守卫，**同时补上现有写接口缺角色门的洞**：

| 角色 | dataScope | 关键限制（`constants.ts` ROLE_CAPABILITIES + `rules_v1.md` §10） |
|---|---|---|
| ADMIN | ALL | 全量，含员工/审计 |
| MANAGER | DEPARTMENT | 项目/CRM 全量；**无**员工/审计 |
| CONSULTANT | OWN | 仅自己的；必须能录合同(`CONTRACT_CREATE`)，合同只看自己录的或自己项目关联的 |
| FINANCE | ALL | 看所有合同回款 |

- 合同归档/删除：仅 ADMIN/MANAGER（§10.3）。
- **MCP 服务账号**（`ai-agent`/MANAGER）天然落在此模型内，无需特例。

---

## 五、迁移批次建议（按模块分批，已与用户确认）

```
批次1  线索+客户 CRM    leads/customers 表 + 读写接口 + convert 级联 + dashboard 只读
批次2  项目交付         projects/tasks/work_logs/reminders/knowledge + complete 原子级联
批次3  合同+财务         contracts/settlements + receivables 确认
批次4  情报+审计+战略    signals/audit/strategic + AI 决策
```

每批次内部走完整链路：**后端表+逻辑 → 启用前端 service 开关 → 前端改为后端优先 → 补该批次 MCP 工具**。
只读 MCP 工具可在批次1 的读接口稳定后立即先做（不阻塞）。

---

## 六、迁移不变量（迁移前后必须保持一致的规则）

1. 统一返回包与错误码（`rules_v1.md` §2/§6）。
2. 金额存分、展示两位小数（§4）；日期 `YYYY-MM-DD` / ISO 8601（§5）。
3. 项目进度 = 核心任务完成率（`calculateProjectProgress`）。
4. 项目评级公式（普通 S/A/B、情报 A/B/C）保持不变。
5. 费用关闭校验（T-001）不得削弱。
6. 完成事件 30 秒可撤销、同一事件只提示一次（§9）。
7. DB 命名规则（§7）。

---

## 七、附录：阶段0 收尾抽取的精确规则

### 7.1 客户分级 & 累计额公式（`AppContext.tsx:2911-2956`）

完成项目后，对目标客户重算（口径：仅统计该客户 `status=Completed 且 costStatus=已确认` 的项目）：

```
totalAmount = Σ(已完成且已确认项目.projectAmount) + 本次 projectAmount
yearAmount  = Σ(其中 completionRecord.actualEndDate 属于本年的项目.projectAmount)
              + (本次完成日期在本年 ? 本次 projectAmount : 0)

level = totalAmount >= 100000 ? 'A'
      : totalAmount >=  30000 ? 'B'
      : 'C'
```

同时累加：`cooperationCount +1`、`serviceCount +1`、`lastProjectAt/lastServiceDate = 今天`、
`firstServiceDate`（首次才set）、`lastProjectType`、`nextOpportunity`。
新客户走 `isNewCustomer` 分支初始化（见 7.2）。

> ⚠️ 迁移注意：当前 `projectAmount` 以**元**参与计算，阈值 10万/3万 也是元。后端按 `rules_v1.md` §4 改为**分**存储时，阈值需同步换算为 `10000000 / 3000000`，否则分级错档。

### 7.2 线索 → 客户 字段映射（`completeProject` PDCA 绑定，`:2792-2857`）

查找顺序：① `project.customerId` → ② `contractRef` 前缀 `CUST:<id>` / `LEAD:<id>` → ③ 按 `unifiedSocialCreditCode` 匹配 → ④ 按公司名匹配 → ⑤ 都没有则新建 `C-AUTO-<ts>`。

从 Lead 新建 Customer 的映射：

| Customer 字段 | 来源 Lead 字段 | 备注 |
|---|---|---|
| `name` | `lead.company` | |
| `contactPerson` | `lead.name` | |
| `mobile` / `industry` / `unifiedSocialCreditCode` | 同名 | |
| `registeredAddress` / `registeredCapital` / `businessScope` / `legalRepresentative` | 同名 | 工商字段 |
| `totalValue=0, activeContracts=0, riskStatus='low', status=Active, cooperationCount=0, serviceCount=0` | 初始化 | |

> 这套映射即 `POST /api/leads/:id/convert` 的后端实现依据。

### 7.3 `buildDashboardMetrics` 指标清单（`dashboardMetrics.ts`）

纯函数，输入 `{leads, customers, contracts, projects, projectWorkLogs, settlements, currentUser, activeRole}`，按角色产出 4 套看板（`boss/sales/consultant/finance`），每套含 `topCards/middleCards/bottomCards/listItems`。后端 `GET /api/dashboard/metrics?role=` 直接搬此函数。

关键计算口径（helper）：
- `contractPaidAmount` = 合同内 `status='paid'` 回款之和
- `contractUnpaidOverdueAmount` = 未付且已过 `dueDate` 之和
- `isRevenueProject` = 交付模式 + 已完成（营收口径）
- `isLeadSourcedRevenueProject` = 营收项目且来源为线索（用于转化率）
- `projectCompleteMonthKey` / `isLeadInMonth` = 月度归集（线索按 id 时间戳或 lastContact）

指标项（43 个，按角色分布）：
- **Boss**：本月签约金额、本月已回款、当前在制项目数、项目延误率、大客户占比、回款集中度(Top3)、客户流失预警、可复购客户…
- **Sales**：本月新增线索、本月有效跟进次数、销售/个人转化率(线索→营收项目)、即将成交客户、今日必须联系客户、超过7天未跟进、待报价客户…
- **Consultant**：参与项目数、本周完成任务数、本周工时/日志条数/覆盖率、逾期任务数、即将到期任务、服务进度低于50%项目…
- **Finance**：本月应收/已收、未来30天预计回款、应收超期清单、回款风险金额、未开票项目、合同金额缺失项目、待签合同…

> MCP 只读工具 `get_dashboard_metrics` 直接包此接口，传 `role` 即可。

### 7.4 批次1 Postgres DDL（leads / customers 先行）

遵循 `rules_v1.md` §7（小写下划线、`*_id`、`created_at/updated_at`、`*_amount` 存分、`*_status`）。
结构化高频查询列提为字段，嵌套数组（contacts/follow_up_records/certificates）用 JSONB 暂存，后续批次再视情况拆表。

```sql
CREATE TABLE IF NOT EXISTS leads (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  company                   TEXT NOT NULL,
  lead_status               TEXT NOT NULL DEFAULT 'New',   -- New/Pending/Converted/Risk/Lost
  score                     INTEGER NOT NULL DEFAULT 0,
  potential_value_amount    BIGINT NOT NULL DEFAULT 0,     -- 分
  probability               INTEGER NOT NULL DEFAULT 0,
  intent                    TEXT,                          -- High/Medium/Low
  source                    TEXT,
  industry                  TEXT,
  mobile                    TEXT,
  wechat                    TEXT,
  position                  TEXT,
  target_certifications     TEXT,
  unified_social_credit_code TEXT,
  registered_address        TEXT,
  legal_representative      TEXT,
  registered_capital        TEXT,
  business_scope            TEXT,
  founding_date             DATE,
  operation_status          TEXT,
  company_type              TEXT,
  owner_user_id             TEXT,                          -- 数据范围用
  last_contact              DATE,
  contacts                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  existing_certifications   JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_records         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_leads_owner  ON leads(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_uscc   ON leads(unified_social_credit_code);

CREATE TABLE IF NOT EXISTS customers (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  contact_person            TEXT,
  mobile                    TEXT,
  industry                  TEXT,
  customer_status           TEXT DEFAULT 'Active',
  risk_status               TEXT NOT NULL DEFAULT 'low',   -- low/medium/high
  level                     TEXT,                          -- A/B/C（系统自动评级）
  total_value_amount        BIGINT NOT NULL DEFAULT 0,     -- 分
  total_amount              BIGINT NOT NULL DEFAULT 0,     -- 历史累计消费（分）
  year_amount               BIGINT NOT NULL DEFAULT 0,     -- 当年累计（分）
  active_contracts          INTEGER NOT NULL DEFAULT 0,
  cooperation_count         INTEGER NOT NULL DEFAULT 0,
  service_count             INTEGER NOT NULL DEFAULT 0,
  first_service_date        DATE,
  last_service_date         DATE,
  last_project_at           DATE,
  last_project_type         TEXT,
  next_opportunity          TEXT,
  unified_social_credit_code TEXT,
  registered_address        TEXT,
  legal_representative      TEXT,
  registered_capital        TEXT,
  business_scope            TEXT,
  company_type              TEXT,
  customer_notes            TEXT,
  owner_user_id             TEXT,
  contacts                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  certificates              JSONB NOT NULL DEFAULT '[]'::jsonb,
  existing_certifications   JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_records         JSONB NOT NULL DEFAULT '[]'::jsonb,
  pdca_paid_contract_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_level ON customers(level);
CREATE INDEX IF NOT EXISTS idx_customers_risk  ON customers(risk_status);
CREATE INDEX IF NOT EXISTS idx_customers_uscc  ON customers(unified_social_credit_code);
```

> API 出入参仍按现有 camelCase 类型（`types.ts`）做序列化层映射（DB snake_case ↔ API camelCase），前端/MCP 无感。

---

## 待办（阶段0 收尾）

- [x] 客户分级(level)与累计额(totalAmount/yearAmount)精确公式 → §7.1
- [x] 线索转客户 字段映射明细 → §7.2
- [x] `buildDashboardMetrics` 指标定义清单 → §7.3
- [x] 批次1 Postgres 表 DDL（leads/customers） → §7.4

**阶段0 完成。** 下一步进入批次1（线索+客户 CRM）后端实现。
