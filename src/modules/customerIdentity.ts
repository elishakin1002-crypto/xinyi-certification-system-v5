/**
 * 「这家公司是不是已经在库里了」—— 只此一份判断。
 *
 * ── 为什么要单独抽出来（2026-09-12）────────────────────────────
 *
 * 金恩来：「客户管理中有 3 个『测试1』……我记得之前是有做过去重的功能的，
 * 不知道为什么改着改着就没有了！」
 *
 * 查下来他没记错，而且比"没了"更难缠：**去重从来只做了一半。**
 *   · 建项目弹窗里的「直接新建客户」查重了（`c.name === name`）
 *   · 客户管理页的「新建客户」**一次都没查过**
 *   · 服务端不查，数据库也没有唯一索引
 *
 * 所以同一个动作，走哪个门结果不一样 —— 他正是这么撞上的：
 * 弹窗里建「测试1」建不出第二个，客户管理里建几个都行。
 *
 * 这就是这个项目最高频的那类 bug（权限三份定义、任务列表三处、
 * 工作台六套）：**同一件事散在多处，补一处漏一处。**
 * 所以这次不在第二个页面上再补一遍规则，而是把规则收进这一个文件，
 * 让 addCustomer 这个唯一入口去用它 —— 以后再多几个入口也不会漏。
 *
 * ── 为什么不能用 `a === b` ────────────────────────────────────
 *
 * 客户名是人手打的，同一家公司在两个人手里能打出好几种样子：
 *   「温州天越包装有限公司」「温州天越包装有限公司 」（尾随空格）
 *   「温州 天越 包装有限公司」（中间空格）「测试１」（全角数字）
 *   「（浙江）」vs「(浙江)」（全角/半角括号）
 * 严格相等一个都拦不住，而它们在业务上就是同一家。
 */

/** 归一化：只用于比较，不改用户输进去的原文 */
export const normalizeCompanyName = (raw?: string): string =>
  String(raw || '')
    // 全角字母数字、全角空格、全角括号 → 半角
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    // 公司名里的空格没有语义（「温州 天越」和「温州天越」是一家），全去掉
    .replace(/\s+/g, '')
    // 括号统一成半角，书名号/中点这类分隔符不动（它们可能有意义）
    .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
    .toLowerCase();

/**
 * 一家客户的「身份」是什么 —— 这是这个文件真正要回答的问题。
 *
 * 金恩来 2026-09-12：「客户的名字规范应该怎么统一？都用公司名字吗？
 * 或者什么厂？同样名字的客户可以出现吗？」
 *
 * ── 结论：身份是**法人主体**，不是那串字 ──────────────────────
 *
 * 一家公司在工商局只有一个身份：**统一社会信用代码**（18 位）。
 * 名字是贴在它身上的标签 —— 会简写、会打错、会改名，
 * 而代码不会。所以：
 *
 *   · 填了代码 → 按代码判重（最可靠，改名也认得出是同一家）
 *   · 没填代码 → 按工商全称判重（够用，也是现在的现实）
 *
 * ── 为什么不能允许重名 ────────────────────────────────────────
 *
 * 合同、项目、不符合项三张表都按 customer_id 挂在客户身上。
 * 同一家公司两条记录 = 两个 id = **这家的历史被劈成两半**：
 * 打开 A 看到三个项目，打开 B 看到两个，两边都不是全貌。
 * 而「这家做过什么、还能复用什么」正是这个系统的核心用途。
 *
 * 所以默认**不许建**，而不是弹个框让人自己决定 ——
 * 把数据模型层面的问题丢给正在录数据的人当场判断，是设计没做完。
 *
 * ── 唯一的例外 ────────────────────────────────────────────────
 *
 * 两家**代码不同**的公司确实可能重名（「温州XX包装厂」个体户
 * 和「温州XX包装有限公司」简写后撞车）。这种情况下系统分得清，
 * 所以放行 —— 判断依据是代码，不是让人拍脑袋。
 */
export interface NamedRecord {
  id: string;
  name?: string;
  unifiedSocialCreditCode?: string;
}

/** 统一社会信用代码归一：去空格、转大写。18 位，含字母。 */
export const normalizeUscc = (raw?: string): string =>
  String(raw || '').replace(/\s+/g, '').toUpperCase();

export type DuplicateVerdict =
  | { kind: 'none' }
  /** 同一家：代码相同，或（都没代码时）名字相同 */
  | { kind: 'same'; existing: NamedRecord; by: 'uscc' | 'name' }
  /** 重名但代码不同 —— 确实是两家，放行 */
  | { kind: 'namesake'; existing: NamedRecord };

/**
 * 判一条待建/待改的客户和库里已有的关系。
 * @param excludeId 改现有客户时排除它自己
 */
export const judgeDuplicate = (
  candidate: { name?: string; unifiedSocialCreditCode?: string },
  list: NamedRecord[],
  excludeId?: string
): DuplicateVerdict => {
  const others = list.filter((c) => String(c.id) !== String(excludeId || ''));
  const code = normalizeUscc(candidate.unifiedSocialCreditCode);
  const key = normalizeCompanyName(candidate.name);

  // ① 代码相同 —— 铁证，哪怕名字完全不一样（改过名）也是同一家
  if (code) {
    const byCode = others.find((c) => normalizeUscc(c.unifiedSocialCreditCode) === code);
    if (byCode) return { kind: 'same', existing: byCode, by: 'uscc' };
  }
  if (!key) return { kind: 'none' };

  const byName = others.find((c) => normalizeCompanyName(c.name) === key);
  if (!byName) return { kind: 'none' };

  // ② 名字相同，但两边代码都填了且不一样 —— 真是两家，放行
  const otherCode = normalizeUscc(byName.unifiedSocialCreditCode);
  if (code && otherCode && code !== otherCode) return { kind: 'namesake', existing: byName };

  return { kind: 'same', existing: byName, by: 'name' };
};

/**
 * 在已有客户里找同名的那一家。
 * @param excludeId 编辑现有客户时要排除自己，否则一改就说「和自己重名」
 */
export const findDuplicateByName = <T extends NamedRecord>(
  name: string,
  list: T[],
  excludeId?: string
): T | null => {
  const key = normalizeCompanyName(name);
  if (!key) return null;
  return list.find(
    (c) => String(c.id) !== String(excludeId || '') && normalizeCompanyName(c.name) === key
  ) || null;
};

/**
 * 客户名该怎么写 —— 界面上直接告诉人，而不是指望大家默契一致。
 *
 * 规范就一条：**照营业执照的全称写**。
 * 「温州天越包装」「天越厂」「天越」都指同一家，但系统认不出来，
 * 而营业执照上的名字全公司只有一个版本。
 */
export const CUSTOMER_NAME_RULE = '照营业执照全称写，别用简称或厂名';
export const CUSTOMER_NAME_PLACEHOLDER = '营业执照全称，例如：温州天越包装有限公司';
