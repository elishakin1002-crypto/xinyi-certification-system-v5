import { Project, ProjectCategory, ProjectMode } from '../../types';

/**
 * 项目分类：只写这一份。
 *
 * ══════════════════════════════════════════════════════════════
 * 这一版为什么又改了（2026-09-08，第三次）
 * ══════════════════════════════════════════════════════════════
 *
 * 前两版都错在**分类轴选错了**，不是名字没起好。
 *
 * 第一版：交付项目 / 跟进项目 / 公共事务
 * 第二版：合同项目 / 跟进项目 / 其他事务
 *
 * 金恩来 2026-09-08：「就算交付项目是指签合同后建的项目，
 * 但那些没有签合同就直接打款或者走流程的项目呢？有些项目小比如
 * 台账指导可能就没有签合同，或者有些项目是先执行，后补合同。」
 *
 * 他说中了要害。我把三件不同的事压进了一个字段：
 *   ① 有没有客户   ② 收不收钱   ③ 有没有合同
 * 三选一只能表达其中几种组合，剩下的无处安放：
 *
 *   台账指导（有客户、收钱、没合同）   →  三类都装不下
 *   先执行后补合同（有客户、收钱、暂无合同） →  三类都装不下
 *
 * 而「合同」恰恰是三者里**最不稳定**的一个：能后补、能没有、
 * 能只是口头约定。拿它当分类轴，必然漏掉一大片真实业务。
 *
 * ── 同行怎么做 ────────────────────────────────────────────────
 *
 * PSA（专业服务管理）类工具的通行做法是：
 * **计费方式是项目的「属性」，不是项目的「类别」** ——
 * 区分 billable / non-billable，以及固定价 / 按工时 / 预付费，
 * 没有「合同项目 vs 非合同项目」这种分法。
 * 合同是可选挂件，挂上去用于对账，不挂项目照跑。
 *
 * ── 所以现在只有两类 ──────────────────────────────────────────
 *
 *   客户项目   给某个客户做的活。收不收钱是**属性**，不是类别。
 *   其他事务   不涉及任何客户的活（政府交办、内部建设、员工培训）。
 *
 * 建项目时不让人选类别，只问两句话，类别由系统推：
 *   ① 这活是给谁做的？  选客户（可当场新建）／ 不涉及客户
 *   ② 这活收不收钱？    收（填金额）／ 不收
 *
 * ── 「售前跟进」为什么退出项目 ────────────────────────────────
 *
 * 金恩来 2026-09-08：「把还在争取的客户去掉吧，这个放到项目里来不合理。」
 *
 * 对的，而且理由比"不合理"更硬：
 *   · **重复建模** —— 线索管理本来就在管"还没成的客户"。
 *     同一个潜在客户在线索里一条、项目里又一条，谁是准的？
 *     跟进记录写哪边？两边都写等于两边都不全。
 *   · **污染统计** —— 在制项目数、延误率、日志覆盖率这些指标的
 *     分母里混进了根本不是交付的东西。
 *   · **节奏完全不同** —— 项目有交付物和验收标准，
 *     争取客户没有；用同一套进度条量它，只会得出假进度。
 *
 * 售前的投入记在**线索的跟进记录**里，那才是它的位置。
 *
 * **但已有的 15 个跟进项目不删**：它们带着 11 条工时和历史。
 * FollowUp 保留为「只读的旧分类」——看得见、能收尾，但**建不出新的**。
 * 这和账号那条规矩是同一个道理：能删错误，不能删历史。
 */

/** 现在还能新建的类别。FollowUp 不在里面 —— 它只出不进 */
export const CREATABLE_CATEGORIES: ProjectCategory[] = ['Delivery', 'Public'];

export const PROJECT_CATEGORY_META: Record<ProjectCategory, {
  label: string;
  /** 什么时候建 */
  when: string;
  /** 钱怎么算 */
  money: string;
  /** 选中时显示的一句话 */
  hint: string;
  /** 是否已停用（只读旧数据） */
  legacy?: boolean;
}> = {
  Delivery: {
    label: '客户项目',
    when: '给某个客户做的活',
    money: '收不收钱另填，收钱的做完算营收',
    hint: '给某个客户做的活 —— 签了合同的、没签直接打款的、先干后补合同的，都是这一类。'
      + '必须选归属客户（搜不到可以当场新建），合同可以先空着。',
  },
  Public: {
    label: '其他事务',
    when: '不属于任何客户的活',
    money: '不涉及钱，但工时照常记',
    hint: '政府交办、行业活动、内部建设、员工培训这些。不要客户，也不计营收，但有人、有进度、有工时。',
  },
  FollowUp: {
    label: '售前跟进（旧）',
    when: '已停用 —— 售前请去线索管理',
    money: '不计营收',
    hint: '这一档已经停用：还在争取的客户属于「线索管理」，不该占一个项目。'
      + '这里的旧项目还能收尾，但不能再建新的。',
    legacy: true,
  },
};

