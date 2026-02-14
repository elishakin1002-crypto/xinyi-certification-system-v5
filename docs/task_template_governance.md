# 任务卡片模板治理（v1）

## 目标
- 支持模板的新增、编辑、删除、归档与恢复。
- 避免误改系统内置模板导致交付链路断裂。
- 明确“谁能改/谁能删”的权限边界，且可回滚。

## 模板类型
### 内置模板（Built-in）
- 识别方式：`isBuiltIn=true`（或历史兼容：`id` 以 `TEMPLATE_` 开头）。
- 约束：
  - 不允许编辑/删除/归档。
  - 允许“复制为我的模板”，复制后的模板为用户模板，可自由管理。

### 用户模板（User）
- 识别方式：`isBuiltIn=false`。
- 特性：
  - 记录创建者信息。
  - 支持编辑、删除或归档。

## 权限规则（v1）
- `ADMIN`：
  - 可管理所有用户模板（编辑/删除/归档/恢复）。
- 非 `ADMIN`：
  - 只能管理自己创建的用户模板（编辑/删除/归档/恢复）。
- 所有人：
  - 可应用任意模板到项目。
  - 可复制内置模板为自己的模板。

## 数据字段（TaskTemplate）
- `id`: string
- `name`: string
- `tasks`: { title, priority, category }[]
- `isBuiltIn`: boolean
- `createdByUserId` / `createdByName`
- `createdAt` / `updatedAt`
- `archived`: boolean
- `usageCount`: number
- `lastUsedAt`: string

## 删除与回滚
- 默认优先“归档”隐藏模板；删除为硬删除，仅对用户模板生效。
- 本地存储键：`taskTemplates_v1`
- 回滚策略：
  - 新字段均为可选/可忽略，旧代码读取时不会因为新增字段报错。
  - 回滚实现后，用户模板仍可被读取与应用（仅丢失管理能力与统计信息）。

## 智能排序
- 默认展示：`archived=false`
- 排序：
  1) `lastUsedAt` 倒序（常用优先）
  2) `createdAt` 倒序（新建优先）
