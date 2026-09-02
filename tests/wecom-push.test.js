// 企业微信推送：**不能谎报推送**。
//
// ── 为什么这条要单独测 ──────────────────────────────────────────
// 2026-08-24 之前系统里有一套模拟实现：给每个用户绑一个假 openid，
// 然后无条件把提醒标成 pushedToWeChat: true。
// 界面上写着「已微信通知」，同事那边一条都没收到。
//
// 危害不在于少发了一条消息，而在于**看到这个标记的人会以为
// 「系统已经提醒过他了」，从而不再当面跟进**。
// 一条没发出去的消息被记成已送达，比根本没有推送功能更危险。
//
// 所以这里测的全是「什么情况下不能算成功」。
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => {
  delete require.cache[require.resolve('../server/services/wecom')];
  delete require.cache[require.resolve('../server/services/reminderPush')];
  return require('../server/services/reminderPush');
};

const clearConfig = () => {
  delete process.env.WECOM_CORP_ID;
  delete process.env.WECOM_AGENT_ID;
  delete process.env.WECOM_SECRET;
};

const highRisk = { title: '任务逾期', content: '项目 X 首次辅导已超期', type: 'risk', urgency: 'high', ownerUserId: 'U-1' };

test('没配置企业微信时，一律不算推送成功', async () => {
  clearConfig();
  const { pushReminder } = load();
  const r = await pushReminder(highRisk, async () => ({ wecomUserId: 'ZhangSan', name: '张三' }));
  assert.equal(r.pushed, false, '没接入就说推送成功，是最危险的一种谎报');
  assert.match(r.reason, /未接入/);
});

test('人没填企业微信 userid 时，不算推送成功', async () => {
  process.env.WECOM_CORP_ID = 'wwtest';
  process.env.WECOM_AGENT_ID = '1000001';
  process.env.WECOM_SECRET = 'secret';
  const { pushReminder } = load();
  const r = await pushReminder(highRisk, async () => ({ wecomUserId: '', name: '李四' }));
  assert.equal(r.pushed, false);
  assert.match(r.reason, /未填写企业微信/, '要说清是谁没填，否则没人知道该去补哪个账号');
  clearConfig();
});

test('提醒没有接收人时，不算推送成功', async () => {
  process.env.WECOM_CORP_ID = 'wwtest';
  process.env.WECOM_AGENT_ID = '1000001';
  process.env.WECOM_SECRET = 'secret';
  const { pushReminder } = load();
  const r = await pushReminder({ ...highRisk, ownerUserId: '' }, async () => null);
  assert.equal(r.pushed, false);
  assert.match(r.reason, /没有指定接收人/);
  clearConfig();
});

test('低优先级提醒不打扰人，但也不谎称推送过', async () => {
  process.env.WECOM_CORP_ID = 'wwtest';
  process.env.WECOM_AGENT_ID = '1000001';
  process.env.WECOM_SECRET = 'secret';
  const { pushReminder, shouldPush } = load();
  const trivial = { title: '知识文档更新', type: 'info', urgency: 'low', ownerUserId: 'U-1' };
  assert.equal(shouldPush(trivial), false, '低优先级不该推到手机');
  const r = await pushReminder(trivial, async () => ({ wecomUserId: 'ZhangSan' }));
  assert.equal(r.pushed, false, '没推就是没推，不能标记成已推送');
  clearConfig();
});

test('高紧急度的提醒值得打扰，无论类型', () => {
  clearConfig();
  const { shouldPush } = load();
  assert.equal(shouldPush({ type: 'info', urgency: 'high' }), true);
  assert.equal(shouldPush({ type: 'risk', urgency: 'low' }), true, '风险类默认要推');
  assert.equal(shouldPush({ type: 'payment', urgency: '' }), true, '回款类默认要推');
});

test('推送正文第一行就说清是什么事', () => {
  clearConfig();
  const { formatMessage } = load();
  const msg = formatMessage(highRisk);
  const first = msg.split('\n')[0];
  assert.match(first, /信义系统/, '手机通知栏只显示前一行，必须自带来源');
  assert.match(first, /任务逾期/, '第一行要带上事由，不能只有「你有一条新提醒」');
  assert.match(msg, /项目 X/, '正文要有具体内容');
});
