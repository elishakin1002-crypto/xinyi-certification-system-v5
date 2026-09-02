// 企业微信接入。两条通道，用途不同，不要混：
//
//   ① 应用消息（本文件的 sendToUser）
//      发给**公司内部成员**，直接进他的企业微信。需要 CorpId / AgentId / Secret。
//      用于「这条任务逾期了，@张三」这类必须落到具体某个人的提醒。
//
//   ② 群机器人 webhook（services/notifyService.js）
//      推到某个群。贴一个 URL 就能用，不需要密钥。
//      内部群里可以 @ 指定成员（填手机号）；**外部群里 @ 不了用普通微信的客户**。
//
// ── 不做什么 ────────────────────────────────────────────────────
// 不碰「微信个人号 API」（PC Hook / iPad 协议那类）。那违反微信使用规范、
// 封号风险高，而信义靠这套系统吃饭，不能拿主体账号去赌。
// 要触达客户的个人微信，正规路径是企业微信的「外部联系人」，
// 前提是客户先加了公司的企业微信——那是业务动作，不是技术能绕过去的。
//
// ── 一条铁律 ────────────────────────────────────────────────────
// **发送成功才算成功。** 没配置、发失败，一律如实返回 ok:false，
// 绝不静默当作已发送。2026-08-24 之前那套模拟实现就是反例：
// 它给每个人绑假 openid，把提醒标成「已推送微信」，
// 而实际一条都没发出去——界面显示已通知，同事什么都没收到。
const API = 'https://qyapi.weixin.qq.com/cgi-bin';

const cfg = () => ({
  corpId: String(process.env.WECOM_CORP_ID || '').trim(),
  agentId: String(process.env.WECOM_AGENT_ID || '').trim(),
  secret: String(process.env.WECOM_SECRET || '').trim(),
});

/** 配置齐了才算可用。缺一项就当没接入，安静地不发，而不是报错刷屏 */
const isEnabled = () => {
  const c = cfg();
  return Boolean(c.corpId && c.agentId && c.secret);
};

/*
  access_token 必须缓存。

  企业微信对获取 token 有频率限制，而且同一份凭证在有效期内返回的是同一个 token——
  每次发消息都去换一次，既会撞限流，也没有任何好处。
  官方有效期 7200 秒，这里按 7000 秒过期，留 200 秒余量给时钟误差和网络延迟。
*/
let tokenCache = { value: '', expiresAt: 0 };

const getAccessToken = async () => {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAt) return tokenCache.value;

  const c = cfg();
  const url = `${API}/gettoken?corpid=${encodeURIComponent(c.corpId)}&corpsecret=${encodeURIComponent(c.secret)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = await res.json().catch(() => ({}));

  if (body.errcode !== 0 || !body.access_token) {
    // 不缓存失败结果——下次调用应当重试，而不是拿着空 token 一直失败
    throw new Error(`获取 access_token 失败：${body.errcode} ${body.errmsg || ''}`);
  }
  tokenCache = {
    value: body.access_token,
    expiresAt: now + (Number(body.expires_in || 7200) - 200) * 1000,
  };
  return tokenCache.value;
};

/** 测试用：清掉缓存，强制下次重新换 token */
const resetTokenCache = () => { tokenCache = { value: '', expiresAt: 0 }; };

/**
 * 给内部成员发应用消息。
 *
 * @param touser 企业微信的 userid（不是姓名，也不是手机号）。多人用 | 分隔。
 * @param text   纯文本，超长会被企业微信截断，这里先截到 2000 字
 * @returns { ok, reason? }
 */
const sendToUser = async (touser, text) => {
  if (!isEnabled()) return { ok: false, reason: '未配置企业微信（WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_SECRET）' };
  const to = String(touser || '').trim();
  if (!to) return { ok: false, reason: '没有企业微信 userid，无法发送' };

  try {
    const token = await getAccessToken();
    const res = await fetch(`${API}/message/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: to,
        msgtype: 'text',
        agentid: Number(cfg().agentId),
        text: { content: String(text || '').slice(0, 2000) },
        safe: 0,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => ({}));

    /*
      errcode 0 才是成功。
      注意 invaliduser：部分收件人无效时企业微信仍返回 0，
      但会在 invaliduser 里列出没收到的人——那部分要如实报出来，
      不能因为 errcode 是 0 就当全员送达。
    */
    if (body.errcode !== 0) {
      return { ok: false, reason: `发送失败：${body.errcode} ${body.errmsg || ''}` };
    }
    const invalid = String(body.invaliduser || '').trim();
    if (invalid) return { ok: true, partial: true, invalidUsers: invalid, reason: `部分成员未送达：${invalid}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || '发送异常' };
  }
};

/**
 * 往群里发消息，可 @ 指定成员。
 *
 * @param webhookUrl 群机器人的 webhook 地址
 * @param text       消息正文
 * @param mentionMobiles 要 @ 的成员手机号数组。
 *   **外部群里 @ 不到用普通微信的客户**——这是企业微信的限制，不是这里的实现问题。
 *   内部群可以正常 @。
 */
const sendToGroup = async (webhookUrl, text, mentionMobiles = []) => {
  const url = String(webhookUrl || process.env.WECOM_GROUP_WEBHOOK || '').trim();
  if (!url) return { ok: false, reason: '未配置群机器人 webhook（WECOM_GROUP_WEBHOOK）' };
  if (!/^https:\/\/qyapi\.weixin\.qq\.com\//i.test(url)) {
    return { ok: false, reason: 'webhook 地址不是企业微信的域名，拒绝发送' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: {
          content: String(text || '').slice(0, 2000),
          mentioned_mobile_list: (mentionMobiles || []).map(String).filter(Boolean),
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => ({}));
    if (body.errcode !== 0) return { ok: false, reason: `群消息失败：${body.errcode} ${body.errmsg || ''}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || '群消息异常' };
  }
};

/** 连通性自检：只换 token，不发消息，避免测试时打扰同事 */
const checkConnectivity = async () => {
  if (!isEnabled()) return { ok: false, reason: '未配置企业微信' };
  try {
    resetTokenCache();
    await getAccessToken();
    return { ok: true, corpId: `${cfg().corpId.slice(0, 6)}***`, agentId: cfg().agentId };
  } catch (e) {
    return { ok: false, reason: e?.message || '连通失败' };
  }
};

module.exports = { isEnabled, sendToUser, sendToGroup, checkConnectivity, getAccessToken, resetTokenCache };
