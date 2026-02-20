# 信义系统铁骨架 V1.0

---

## 1. 项目目录结构（固定）

```
src/
  modules/
  routes/
  services/
  models/
  utils/
  constants/
  configs/
```

禁止新增同级核心目录。
所有业务功能必须放在 modules 下。

---

## 2. 统一 API 返回格式

所有接口必须使用：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {}
}
```

禁止自定义返回结构。
前端仅依据 code 判断逻辑。

---

## 3. 状态枚举集中管理

文件路径：

```
src/constants/status.ts
```

示例：

```ts
export const CONTRACT_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  ACTIVE: "active",
  DONE: "done",
  CANCELLED: "cancelled"
}
```

禁止在业务代码中直接写字符串状态。
必须引用 constants。

---

## 4. 金额规范

数据库存储：
- 类型：number
- 单位：分

禁止使用浮点数直接存储金额。
展示统一两位小数。

---

## 5. 日期规范

数据库统一：
YYYY-MM-DD

接口统一：
ISO 8601 格式

禁止混用时间戳格式。

---

## 6. 错误代码表

文件路径：

```
src/constants/errorCodes.ts
```

示例：

```ts
export const ERROR_CODES = {
  SUCCESS: 0,
  PARAM_ERROR: 1001,
  NOT_LOGIN: 1002,
  NO_PERMISSION: 1003,
  NOT_FOUND: 2001,
  DATA_CONFLICT: 3001,
  SERVER_ERROR: 5001
}
```

所有错误必须引用该文件。
禁止返回未定义 code。

---

## 7. 数据库命名规则

全部小写。
使用下划线。
禁止拼音。
禁止缩写。

外键统一：
*_id

时间字段统一：
created_at
updated_at

金额字段统一：
*_amount

状态字段统一：
*_status

---

## 8. 禁止行为

禁止修改 SYSTEM_RULES.md。
禁止更改目录结构。
禁止新增未定义状态。
禁止返回非统一格式接口。