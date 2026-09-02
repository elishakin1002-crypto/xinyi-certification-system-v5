# 身份 / 数据 / 权限 / 责任 四层机制审查（v2）

> 审查日期：2026-08-20
> 目的：判断现有架构能否安全承接 AI Agent 接入
> 原则：**不推翻现有业务架构，尽量少改动**
>
> v2 相对 v1 的升级：权限从「角色 + 动作码」升级为**资源级授权**；
> AI 从「统一入队」升级为 **L0–L4 分级**；责任从「事件流」升级为**完整 Action Ledger**。

---

## 一句话结论

**服务端没有任何授权边界。** 不只是「缺角色校验」——是连「你只能看自己的数据」都由客户端说了算。

铁证两条：

```
server/routes/batch1.js:46
  leadRepo.list({ ownerUserId: req.query.owner })   ← 归属过滤来自 URL 参数
```
改一下 `?owner=` 就能看全部 455 条线索。**「数据范围」是客户端自愿遵守的约定，不是约束。**

```
auth_audit_logs 表在 PG 中不存在
```
它写在 `authStore.js` 的 `CREATE TABLE IF NOT EXISTS` 里，但 authStore 用的是未设置的 `DATABASE_URL` → 一直文件模式 → **表从没被创建过，审计日志 0 条**。

---

## 一、权限层：升级为资源级服务端授权

### 现状盘点

| 能力 | 现状 | 可复用性 |
|---|---|---|
| Identity（谁） | ✅ session + `x-xinyi-on-behalf-of` | **直接复用** |
| Action（什么动作） | ✅ 9 个动作码 × 6 角色矩阵 | **直接复用** |
| Scope（数据范围） | 🔶 `dataScope: ALL/DEPARTMENT/OWN/NONE` **已定义但服务端从不读取** | **定义复用，执行缺失** |
| Resource（哪条数据） | ❌ 完全没有 | 需新增 |
| Condition（什么条件） | ❌ 完全没有 | 需新增 |
| 服务端执行 | ❌ 30 个写接口 0 处校验；读接口 0 处范围过滤 | 需新增 |

**好消息**：四要素里前两个已就绪，第三个已有定义只差执行。真正从零开始的只有 Resource 和 Condition。

### 设计：一个授权函数，四要素齐备

```ts
// server/authz/authorize.js（新增，约 120 行）
authorize({
  identity,          // req.authUser（含 onBehalfOf）
  action,            // 'CONTRACT_VIEW_AMOUNT'
  resource,          // { type:'contract', id, ownerUserId, customerId, amount }
  condition,         // { amountFen, sensitivity, businessType }
}) => { allow: boolean, policy: string, reason: string }
```

判定顺序（**先拒后允**，任一步拒绝即终止）：

1. **账号状态** —— 停用 / 过期（`accountExpiresAt`）直接拒
2. **`deniedActions`** —— 显式拒绝优先级最高（已有字段）
3. **动作码** —— `ROLE_CAPABILITIES.actions` + `extraActions`（已有）
4. **数据范围** —— 按 `dataScope` 决定能碰哪些行（已有定义，新增执行）
5. **条件约束** —— 金额上限 / 敏感度 / 业务类型（新增）
6. **AI 分级** —— 见第二节

返回值带 `policy` 字段（命中哪条规则），**直接写进 Ledger**，这样每条记录都能回答「凭什么允许/拒绝」。

### Scope 的服务端执行（关键改动）

不再信任 `req.query.owner`，改由服务端**注入**过滤条件：

```js
// 读接口
const scope = resolveScope(req.authUser, 'lead');
//  ALL        → 不加条件
//  DEPARTMENT → owner_user_id IN (同部门成员)
//  OWN        → owner_user_id = 自己
//  NONE       → 直接返回空
const leads = await leadRepo.list({ ...req.query, _scopeFilter: scope });
```

**关键**：`_scopeFilter` 由中间件写入，**忽略并覆盖客户端传的任何 owner 参数**。客户端能做的只是在允许范围内进一步收窄。

repo 层改动很小——`leadRepo.list` 已经支持 `ownerUserId` 过滤，只是把来源从 query 换成 scope。

### 需要新增的动作码（4 个）

`LEAD_CREATE`、`SETTLEMENT_MANAGE`、`KNOWLEDGE_WRITE`、`REMINDER_WRITE`。其余复用现有 9 个。

### 需要新增的条件（3 类）