/**
 * 类别 → 运行时模式。
 *
 * 库里存 projectCategory，过滤和面板显隐用 projectMode，
 * 两套名字并存是历史遗留。映射只写这一份，避免又一次「选了却看不见」。
 */
export const CATEGORY_TO_MODE: Record<ProjectCategory, ProjectMode> = {
  Delivery: 'delivery',
  FollowUp: 'followup',
  Public: 'public'
};

/** 列表的类别筛选值 */
export type ProjectModeFilter = ProjectMode | 'all';

/**
 * 由「给谁做 + 收不收钱」推出类别。
 *
 * **人不选类别，只回答这两句话。** 多一个选项就多一次「我该选哪个」的犹豫，
 * 而这两个问题他不用想 —— 答案本来就在他脑子里。
 */
export const deriveCategory = (input: {
  customerId?: string;
  billable?: boolean;
}): ProjectCategory => (String(input.customerId || '').trim() ? 'Delivery' : 'Public');

/**
 * 这个项目算不算营收。
 *
 * 老数据没有 billable 字段，按原来的口径回推：
 * 交付项目算营收，跟进和公共事务不算 —— 和改动前的行为一致，
 * 不会因为加了字段就让历史报表变个数。
 */
export const isBillable = (p: Pick<Project, 'projectCategory' | 'billable'>): boolean => {
  if (typeof p.billable === 'boolean') return p.billable;
  return p.projectCategory === 'Delivery';
};

/**
 * 这个项目挂没挂合同。
 *
 * ── 为什么不能直接判空字符串（2026-09-08 实测踩到）──────────
 *
 * AppContext 落库时会把空的 contractRef 默认成字符串 **「无关联」**：
 *   const incomingContractRef = p.contractRef || '无关联';
 *
 * 于是「没有合同」在库里有两种长相：'' 和 '无关联'。
 * 我第一版的「缺合同」判断只看了空字符串，结果**刚建的那个无合同项目
 * 一条都没被统计到** —— 提醒功能看着在跑，实际漏掉了它要提醒的东西。
 * 这种「不报错但一直漏」的最难发现。
 */
export const hasContract = (p: Pick<Project, 'contractRef'>): boolean => {
  const raw = String(p.contractRef || '').trim();
  return Boolean(raw) && raw !== '无关联';
};

/**
 * 列表按类别筛选的档位。
 *
 * 「售前跟进（旧）」只在库里真的还有这类项目时才出现 ——
 * 等最后一个收尾完，这一档自己就消失了，不用谁去清理。
 */
export const buildCategoryFilters = (hasLegacyFollowUp: boolean): readonly {
  value: ProjectModeFilter; label: string; title?: string;
}[] => [
  { value: 'all', label: '全部类别', title: '所有项目都显示' },
  {
    value: 'delivery',
    label: PROJECT_CATEGORY_META.Delivery.label,
    title: `${PROJECT_CATEGORY_META.Delivery.when}・${PROJECT_CATEGORY_META.Delivery.money}`
  },
  {
    value: 'public',
    label: PROJECT_CATEGORY_META.Public.label,
    title: `${PROJECT_CATEGORY_META.Public.when}・${PROJECT_CATEGORY_META.Public.money}`
  },
  ...(hasLegacyFollowUp ? [{
    value: 'followup' as ProjectModeFilter,
    label: PROJECT_CATEGORY_META.FollowUp.label,
    title: '已停用的旧分类，只剩收尾'
  }] : [])
];

/** 列表状态筛选。默认「全部状态」 */
export const STATUS_FILTERS = [
  { value: 'All' as const, label: '全部状态', title: '进行中和已完成都显示' },
  { value: 'Active' as const, label: '进行中', title: '还没结项的' },
  { value: 'Completed' as const, label: '已完成', title: '已经结项的' }
];

/** 列表范围筛选 */
export const SCOPE_FILTERS = [
  { value: 'related' as const, label: '与我相关', title: '我负责、我负责其中服务项、或有任务在我名下的项目' },
  { value: 'all' as const, label: '全公司', title: '公司全部项目（只读，用于了解别人的交付进度）' }
];
