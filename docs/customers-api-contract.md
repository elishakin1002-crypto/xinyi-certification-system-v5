# 客户后端 API 契约

## 目标

客户模块后端化沿用线索模块的渐进迁移方式：先提供后端 API，继续读写现有 `customers_v8` 数据集；前端通过灰度开关接入，默认关闭，不改变当前 UI、DOM、demo 结构和业务字段。

## 数据边界

- 数据集：`customers_v8`
- 返回对象：保持当前 `Customer` 形状
- 不新增、不重命名、不删除现有业务字段
- 更新操作为浅合并，`id` 以 URL 参数为准，不允许通过 body 改写

## 接口

### `GET /api/customers`

返回全部客户：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {
    "customers": []
  }
}
```

### `GET /api/customers/:id`

返回单个客户；不存在时返回 `404`。

### `POST /api/customers`

创建客户。推荐请求格式：

```json
{
  "customer": {
    "name": "客户名称",
    "contactPerson": "联系人",
    "mobile": "13900000000"
  }
}
```

创建默认值与当前客户新增流程兼容：

- `totalValue=0`
- `riskStatus=low`
- `activeContracts=0`
- `contacts[0]` 为主联系人
- `followUpRecords=[]`

### `PATCH /api/customers/:id`

更新客户。推荐请求格式：

```json
{
  "customer": {
    "name": "客户名称-已编辑",
    "riskStatus": "medium"
  }
}
```

不存在时返回 `404`。

### `POST /api/customers/:id/follow-ups`

追加跟进记录。推荐请求格式：

```json
{
  "record": {
    "type": "电话",
    "content": "客户确认下周复盘",
    "operator": "客服一号"
  }
}
```

后端会生成 `record.id`，并追加到 `customer.followUpRecords`。

## 鉴权

`/api/customers` 属于受保护 API：

- 测试/预发/生产应开启 `XINYI_API_AUTH_REQUIRED` 或 `XINYI_SESSION_AUTH_REQUIRED`
- 自动化任务可继续使用 API token
- 员工登录模式下可通过 HttpOnly session 访问

## 前端灰度开关

默认值均为 `0`，不会改变现有客户页面的数据来源与演示行为。

| 环境变量 | 作用 |
|---|---|
| `VITE_CUSTOMERS_API_ENABLED` | 打开客户新增、编辑、追加跟进的 API 写入 |
| `VITE_CUSTOMERS_API_READ_ENABLED` | 页面启动时从 `GET /api/customers` 读取客户数据 |
| `VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED` | 写入后再 `GET /api/customers/:id` 读回校验；校验失败时回滚前端状态 |

打开灰度时，当前页面仍保留现有字段、DOM、按钮文案和交互路径。前端只替换数据读写来源，并保留乐观更新体验。

## 回归要求

每次接入或修改客户后端化相关逻辑，至少运行：

```bash
npm run test
npm run e2e
```

客户模块单项灰度验证：

```bash
VITE_CUSTOMERS_API_ENABLED=1 \
VITE_CUSTOMERS_API_READ_ENABLED=1 \
VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED=1 \
npm run e2e -- --project=chromium --grep "customer create"
```