| 条件 | 用途 | 存储 |
|---|---|---|
| `maxAmountFen` | 金额上限（如销售只能确认 5 万以下） | 角色能力表新增字段 |
| `sensitivity` | 数据敏感度（客户经营数据 / 合规记录） | 资源自身字段 |
| `businessType` | 业务类型（体系 / 生产许可 / 台账） | 已有 `projectCategory` |

---

## 二、AI 权限：L0–L4 分级（替代「统一入队」）

v1 的「AI 一律入队」太粗——**读个客户名也要人确认，人会烦到关掉这个功能**；而改金额只要求确认一次，风险又不够。

### 分级定义

| 级别 | 含义 | AI 能做什么 | 典型动作 |
|---|---|---|---|
| **L0** | 禁止 | 完全不可见、不可调用 | 员工薪酬、密码、结算提成明细 |
| **L1** | 只读 | 可读取，不可写 | 客户基本信息、项目进度、知识库 |
| **L2** | 建议 | 产出建议，**不落库**，仅展示给人 | 风险诊断、线索评分 |
| **L3** | 待确认 | 写入提案队列，人批准后执行 | 补任务、改截止日、生成整改方案 |
| **L4** | 自主 | 直接执行 + 写 Ledger | 生成摘要、打标签、拉取情报 |

### 分级怎么定：动作 × 条件

级别不是固定在动作上，而是**动作 + 条件共同决定**：

```js
// server/authz/aiPolicy.js（新增，约 80 行）
{
  action: 'PAYMENT_CONFIRM',
  baseLevel: 'L0',                          // 金额确认，AI 一律禁止
},
{
  action: 'PROJECT_EDIT_INFO',
  baseLevel: 'L3',
  downgradeWhen: [                          // 满足条件时降级（更严）
    { if: 'resource.amountFen > 5000000', to: 'L0' },   // 5 万以上不许碰
  ],
},
{
  action: 'KNOWLEDGE_WRITE',
  baseLevel: 'L4',
  downgradeWhen: [
    { if: 'resource.sensitivity === "confidential"', to: 'L0' },
  ],
},
```

**只允许降级，不允许升级**——配置写错最多是更严，不会意外放开。

### 与现有机制的对应

| 级别 | 复用什么 | 需新增 |
|---|---|---|
| L0 | `deniedActions`（已有字段） | 无 |
| L1 | 授权函数返回 read-only | 无 |
| L2 | 前端展示，不落库 | 无 |
| L3 | **`ai_proposals` 队列（已建好并跑通）** | 无 |
| L4 | 直接执行 + Ledger | 无 |

**L0–L4 全部可以用已有机制实现，零新增表。** 只需一份策略配置 + 授权函数里加一个分支。

---

## 三、责任层：完整 Action Ledger

### 现有三表能覆盖多少

| Ledger 字段 | `business_events` | `ai_proposals` | 缺口 |
|---|---|---|---|
| `actor` | ✅ `actor_user_id/name` | ✅ `decided_by` | — |
| `onBehalfOf` | ✅ `on_behalf_of` + `via_ai_agent` | 🔶 | — |
| `resource` | ✅ `subject_type` + `subject_id` | ✅ `source_ref` | — |
| `action` | ✅ `event_type` | ✅ `action` (jsonb) | — |
| `reason` | ✅ `reason` | ✅ `reason` / `reject_reason` | — |
| `timestamp` | ✅ `occurred_at` | ✅ `created_at` | — |
| `before` / `after` | 🔶 塞在 `detail` 里，无约定 | ❌ | **需规范化** |
| `policy` | ❌ | ❌ | **需新增** |
| `approver` | ❌ | ✅ `decided_by` | **需新增** |
| `result` | ❌ | ✅ `executed_at`/`execute_error` | **需新增** |

**结论：`business_events` 已覆盖 6/10，补 4 列即可，不需要新表。**

```sql
ALTER TABLE business_events
  ADD COLUMN IF NOT EXISTS policy      text,        -- 命中的授权规则，回答「凭什么允许」
  ADD COLUMN IF NOT EXISTS approver    text,        -- L3 场景下的批准人
  ADD COLUMN IF NOT EXISTS result      text NOT NULL DEFAULT 'success',  -- success/failed/denied
  ADD COLUMN IF NOT EXISTS ai_level    text;        -- 本次判定的 L0-L4
-- before/after 约定放进已有的 detail：{ "before": {...}, "after": {...} }
```

**同时要记「被拒绝」的操作。** 现在只记成功的动作，但 `result='denied'` 才是安全审计最该看的——谁试图越权、被哪条策略挡下。

