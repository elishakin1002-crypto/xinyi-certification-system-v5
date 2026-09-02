# 权限委派设计草案

更新日期：2026-05-15

## 目标

在不把员工直接提升为 `ADMIN` 的前提下，让前台、总经理助理、人事负责人、兼职管理人员等可以获得有限管理能力。

本草案只做设计，不改 UI、DOM、demo 结构，也不新增数据库字段。真正实施前需要先确认字段和页面影响范围。

## 第一性原则

1. 默认最小权限

员工只获得完成工作所需的动作，不因为临时承担账号管理就获得全局管理员权限。

2. 角色和动作分离

`roles` 表示员工的业务身份，例如 `CONSULTANT`、`FINANCE`、`MANAGER`、`ADMIN`。附加动作表示额外委派能力，例如 `EMPLOYEE_CREATE`、`EMPLOYEE_RESET_PASSWORD`。

3. 对管理员账号做特殊保护

即使某个非 `ADMIN` 员工未来获得员工管理动作，也不能修改、停用、重置 `ADMIN` 账号，不能给别人授予 `ADMIN`。

4. 可审计、可回收

每一次授权、撤权、员工账号变更、密码重置都应进入审计日志。授权也应能随时撤回。

5. 删除和解绑另行处理

删除类、解绑类能力不混入普通委派权限。删除必须单独设计软删除、恢复、审计和影响提示。

## 建议模型

### 当前已有

| 概念 | 现状 |
|---|---|
| `roles` | 员工可同时拥有多个系统角色 |
| `activeRole` | 当前启用视角 |
| `ROLE_CAPABILITIES` | 每个角色默认拥有哪些动作 |
| `ActionCode` | 业务动作码 |
| 后端员工管理守卫 | 已按 `EMPLOYEE_*` / `AUTH_AUDIT_VIEW` 拆分 |

### 下一步建议新增

这一步会涉及字段，实施前必须单独确认。

| 字段 | 建议位置 | 说明 |
|---|---|---|
| `extraActions` | 员工账号 | 额外授予动作，例如给前台 `EMPLOYEE_CREATE` |
| `deniedActions` | 员工账号 | 显式撤销动作，用于覆盖角色默认能力 |
| `delegationNote` | 员工账号或审计日志 | 授权原因 |
| `delegatedByUserId` | 审计日志 | 谁做了授权 |
| `delegatedAt` | 审计日志 | 授权时间 |

当前不建议新增“前台”“助理”这类硬编码系统角色。岗位可以继续放在 `positionTags`，权限用动作码控制，这样一个咨询师也可以临时承担员工账号管理。

## 建议动作分组

| 场景 | 建议动作 | 风险 |
|---|---|---|
| 查看员工列表 | `EMPLOYEE_VIEW` | 低，涉及员工信息可见性 |
| 创建普通员工账号 | `EMPLOYEE_CREATE` | 中，可能创建错误账号 |
| 更新员工基础资料 | `EMPLOYEE_UPDATE` | 中，可能改错联系方式、岗位、上级 |
| 调整角色/视角 | `EMPLOYEE_UPDATE_ROLE` | 高，可能放大权限 |
| 启用/停用员工 | `EMPLOYEE_DISABLE` | 高，可能影响员工登录和工作 |
| 重置密码 | `EMPLOYEE_RESET_PASSWORD` | 高，涉及账号接管风险 |
| 查看审计日志 | `AUTH_AUDIT_VIEW` | 中，涉及操作记录可见性 |

## 推荐岗位模板

这些只是建议模板，实施前需要业务确认。

| 岗位/人员 | 可考虑授予 | 不建议授予 |
|---|---|---|
| 前台 | `EMPLOYEE_VIEW`、`EMPLOYEE_CREATE` | `EMPLOYEE_UPDATE_ROLE`、`EMPLOYEE_DISABLE`、`EMPLOYEE_RESET_PASSWORD` |
| 总经理助理 | `EMPLOYEE_VIEW`、`EMPLOYEE_CREATE`、`EMPLOYEE_UPDATE`、`EMPLOYEE_RESET_PASSWORD` | `EMPLOYEE_UPDATE_ROLE` 默认不授予 |
| 人事负责人 | `EMPLOYEE_VIEW`、`EMPLOYEE_CREATE`、`EMPLOYEE_UPDATE`、`EMPLOYEE_DISABLE`、`EMPLOYEE_RESET_PASSWORD` | 授予 `EMPLOYEE_UPDATE_ROLE` 需单独确认 |
| 交付负责人 | `EMPLOYEE_VIEW` | 员工账号创建、停用、重置密码 |
| 财务 | 通常不授予员工管理动作 | 员工管理全套动作 |

## 后端验收标准

实施字段和接口后，必须满足：

1. 非 `ADMIN` 可以通过 `extraActions` 获得指定员工管理动作。
2. 非 `ADMIN` 不能给任何人授予 `ADMIN`。
3. 非 `ADMIN` 不能修改、停用、重置 `ADMIN` 账号。
4. 撤销 `extraActions` 后，该员工立即失去对应接口权限。
5. 每次授权、撤权、员工账号更新和密码重置都有审计日志。
6. 未登录、过期 session、禁用账号仍然不能调用员工管理接口。

## 前端实施边界

这部分会涉及 UI，必须在实施前确认。

可能需要新增或调整：

- 员工账号页面的“额外权限”配置区
- 权限动作勾选控件
- 高风险动作提示，例如重置密码、停用账号、调整角色
- 审计日志展示授权和撤权记录
- 侧边栏员工账号入口不再只看 `ADMIN`，而是看 `EMPLOYEE_VIEW`

不建议改动：

- 不把官网和管理系统重新捆绑
- 不删除现有员工账号页面功能
- 不把 demo 员工结构直接当生产权限模型

## 分阶段实施建议

| 阶段 | 内容 | 是否需要先确认 |
|---|---|---|
| P1 | 后端字段与权限计算函数 | 需要，涉及员工账号字段 |
| P2 | 授权/撤权 API 与审计日志 | 需要，涉及接口行为 |
| P3 | 员工账号页面显示额外权限 | 需要，涉及 UI |
| P4 | E2E 覆盖前台/助理委派流程 | 不涉及业务字段，但依赖 P1-P3 |
| P5 | 测试环境真实账号验收 | 需要准备测试账号 |

## 当前不实施的内容

- 不新增 `extraActions` / `deniedActions` 字段
- 不改员工账号页面
- 不改侧边栏入口显示逻辑
- 不给任何非 `ADMIN` 角色默认增加员工管理动作
- 不新增删除类权限
