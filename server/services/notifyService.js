// 真实通知推送：企业微信 / 钉钉 / 飞书 群机器人 webhook（贴 URL 即可，无需 OAuth）。
// 替代原 wechatService 的 Mock。webhook URL 来自 NOTIFY_WEBHOOK_URL 或调用时传入。
const buildBody = (url, text) => {
  if (/dingtalk\.com/i.test(url)) return { msgtype: 'text', text: { content: text } };            // 钉钉
  if (/(feishu|larksuite)\.(cn|com)/i.test(url)) return { msg_type: 'text', content: { text } };   // 飞书
  return { msgtype: 'text', text: { content: text } };                                             // 企业微信（默认）
};

const detectChannel = (url) => {
  if (/dingtalk\.com/i.test(url)) return 'dingtalk';
  if (/(feishu|larksuite)\.(cn|com)/i.test(url)) return 'feishu';
  if (/qyapi\.weixin\.qq\.com/i.test(url)) return 'wecom';
  return 'unknown';
};

const notify = async (text, webhookUrl) => {
  const url = String(webhookUrl || process.env.NOTIFY_WEBHOOK_URL || '').trim();
  if (!url) return { ok: false, reason: '未配置 webhook（NOTIFY_WEBHOOK_URL）' };
  /*
    ⚠️ 这个函数默认发的是 **业务通道**（工作群）。

    系统错误、异常登录、AI 花费这类内容**不要走这里** ——
    发到工作群，顾问看到「Cannot read properties of undefined」只会慌，
    而且帮不上任何忙；发几次之后所有人开始无视这个群，
    连真正要紧的「某某证书下月到期」也一起被无视了。

    管理类通知走 notifyAdmin()，见下方。
  */
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'webhook URL 非法' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(url, String(text || '').slice(0, 2000))),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    // 各平台成功码：企业微信/钉钉 errcode=0；飞书 code=0/StatusCode=0
    const okCode = data.errcode === 0 || data.code === 0 || data.StatusCode === 0;
    return { ok: res.ok && (okCode || Object.keys(data).length === 0), channel: detectChannel(url), status: res.status, raw: data };
  } catch (e) {
    return { ok: false, reason: e?.message || 'push failed', channel: detectChannel(url) };
  }
};


/*
  ── 管理通道：只发给系统管理员，不发工作群 ────────────────────

  两条通道分开，是因为**收的人和该做的事完全不同**：

    业务通道（工作群）   「浙江xx厂的证书下月到期，该联系续证了」
                        → 顾问看了知道该干什么

    管理通道（管理员群） 「今天 3 个页面报错，影响 2 人」
                        → 只有技术能处理，顾问看了只会慌

  ── 为什么没配就不发，而不是退回业务通道 ──────────────────────
  「宁可漏发，也不能把系统报错倒进全公司的群」。
  退回去发一次，全公司就学会一件事：这个群的消息可以不看。
  而那正是这套通知机制唯一的死法。
*/
const notifyAdmin = async (text) => {
  const url = String(process.env.ADMIN_WEBHOOK_URL || '').trim();
  if (!url) {
    return {
      ok: false,
      reason: '未配置管理通道（ADMIN_WEBHOOK_URL）。'
        + '系统类通知不会退回业务群 —— 那会让全公司学会无视这个群。',
    };
  }
  return notify(text, url);
};

module.exports = { notify, notifyAdmin, detectChannel };
