/**
 * 把数据库约束报错翻译成人能看懂的话。
 *
 * ── 为什么要有这个（2026-09-14）────────────────────────────────
 *
 * 刚给库加上外键（migration 025），好处是「合同不能挂在不存在的客户名下」
 * 从此在数据库层面就不可能发生。但代价是：一旦真撞上，
 * 原始报错长这样 ——
 *
 *   insert or update on table "contracts" violates foreign key constraint
 *   "fk_contracts_customer"
 *
 * 而接口把它当成"未知异常"返回 **500**。
 * 500 在界面上等于「系统崩了」，同事只会截图来问；
 * 而真相其实是一句一句话能说清的：「这个客户不存在，先去客户管理建一下」。
 *
 * 金恩来一直在提的那条：**给用户的文案要说清后果，不要只说不行。**
 * 这里做的就是把「不行」翻译成「为什么不行、接下来怎么办」。
 *
 * PostgreSQL 的错误码是稳定的（不会随版本变），所以按码分派是可靠的；
 * 按错误文本匹配就不行了 —— 那是另一种"按形状猜"。
 */

/** 约束名 → 这件事用大白话怎么说 */
const CONSTRAINT_HINTS = {
  fk_contracts_customer: '这份合同指定的客户不存在。先到「客户管理」把客户建出来，再回来关联。',
  fk_projects_customer: '这个项目指定的客户不存在。先到「客户管理」把客户建出来，再回来关联。',
  fk_worklogs_project: '这条工作日志指定的项目不存在，可能刚被别人删掉了。刷新一下再试。',
  fk_audit_contract: '这条不符合项指定的合同不存在，可能刚被别人删掉了。刷新一下再试。',
  fk_audit_customer: '这条不符合项指定的客户不存在，可能刚被别人删掉了。刷新一下再试。',
  fk_audit_project: '这条不符合项指定的项目不存在，可能刚被别人删掉了。刷新一下再试。',
  idx_reminders_dedupe: '同样的提醒已经有一条了，系统不会重复生成。',
  reminders_status_check: '提醒状态只能是「待办 / 已办完 / 已归档」三者之一。',
};

/** 被引用而删不掉时，告诉人"先处理什么" */
const RESTRICT_HINTS = {
  contracts: '这个客户名下还有合同。合同是有法律意义的记录，不会跟着客户一起删 —— 请先处理那些合同。',
  projects: '这个客户名下还有项目。请先处理那些项目，再删客户。',
};

/**
 * 认得出来就返回 { status, message }，认不出来返回 null（交给原来的 500 路径）。
 *
 * **认不出来时一定要返回 null，不要瞎猜一句话**：
 * 一句听起来合理但其实不对的解释，比一个原始报错更耽误事 ——
 * 人会照着那句话去查，而方向是错的。
 */
const explainDbError = (e) => {
  if (!e || !e.code) return null;

  // 23503 = foreign_key_violation
  if (e.code === '23503') {
    const named = CONSTRAINT_HINTS[e.constraint];
    if (named) return { status: 400, message: named };
    /*
      删父记录被 RESTRICT 挡住时，e.table 是**子表**（被引用的那一方）。
      这个方向很容易记反，写的时候实测过：
      删 customers 撞上 contracts 的外键，e.table === 'contracts'。
    */
    const restrict = RESTRICT_HINTS[e.table];
    if (restrict) return { status: 409, message: restrict };
    return { status: 400, message: '关联的记录不存在，或者它底下还挂着别的记录，不能这样操作。' };
  }

  // 23505 = unique_violation
  if (e.code === '23505') {
    const named = CONSTRAINT_HINTS[e.constraint];
    if (named) return { status: 409, message: named };
    return { status: 409, message: '已经有一条一样的记录了，不能重复创建。' };
  }

  // 23514 = check_violation
  if (e.code === '23514') {
    const named = CONSTRAINT_HINTS[e.constraint];
    return { status: 400, message: named || '填的值不在允许的范围里。' };
  }

  // 23502 = not_null_violation
  if (e.code === '23502') {
    return { status: 400, message: `「${e.column || '必填项'}」不能为空。` };
  }

  return null;
};

module.exports = { explainDbError, CONSTRAINT_HINTS, RESTRICT_HINTS };
