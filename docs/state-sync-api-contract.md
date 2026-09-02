# State Sync API 契约（`/api/state/sync`）

## 目标

为前端状态双写（localStorage + backend）提供稳定读写接口，保证统一 envelope、可观测 metadata、可灰度切换。

## 通用响应格式

所有接口遵循：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {}
}
```

失败示例：

```json
{
  "ok": false,
  "code": 1001,
  "message": "datasets 不能为空且必须是对象",
  "data": {}
}
```

## 1) 写入快照

### `POST /api/state/sync`

请求体：

```json
{
  "datasets": {
    "leads_v8": [],
    "customers_v8": []
  },
  "source": "frontend",
  "actorUserId": "U-001",
  "clientId": "web-01",
  "appVersion": "5.0.0"
}
```

返回：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {
    "written": 2,
    "mode": "file",
    "latestUpdateAt": "2026-05-06T05:26:00.123Z"
  }
}
```

校验规则：

- `datasets` 必须是对象，否则返回 `400 + code=1001`。
- `datasets` 的 key 会被标准化后写入（见“键标准化规则”）。
- 无效 key 会被忽略，不报错；`written` 仅统计有效 key 数量。

## 2) 读取快照

### `GET /api/state/sync?keys=leads_v8,customers_v8`

- `keys` 可选，不传时返回全部数据集。
- 传入 `keys` 时会先进行 key 标准化，再按标准化结果查询。

返回：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {
    "mode": "file",
    "datasets": {
      "leads_v8": []
    },
    "metadata": {
      "leads_v8": {
        "updatedAt": "2026-05-06T05:26:00.123Z",
        "source": "frontend"
      }
    }
  }
}
```

## 3) 状态健康

### `GET /api/state/health`

返回字段：

- `mode`: `postgres` 或 `file`
- `ready`: 布尔值
- `reason`: 模式原因（例如 `connected`、`DATABASE_URL not configured`）
- `totalDatasets`
- `latestUpdateAt`

## 键标准化规则

后端标准化逻辑（`server/stateStore.js`）：

1. `trim()`
2. 驼峰转下划线：`camelCase -> camel_case`
3. `.`、`:`、`-` 统一替换为 `_`
4. 全部转小写
5. 必须匹配 `^[a-z0-9_]+$`
6. 最大长度 `128`

示例：

- `CamelCaseKey` -> `camel_case_key`（有效）
- `Lead-Data.V1` -> `lead_data_v1`（有效）
- `bad key !` -> 无效（被忽略）

## 关键错误码

- `1001` (`PARAM_ERROR`): 参数错误（如 `datasets` 缺失或不是对象）
- `5004` (`STATE_SYNC_ERROR`): 状态读写内部错误
- `5001` (`SERVER_ERROR`): 健康检查等服务端通用错误

## 鉴权与安全

当 `XINYI_API_AUTH_TOKEN` + `XINYI_API_AUTH_REQUIRED=true` 生效时：

- 无 token：`401 + code=1002`
- token 错误：`403 + code=1003`

当配置 `CORS_ALLOWED_ORIGINS` 时，非白名单 Origin 会被拒绝：

- `403 + code=1003`

## 回归测试覆盖（当前）

- `tests/api-state.test.js`
  - 参数校验
  - 单 key 读写回环
  - key 标准化与 metadata/source 验证
- `tests/api-auth-guard.test.js`
  - 鉴权与 CORS 场景
