# 信义系统「前端→后端 + MCP」总迁移进度

> 目标：让 openclaw/Hermes 经 MCP 调用并使用系统全部功能。
> 路线：先把业务逻辑/真相源迁到后端（建立稳定 API 契约 = MCP 契约），再包 MCP；前端切换放最后。
> 约束：不改原 UI 布局 / demo / 字段名（仅在最后阶段换前端数据源）。

## 每模块两半进度

| 模块 | 后端真相源(PG)+逻辑 | 前端切后端 | MCP 只读工具 | MCP 写工具 |
|---|---|---|---|---|
| 线索 leads | ✅ 批次1 | ✅ 灰度(读写→PG) | ✅ | ✅（create/update/followup/convert） |
| 客户 customers | ✅ 批次1（含 convert 级联） | ✅ 灰度(读写→PG) | ✅ | ✅（create/update/followup） |
| 项目 projects | ✅ 批次2（含 completeProject 原子级联） | ✅ 灰度(读写→PG，/transaction 已路由 PG) | ✅ | ✅（create/update/task/complete） |
| 合同 contracts | ✅ 批次3（含回款确认级联） | ✅ 灰度(读写→PG，/transaction 已路由 PG) | ✅ | ✅（create/update/attachment/confirm_receivable） |
| 财务 settlements | ✅ 批次3 | ✅ 灰度(读写→PG) | ✅(list) | ✅（create_settlement） |
| 知识库 knowledge | ✅ 批次2（PG，含级联PDCA） | ✅ 灰度(读写→PG) | ⬜ | — |
| 情报 market_signals | ✅ 批次4（328 条迁移） | ✅ 灰度(读写→PG) | ✅ list/get_intel_latest | ✅ update_market_signal |
| 审计 audit_issues | ✅ 批次4 | ⬜ | ✅ list | ✅ create/update_audit_issue |
| 战略 strategic_tasks | ✅ 批次4 | ⬜ | ✅ list | ✅ create/update_strategic_task |
| 看板 dashboard | ✅（buildDashboardMetrics 经 esbuild 复用到后端） | ⬜ | ✅ get_dashboard_metrics | — |

## 推荐执行顺序（已与用户确认）

1. ✅ **补 batch1/2 写工具**（线索/客户/项目，共 12 个，MCP 共 21 工具）— 已完成，端到端验证通过
2. ✅ **批次3 后端（合同+财务）+ 读/写工具** — 已完成，回款确认级联验证通过。MCP 共 27 工具。
   - 注：completeProject 仍读 legacy 合同（getStateBatch），可后续改为读 PG contractRepo（小优化）。
3. ✅ **批次4 后端（情报/审计/战略）+ 工具** — 已完成。MCP 共 35 工具。
4. ✅ **dashboard 指标后端化 + 只读工具** — 已完成。`buildDashboardMetrics` 用 esbuild 打成 `server/generated/dashboardMetrics.cjs`（零重写复用），`GET /api/dashboard/metrics` + `get_dashboard_metrics`。MCP 共 36 工具。
   - 重新生成产物：`npm run build:metrics`。工作日志暂从 legacy 读。
5. 🔨 **前端切后端（灰度，按模块读写一起切）** — 进行中
   - ✅ 线索+客户：`.env.local` 开 `VITE_LEADS_API_ENABLED/READ` + `VITE_CUSTOMERS_API_ENABLED/READ`，读写都到 PG，已验证读写同源。删这 4 行即回退。
   - ✅ 项目+合同：开 `VITE_PROJECTS_API_READ/WRITE_ENABLED` + `VITE_CONTRACTS_API_READ/WRITE_ENABLED`。前端这两模块的写走 `/transaction`，已新增 PG 路由（`server/services/txUpsert.js`，幂等 upsert）。四模块前端读 PG 已验证（计数对齐）。
   - ✅ 情报：新建 `services/signalService.ts` + `_factory` upsert + `/api/signals/bulk`，读写→PG，已验证（真人与 Agent 共享情报）。
   - ✅ 知识库：新建 `services/knowledgeService.ts` + `server/routes/knowledge.js`（GET/POST/PATCH/DELETE），读写→PG，已验证（真人可见 Agent 级联生成的 PDCA 文档）。
   - ✅ 结算：新建 `services/settlementService.ts` + `/api/settlements` PATCH/bulk，读写→PG，已验证。
   - ⬜ 剩余：审计/战略前端（数据为空，暂不切）；看板 Dashboard **不切**（实时本地计算且数据已 PG 来源，切会降级）。
   - 已知事项：① `/transaction` 为整批 upsert，前端删除项不会从 PG 删（upsert-only，留存陈旧；低频可接受）；② 完成项目/确认回款存在前端与后端两套级联实现（前端用于 UI 的 transaction、后端用于 MCP），均为同逻辑移植，需保持同步。

## 🎉 后端 + MCP 全部完成
除前端切换外，所有业务模块（线索/客户/项目/合同/结算/情报/审计/战略/看板）的后端真相源 + MCP 工具（36 个）均已就绪并验证。

> 已迁数据：批次1 458线索+16客户；批次2 36项目+304提醒+14文档；批次3 15合同+3结算；批次4 328情报。

## 过渡期风险（务必知晓）
第 5 步完成前：**前端(真人) 写 localStorage、Agent 写 PG，两套数据并存**。开发/灰度可接受，**正式上线前必须先完成第 5 步**。

## 关键文档
- 盘点与契约：`phase0-inventory.md`
- 批次1：`batch1-status.md`　批次2：`batch2-status.md`
- MCP server：`~/xinyi-mcp/README.md`
