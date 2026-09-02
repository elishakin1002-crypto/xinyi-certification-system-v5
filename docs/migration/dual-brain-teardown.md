# 双大脑拆除清单（Dual-Brain Teardown）

> 目标：让**后端成为唯一业务权威**，前端 `AppContext.tsx` 退化为「调 API → 用返回值 setState」的瘦客户端。
> 现状根因：前端每个写操作都是「**本地算完整业务结果 + 更新本地 state + fire-and-forget 推一份给后端**」。
> 后端 hydrate 又把数据拉回来 → 两套规则并存、结果漂移、竞态。旗舰级联更是**连后端都不调**。

统计口径：`AppContext.tsx` 共 ~4600 行。以下按危险度分三档。

> **本轮结论（2026-07-08）**：A 档三大真·漂移点 **A1/A2/A3 全部合并完毕**（均经真实 UI 点击验证），**A5** 死代码清除。**A4 线索转化 defer**——它无匹配的原子后端级联、且现有前端富流程已落库（非活 bug），需专项新建后端级联再做。B/C 档尚未开始。

---

## A 档 — 旗舰原子级联：后端有完整服务，前端却完全自己算（最高危，先拆）

这几个是「convert / complete / confirm」三大原子级联。后端 `server/services/` 里有正确的事务版，但前端**没有一次 `fetch`/service 调用**，整套结果本地算。**必须优先拆**，否则前后端算出的回款、结算、评级会不一致。

