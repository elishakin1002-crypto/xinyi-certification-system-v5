# 员工登录与权限系统计划

## 当前结论

当前仓库就是内部管理系统本体。现有“身份/视角”来自前端示例员工数据，适合演示和开发，不适合作为测试/生产登录体系。

## 已完成的后端认证基础

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/auth/login` | `POST` | 员工账号密码登录，成功后写入 HttpOnly session cookie |
| `/api/auth/me` | `GET` | 根据 session cookie 查询当前员工 |
| `/api/auth/change-password` | `POST` | 登录员工修改自己的密码，成功后清除“必须改密”状态 |
| `/api/auth/logout` | `POST` | 注销当前 session，并清除 cookie |
| `/api/auth/health` | `GET` | 查询认证存储健康状态与当前模式 |
| `/api/auth/users` | `GET` | 管理员查看员工账号列表 |
| `/api/auth/users` | `POST` | 管理员创建员工账号 |
| `/api/auth/users/:id` | `PATCH` | 管理员更新员工账号资料、角色、状态 |
| `/api/auth/users/:id/reset-password` | `POST` | 管理员重置员工密码，并使该员工旧 session 失效 |

说明：员工账号管理接口已拆成动作权限守卫。当前默认仍只有 `ADMIN` 拥有这些动作；未来如委派给前台、总经理助理或人事负责人，非 `ADMIN` 仍不能操作 `ADMIN` 账号，包括修改管理员账号和重置管理员密码。

登录成功返回：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {
    "user": {
      "id": "U-AUTH-ADMIN",
      "name": "系统管理员",
      "email": "admin@xinyi-iso.local",
      "roles": ["ADMIN", "MANAGER", "CONSULTANT", "FINANCE"],
      "activeRole": "ADMIN"
    },
    "expiresAt": "2026-05-07T08:00:00.000Z"
  }
}
```

## 本地/测试种子账号

`.env.local` 可临时配置：

```bash
XINYI_AUTH_SEED_ADMIN_EMAIL=admin@xinyi-iso.local
XINYI_AUTH_SEED_ADMIN_PASSWORD=<strong-password>
```

说明：

- 仅用于 bootstrap 第一个管理员。
- 密码会以 PBKDF2 哈希写入 auth store。
- 上测试环境后应替换为正式员工创建流程或迁移脚本。

## 前端门禁状态

已接入 `/login` 登录页与前端门禁：

- `VITE_AUTH_REQUIRED=1` 时，未登录访问管理系统会跳转到 `/login`。
- 登录成功后，当前用户来自 `/api/auth/me` / `/api/auth/login` 返回的员工身份。
- 本地开发与 E2E 可用 `localStorage.xinyi_auth_required=1` 临时开启门禁，只能开启，不能关闭正式环境的 `VITE_AUTH_REQUIRED=1`。
- 登录模式下，顶部“切换当前用户”被锁定，后端状态同步也不能用 demo 的 `current_user_id` 覆盖当前登录员工。

## 下一步实现

| 阶段 | 任务 | 验收 |
|---|---|---|
| A1 | 前端 `/login` 页面 | 已完成：未登录访问系统时跳转登录 |
| A2 | 前端 AuthProvider | 已完成：`currentUser` 来自 `/api/auth/me` |
| A3 | 关闭生产身份随意切换 | 已完成：登录模式锁定当前员工，保留员工已分配角色内的视角切换 |
| A4 | 后端 API session 权限 | 已完成第二步：关键 API 启用会话鉴权 + 角色校验（如 `intel/fetch` 仅管理角色） |
| A5 | PostgreSQL 员工表/会话表 | 已完成第七步：支持 `auth_users` / `auth_sessions` PostgreSQL 存储、员工账号管理 API、密码重置与旧 session 失效、管理员员工账号页面、账号审计日志页面、首次登录强制改密、登录失败临时锁定 |
| A6 | 官网线索接入 | 官网表单写入管理系统线索池，同时发 QQ 邮件通知 |

## 员工账号字段

当前员工账号管理接口与 `/employees` 页面采用以下字段：

| 字段 | 说明 |
|---|---|
| `email` | 登录邮箱，可为空但必须至少有 `email` 或 `username` 之一 |
| `username` | 登录账号，可为空但必须至少有 `email` 或 `username` 之一 |
| `name` | 员工姓名 |
| `roles` | 系统角色：`ADMIN`、`MANAGER`、`CONSULTANT`、`FINANCE` |
| `activeRole` | 默认启用角色，必须属于 `roles` |
| `positionTags` | 岗位标签，如财务、咨询、销售 |
| `reportsToUserId` | 上级员工 ID |
| `status` | `active` 或 `disabled` |
| `mustChangePassword` | 是否必须先修改临时密码 |

## 员工账号页面

已新增 `/employees` 管理页面，并在侧边栏底部新增“员工账号”入口：

