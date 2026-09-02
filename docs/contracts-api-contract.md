# 合同后端 API 契约

## 目标

合同模块后端化继续使用渐进迁移方式：后端 API 继续读写现有 `contracts_v8` 数据集；前端通过读写灰度和事务写入接入，不改变当前 UI、DOM、demo 结构和业务字段。

本阶段不提供删除合同、删除附件等破坏性接口。此类能力需要单独说明影响范围并确认后再做。

## 数据边界

- 数据集：`contracts_v8`
- 返回对象：保持当前 `Contract` 形状
- 不新增、不重命名、不删除现有业务字段
- 更新操作为浅合并，`id` 以 URL 参数为准，不允许通过 body 改写

## 接口

### `GET /api/contracts`

返回全部合同：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {
    "contracts": []
  }
}
```

### `GET /api/contracts/:id`

返回单个合同；不存在时返回 `404`。

### `POST /api/contracts`

创建合同。推荐请求格式：

```json
{
  "contract": {
    "title": "ISO 9001 认证服务合同",
    "customerId": "C-001",
    "customerName": "客户名称",
    "amount": 98000,
    "signDate": "2026-05-09",
    "serviceLine": "ISO 9001"
  }
}
```

创建默认值与当前合同录入流程兼容：

- `status=Active`
- `riskLevel=Low`
- `archiveStatus=active`
- `receivables=[]`
- `attachments=[]`
- `serviceItems=[]`

### `PATCH /api/contracts/:id`

更新合同。推荐请求格式：

```json
{
  "contract": {
    "title": "ISO 9001 认证服务合同-已编辑",
    "riskLevel": "Medium"
  }
}
```

不存在时返回 `404`。

### `POST /api/contracts/:id/attachments`

追加合同附件元数据。推荐请求格式：

```json
{
  "attachment": {
    "name": "补充协议.pdf",
    "size": "8 KB",
    "type": "application/pdf",
    "uploadDate": "2026-05-10"
  }
}
```

后端会生成 `attachment.id`，并追加到 `contract.attachments`。

### `POST /api/contracts/transaction`

提交合同录入引发的多数据集联动结果。该接口用于后续前端写入灰度，避免只保存合同、遗漏自动客户、自动项目或线索转化状态。

只允许写入以下数据集：

- `contracts_v8`
- `customers_v8`
- `projects_v8`
- `leads_v8`
- `knowledge_docs_v8`

请求格式：

```json
{
  "contractId": "CT-001",
  "datasets": {
    "contracts_v8": [],
    "customers_v8": [],
    "projects_v8": [],
    "leads_v8": [],
    "knowledge_docs_v8": []
  }
}
```

规则：

- `contracts_v8` 必须存在且必须是数组
- `contractId` 可选；传入时必须能在 `contracts_v8` 中找到
- 不在允许列表内的数据集会被忽略
- PostgreSQL 模式下由 `upsertStateBatch` 在一个数据库事务内写入
- 文件模式下会在一次文件写入中保存本批次数据

## 鉴权

`/api/contracts` 属于受保护 API：

- 测试/预发/生产应开启 `XINYI_API_AUTH_REQUIRED` 或 `XINYI_SESSION_AUTH_REQUIRED`
- 自动化任务可继续使用 API token
- 员工登录模式下可通过 HttpOnly session 访问

## 前端灰度开关

默认值为 `0`，不会改变现有合同页面的数据来源与演示行为。

| 环境变量 | 作用 |
|---|---|
| `VITE_CONTRACTS_API_READ_ENABLED` | 页面启动时从 `GET /api/contracts` 读取合同数据 |
| `VITE_CONTRACTS_API_WRITE_ENABLED` | 合同录入、归档、客户绑定、附件追加、回款状态切换完成本地联动计算后，通过 `POST /api/contracts/transaction` 一次性提交联动数据集 |
| `VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED` | 写入后读取 `contracts_v8`、`customers_v8`、`projects_v8`、`leads_v8`、`knowledge_docs_v8` 校验；失败时回滚前端状态 |

合同写入灰度默认关闭。打开后，前端会先保留当前本地联动计算，再把 `contracts_v8`、`customers_v8`、`projects_v8`、`leads_v8`、`knowledge_docs_v8` 作为同一个提交单元写入 `/api/contracts/transaction`，避免“合同已写后端，但客户、项目、线索状态、PDCA 知识记录未同步”的半落库状态。

当前已接入事务写入灰度的前端操作：

- 合同录入
- 合同归档
- 合同绑定客户
- 合同附件追加
- 回款状态切换

当前暂不接入事务写入灰度的操作：

- 删除合同、删除附件：破坏性操作，需要单独确认后再做

## 回归要求

每次接入或修改合同后端化相关逻辑，至少运行：

```bash
npm run test
npm run e2e
```

合同模块单项读写灰度验证：

```bash
VITE_CONTRACTS_API_READ_ENABLED=1 \
VITE_CONTRACTS_API_WRITE_ENABLED=1 \
VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED=1 \
npm run e2e -- --project=chromium --grep "contract entry"
```
