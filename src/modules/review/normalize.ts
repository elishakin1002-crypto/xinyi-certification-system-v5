/**
 * 月度经营判断：把模型返回的 JSON 收拾成能直接渲染的结构。
 *
 * ── 为什么要在代码里再卡一道 ────────────────────────────────────
 * 提示词里写了「每条建议必须指回下面某个具体数字」，但**提示词只是请求，不是保证**。
 * 模型照样会返回「加强客户维护」这种没有数字依据的条目，
 * 而它和有依据的条目长得一模一样——渲染出来老板分不出哪条能信。
 *
 * 所以这里硬性丢掉没有 why 的条目。宁可只剩一条，也不要三条里混着套话：
 * 一旦老板发现有一条是编的，另外两条他也不会再信了。
 *
 * 同理，条数上限也在这里卡死。提示词说「只给三条」，模型给五条时
 * 多出来的两条必然是凑数的——凑数的建议比不给建议更浪费注意力。
 */

export type Urgency = 'high' | 'medium' | 'low';

export interface MonthlyAction {
  title: string;
  /** 依据的具体数字。空的条目会被丢弃，见文件头 */
  why: string;
  firstStep: string;
  urgency: Urgency;
}

export interface MonthlyJudgement {
  period: string;
  actions: MonthlyAction[];
  /** 因为缺数据而判断不了的事 */
  cannotJudge: string[];
  /** 建议补上的数据 */
  dataToFix: string[];
  /** 被丢掉的条目数。要显示出来——静默丢弃会让人以为模型只给了这么多 */
  droppedCount: number;
}

const MAX_ACTIONS = 3;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const urgencyOf = (v: unknown): Urgency => {
  const s = text(v).toLowerCase();
  return s === 'high' || s === 'low' ? s : 'medium';
};

const stringList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(text).filter(Boolean);

export const normalizeJudgement = (raw: any, fallbackPeriod = ''): MonthlyJudgement => {
  const rawActions = Array.isArray(raw?.actions) ? raw.actions : [];

  const kept: MonthlyAction[] = [];
  let dropped = 0;

  for (const item of rawActions) {
    const title = text(item?.title);
    const why = text(item?.why);
    // 标题和依据缺任何一个都不要：没标题不知道做什么，没依据不知道凭什么
    if (!title || !why) {
      dropped++;
      continue;
    }
    if (kept.length >= MAX_ACTIONS) {
      dropped++;
      continue;
    }
    kept.push({ title, why, firstStep: text(item?.firstStep), urgency: urgencyOf(item?.urgency) });
  }

  return {
    period: text(raw?.period) || fallbackPeriod,
    actions: kept,
    cannotJudge: stringList(raw?.cannotJudge),
    dataToFix: stringList(raw?.dataToFix),
    droppedCount: dropped,
  };
};

/**
 * 签约趋势里的「零签约连续月数」。
 *
 * 单看柱状图，连着几个月为零并不显眼——柱子没有就是一片空白，
 * 眼睛会自动略过。**这恰恰是最该被看见的信号**，所以单独算出来摆在数字位。
 */
export const longestZeroStreak = (trend: Array<{ deals: number }>): number => {
  let best = 0;
  let cur = 0;
  for (const m of trend || []) {
    if (!m || Number(m.deals) > 0) cur = 0;
    else { cur++; if (cur > best) best = cur; }
  }
  return best;
};
