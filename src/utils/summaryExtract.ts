/**
 * 文档摘要的取材策略（P0-11）。
 *
 * 原来是固定 `content.slice(0, 2000)`：
 * 对 5970 字的培训手册只读到前三分之一，摘要必然是「封面 + 目录」的废话；
 * 对 5 万字的质量手册更是只能看到封面。
 *
 * 按长度分层的道理：文档越长，开头越不代表全文，但**标题行**越能代表结构。
 * 所以长文改成「开头 + 全部标题 + 结尾」——用同样的 token 拿到更有代表性的内容。
 */

export type ExtractTier = 'full' | 'outline' | 'toc' | 'empty';

export interface ExtractResult {
  text: string;
  tier: ExtractTier;
  /** 原文字数，用于提示词里告诉模型这是节选 */
  originalLength: number;
}

/** 抓 Markdown 标题、编号条款、全角冒号小标题——中文文档常见的三种结构标记 */
const HEADING_RE = /^\s*(#{1,6}\s+.+|第[一二三四五六七八九十百]+[章节条]\s*.*|\d+(\.\d+)*\s+\S.*|[^\n]{2,30}[:：]\s*$)/;

const headingLines = (text: string, max: number): string[] => {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (HEADING_RE.test(line)) {
      const t = line.trim();
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= max) break;
    }
  }
  return out;
};

/**
 * 按长度分层抽取。
 *
 * - 3000 字以内：全文（够短，直接给）
 * - 3000 ~ 30000 字：开头 1500 + 全部标题 + 结尾 800
 *   （结尾常有结论/修订记录，比中间段落更有信息量）
 * - 30000 字以上：只给标题结构。全文摘要本来就做不准，
 *   与其烧一大笔 token 得到一段泛泛之词，不如老实给目录
 */
export const extractForSummary = (content: string | undefined | null): ExtractResult => {
  const text = String(content || '').trim();
  const len = text.length;

  if (len === 0) return { text: '', tier: 'empty', originalLength: 0 };
  if (len <= 3000) return { text, tier: 'full', originalLength: len };

  if (len <= 30000) {
    const heads = headingLines(text, 40);
    const parts = [
      text.slice(0, 1500),
      heads.length ? `\n\n【文档结构】\n${heads.join('\n')}` : '',
      `\n\n【结尾部分】\n${text.slice(-800)}`,
    ];
    return { text: parts.join(''), tier: 'outline', originalLength: len };
  }

  const heads = headingLines(text, 80);
  return {
    text: heads.length
      ? `【文档结构（全文 ${len} 字，仅提取标题）】\n${heads.join('\n')}`
      : text.slice(0, 3000),
    tier: 'toc',
    originalLength: len,
  };
};

/** 提示词。明确告诉模型这是节选，避免它把节选当全文下结论 */
export const buildSummaryPrompt = (title: string, r: ExtractResult): string => {
  const note =
    r.tier === 'full' ? ''
    : r.tier === 'outline' ? `\n\n注意：以下是全文 ${r.originalLength} 字的节选（开头 + 结构 + 结尾），请据此概括，不要臆测未给出的内容。`
    : `\n\n注意：全文 ${r.originalLength} 字过长，以下只有标题结构。请概括这份文档「涵盖哪些内容」，不要编造细节。`;
  return `请为文档《${title}》生成一份精炼摘要（100 字以内），突出核心价值和关键信息点。${note}\n\n${r.text}`;
};
