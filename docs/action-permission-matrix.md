# 动作权限矩阵

更新日期：2026-05-14

## 目标

把“能看到哪个导航”和“能执行哪个业务动作”分开管理。导航权限继续由 `ROLE_PERMISSIONS` 控制，业务动作权限由 `ROLE_CAPABILITIES` 与 `checkRoleActionPermission` 控制。

本阶段只固化现有动作权限，不新增删除能力，不改变页面 UI、DOM、业务字段或 demo 结构。

员工账号管理已经拆成独立动作码，但默认只授予 `ADMIN`。后续要给前台、总经理助理、人事负责人时，应按动作逐项授权，不直接给全局管理员。

即使未来把部分员工管理动作委派给非 `ADMIN`，后端仍禁止非 `ADMIN` 操作 `ADMIN` 账号，例如修改管理员账号资料、角色、状态或重置管理员密码。

## 当前角色

| 角色 | 数据范围 | 说明 |
|---|---|---|
| `ADMIN` | `ALL` | 公司负责人/系统管理员，拥有全局业务动作权限 |
| `MANAGER` | `DEPARTMENT` | 交付负责人，管理项目、任务、合同与客户转化 |
| `CONSULTANT` | `OWN` | 咨询师，只能操作自己负责的项目或任务 |
| `FINANCE` | `ALL` | 财务角色，只允许财务相关动作 |

## 当前动作矩阵

| 动作 | ADMIN | MANAGER | CONSULTANT | FINANCE | 备注 |
|---|---:|---:|---:|---:|---|
| `PROJECT_CREATE` | 是 | 是 | 否 | 否 | 创建项目 |
| `PROJECT_EDIT_INFO` | 是 | 是 | 否 | 否 | 编辑项目信息 |
| `PROJECT_ASSIGN_MANAGER` | 是 | 是 | 否 | 否 | 指派项目负责人 |
| `PROJECT_PAUSE` | 是 | 是 | 否 | 否 | 暂停/状态类项目动作，当前未完整产品化 |
| `TASK_CREATE` | 是 | 是 | 是 | 否 | 咨询师仅限自己范围 |
| `TASK_COMPLETE` | 是 | 是 | 是 | 否 | 咨询师仅限自己范围 |
| `TASK_DELETE` | 是 | 是 | 否 | 否 | 破坏性动作，现阶段不继续扩展后端持久化，需单独确认 |
| `CONTRACT_CREATE` | 是 | 是 | 是 | 否 | 咨询师仅限自己范围 |
| `CONTRACT_VIEW_AMOUNT` | 是 | 是 | 否 | 是 | 合同金额/回款查看 |
| `PAYMENT_CONFIRM` | 否 | 否 | 否 | 是 | 财务确认回款 |
| `CUSTOMER_CREATE` | 是 | 是 | 是 | 否 | 咨询师仅限自己范围 |
| `LEAD_CONVERT` | 是 | 是 | 否 | 否 | 线索转化 |
| `EMPLOYEE_VIEW` | 是 | 否 | 否 | 否 | 查看员工账号列表 |
| `EMPLOYEE_CREATE` | 是 | 否 | 否 | 否 | 创建员工账号 |
| `EMPLOYEE_UPDATE` | 是 | 否 | 否 | 否 | 更新员工基础资料 |
| `EMPLOYEE_UPDATE_ROLE` | 是 | 否 | 否 | 否 | 调整员工角色/当前身份 |
| `EMPLOYEE_DISABLE` | 是 | 否 | 否 | 否 | 启用/停用员工账号 |
| `EMPLOYEE_RESET_PASSWORD` | 是 | 否 | 否 | 否 | 重置员工密码 |
| `AUTH_AUDIT_VIEW` | 是 | 否 | 否 | 否 | 查看登录与账号审计日志 |

## 当前实现

- 角色动作能力：`constants.ts` 的 `ROLE_CAPABILITIES`
- 导航权限：`constants.ts` 的 `ROLE_PERMISSIONS`
- 统一校验函数：`src/utils/actionPermissions.ts` 的 `checkRoleActionPermission`
- 前端上下文入口：`context/AppContext.tsx` 的 `checkActionPermission`
- 员工账号接口后端守卫：`server/app.js` 的 `requireAuthActionSession` 与 `hasAuthManagementAction`
- 管理员账号保护：`server/app.js` 的 `rejectIfNonAdminManagingAdmin`
- 权限契约测试：`tests/permissions-contract.test.js` 校验动作码、角色能力、后端员工管理动作清单和管理员账号保护一致

## 后续扩展建议

1. 员工账号管理委派

用户提到未来可能让前台、总经理助理、人事负责人承担员工账号管理。当前已经预留独立动作码，但没有授予非管理员。下一步如果要开放，需要先确认具体岗位可以执行哪些动作，并同步前端入口显示策略。

详细设计见 `docs/permission-delegation-design.md`。该设计建议用个人附加动作承载委派权限，而不是新增大量硬编码角色。

2. 删除类动作必须先产品化规则

删除类建议统一采用软删除/归档优先，并配套审计日志和恢复机制。现阶段不直接进入实现。

3. 后端也需要动作权限

当前已有基础 session 角色校验，但业务 API 还没有全部做到动作级校验。后续应把前端动作权限与后端中间件规则对齐，避免只靠前端隐藏按钮。

## 本阶段不做的事

- 不新增删除能力
- 不改变任何 UI/DOM
- 不调整 demo 数据结构
- 不把前台/助理直接提升为 `ADMIN`
