/**
 * 合同 ↔ 项目 的关联，只此一份。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-09-17）
 * ══════════════════════════════════════════════════════════════
 *
 * 仓库里到处是这一句：
 *
 *     projects.find(p => p.contractRef === contract.id || p.contractRef === contract.contractNo)
 *
 * **合同号没填的时候，这句话会把八竿子打不着的东西连起来。**
 * `contractNo` 是 NULL，某个项目的 `contractRef` 也是 NULL，
 * `NULL === NULL` 为真 —— 于是那张合同「认领」了一个跟它毫无关系的项目。
 *
 * 实测复现（2026-09-17，本机库）：
 *   - 嘉力那张合同没有合同号
 *   - 新建一个不关联任何合同的项目，负责人是验收顾问
 *   - 该顾问打开合同管理「与我相关」→ **嘉力合同出现在他的列表里**
 *     （归属是 isMyContract 通过"关联项目"算的，关联项目认错了人）
 *   - 项目管理列表里，8 个没客户的项目，客户列全写着「浙江嘉力」
 *
 * 这条在生产上一定会发生：一年 200~400 张合同，漏填一个合同号，
 * 它就变成一块磁铁，把所有没关联合同的项目都吸过去。
 *
 * 已经有人发现过其中几处，加了 `contract.contractNo && ...` 的守卫 ——
 * 19 处同款写法里 6 处有守卫、8 处没有。这就是项目里最高频的
 * 「改一处漏一处」。所以不补第 9 处，收口成这一份：
 * **空引用永远不匹配任何东西**，而且是在一个地方决定的。
 */

type ContractLike = {
  id?: string | null;
  contractNo?: string | null;
};

type ProjectLike = {
  contractRef?: string | null;
};

/** 空白、null、undefined 一律当"没填"。'  ' 也是没填 —— 导入的数据里真有这种 */
const refKey = (value?: string | null): string => String(value ?? '').trim();

/** 一张合同可以被哪几个键引用到。没填的键不算键 */
export const contractRefKeys = (contract?: ContractLike | null): string[] =>
  [refKey(contract?.id), refKey(contract?.contractNo)].filter(Boolean);

/**
 * 这个引用指向这张合同吗？
 *
 * 引用为空 → **一律 false**。这是整个模块存在的理由：
 * 「没填」不是一个可以用来匹配的值。
 */
export const refMatchesContract = (ref: string | null | undefined, contract?: ContractLike | null): boolean => {
  const key = refKey(ref);
  if (!key) return false;
  return contractRefKeys(contract).includes(key);
};

/** 按引用找合同。找不到返回 undefined */
export const findContractByRef = <T extends ContractLike>(
  contracts: readonly T[] | null | undefined,
  ref: string | null | undefined
): T | undefined => {
  if (!refKey(ref)) return undefined;
  return (contracts || []).find((contract) => refMatchesContract(ref, contract));
};

/** 这张合同立的项目。没立返回 undefined */
export const findProjectByContract = <T extends ProjectLike>(
  projects: readonly T[] | null | undefined,
  contract?: ContractLike | null,
  extraFilter?: (project: T) => boolean
): T | undefined => {
  const keys = contractRefKeys(contract);
  if (!keys.length) return undefined;                 // 合同自己没有任何可被引用的键
  return (projects || []).find(
    (project) => refMatchesContract(project.contractRef, contract) && (!extraFilter || extraFilter(project))
  );
};
