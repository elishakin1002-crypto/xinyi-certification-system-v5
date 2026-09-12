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

export interface NamedRecord { id: string; name?: string }

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
