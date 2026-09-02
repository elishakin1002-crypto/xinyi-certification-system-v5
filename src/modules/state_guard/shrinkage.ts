/**
 * 数据集「缩水」检测：一次保存让记录数掉了一大截，多半不是人干的。
 *
 * ── 为什么需要 ────────────────────────────────────────────────
 * state store 是**整份数组写入**：前端把一整个数据集写回去。
 * 只要有两个地方各持一份副本，后写的就会盖掉先写的——
 * 2026-08-28 就这么丢过 11 个员工账号，没有任何报错。
 *
 * 业务数据有 app_state_history 兜底（每次写都存一份完整快照），
 * 所以**理论上都能翻回去**。但真正的问题不是能不能恢复，是：
 *
 *   **没人会发现。** 页面上就是「少了几条」，不报错、不弹窗。
 *   等三个月后有人问「那个客户怎么没了」，备份早轮转掉了。
 *
 * 所以这里做的是**报警**，不是拦截。
 *
 * ── 为什么不拦 ────────────────────────────────────────────────
 * 拦了就会误伤真实的批量删除（清理演示数据、退掉一批无效线索）。
 * 一个会误伤的保护，最后一定会被要求关掉——那时它一点用都没有。
 *
 * 报警 + 完整历史 = 出事能查、能回滚；而拦截 = 有时候不能干活。
 */

export interface ShrinkVerdict {
  /** 是否可疑 */
  suspicious: boolean;
  before: number;
  after: number;
  /** 掉了多少条 */
  lost: number;
  /** 掉了百分之多少（0-1） */
  ratio: number;
  reason: string;
}

/*
  阈值。两条同时满足才算可疑：

  ① 掉了 30% 以上 —— 单看比例会误报小数据集
     （3 条变 2 条也是 33%，但那大概率就是删了一条）
  ② 至少掉了 5 条 —— 单看条数会漏掉小数据集的整批清空
     （所以下面还有一条「清空」的单独判定）

  阈值是拍出来的，但方向明确：宁可漏报几次小改动，
  不能因为频繁误报让人把这个提示当噪音忽略掉。
*/
const RATIO_THRESHOLD = 0.3;
const COUNT_THRESHOLD = 5;

export const checkShrinkage = (
  datasetKey: string,
  beforeCount: number,
  afterCount: number,
): ShrinkVerdict => {
  const before = Number(beforeCount) || 0;
  const after = Number(afterCount) || 0;
  const lost = Math.max(0, before - after);
  const ratio = before > 0 ? lost / before : 0;

  const base = { before, after, lost, ratio };

  if (before === 0 || lost === 0) {
    return { ...base, suspicious: false, reason: '' };
  }

  /*
    整个清空**永远可疑**，哪怕只有 1 条。

    空数组最常见的来源不是「真的全删了」，
    而是「前端还没加载完就触发了一次写」——
    那两种情况在数据上一模一样，分不出来，所以一律报。
  */
  if (after === 0) {
    return {
      ...base,
      suspicious: true,
      reason: `${datasetKey} 被清空了（原有 ${before} 条）。` +
        `整份清空极少是正常操作，更常见的是页面没加载完就触发了保存。`,
    };
  }

  if (ratio >= RATIO_THRESHOLD && lost >= COUNT_THRESHOLD) {
    return {
      ...base,
      suspicious: true,
      reason: `${datasetKey} 一次保存少了 ${lost} 条（${before} → ${after}，掉了 ${Math.round(ratio * 100)}%）。` +
        `如果不是有人在批量清理，很可能是旧数据覆盖了新数据。`,
    };
  }

  return { ...base, suspicious: false, reason: '' };
};

/** 数组长度。非数组（对象型数据集如 current_user_id）返回 -1，表示不适用 */
export const countOf = (value: unknown): number =>
  Array.isArray(value) ? value.length : -1;
