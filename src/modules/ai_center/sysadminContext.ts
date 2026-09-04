/**
 * 给系统管理员的 AI 装上「眼睛」。
 *
 * ── 为什么之前问它没用 ────────────────────────────────────────
 * 2026-09-03 业务方反馈：以系统管理员登录，问 AI「我有哪些权限和功能」，
 * 回答和其他角色没区别。
 *
 * 两个原因，第二个是根本：
 *   ① identityContext 里没有 SYS_ADMIN 的口径 —— 它只知道你权限大，
 *      不知道你是来**管系统**的
 *   ② **它手上一个系统数据都没有**。问「系统健康吗」，它只能拿常识作答，
 *      说的全是「建议定期检查备份」这种放之四海皆准的废话
 *
 * 第二条才是关键：**没有数据的诊断不叫诊断，叫算命。**
 *
 * ── 所以这里做的事很简单 ──────────────────────────────────────
 * 把已经存在的系统状态（错误、AI 花费、会话、数据规模）
 * 变成一段 AI 读得懂的文字，塞进提示词。
 *
 * 数据本来就在 /api/admin/sysadmin-overview 里，SysAdminBoard 一直在用。
 * 缺的只是「让 AI 也能看到」这一步。
 *
 * ── 为什么只给系统管理员 ──────────────────────────────────────
 * 这段文字里有 IP、登录时间、各人 AI 用量。
 * 顾问的 AI 不该知道谁几点从哪登录的 —— 那不是他该看的。
 */

export interface SysAdminSnapshot {
  errors?: {
    today?: { kinds?: number; occurrences?: number; unhandled?: number };
    top?: Array<{ kind?: string; message?: string; route?: string; count?: number; affected?: number }>;
  };
  ai?: {
    month?: { calls?: number; failures?: number; tokens?: number | string };
    today?: { calls?: number; tokens?: number | string };
    byDay?: Array<{ day?: string; calls?: number; tokens?: number | string }>;
    byUser?: Array<{ name?: string; calls?: number; tokens?: number | string }>;
  };
  security?: {
    sessions?: Array<{ name?: string; username?: string; ip?: string; created_at?: string }>;
    accounts?: { total?: number; pending_password?: number; disabled?: number; expired?: number };
    deniedRecent?: { n?: number };
  };
  data?: { size?: string; rows?: Array<{ table?: string; rows?: number }> };
  version?: { current?: string; deployedAt?: string };
}