### 追加式（不可随意改删）

现状：`business_events` 的 repo **只有 INSERT，没有 UPDATE/DELETE**（已核实 0 处），设计上已经是追加式，但**没有数据库层强制**。

最简加固（不引入新组件）：

```sql
-- 用触发器挡掉 UPDATE / DELETE，比靠代码自律可靠
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '责任记录只能追加，不能修改或删除（表 %）', TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_business_events_append_only
  BEFORE UPDATE OR DELETE ON business_events
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
```

⚠️ **注意**：加了这个触发器后，迁移脚本也改不动这张表。所以**先补完 4 个列，再加触发器**。

`ai_proposals` 有 2 处 UPDATE（批准/驳回、执行留痕），**不能设为追加式**——它是状态机不是账本。责任记录由它触发写入 `business_events`，账本本身保持只追加。

---

## 四、需要改什么（汇总）

| # | 改动 | 新增表 | 新增字段 | 代码量 | 风险 |
|---|---|---|---|---|---|
| 1 | `business_events` 补 4 列 + 追加式触发器 | 0 | 4 | 1 个迁移 | 极低 |
| 2 | 关键动作打点（含被拒绝的） | 0 | 0 | ~10 处 `record()` | 极低 |
| 3 | 授权函数 `authorize()` | 0 | 0 | ~120 行 | 低（先只记录不拦截） |
| 4 | Scope 服务端注入（覆盖客户端参数） | 0 | 0 | ~40 行 + repo 小改 | **中（会改变可见数据）** |
| 5 | 30 个写接口挂授权中间件 | 0 | 0 | 30 处一行 | 低 |
| 6 | AI 分级策略配置 | 0 | 1（`ai_level`） | ~80 行配置 | 低 |
| 7 | 新增 4 个动作码 + 3 类条件 | 0 | 1（`maxAmountFen`） | 配置 | 低 |
| 8 | 员工账号迁 PG | **1** | 0 | repo + 迁移 | **中（影响登录）** |

**总计：新增 1 张表、6 个字段、4 个动作码。** 现有 15 张业务表、权限矩阵、前端逻辑全部不动。

---

## 五、第一阶段执行记录（2026-08-20 已完成）

### 已打点的动作（6 处）

| 事件类型 | 触发点 | 记录了什么 |
|---|---|---|
| `receivable.confirmed` / `.unconfirmed` | `confirmReceivable` | 金额、变更前后、三项级联（全额到账/客户升级/PDCA） |
| `project.completed` | `completeProject` | 评级、工期、任务完成率 + 六项级联产物 id |
| `settlement.created` | 同上（单独一条） | 受益人、金额、提成规则 |
| `contract.amount_changed` | `PATCH /api/contracts/:id` | 改前改后金额 + 差额，**只在金额真变时记** |
| `auth.*` | `recordAuthAuditLog`（双写） | 权限变更：谁给谁开了什么 |
| `ai_proposal.approved/rejected/executed` | 提案队列 | 含 `approver`（与 actor 分开）、执行成败 |
| `*.denied` | `recordDenied()` | 越权尝试：谁、什么动作、被哪条策略挡下 |

### 关键设计决策

**「批准」和「执行成功」分成两条记录。** 批了但执行失败必须能查出来，否则会以为 AI 已经把事办了。

**合同修改只在金额真变时记账。** 改个联系人也刷进账本，会把真正重要的金额变动淹掉。

**权限变更用双写而不是改造 authStore。** `appendAuthAuditLog` 落在 JSON 文件（`DATABASE_URL` 未配置，`auth_audit_logs` 表压根没建过）。改 authStore 会牵扯登录链路，风险不对等；双写让权限变更进了可查询、不可篡改的账本，登录链路一行没动。

### 实测验证

```
UPDATE business_events → ✓ 被数据库挡下
DELETE business_events → ✓ 被数据库挡下（连清理测试数据也删不掉）

回款确认实测：
  摘要   : 确认到账「签订合同时」¥6,000
  操作人 : 系统管理员 (U-AUTH-ADMIN)
  变更前 : {"status":"overdue","projectPaymentStatus":"overdue"}
  变更后 : {"status":"paid","projectPaymentStatus":"paid"}
  级联   : {"allPaid":true,"customerLeveledUp":true,"pdcaDocId":"DOC-PDCA-..."}

越权尝试实测：
  PAYMENT_CONFIRM.denied  denied  L0  ai.L0:PAYMENT_CONFIRM
```

