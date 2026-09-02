# 线索后端 API 契约

## 目标

线索模块后端化采用渐进迁移：先提供后端 API，继续读写现有 `leads_v8` 数据集；前端页面接入前，不改变当前 UI、DOM、demo 结构和业务字段。

## 数据边界

- 数据集：`leads_v8`
- 返回对象：保持当前 `Lead` 形状
- 不新增、不重命名、不删除现有业务字段
- 更新操作为浅合并，`id` 以 URL 参数为准，不允许通过 body 改写

## 接口

### `GET /api/leads`

返回全部线索：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {
    "leads": []
  }
}
```

### `GET /api/leads/:id`

返回单条线索：

```json
{
  "data": {
    "lead": {
      "id": "L-...",
      "company": "客户名称"
    }
  }
}
```

不存在时返回 `404`。

### `POST /api/leads`

创建线索。推荐请求格式：

```json
{
  "lead": {
    "company": "客户名称",
    "name": "联系人",
    "mobile": "13800000000"
  }
}
```

创建默认值与当前前端新增线索保持一致：

- `status=New`
- `score=60`
- `potentialValue=0`
- `probability=20`
- `source=官网`
- `intent=Medium`
- `contacts[0]` 为主联系人
- `followUpRecords=[]`

### `PATCH /api/leads/:id`

更新线索。推荐请求格式：

```json
{
  "lead": {
    "company": "客户名称-已编辑",
    "status": "Pending"
  }
}
```

不存在时返回 `404`。

### `POST /api/leads/:id/follow-ups`

追加跟进记录。推荐请求格式：

```json
{
  "record": {
    "type": "微信",
    "content": "客户要求明天发资料",
    "operator": "销售一号"
  }
}
```

后端会生成 `record.id`，并追加到 `lead.followUpRecords`。

## 鉴权

`/api/leads` 属于受保护 API：

- 测试/预发/生产应开启 `XINYI_API_AUTH_REQUIRED` 或 `XINYI_SESSION_AUTH_REQUIRED`
- 自动化任务可继续使用 API token
- 员工登录模式下可通过 HttpOnly session 访问

## 回归要求

每次接入或修改线索后端化相关逻辑，至少运行：

```bash
npm run test
npm run e2e
```

其中 E2E 必须通过 `lead create, search, detail edit, and follow-up preserve current UI contract`，用于证明 UI、DOM 和字段契约未被破坏。

测试环境部署后还必须运行线索 API 冒烟：

```bash
DEPLOY_BACKEND_BASE=https://<host> XINYI_API_AUTH_TOKEN=<token> npm run health:leads:api
```

该命令会创建一条 `SMOKE线索-*` 测试线索，继续执行编辑、追加跟进和写后读回，并确认 `leads_v8` 中能读到最终结果。它不删除测试线索。

## 前端灰度开关

前端通过两个开关控制是否调用 `/api/leads`：

- `VITE_LEADS_API_ENABLED=0`：默认值，写入仍保持当前前端本地 state + state sync 行为
- `VITE_LEADS_API_ENABLED=1`：`addLead`、`updateLead`、`addLeadFollowUp` 在乐观更新 UI 后调用后端 API，并用后端返回的 `Lead` 校准本地 state
- `VITE_LEADS_API_READ_ENABLED=0`：默认值，读取仍保持当前前端本地 state + state sync 行为
- `VITE_LEADS_API_READ_ENABLED=1`：启动时从 `GET /api/leads` 拉取线索列表；请求失败时回落到当前本地线索
- `VITE_LEADS_API_VERIFY_WRITES_ENABLED=0`：默认值，不额外做写后读回
- `VITE_LEADS_API_VERIFY_WRITES_ENABLED=1`：新增、编辑、追加跟进写入后，再 `GET /api/leads/:id` 读回确认；读回失败或不一致时回滚到写入前的前端 state

该开关不改变页面 UI、DOM、字段和 demo 数据结构。