const KIND_LABEL: Record<string, string> = {
  js: '页面报错', promise: '操作静默失败', api: '接口错误', render: '渲染失败',
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * 把系统状态写成 AI 能用的一段话。
 *
 * **写成「事实 + 判断依据」，不写结论**——
 * 结论让模型自己下，它才能结合用户的问题回答；
 * 我们把结论写死，它就只会照念，问什么都是同一段。
 */
export const buildSysAdminContext = (s: SysAdminSnapshot | null | undefined): string => {
  if (!s) return '';

  const L: string[] = ['', '### 系统当前状态（只有系统管理员能看到这段）', ''];

  // ── 错误 ────────────────────────────────────────────────
  const et = s.errors?.today;
  if (et) {
    L.push(`今日错误：${n(et.kinds)} 种，共发生 ${n(et.occurrences)} 次，其中 ${n(et.unhandled)} 种未处理。`);
  }
  const top = s.errors?.top || [];
  if (top.length > 0) {
    L.push('最近 7 天未处理的错误（按影响人数排）：');
    top.forEach((e, i) => {
      L.push(
        `${i + 1}. [${KIND_LABEL[String(e.kind)] || e.kind}] ${String(e.message || '').slice(0, 120)}` +
        `　页面 ${e.route || '未知'}　影响 ${n(e.affected)} 人，发生 ${n(e.count)} 次`,
      );
    });
    /*
      这一句是给模型的判断依据，不是结论。
      不写的话它会按「次数多 = 严重」排，而那正好是错的。
    */
    L.push('（判断轻重看**影响人数**优先于次数：一个人碰 100 次多半是他卡住反复试，'
      + '3 个人各碰 1 次说明所有人都会踩。）');
  } else if (et && n(et.unhandled) === 0) {
    L.push('最近 7 天没有未处理的错误。');
  }

  // ── AI 花费 ─────────────────────────────────────────────
  if (s.ai?.month || s.ai?.today) {
    const m = s.ai?.month, t = s.ai?.today;
    L.push('', `AI 用量：本月 ${n(m?.calls)} 次调用、${n(m?.tokens).toLocaleString('zh-CN')} tokens`
      + (n(m?.failures) > 0 ? `，其中 ${n(m?.failures)} 次失败` : '')
      + `；今天 ${n(t?.calls)} 次、${n(t?.tokens).toLocaleString('zh-CN')} tokens。`);
    L.push('（价格参考：DeepSeek 峰时约 ¥10/百万 tokens，Kimi 约 ¥40/百万。'
      + '全公司日上限 200 万 tokens，撞上说明有功能在反复调用，不是有人用得多。）');
    /*
      按天列出来，AI 才答得了「昨天花了多少」「今天是不是异常」。
      判断异常靠的是和前几天比，不是和某个绝对数字比 ——
      所以这里给的是序列，不是一个「日均」。
    */
    const bd = s.ai?.byDay || [];
    if (bd.length > 0) {
      L.push('近 7 天按天：' + bd.map((d) => `${d.day} ${n(d.calls)}次/${n(d.tokens).toLocaleString('zh-CN')}`).join('　'));
      L.push('（问「昨天/某天花了多少」时用这一行。判断今天是否异常，和前几天比，不要和绝对值比。）');
    }

    const bu = s.ai?.byUser || [];
    if (bu.length > 0) {
      L.push('本月按人：' + bu.slice(0, 5).map((u) => `${u.name} ${n(u.tokens).toLocaleString('zh-CN')}`).join('、'));
    }
  }

  // ── 账号与登录 ──────────────────────────────────────────
  const acc = s.security?.accounts;
  if (acc) {
    L.push('', `账号：共 ${n(acc.total)} 个`
      + (n(acc.pending_password) > 0 ? `，${n(acc.pending_password)} 个还没改过初始密码` : '')
      + (n(acc.disabled) > 0 ? `，${n(acc.disabled)} 个已停用` : '')
      + (n(acc.expired) > 0 ? `，${n(acc.expired)} 个已过有效期` : '') + '。');
  }
  const ss = s.security?.sessions || [];
  if (ss.length > 0) {
    L.push(`当前在线 ${ss.length} 个登录：`
      + ss.slice(0, 8).map((x) => `${x.name}(${x.ip || '未记录IP'})`).join('、'));
    /*
      同一个人多个会话是正常的（手机+电脑），不要当成异常报出来 ——
      误报一次，下次真有异常他也不会信。
    */
    L.push('（同一个人有多个登录是正常的，手机和电脑各算一个。'
      + '值得警惕的是**陌生 IP** 或者本人说自己没登录过。）');
  }
  if (n(s.security?.deniedRecent?.n) > 0) {
    L.push(`近 7 天被服务端授权拦下 ${n(s.security?.deniedRecent?.n)} 次请求。`
      + '（少量正常，突然变多要么有人在试探，要么某个人的权限配错了。）');
  }

  // ── 数据与版本 ──────────────────────────────────────────
  if (s.data?.size) {
    const rows = (s.data.rows || []).slice(0, 5).map((r) => `${r.table} ${n(r.rows)}`).join('、');
    L.push('', `数据库 ${s.data.size}${rows ? `，主要表：${rows}` : ''}。`);
  }
  if (s.version?.current) {
    L.push(`当前版本 ${s.version.current}${s.version.deployedAt ? `，部署于 ${s.version.deployedAt}` : ''}。`);
  }

  L.push('', '回答系统类问题时**必须引用上面的具体数字**，不要说「建议定期检查」这类没有信息量的话。',
    '如果上面没有相关数据，就直说「这一项现在没有数据」，不要编。', '');
  return L.join('\n');
};
