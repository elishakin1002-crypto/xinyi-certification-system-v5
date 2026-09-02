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

module.exports = { notify, detectChannel };