| # | 前端函数（位置） | 本地代码量 | 后端应调的接口 / 服务 | 前端客户端现状 | 改法 |
|---|---|---|---|---|---|
| ✅ A1 **已完成** | `completeProject` (`AppContext.tsx`) | 极大 | `POST /api/projects/:id/complete` → `services/completeProject.js`（含完成记录/评级/回款/**结算草稿自动生成**） | 已新增 `projectService.complete(id, opts)` | 已完成：新增 `projectService.complete`；本体改名 `completeProjectLocal`（仅写开关关闭时回退）；新增 async 权威版 `completeProject` = 写开关开→调后端+`refreshAfterProjectCompletion()` 重拉 projects/customers/reminders/settlements/knowledge；4 处调用点加 `await`。**浏览器实测通过**：UI 点「标记完成」→ 仅一条 `POST …/complete`；知识 14→15（新 PDCA）、结算草稿 +¥500、项目 Completed、客户自动绑定；顾问结算页免刷新即显示 ¥500 草稿。 |
| ✅ A2 **已完成** | `convertSignalToFollowUpProject` | 大 | `POST /api/signals/:id/convert` → `services/convertSignal.js` | 已新增 `signalService.convert(id, {manager})` | 已完成：新增 `signalService.convert`；本体改名 `...Local`（写开关关闭时回退）；async 权威版委托后端 + 刷新 projects/signals + 补建「情报已转化」提醒；2 处调用点（AIChatWidget/IntelRadar）加 await/void。**浏览器实测通过**：UI 点「一键生成跟进项目」→ 仅一条 `POST …/convert`；P-INTEL 项目 3→4、已转化情报 2→3；按钮即时置灰并显示「已转化为项目：P-INTEL-…」。 |
| ✅ A3 **已完成** | `toggleReceivableStatus` + `rejectReceivable` | 中 | `POST /api/contracts/:id/receivables/:rid/confirm` → `services/confirmReceivable.js` | 已新增 `contractService.confirmReceivable` | 已完成：新增 `contractService.confirmReceivable`；`toggleReceivableStatus` 本体改名 `...Local`，async 权威版委托后端 + 刷新 contracts/projects/customers/knowledge（接口仍 `=>void`，4 处 fire-and-forget 调用点无需改）；`rejectReceivable` 无专用后端 → 改经合同 PATCH 落库（消除纯本地态）。**浏览器实测通过**：UI 点「确认到账」→ 仅一条 `POST …/confirm`；已到账 10→11 笔、¥168,500→¥173,500；顶部卡片（到账率/待收/逾期）免刷新同步更新。 |
| ⚠️ A4 **需后端工作（未做）** | 线索转化：`createFollowUpProjectFromLead`（线索→跟进项目）/「从线索建合同」富流程（合同+客户+项目+线索转 Converted，经 `commitTransaction` raw-upsert） | 中 | ❌ **无匹配的原子后端级联**。现有 `POST /api/leads/:id/convert` 只做「线索→客户」瘦转化，且**无 UI 触发点**，与前端两条富流程都不 1:1 | `leadService` 有 create/update | **不是 drop-in**：需先在后端新建级联服务（如 `convertLeadToProject` / `createContractFromLead`，仿 `completeProject.js`），前端才能委托。属较大工作，待决策后再做。 |
| ✅ A5 **已完成** | `generateProjectSettlement` | 中 | 已废弃：结算草稿由 A1 的 complete 级联在后端自动生成 | — | 已完成：该函数无任何调用点，且仅本地 setState 不落库（会漂移）。已删除定义 + 接口声明 + value 导出三处；tsc 通过；顾问结算页正常渲染（A1 自动草稿仍在）。 |

> A 档拆完，`AppContext.tsx` 预计减少 **900–1100 行**，且三大级联的结果从此只有一个来源。

---

## B 档 — 简单写操作：已「本地算 + fire-and-forget 同步」（会漂移，次高危）

这些**已经**在调 service，但模式是「先本地算好、setState，再 `service.xxx().catch(warn)`」。问题：① 后端失败只打 warn，用户以为成功；② 本地算的字段（id、时间戳、派生值）和后端可能不一致。改法统一为 **`await` 后端 → 用返回的规范化对象 setState**，失败要回滚/提示。

| 前端函数 | 位置 | 已调用的 service | 后端接口 |
|---|---|---|---|
| `addProject` | `:2019` | `projectService.createProject` | `POST /api/projects` |
| `assignProjectManager` / `updateProject*` | `:2060` `:3270` | `projectService.updateProject` | `PATCH /api/projects/:id` |
| `addProjectTask` | `:2619` | `projectService.addTask` | `POST /api/projects/:id/tasks` |
| `addLead` / `updateLead` / `addLeadFollowUp` | `:3322/3345/3373` | `leadService.*` | `POST /api/leads`, `PATCH`, `/follow-ups` |
| `addCustomer` / `addCustomerFollowUp` / `updateCustomer` | `:3398/3426/4575` | `customerService.*` | `POST /api/customers`, `/follow-ups`, `PATCH` |
| `updateSettlementStatus` | `:4135` | `settlementService.updateStatus` | `PATCH /api/settlements/:id` |
| `addKnowledgeDoc` / `updateKnowledgeDoc` | `:718/4149` | `knowledgeService.*` | `POST/PATCH /api/knowledge` |
| `addReminder` / `dismissReminder` | `:1002` | `reminderService.*` | `POST/PATCH /api/reminders` |
| `upsertMarketSignals` / `updateMarketSignal` | `:1244` | `signalService.*` | `POST /api/signals/bulk`, `PATCH` |
| 合同增改 / receivable 结构 | — | `contractService.*` | `POST /api/contracts`, `/transaction`, `PATCH` |

> B 档不删函数，只把「本地先算」改成「后端返回为准」。工作量小但项数多，逐个改。

---

## C 档 — 后端有存储、但业务流程未接（孤岛，拆双大脑时一并接上）

| 模块 | 后端现状 | 缺口 | 建议 |
|---|---|---|---|
| 不符合项 `addAuditIssue/updateAuditIssue` | ✅ 有 CRUD `mount('audit-issues', ...)` + `syncRectificationTask`（`batch4.js:43`） | **不 gate 项目完成**；前端 `addAuditIssue` 仍本地算 | ① 前端接 `/api/audit-issues`；② 在 A1 的 `completeProject.js` 里加校验：有未关闭 MAJOR 时拒绝/警示 |
| 战略任务 `runDeepAnalysis` / `generateStrategicTasks` | ✅ 有 CRUD `mount('strategic-tasks', ...)`（`batch4.js:44`） | SWOT/洞察是**纯前端调 AI**（`:4219/4233`），结果没落库、不可复现 | 把 AI 洞察生成挪到后端或至少把结果 upsert 到 `strategic-tasks`，前端只读 |
| 知识库 RAG | ⚠️ 后端**无 embedding/向量检索**（全库 grep 无 `embedding/vector/cosine/pgvector`） | 「RAG Ready / AI 读取权限」是标签，AI 问答**不会真检索文档** | 二选一：接 pgvector 真检索（PG 已就位）／把标签改诚实，避免误导 |

---

## 推荐执行顺序

1. **A1 completeProject**（收益最大、风险最高，一个函数消掉 ~370 行双写）
2. A2 → A3 → A4 → A5（其余级联，同一套「新增 service 方法 + 删本地 + 用返回值」模式）
3. C 档的 audit gating（顺手接进 A1 的后端校验）
4. B 档批量收尾（本地先算 → 后端为准）
5. C 档 RAG / 战略落库（独立较大，可另立项）

## 每项的统一改造模式（模板）

```ts
// 改造前（双大脑）：本地算 + 可能 fire-and-forget
const nextX = /* 本地把业务结果算一遍 */;
setX(nextX);
xService.doThing(id).catch(warn);        // 后端只是被动镜像

// 改造后（单一权威）：后端算，前端只反映
const res = await xService.doThing(id, payload);   // 后端事务级联
if (!res.ok) { /* 提示 + 不改本地 state */ return res; }
applyServerState(res.data);                        // 用后端返回的规范化对象 setState
```

## 验证口径（拆完必须做）
- 浏览器真跑一遍主闭环：线索转化→合同→完成项目→**看回款&结算草稿自动出现**→确认到账。
- 幂等：连点两次「完成项目」不得重复生成回款/结算。
- 关掉某个 `VITE_*_WRITE_ENABLED` 时前端应明确报「后端未就绪」，而非静默本地写。
