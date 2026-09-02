// 把提醒推到企业微信。
//
// ── 一条铁律 ────────────────────────────────────────────────────
// **发送成功才标记为已推送。** 没配置、找不到人、发失败，一律不标记。
//
// 2026-08-24 之前那套模拟实现是反例：它给每个人绑一个假 openid，
// 然后无条件把提醒标成 pushedToWeChat: true。界面上写着「已微信通知」，
// 同事那边一条都没收到——更糟的是，看到这个标记的人会以为
// 「系统已经提醒过他了」，从而不再当面跟进。
//
// 宁可不推送，也不能谎报推送。
const { isEnabled, sendToUser } = require('./wecom');

/** 什么样的提醒值得打扰人。低优先级的攒着在系统里看就行，不必推到手机 */
const WORTH_PUSHING = new Set(['risk', 'overdue', 'deadline', 'payment']);

const shouldPush = (reminder) => {
  if (!reminder) return false;
  const type = String(reminder.type || '').toLowerCase();
  const urgency = String(reminder.urgency || reminder.severity || '').toLowerCase();
  if (urgency === 'high' || urgency === '严重') return true;
  return WORTH_PUSHING.has(type);
};

/** 提醒正文。手机上看，第一行就要说清是什么事 */
const formatMessage = (reminder) => {
  const title = String(reminder.title || '系统提醒').trim();
  const content = String(reminder.content || '').trim();
  const date = String(reminder.date || '').trim();
  return [
    `【信义系统】${title}`,
    content,
    date ? `时间：${date}` : '',
    '登录系统查看详情',
  ].filter(Boolean).join('\n');
};

/**
 * 推送一条提醒给指定用户。
 *
 * @param reminder 提醒对象
 * @param resolveUser (userId) => { wecomUserId, name } | null
 * @returns { pushed:boolean, reason?:string }
 *   pushed 为 true 时**才可以**把提醒标记成已推送
 */
const pushReminder = async (reminder, resolveUser) => {
  if (!isEnabled()) return { pushed: false, reason: '未接入企业微信' };
  if (!shouldPush(reminder)) return { pushed: false, reason: '该提醒不值得打扰（按类型与紧急度判定）' };

  const targetId = String(reminder.ownerUserId || reminder.assigneeUserId || '').trim();
  if (!targetId) return { pushed: false, reason: '提醒没有指定接收人' };

  const user = typeof resolveUser === 'function' ? await resolveUser(targetId) : null;
  const wecomUserId = String(user?.wecomUserId || '').trim();
  if (!wecomUserId) {
    // 这不是错误，是「这个人还没填企业微信账号」。安静跳过，但如实说明原因
    return { pushed: false, reason: `${user?.name || targetId} 未填写企业微信 userid` };
  }

  const result = await sendToUser(wecomUserId, formatMessage(reminder));
  if (!result.ok) return { pushed: false, reason: result.reason };
  if (result.partial) return { pushed: false, reason: result.reason };  // 部分未送达也不算成功
  return { pushed: true };
};

module.exports = { pushReminder, shouldPush, formatMessage };
