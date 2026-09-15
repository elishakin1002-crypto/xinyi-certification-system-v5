/**
 * 「这条记录归谁」—— 归属判定只有这一份。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个文件（2026-09-15）
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来用「合同识别」一次建了合同 + 客户 + 项目，然后看到：
 *
 *     合同管理 · 与我相关   有「浙江嘉力生物技术开发有限公司」
 *     项目管理 · 与我相关   没有
 *
 * 他的原话：「合同管理与我有关的包括"嘉力"而项目管理中与我有关的
 *            不包括"嘉力"怎么回事？」
 *
 * 真因不是项目没建出来（关系表和 app_state_latest 里都在），
 * 是**那个项目不属于任何人**：
 *     contract.owner  = '黄佳佳'     ← 建合同时写了操作人
 *     project.manager = '待指派'     ← 建项目时写死了这个词
 *     project.ownerUserId = 空
 *     9 条自动生成的任务 owner 也全是 '待指派'
 *
 * 于是「与我相关」的四条判据一条都不成立 ——
 * **不属于任何人，等于对每个人都隐藏**，包括刚刚亲手建它的人。
 *
 * ── 为什么原来的防线没拦住 ────────────────────────────────────
 *
 * AppContext 里本来有一句「强制校验：必须有负责人」：
 *     if (!p.manager || p.manager === '待定') return null;
 * 它只挡了 '待定' 一个词，而合同识别传的是 '待指派'。
 *
 * 这是 CLAUDE.md 二点五第 1 条的形状：**判空写成枚举几个已知的词**，
 * 别人新写一个说法就漏过去，而且不报错。
 * 所以这里把「无主」的说法集中到一处，加词只加这里。
 */

/**
 * 界面上表示「还没定负责人」的几种写法。它们等价。
 *
 * 新增说法只能加在这里 —— 加在别处等于又开一个漏口。
 */
export const UNOWNED_LABELS = ['待定', '待指派', '未指派', '待分配', '无', '-', '—'] as const;

/** 这个名字算不算「没有负责人」。空串、空白、以及上面那几个词都算 */
export const isUnownedName = (name?: string | null): boolean => {
  const v = String(name ?? '').trim();
  return v === '' || (UNOWNED_LABELS as readonly string[]).includes(v);
};

/**
 * 这个项目是不是**无主**的：既没有 ownerUserId，负责人名字也是「待指派」这类占位。
 *
 * 用途有两个，方向相反但目的一致：
 *   1. 建项目时 —— 发现无主就兜底到当前操作人，别让它生出来
 *   2. 列表筛选时 —— 万一库里已经有无主的（生产上可能有历史数据），
 *      **不许被「与我相关」藏起来**。无主是需要有人认领的异常，
 *      藏起来的后果是一个没人做的项目安安静静地烂掉。
 */
export const isUnownedProject = (project: {
  manager?: string | null;
  ownerUserId?: string | null;
} | null | undefined): boolean => {
  if (!project) return false;
  if (String(project.ownerUserId ?? '').trim()) return false;
  return isUnownedName(project.manager);
};