- 仅具备 `ADMIN` 角色的登录用户显示入口。
- 页面支持查看员工列表、新建员工、编辑账号资料/角色/状态、重置密码。
- 新建员工时需要临时密码；编辑员工时不在普通资料表单内显示旧密码。
- 重置密码入口独立处理，后端会使该员工旧 session 失效。

## 账号审计日志

已新增 `/api/auth/audit-logs`：

- 仅管理员可读取。
- 文件模式写入 auth store 的 `auditLogs`；PostgreSQL 模式写入 `auth_audit_logs`。
- 当前记录动作包括 `USER_CREATE`、`USER_UPDATE`、`USER_DISABLE`、`USER_ENABLE`、`PASSWORD_RESET`。
- 日志字段包括 `actorUserId`、`actorName`、`action`、`targetUserId`、`targetName`、`metadata`、`createdAt`。
- `metadata` 会过滤密码相关字段，不记录明文密码或密码哈希。

已新增 `/auth-audit` 管理页面：

- 仅具备 `ADMIN` 角色的登录用户显示侧边栏入口。
- 展示最近 100 条审计日志。
- 页面字段包括时间、动作、操作人、对象、详情。
- 动作会转换为中文标签，如创建员工、更新员工、停用员工、启用员工、重置密码、修改密码。

## 首次登录改密

已新增 `/change-password` 页面：

- 新建员工账号默认 `mustChangePassword=true`。
- 管理员重置密码后，员工账号重新变为 `mustChangePassword=true`。
- 员工登录后如需改密，会先进入 `/change-password`，改完后才能进入工作台。
- 改密需要输入当前密码与新密码，新密码至少 8 位。
- 改密成功后 `mustChangePassword=false`，并记录 `PASSWORD_CHANGE` 审计日志。

## 登录失败锁定

已新增登录失败次数限制：

- 认证存储新增内部字段 `failedLoginCount`、`lockedUntil`、`lastFailedLoginAt`。
- 默认连续 5 次密码错误后临时锁定账号 15 分钟。
- 锁定期内即使输入正确密码也不能登录。
- 锁定期过后正确登录会自动清空失败次数与锁定状态。
- 管理员重置密码、员工成功改密也会清空失败次数与锁定状态。
- 可通过 `XINYI_AUTH_MAX_FAILED_LOGIN_ATTEMPTS` 和 `XINYI_AUTH_LOCK_MS` 调整阈值与锁定时长。

## 权限策略

| 环境 | 身份切换 |
|---|---|
| 本地开发 | 可保留示例身份切换 |
| 测试环境 | 默认关闭普通切换，仅管理员可代看并记录日志 |
| 生产环境 | 只能使用登录员工自己的身份和角色 |

## 验证命令

```bash
npm run test
npm run e2e
```

当前已覆盖：

- 登录成功设置 HttpOnly session cookie
- `/api/auth/me` 可读取当前员工
- 登出后 session 失效
- 错误密码返回 403
- `VITE_AUTH_REQUIRED=1` 时前端跳转登录并可使用种子员工登录
- 登录模式下不会显示 demo 当前用户切换菜单
- `XINYI_SESSION_AUTH_REQUIRED=1` 时，未登录访问 `/api/ai/*`、`/api/state/*`、`/api/intel/*` 返回 401；登录后可访问
- 角色校验开启时（`XINYI_SESSION_ROLE_ENFORCEMENT=1`），`FINANCE` 不能触发 `/api/intel/fetch`，`MANAGER/ADMIN` 可触发
- `XINYI_AUTH_REQUIRE_POSTGRES=1` 且缺少 `DATABASE_URL` 时服务启动失败
- `/api/auth/health` 与 `npm run health:auth:postgres` 可验收认证存储模式
- `npm run health:auth:api` 可只读验收管理员登录、当前用户、员工列表与审计日志接口
- `npm run health:local-auth` 可验收普通本地 `3000/3001` 启动是否会从工作台跳转登录页，且本地认证库至少有 1 个账号
- 管理员可创建、更新、查看员工账号；普通员工访问账号管理接口返回 403
- 管理员重置员工密码后，该员工旧 session 立即失效，旧密码不可再登录
- 管理员不能通过账号管理接口禁用当前登录的自己，也不能移除自己的 `ADMIN` 角色
- 员工账号被禁用后，旧 session 和新登录都会被拒绝
- 登录管理员可在 `/employees` 打开员工账号页面并新建员工账号
- 管理员账号管理动作会写入审计日志；普通员工读取审计日志返回 403；审计日志不包含密码明文
- 管理员可在 `/auth-audit` 查看员工账号相关审计日志
- 新员工首次登录会被要求修改临时密码；改密后才能进入工作台
- 连续错误密码会临时锁定账号，锁定期后正确密码可恢复登录

E2E 默认独立启动 `3100/3101` 测试服务，避免复用正在手工查看的 `3000/3001` 本地服务。
