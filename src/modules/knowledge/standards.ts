/**
 * 从文本里认出涉及的认证标准。**前后端共用同一份，不要各写各的。**
 *
 * ── 为什么抽出来 ────────────────────────────────────────────────
 * 客户复盘有两处生成：服务端 completeProject.js 和前端 AppContext。
 * 走哪一处取决于写开关，而 2026-08-24 查出两边已经漂移——
 * 服务端那份带标准号、可信层级、行业标签，前端那份只有标题和分类。
 *
 * 于是同一个业务动作，产出的复盘质量取决于一个环境变量，
 * 而没有任何人知道这件事，也不会有任何报错。
 *
 * 这就是「同一件事两份实现」的典型代价。规则放这里，两边都引。
 *
 * ── 为什么标准号这么重要 ────────────────────────────────────────
 * 它是信义业务里**最有区分度的检索词**，也是同事最自然的问法
 * （「ISO 9001 的复盘有哪些」）。而服务项常常写成「咨询服务合同书」，
 * 标题里完全看不出做的是什么体系——实测有 2/5 的复盘是这样。
 */

/** 标准识别规则。加新标准时改这里一处即可。 */
const STANDARD_PATTERNS: Array<[RegExp, string]> = [
  [/ISO\s*9001/i, 'ISO 9001'],
  [/ISO\s*14001/i, 'ISO 14001'],
  [/ISO\s*45001/i, 'ISO 45001'],
  [/ISO\s*22000/i, 'ISO 22000'],
  [/ISO\s*13485/i, 'ISO 13485'],
  [/ISO\s*27001/i, 'ISO 27001'],
  [/HACCP/i, 'HACCP'],
  // QS 与 SC 都是食品相关许可，写法很多，按业务叫法匹配
  [/食品相关产品生产许可|\bQS\b/, 'QS'],
  [/食品生产许可|\bSC\b/, 'SC'],
  [/BRC/i, 'BRC'],
  [/FSC/i, 'FSC'],
  [/两化融合/, '两化融合'],
  [/知识产权贯标|GB\/T\s*29490/i, '知识产权贯标'],
];

/** 从任意多段文本里识别标准，去重后按规则顺序返回 */
export const detectStandards = (...texts: Array<string | undefined | null>): string[] => {
  const blob = texts.filter(Boolean).join(' ');
  const out: string[] = [];
  for (const [re, name] of STANDARD_PATTERNS) {
    if (re.test(blob) && !out.includes(name)) out.push(name);
  }
  return out;
};

/**
 * 复盘标题。服务项名里已经带标准的就不重复加。
 *
 * 标准放在括号里追加，而不是替换服务项——
 * 客户名 + 服务项仍然是人认出这份复盘的方式，标准是给检索用的。
 */
export const buildPdcaTitle = (customerName: string, serviceLabel: string, standards: string[]): string => {
  const suffix = standards.length && detectStandards(serviceLabel).length === 0
    ? `${serviceLabel}（${standards.join('/')}）`
    : serviceLabel;
  return `客户复盘｜${customerName}｜${suffix}`;
};
