/**
 * 高风险动作的「意图核对」：用户自己的话里，有没有真的要求做这件事。
 *
 * ── 为什么需要（2026-08-31 实测）─────────────────────────────
 * 老板打了一句「在吗」，AI 回「收到，现在执行系统自我诊断并自动修复」，
 * 然后真的跑了一遍全系统自检。
 *
 * 模型不是笨，是**从上下文惯性推断**：前面几轮都在做自检，
 * 它就顺着接下去了。而代码这边照单全收——
 * **AI 说要执行就执行，从来没核对过「用户真的要这个吗」。**
 *
 * ── 为什么只管高风险动作 ──────────────────────────────────────
 * 「录一条线索」推错了，删掉重录就行；
 * 「确认回款」「完成项目」「系统自检并自动修复」推错了，代价完全不同。
 *
 * 低风险动作照旧放行——每个动作都要求逐字对上，AI 就没法用了。
 * 这里挡的是**代价不对等**的那几个。
 *
 * ── 这不是关键词匹配那么简单的事，但够用 ──────────────────────
 * 真正严谨的做法是让模型单独输出一次「用户的原始意图」再比对。
 * 那要多一次调用、多一份钱。对这几个动作，
 * 「用户自己的话里有没有相关的词」已经能挡掉绝大多数惯性误触发——
 * 而漏挡的情况，用户会看到一句明确的追问，不是默默执行。
 */

/** 需要核对意图的动作，以及能证明意图的词 */
const INTENT_EVIDENCE: Record<string, RegExp> = {
  // 「在吗」跑全系统自检，就是这条挡的
  diagnose: /诊断|自检|体检|检查系统|系统检查|自愈|自我修复|健康检查|排查/,
  // 确认到账不可撤销
  confirm_receivable: /回款|到账|收到款|付款|打款|款项|结清|确认收款/,
  // 完成会触发一连串级联
  complete_project: /完成|结项|收尾|做完|交付完|验收/,
};

export interface IntentCheck {
  ok: boolean;
  /** 缺少依据的动作键 */
  missing: string[];
}

/**
 * @param actionData  AI 输出的动作块
 * @param userMessage **用户自己这一轮说的话**（不是 AI 的回复，也不是历史）
 */
export const checkActionIntent = (
  actionData: Record<string, unknown>,
  userMessage: string,
): IntentCheck => {
  const said = String(userMessage || '');
  const missing: string[] = [];
  for (const key of Object.keys(actionData || {})) {
    const evidence = INTENT_EVIDENCE[key];
    if (!evidence) continue;              // 低风险动作不核对
    if (!evidence.test(said)) missing.push(key);
  }
  return { ok: missing.length === 0, missing };
};

/** 追问的话。要说清「为什么没做」，并给出一句能直接照抄的指令 */
export const buildIntentPrompt = (missing: string[], labels: Record<string, string>): string => {
  const names = missing.map((k) => labels[k] || k);
  const examples: Record<string, string> = {
    diagnose: '做一次系统自检',
    confirm_receivable: '确认 XX 合同的回款已到账',
    complete_project: '把 XX 项目标记为完成',
  };
  const how = missing.map((k) => `「${examples[k] || labels[k] || k}」`).join('、');
  return `🤔 我准备做的是**${names.join('、')}**，但你刚才那句话里没提到这件事，` +
    `所以我先停下来了——**没有执行任何操作**。\n\n` +
    `如果确实要做，直接说 ${how} 就行。`;
};

export const INTENT_GUARDED_ACTIONS = Object.keys(INTENT_EVIDENCE);
