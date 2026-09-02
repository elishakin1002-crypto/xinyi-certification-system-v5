# 批次3（合同+财务）后端进度

## 已完成 ✅（纯后端，未碰前端）

| 项 | 文件 |
|---|---|
| PG 表 | `db/init/003_batch3_contracts.sql`：contracts、settlements |
| repo | `server/repos/contractRepo.js`（CRUD+addAttachment）、`settlementRepo.js` |
| 回款确认级联 | `server/services/confirmReceivable.js`：切换回款→重算项目 paymentStatus→全额时客户分级/累计额/pdcaPaidContractIds + PDCA 文档，单事务 |
| 路由 | `server/routes/batch3.js`：合同 CRUD+附件+`receivables/:rid/confirm`、结算 list/create；DB 未配自动回退 |
| 挂载 | `server/app.js`：`app.use(batch3Router)`，`/api/settlements` 纳入受保护路径 |
| 迁移 | `scripts/batch3-migrate.mjs`：已迁 15 合同 + 3 结算 |
| MCP 工具 | 读 list_settlements；写 create_contract/update_contract/add_contract_attachment/confirm_receivable/create_settlement（MCP 共 27 工具） |

### 验证（HTTP 端到端全绿）
- 合同 amount 8万元 → DB 800万分；API 返回元。
- 确认回款：allPaid→项目 paymentStatus=paid；客户 level=B/totalAmount=8万/pdcaPaidContractIds 记账；PDCA 文档生成。
- 二次确认正确撤销（回款回退 unpaid/overdue，allPaid=false）。
- 评级阈值沿用元（10万/3万），与 repo 边界一致。

## 接口
```
GET   /api/contracts   /api/contracts/:id
POST  /api/contracts
PATCH /api/contracts/:id
POST  /api/contracts/:id/attachments
POST  /api/contracts/:id/receivables/:rid/confirm   ⚠️ 级联（项目付款状态/客户分级/PDCA）
GET   /api/settlements
POST  /api/settlements
```

## 已知事项
- `completeProject` 仍通过 `getStateBatch` 读 legacy 合同（用于费用门提示/PDCA上下文）；现合同已在 PG，可改读 `contractRepo`（小优化，不影响正确性）。
- 合同归档/删除的角色限制（rules §10.3：仅 ADMIN/MANAGER）尚未加路由守卫，待权限统一时补。
- 结算自动生成（generateProjectSettlement）未接入；当前仅手动 create_settlement。
- `/api/contracts/transaction`（前端旧批量写）仍走 legacy。
