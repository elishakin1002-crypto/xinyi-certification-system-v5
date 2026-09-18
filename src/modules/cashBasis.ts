/**
 * 「应收」和「实收」分开 —— 财务口径只此一份。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个文件（2026-09-18）
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来：「写着本月已收，实际上算的是上月的应收款，容易让人误解。
 *   你看看成熟先进的设计是怎么样的，毕竟我不懂财务。」
 *
 * 他的直觉是对的，而且财务上有标准答案 —— 两套记账基础：
 *
 *   权责发生制（accrual basis）  按**应收到期日**归月  → 「本月应收」
 *   收付实现制（cash basis）     按**实际到账日**归月  → 「本月实收」
 *
 * 任何一个成熟的财务系统都会把这两条线分开：
 * 一条用来看**账龄和催收**（谁该付钱还没付），
 * 一条用来看**现金流**（这个月账上真进了多少）。
 * 它们**本来就应该对不上**，对不上的那部分正是"该收没收到"。
 *
 * ── 改之前是什么样 ────────────────────────────────────────────
 *
 *     receivables.filter(r => r.status === 'paid' && inMonth(r.dueDate, 本月))
 *
 * 「已经收到了」+「到期日在本月」——**两个基础都不是**，是个混合体：
 *   · 八月到期、九月才收到的钱  → 记在**八月**（八月并没有进这笔钱）
 *   · 九月真正进账的钱          → 九月的卡上**看不到**
 * 而这张卡叫「本月已收」，财务会拿它对银行流水，永远对不上。
 *
 * ── 怎么改的 ──────────────────────────────────────────────────
 *
 * 给回款节点加一个 `paidAt`（实际到账日），在「确认到账」那一刻记下来。
 * 应收存在合同的 JSONB 里，加字段不用改表结构，风险很低。
 *
 * **历史数据没有 paidAt** —— 这类数据不能硬塞进任何一个月：
 * 猜成到期日就是在重犯原来的错。所以它们单独计数，界面上明说
 * 「另有 N 笔没有记到账日期」，让人知道这个数字缺了什么，
 * 而不是给一个看起来完整、其实少了一截的金额。
 * 这和「别把看不到说成没有」是同一条。
 */

type ReceivableLike = {
  amount?: number | string | null;
  status?: string | null;
  dueDate?: string | null;
  /** 实际到账日（YYYY-MM-DD）。2026-09-18 起由「确认到账」写入；更早的数据没有 */
  paidAt?: string | null;
};

type ContractLike = {
  amount?: number | string | null;
  receivables?: ReadonlyArray<ReceivableLike> | null;
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const monthOf = (date?: string | null) => String(date || '').trim().slice(0, 7);

const allReceivables = (contracts?: ReadonlyArray<ContractLike> | null) =>
  (contracts || []).flatMap(c => (c?.receivables || []) as ReceivableLike[]);

const isPaid = (r: ReceivableLike) => String(r?.status || '') === 'paid';

/* ══════════════════════════════════════════════════════════════
   收付实现制 —— 这个月账上真进了多少
   ══════════════════════════════════════════════════════════════ */

/**
 * 本月实收（现金流）。只认**有记到账日**且落在本月的。
 * 财务拿这个数对银行流水，所以宁可少算也不能猜。
 */
export const receivedInMonth = (contracts: ReadonlyArray<ContractLike> | null | undefined, monthKey: string): number =>
  allReceivables(contracts)
    .filter(r => isPaid(r) && monthOf(r.paidAt) === monthKey)
    .reduce((acc, r) => acc + num(r.amount), 0);

/**
 * 已收但**没记到账日**的笔数。
 *
 * 界面必须把这个数说出来 —— 否则「本月实收」看起来完整，
 * 实际上少了一截，而少的那截没有任何提示。
 */
export const paidWithoutPaidAt = (contracts: ReadonlyArray<ContractLike> | null | undefined): number =>
  allReceivables(contracts).filter(r => isPaid(r) && !monthOf(r.paidAt)).length;

/* ══════════════════════════════════════════════════════════════
   权责发生制 —— 这个月该收多少、收到了多少
   ══════════════════════════════════════════════════════════════ */

/** 本月到期的应收合计（不管收没收到） */
export const dueInMonth = (contracts: ReadonlyArray<ContractLike> | null | undefined, monthKey: string): number =>
  allReceivables(contracts)
    .filter(r => monthOf(r.dueDate) === monthKey)
    .reduce((acc, r) => acc + num(r.amount), 0);

/** 本月到期、且已经收到的部分 —— 用来算「本月该收的收齐了没有」 */
export const dueAndReceivedInMonth = (contracts: ReadonlyArray<ContractLike> | null | undefined, monthKey: string): number =>
  allReceivables(contracts)
    .filter(r => isPaid(r) && monthOf(r.dueDate) === monthKey)
    .reduce((acc, r) => acc + num(r.amount), 0);

/* ══════════════════════════════════════════════════════════════
   回款率
   ══════════════════════════════════════════════════════════════ */

/**
 * 回款率 —— 全系统只有这一个口径：**已收 ÷ 合同总额**。
 *
 * 金恩来 2026-09-17：「我们之前没有算回款率，但一般是倾向于
 *   真实的回款进度。」
 *
 * 所以分母用**合同总额**（我们签了多少钱），不用"回款节点计划总额"：
 * 后者只是把合同金额拆成了几期，正常情况下两者应该相等 ——
 * **不相等就说明回款计划没录全**，那是数据缺失，不是另一个口径。
 * 拿计划总额当分母会把这个缺失藏起来：少录一期，回款率反而变好看。
 *
 * 所以这里返回缺口本身（`planGap`），由界面提示人去补，
 * 而不是换个分母绕过去。
 */
export const collectionProgress = (contracts: ReadonlyArray<ContractLike> | null | undefined) => {
  const list = contracts || [];
  const contractTotal = list.reduce((acc, c) => acc + num(c?.amount), 0);
  const planTotal = allReceivables(list).reduce((acc, r) => acc + num(r.amount), 0);
  const received = allReceivables(list).filter(isPaid).reduce((acc, r) => acc + num(r.amount), 0);

  return {
    /** 已收金额 */
    received,
    /** 合同总额（分母） */
    contractTotal,
    /** 回款节点计划总额 —— 只用来发现"计划没录全"，不当分母 */
    planTotal,
    /** 合同总额 − 计划总额。大于 0 说明有合同金额没被拆进回款节点 */
    planGap: contractTotal - planTotal,
    /** 回款率。没有合同金额时返回 null，**不返回 0** —— 0 会被当成"一分没收" */
    rate: contractTotal > 0 ? received / contractTotal : null
  };
};
