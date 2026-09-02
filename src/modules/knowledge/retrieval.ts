/**
 * 知识库检索：从内部文档里挑出和问题相关的几篇，喂给 AI。
 *
 * ── 之前为什么不工作 ────────────────────────────────────────────
 * 原来的打分是拿**用户输入的整句话**去做子串匹配：
 *
 *     if (title.includes(q)) score += 8;    // q = "包装厂的复盘"
 *
 * 标题里当然不会出现一整句问话，所以所有文档恒定得 0 分，
 * 排序退化成「按数组顺序取前 4 篇」——检索出来的东西和问题无关。
 * 实测：问「包装厂的复盘」，匹配不到《客户复盘｜东莞市万豪包装有限公司》。
 *
 * 这类失效不会报错。AI 照样答，只是答得没用上公司自己的知识，
 * 看上去像是「AI 不懂我们的业务」，而实际是检索压根没生效。
 *
 * ── 中文没有空格，怎么切词 ──────────────────────────────────────
 * 不引入分词库（体积大、还要维护词典），用两条够用的规则：
 *   ① 英文数字整段保留 —— ISO 9001、HACCP、SC、22000 这类标准号最关键
 *   ② 中文按 2 字滑窗切 —— 「包装厂」→ 包装 / 装厂，「复盘」→ 复盘
 * 2 字窗对中文业务词命中率够高，代价是会产生「装厂」这类碎片，
 * 由下面的区分度过滤兜住。
 */

export interface RetrievableDoc {
  id: string;
  title?: string;
  summary?: string;
  content?: string;
  category?: string;
  /** 可信层级。影响排序，也决定 AI 引用时该怎么说 */
  trustLevel?: 'official' | 'ourExperience' | 'aiDraft';
  /** 失效日期（标准改版）。过期的降权并提示 */
  validUntil?: string;
  industry?: string;
  standards?: string[];
}

export interface ScoredDoc<T> {
  doc: T;
  score: number;
  /** 命中的词，用来在界面上说明「为什么给你这篇」 */
  hits: string[];
  /** 依据是否已过期（标准改版），界面和提示词里都要标出来 */
  expired: boolean;
  trustLevel: 'official' | 'ourExperience' | 'aiDraft';
}

/*
  可信层级权重。没标层级的按「我们的经验」处理——
  默认从严：不能让一份来路不明的文档享受标准原文的待遇。
*/
const TRUST_WEIGHT: Record<string, number> = {
  official: 1.3,
  ourExperience: 1.0,
  aiDraft: 0.5,
};

/** 问句里的功能词，出现在几乎所有问题里，对区分文档毫无帮助 */
const STOP_TERMS = new Set([
  '怎么', '如何', '哪些', '什么', '需要', '可以', '我们', '公司', '一下', '帮我',
  '有没', '没有', '这个', '那个', '关于', '的话', '是否', '要求', '请问',
]);

/** 从查询里抽取检索词 */
export const extractTerms = (query: string): string[] => {
  const q = String(query || '').trim();
  if (!q) return [];
  const terms = new Set<string>();

  // ① 英文/数字整段（ISO 9001 会被切成 ISO 和 9001，都保留）
  for (const m of q.matchAll(/[A-Za-z][A-Za-z-]*|\d{3,}/g)) {
    const t = m[0].toUpperCase();
    if (t.length >= 2) terms.add(t);
  }

  // ② 中文 2 字滑窗
  for (const seg of q.split(/[^一-龥]+/)) {
    for (let i = 0; i + 2 <= seg.length; i++) {
      const t = seg.slice(i, i + 2);
      if (!STOP_TERMS.has(t)) terms.add(t);
    }
  }
  return [...terms];
};

/**
 * 词的区分度（IDF）。一个词出现在越少的文档里，它越能说明问题。
 *
 * 第一版是「出现在超过一半文档里就直接不计分」——**在小语料上完全不成立**：
 * 库里只有 5 篇文档时，「包装」出现在 3 篇就被判成没有区分力，
 * 可它明明排除掉了另外 2 篇。结果是问「包装厂的复盘」一条都检索不到。
 *
 * 改用标准 IDF：log((N+1)/(df+0.5))。它随语料增长自然收敛——
 * 现在 14 篇文档时「包装」还有分量，将来几百篇时会自动降下去，
 * 不需要回来调阈值。df=0（库里根本没这个词）时返回 0。
 */
const discriminationOf = (term: string, docs: RetrievableDoc[]): number => {
  const df = docs.filter((d) =>
    `${d.title || ''}${d.summary || ''}${d.content || ''}`.toUpperCase().includes(term)).length;
  if (df === 0) return 0;
  return Math.log((docs.length + 1) / (df + 0.5));
};

/*
  字段权重：标题 > 摘要 > 正文。
  标题是人特意写的，命中标题几乎一定相关；
  正文里出现一次可能只是顺带提到。
*/
const FIELD_WEIGHT = { title: 8, summary: 4, content: 2 } as const;

/**
 * 按相关度给文档排序。
 *
 * @param minScore 低于这个分数不返回。**宁可什么都不给，也不要给不相关的**——
 *   塞一篇无关文档进 AI 的上下文，比不塞更糟：它会照着那篇答，
 *   而使用者以为那就是公司的规定。
 */
export const rankDocs = <T extends RetrievableDoc>(
  query: string,
  docs: T[],
  { limit = 4, minScore = 4 }: { limit?: number; minScore?: number } = {}
): ScoredDoc<T>[] => {
  const terms = extractTerms(query);
  if (!terms.length || !docs.length) return [];

  const weights = new Map(terms.map((t) => [t, discriminationOf(t, docs)]));

  return docs
    .map((doc) => {
      const title = String(doc.title || '').toUpperCase();
      const summary = String(doc.summary || '').toUpperCase();
      const content = String(doc.content || '').toUpperCase();
      let score = 0;
      const hits: string[] = [];

      for (const term of terms) {
        const w = weights.get(term) || 0;
        if (w === 0) continue;
        let field = 0;
        if (title.includes(term)) field = FIELD_WEIGHT.title;
        else if (summary.includes(term)) field = FIELD_WEIGHT.summary;
        else if (content.includes(term)) field = FIELD_WEIGHT.content;
        if (field > 0) { score += field * w; hits.push(term); }
      }

      // 整句原样出现在标题里 —— 少见但最强的信号
      const raw = String(query || '').trim().toUpperCase();
      if (raw.length >= 4 && title.includes(raw)) score += 20;

      /*
        可信层级影响排序：标准原文 > 我们的经验 > AI 草稿。

        同样相关的两份材料，标准原文该排在经验总结前面——
        经验可能只适用于某一类客户，标准是普遍成立的。
        AI 草稿降权最狠：它还没人审过，只配当提示，不配当依据。
      */
      score *= TRUST_WEIGHT[doc.trustLevel || 'ourExperience'] ?? 1;

      /*
        过期的知识**比没有知识更危险**——它看起来仍然权威。
        标准改版后旧版依据还在库里，AI 照着答就是错的。
        这里降权到三成而不是直接排除：有时旧版仍有参考价值，
        但要让新的排在前面，并由调用方在界面上标出「可能已过期」。
      */
      const expired = doc.validUntil && new Date(doc.validUntil) < new Date();
      if (expired) score *= 0.3;

      return { doc, score, hits, expired: Boolean(expired), trustLevel: doc.trustLevel || 'ourExperience' };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};
