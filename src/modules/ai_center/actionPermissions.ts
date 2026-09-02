import { ActionCode } from '../../../types';

/**
 * AI 对话框能执行的动作 → 需要的权限。
 *
 * ── 为什么要有这张表（2026-08-31 查出来的洞）──────────────────
 * AI 对话框是一条**绕过界面的通道**。界面上顾问看不到「确认回款」按钮，
 * 但他可以对 AI 说「确认某某合同的钱到账了」——
 * 原来 11 个动作里只有 2 个（建客户、建合同）做了权限校验，
 * 剩下 9 个直接执行，其中包括 confirm_receivable：**不可撤销的财务动作**。
 *
 * 而服务端当时是 observe 模式（判定 + 记账，一律放行），兜不住。
 *
 * ── 为什么用一张表，不是散着写 if ──────────────────────────────
 * 散着写的问题不是难看，是**加新动作时没人提醒你漏了**。
 * 集中一张表之后，测试可以断言「提示词里列出的每个动作在这里都有条目」——
 * 漏一个就红。这比指望作者记得加校验可靠。
 *
 * ── 这张表不是安全边界 ────────────────────────────────────────
 * 它跑在浏览器里，改一下前端代码就绕过去了。
 * **真正的边界是服务端授权（XINYI_AUTHZ_MODE=enforce）。**
 * 这张表的作用是：① 让用户当场看到「你没这个权限」而不是操作静默失败
 * ② 减少 AI 承诺了却做不到的尴尬。两者都不能替代服务端。
 */
export const AI_ACTION_PERMISSION: Record<string, ActionCode> = {
  customer: 'CUSTOMER_CREATE',
  contract: 'CONTRACT_CREATE',
  project: 'PROJECT_CREATE',
  lead: 'LEAD_CREATE',
  lead_follow_up: 'LEAD_EDIT',
  customer_follow_up: 'CUSTOMER_EDIT',
  // 完成项目会触发评级、客户分级、提醒、PDCA 一连串级联，不是一个轻动作
  complete_project: 'PROJECT_EDIT_INFO',
  // **最要紧的一条**：确认回款不可撤销
  confirm_receivable: 'PAYMENT_CONFIRM',
  convert_signal: 'PROJECT_CREATE',
  reminder: 'REMINDER_WRITE',
  /*
    系统自检。**不是 PROJECT_AI_DIAGNOSE**——那个是「诊断某个项目的交付风险」，
    是业务动作，总助也该有；这个是「检查整套系统并自动修复配置」，是运维动作。

    第一版映射错了，于是前端放行总助、服务端 /api/admin/diagnose 只认 ADMIN，
    总助会撞上一个看起来像 bug 的 403。两边现在用同一个动作码。
  */
  diagnose: 'SYSTEM_DIAGNOSE',
};

/** 人能看懂的动作名。权限不足时要说清被拦的是哪件事 */
export const AI_ACTION_LABEL: Record<string, string> = {
  customer: '新建客户',
  contract: '录入合同',
  project: '建交付项目',
  lead: '录入线索',
  lead_follow_up: '给线索加跟进',
  customer_follow_up: '给客户加跟进',
  complete_project: '完成项目',
  confirm_receivable: '确认回款到账',
  convert_signal: '把情报转为项目',
  reminder: '建提醒',
  diagnose: '系统自我诊断',
};

export interface ActionGateResult {
  allowed: boolean;
  /** 被拦下的动作键 */
  denied: Array<{ key: string; label: string; action: ActionCode; reason: string }>;
}

/**
 * 检查一批动作。**只要有一个不许，整批都不执行。**
 *
 * 不做「能做的先做、不能做的跳过」——那会产生半成品：
 * 比如「建合同 + 确认回款」里合同建了、回款没确认，
 * 用户以为整件事办完了，实际上账目是错的。
 * 宁可一件不做，让人看清楚缺什么权限。
 */
export const gateAiActions = (
  actionData: Record<string, unknown>,
  check: (action: ActionCode) => { allowed: boolean; reason?: string },
): ActionGateResult => {
  const denied: ActionGateResult['denied'] = [];
  for (const key of Object.keys(actionData || {})) {
    const action = AI_ACTION_PERMISSION[key];
    if (!action) continue;               // 不是受管动作（如 create_project 这类附带标志位）
    const r = check(action);
    if (!r.allowed) {
      denied.push({
        key,
        label: AI_ACTION_LABEL[key] || key,
        action,
        reason: r.reason || '你的角色没有这个权限',
      });
    }
  }
  return { allowed: denied.length === 0, denied };
};
