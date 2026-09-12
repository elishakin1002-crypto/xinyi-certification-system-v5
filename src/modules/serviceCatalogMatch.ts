/**
 * 把「合同上写的那句话」映射到标准服务目录。
 *
 * ── 为什么要有这个（2026-09-12）────────────────────────────────
 *
 * 金恩来：「这里主要是目前的合同不够规范，同时识别 pdf 也常常不够准确，
 * 这里还是需要，提供标准的服务项目多选会更准确，高效」。
 *
 * 他指的是同一个老问题的两头：
 *   · 合同是人写的 —— 「ISO三体系」「ISO 9001/14001/45001」「三体系认证咨询」
 *     指的是同一批事，但字面上没有一个字一样
 *   · AI 从 PDF 里读出来的是**原文**，原文不规范，读得再准也还是不规范
 *
 * 所以规范化不能指望识别环节，要靠**录入时从固定目录里选**。
 * AI 的职责随之变了：不再是「填一个字符串」，而是
 * **「在 111 条标准目录里替人先勾好」** —— 勾错了人一眼能看出来，
 * 而自由文本错了没人看得出来。
 *
 * ── 匹配为什么不能只做字符串包含 ──────────────────────────────
 *
 * 「ISO9001」「ISO 9001」「iso-9001」「GB/T 19001」是同一件事；
 * 而「ISO 14001」包含「14001」，「ISO 22000」包含「2000」——
 * 光做 includes 会把 ISO 20000 匹配进 ISO 22000 的文本里。
 * 所以：先按代码（去掉所有非字母数字后比对，且要求边界），
 * 再按全名，最后才按别名。
 */
import { SERVICE_CATALOG } from '../../constants';
import type { ServiceCatalogItem } from '../../types';

/** 只留字母数字并大写 —— 「ISO 9001」「iso-9001」「ＩＳＯ9001」都归成 ISO9001 */
const squash = (raw?: string): string =>
  String(raw || '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[^0-9A-Za-z一-龥]/g, '')
    .toUpperCase();

/**
 * 代码要按「边界」匹配，不能裸 includes。
 * 例：目录里有 ISO20000，而合同里写 ISO22000 —— 裸 includes 不会错，
 * 但目录里也有 SC / CE / KC 这种两字母代码，裸 includes 会在
 * 「SCAN」「CERT」这类词里疯狂误命中。所以短代码要求两侧不是字母数字。
 */
const hasCode = (haystack: string, code: string): boolean => {
  if (!code) return false;
  const c = squash(code);
  if (!c) return false;
  if (c.length >= 5) return haystack.includes(c);
  const re = new RegExp(`(^|[^0-9A-Z])${c}([^0-9A-Z]|$)`);
  return re.test(haystack);
};

export interface CatalogMatch {
  /** 认出来的标准目录项，按目录顺序 */
  matched: ServiceCatalogItem[];
  /** 认不出来的片段 —— 要摆给人看，别偷偷丢掉 */
  unmatched: string[];
}

/**
 * 从一段自由文本里认出标准服务项。
 *
 * **认不出来的不丢**：合同里写的东西认不出来，可能是目录缺了这一项，
 * 也可能是写法太偏。两种都需要人看一眼，偷偷丢掉就变成
 * 「系统自作主张改了合同内容」——那是这个系统最不该做的事。
 */
export const matchCatalogItems = (raw?: string): CatalogMatch => {
  const text = String(raw || '').trim();
  if (!text) return { matched: [], unmatched: [] };

  const squashedAll = squash(text);
  const matched: ServiceCatalogItem[] = [];

  for (const item of SERVICE_CATALOG) {
    const byCode = hasCode(squashedAll, item.code || '');
    const byName = squashedAll.includes(squash(item.name));
    const byAlias = (item.aliases || []).some((a) => hasCode(squashedAll, a) || squashedAll.includes(squash(a)));
    if (byCode || byName || byAlias) matched.push(item);
  }

  /*
    按「、，,；;/」切开原文，逐段看有没有被认走。
    一段都没命中的，原样留给人确认 —— 它可能是目录该补的一项。
  */
  const pieces = text.split(/[、，,；;\/\n]+/).map((s) => s.trim()).filter(Boolean);
  const unmatched = pieces.filter((piece) => {
    const sq = squash(piece);
    if (!sq) return false;
    return !matched.some((m) =>
      sq.includes(squash(m.name)) || squash(m.name).includes(sq)
      || hasCode(sq, m.code || '')
      || (m.aliases || []).some((a) => hasCode(sq, a) || sq.includes(squash(a)))
    );
  });

  return { matched, unmatched };
};

/** 选中的标准项 → 存进合同 serviceLine 的那串字（标准名，顿号分隔） */
export const toServiceLine = (items: Array<{ name: string }>, extras: string[] = []): string =>
  [...items.map((i) => i.name), ...extras].filter(Boolean).join('、');

/**
 * 搜索用：打「iso9001」「体系」「食品」「SC」都要能找到。
 * 代码、全名、别名、大类名都参与。
 */
export const searchCatalog = (keyword: string): ServiceCatalogItem[] => {
  const k = squash(keyword);
  if (!k) return SERVICE_CATALOG;
  return SERVICE_CATALOG.filter((item) =>
    squash(item.name).includes(k)
    || squash(item.code).includes(k)
    || squash(item.category).includes(k)
    || (item.aliases || []).some((a) => squash(a).includes(k))
  );
};
