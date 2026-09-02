/**
 * 高风险动作：AI 只能提案，人点一下才执行。
 *
 * ── 挑这三个的标准 ────────────────────────────────────────────
 * 不是「重要」，是**「做错了很难发现、发现了很难回退」**：
 *
 *   确认回款  账本是追加式的，改不回来，只能再记一条冲销——年底对账两条都在
 *   完成项目  一口气写七八处（评级、客户分级、PDCA 复盘、提醒、结算草稿）
 *   录入合同  金额是提成和业绩的基数，AI 把「壹拾贰万」读成 12 元就全错
 *
 * 相比之下「录一条线索」错了删掉重录就行，那就不算。
 *
 * ── 关键：区别在「谁决定的」，不在动作本身 ────────────────────
 * **人自己在页面上点按钮的路径完全没变**，一步都没加。
 * 走这条队列的只有「AI 从一句话推断出来的」——
 * 你说「那个包装厂的钱到了」，AI 得猜是哪个厂、哪一笔，中间隔着一层。
 *
 * 老板明确提过顾虑：他常年在外跑业务，任何需要他点一下的步骤都会变成堵点。
 * 所以这里**只拦 AI 的推断**，不拦人的操作。
 */

/** 走提案队列的动作键（对应 AI 动作块里的键名） */
export const HIGH_RISK_ACTIONS = ['confirm_receivable', 'complete_project', 'contract'];

export interface ProposalInput {
  source: string;
  sourceRef: string;
  title: string;
  action: { type: string; payload: any; reason: string };
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

const yuan = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? `¥${v.toLocaleString('zh-CN')}` : String(n ?? '');
};

/**
 * 把一个高风险动作变成一条提案。
 *
 * **标题必须写清「对谁、多少钱」**——队列里只显示这一行，
 * 看不出具体对象的话，人只能凭信任点批准，那这道闸就白设了。
 */
export const buildProposalFor = (
  key: string,
  payload: any,
  actorName: string,
): ProposalInput | null => {
  const p = payload || {};
  const by = actorName ? `（${actorName} 让 AI 做的）` : '';

  if (key === 'confirm_receivable') {
    return {
      source: 'chat_high_risk',
      sourceRef: String(p.contractId || ''),
      title: `确认回款到账：合同 ${p.contractId || '(未指明)'}${p.receivableId ? ` 第 ${p.receivableId} 笔` : ''}`,
      action: { type: 'CONFIRM_RECEIVABLE', payload: p, reason: '由 AI 对话推断' },
      reason: `**确认到账不可撤销**，而且会连带改项目付款状态和客户价值分级。` +
        `批准前请核对：这笔钱确实到账了，而且是这份合同的这一笔。${by}`,
      confidence: 'medium',
    };
  }

  if (key === 'complete_project') {
    return {
      source: 'chat_high_risk',
      sourceRef: String(p.projectId || ''),
      title: `完成项目：${p.projectId || '(未指明)'}`,
      action: { type: 'COMPLETE_PROJECT', payload: p, reason: '由 AI 对话推断' },
      reason: `完成会一口气触发评级、客户分级、生成 PDCA 复盘、发提醒、生成结算草稿，` +
        `**退不回来**。批准前确认这个项目真的交付完了。${by}`,
      confidence: 'medium',
    };
  }

  if (key === 'contract') {
    return {
      source: 'chat_high_risk',
      sourceRef: String(p.customerName || ''),
      title: `录入合同：${p.customerName || '(未指明客户)'} ${yuan(p.amount)}`,
      action: { type: 'CREATE_CONTRACT', payload: p, reason: '由 AI 对话推断' },
      reason: `**金额是提成和业绩的基数**，AI 读错小数点或单位后面全错。` +
        `批准前核对金额：${yuan(p.amount)}。${by}`,
      confidence: 'medium',
    };
  }

  return null;
};