测试操作已还原（状态、客户分级、PDCA 文档），**但两条 Ledger 记录都保留**——
追加式账本不抹掉做过的事，用新记录说明订正。

### 一处技术更正

原文说「加了触发器后迁移脚本也改不动这张表」——**不准确**。
触发器是 `FOR EACH ROW`，只拦数据行的 UPDATE/DELETE，**不影响 `ALTER TABLE`**。
所以将来仍可加列，但不能回填历史数据。这恰好是想要的：结构可扩展，内容不可篡改。

---

## 六、推荐实施顺序

**第一阶段：先能看见（零风险，且事件不可补录）**
1. `business_events` 补 4 列
2. 关键动作打点，含 `result='denied'`
3. 加追加式触发器（必须在补完列之后）

**第二阶段：先记录不拦截（观察一周）**
4. 写 `authorize()` 函数
5. 挂到 30 个写接口，但**只记 Ledger、一律放行**
6. 一周后看 Ledger 里有多少 `denied` —— **这批就是真实的越权尝试和误配规则**，据此调整策略再打开拦截

**第三阶段：收紧（有观察数据支撑）**
7. 打开写接口拦截
8. Scope 服务端注入（读接口）—— 这一步会改变各角色看到的数据量，需要和你确认口径
9. AI 分级策略上线

**第四阶段：补身份底座**
10. 员工账号迁 PG（与 P0-20 建真实账号一起做，需你在场验证登录）

**在第三阶段完成前，不要开放 AI Agent 的写权限。** L1（只读）可以先行，但读接口的 Scope 注入必须先做完——否则 AI 一次查询就能拿到全部客户数据。

---

## 七、业务方已确认的口径（2026-08-20）

### 1. 数据范围：读写必须分开

> 销售可以看全部客户，但只能修改自己的；顾问可以看全部项目进度，但只能修改自己参与的任务。

**这条推翻了原设计里的单一 `dataScope`。** 必须拆成两个：

```ts
readScope:  'ALL' | 'DEPARTMENT' | 'OWN' | 'NONE'
writeScope: 'ALL' | 'DEPARTMENT' | 'OWN' | 'NONE'
```

| 角色 | 读 | 写 |
|---|---|---|
| 销售 SALES | 客户 `ALL` | 客户 `OWN`（自己名下的） |
| 咨询顾问 CONSULTANT | 项目 `ALL` | 任务 `OWN`（自己参与的） |
| 财务 FINANCE | `ALL` | 回款/结算 `ALL` |
| 老板 ADMIN / 系统管理员 | `ALL` | `ALL` |

「自己参与的任务」判定沿用已有的 `isMineProject` 口径：**负责人 或 服务项负责人 或 有任务分配**——不是只看 `ownerUserId`（那个口径会漏掉多顾问协作的项目，之前踩过）。

### 2. 金额门槛：三档

| 金额 | AI 权限 | 说明 |
|---|---|---|
| **≤ 1 万元** | **L4 自主** | 以当前对话中的明确指令作为批准，执行后写 Ledger |
| **1 万 – 5 万元** | **L3 待确认** | 进提案队列，人批准后执行 |
| **> 5 万元** | **L2 仅建议** | AI 只给建议，不进队列也不执行 |

注意 L4 那档的前提是「**当前对话中的明确指令**」——不是 AI 自己想做就做。
实现上要求调用时带上触发指令原文，写进 Ledger 的 `reason`，
这样事后能看出这次自主执行是基于谁的哪句话。

### 3. L0 清单（AI 完全不可见/不可调用）

- 凭证（发票、付款凭证）
- 工资、提成明细
- 身份信息（身份证、银行卡等）
- 权限变更
- 硬删除

**客户经营数据不整体设 L0**，改为**按 AI 当前代表的人判定，最高 L1 只读**：
AI 代表财务时能读、代表兼职时读不到。这正好用上已有的 `x-xinyi-on-behalf-of`——
**AI 能看到什么，取决于它此刻代表谁**，而不是给 AI 一套独立的权限。

---

## 八、原「待确认」清单（已全部确认，保留备查）

1. **各角色的数据范围口径** —— 销售能看全部客户还是只看自己的？（已有 `VITE_CUSTOMER_VISIBILITY` 开关，但服务端没执行）
2. **金额条件的阈值** —— 多少金额以上的操作 AI 一律禁止？谁能确认多大金额的回款？
3. **哪些数据算 L0（AI 完全不可见）** —— 我的建议是：员工薪酬、结算提成明细、客户经营数据。需要你确认。
