# 全能大脑 v5.0 权限体系设计规范

## 一、设计总原则

> **全能大脑不是“万能遥控器”，而是“带门禁的总控台”。**

AI 执行任何动作（execute_action）前，必须通过 **三层校验**：
1. **身份层**：当前用户是哪个角色？（Who）
2. **能力层**：该角色是否有权执行此动作？（Can Do What）
3. **数据层**：该动作是否越权操作了他人数据？（On Which Data）

---

## 二、角色 × 能力 × 动作 对照表（Capability Matrix）

| 动作代码 (Action Code) | 描述 | ADMIN (老板) | MANAGER (交付负责人) | CONSULTANT (咨询师) | FINANCE (财务) |
|---|---|---|---|---|---|
| **PROJECT_CREATE** | 创建项目 | ✅ | ✅ | ❌ | ❌ |
| **PROJECT_EDIT_INFO** | 修改项目信息 | ✅ | ✅ | ❌ | ❌ |
| **PROJECT_ASSIGN_MANAGER** | 修改项目负责人 | ✅ | ✅ | ❌ | ❌ |
| **PROJECT_PAUSE** | 暂停/重启项目 | ✅ | ✅ | ❌ | ❌ |
| **TASK_CREATE** | 创建任务 | ✅ | ✅ | ✅ (仅自己项目) | ❌ |
| **TASK_COMPLETE** | 完成任务 | ✅ | ✅ | ✅ (仅自己负责) | ❌ |
| **TASK_DELETE** | 删除任务 | ✅ | ✅ | ❌ | ❌ |
| **CONTRACT_CREATE** | 录入合同 | ✅ | ✅ | ✅（仅自己录入或关联自己负责项目） | ❌ |
| **CONTRACT_VIEW_AMOUNT** | 查看合同金额 | ✅ | ✅ | ❌ | ✅ |
| **PAYMENT_CONFIRM** | 确认回款 | ❌ | ❌ | ❌ | ✅ |
| **CUSTOMER_CREATE** | 录入客户 | ✅ | ✅ | ✅ | ❌ |
| **LEAD_CONVERT** | 线索转项目 | ✅ | ✅ | ❌ | ❌ |

---

## 三、数据范围规则（Data Scope Rules）

即使拥有动作能力，也受以下数据范围限制：

1. **CONSULTANT (咨询师)**
   - **读**：只能查看自己是 `manager` 或 `tasks.owner` 的项目。
   - **写**：只能操作自己负责的任务（`task.owner === currentUser`）。
   - **合同**：仅可访问“自己录入的合同”或“与自己负责项目关联的合同”；不可见其他咨询师合同金额。

2. **MANAGER (交付负责人)**
   - **读/写**：所有 `projectCategory === 'Delivery'` 的项目。
   - **禁**：不可操作财务回款状态。

3. **FINANCE (财务)**
   - **读/写**：所有合同的 `receivables` 与 `settlements`。
   - **禁**：不可修改项目任务状态。

4. **ADMIN (老板)**
   - **读/写**：全域数据。

---

## 四、全能大脑可调用指令白名单 (AI Whitelist)

AI 仅允许解析并尝试执行以下指令（需经过 `hasPermission` 校验）：

```typescript
type AIAllowedAction = 
  | 'CREATE_PROJECT'      // 对应 PROJECT_CREATE
  | 'ADD_TASK'            // 对应 TASK_CREATE
  | 'COMPLETE_TASK'       // 对应 TASK_COMPLETE
  | 'UPDATE_PROGRESS'     // 对应 PROJECT_EDIT_INFO
  | 'ADD_REMINDER'        // 通用能力 (所有人可用)
  | 'CREATE_CUSTOMER'     // 对应 CUSTOMER_CREATE
  | 'CREATE_CONTRACT'     // 对应 CONTRACT_CREATE
```

---

## 五、权限拒绝时 AI 标准回复话术

当 `hasPermission` 返回 `false` 时，AI **必须** 返回以下格式回复，而不是报错：

**场景 1：无能力（Capability Denied）**
> “抱歉，当前身份（咨询师）没有‘修改项目负责人’的权限。建议联系交付负责人处理。”

**场景 2：无数据权限（Scope Denied）**
> “你无法操作项目【项目B】，因为它不属于你负责。请联系项目经理。”

**场景 3：引导式拒绝（Soft Rejection）**
> “我无法直接暂停项目，但我可以帮你‘通知项目负责人’，是否发送？”

---

## 六、系统级死规则（开发必读）

> **全能大脑只能调用：当前身份 × 被授权能力 × 允许的数据范围 三者同时满足的动作。**
> **AI 只是代办员，不拥有任何特权。**
