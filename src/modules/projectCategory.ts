import { ProjectCategory, ProjectMode } from '../../types';

/**
 * 项目分类的名字和说明 —— 只写这一份。
 *
 * ── 为什么改名（2026-09-07）──────────────────────────────────
 *
 * 原来叫「交付项目 / 跟进项目 / 公共事务」，金恩来的原话：
 * 「名字完全无法 get 到『什么时候建』以及『钱』这两者内容，我基本都看误解了。」
 *
 * 他说得对。「交付项目」听起来像「已经交付完的」，
 * 而它其实是「合同签了、接下来要去交付的」—— 时间方向正好反了。
 *
 * 三类真正的区别是**钱从哪来**：
 *   有合同 → 做完算营收
 *   没合同 → 是投入，指望它变成合同
 *   没客户 → 不涉及钱
 *
 * 所以名字改成按**来源**命名，一眼能对上：
 *   合同项目 / 跟进项目 / 其他事务
 *
 * ── 为什么第三类叫「其他事务」而不是「公共事务」──────────────
 *
 * 金恩来：「宁愿笼统些，不要那么具体，否则不好归类。」
 * 「公共事务」听着像只能装政府的事，那内部装修、行业协会活动、
 * 给员工做的培训该往哪放？名字一具体，人就开始纠结「这算不算」，
 * 而纠结的结果通常是干脆不记。
 *
 * ── 名字要短，解释放在旁边 ──────────────────────────────────
 * 按钮上塞不下「什么时候建 + 钱怎么算」。所以名字只负责区分，
 * 每一项配一句 hint，在选择的地方直接显示出来。
 */

export const PROJECT_CATEGORY_META: Record<ProjectCategory, {
  label: string;
  /** 什么时候建 */
  when: string;
  /** 钱怎么算 */
  money: string;
  /** 选择时显示的一句话 */
  hint: string;
}> = {
  Delivery: {
    label: '合同项目',
    when: '合同签了之后',
    money: '有合同金额，做完算营收',
    hint: '合同签了、接下来要去交付的活。必须选归属客户 —— 它关系到结算和客户合作记录。',
  },
  FollowUp: {
    label: '跟进项目',
    when: '客户还没谈成时',
    money: '还没有钱，是投入',
    hint: '还在争取的客户。归属客户可以先空着，谈成了再补上。',
  },
  Public: {
    label: '其他事务',
    when: '不属于任何客户的活',
    money: '不涉及钱，但工时照常记',
    hint: '政府交办、行业活动、内部建设、员工培训这些。不要客户，也不计营收，但有人、有进度、有工时。',
  },
};

/**
 * 类别 → 运行时模式。
 *
 * 库里存的是 projectCategory（Delivery/FollowUp/Public），
 * 而过滤和面板显隐用的是 projectMode（delivery/followup/public）。
 * 两套名字并存是历史遗留，映射只写这一份，避免又一次「选了却看不见」。
 */
export const CATEGORY_TO_MODE: Record<ProjectCategory, ProjectMode> = {
  Delivery: 'delivery',
  FollowUp: 'followup',
  Public: 'public'
};

/** 列表的类别筛选值：三种模式，外加「全部」 */
export type ProjectModeFilter = ProjectMode | 'all';

/** 选择项目类别时，按这个顺序排 —— 最常用的在前面 */
export const PROJECT_CATEGORY_ORDER: ProjectCategory[] = ['Delivery', 'FollowUp', 'Public'];

/**
 * 列表按类别筛选的档位。
 *
 * 「全部类别」放第一个，也是默认值 —— 金恩来：
 * 「默认应该都是全部状态，然后若是要筛选内容，再由登录同事自己根据条件筛选。」
 *
 * 这里之所以把三类都列出来、而不是原来的「交付 / 跟进 / 两者都看」，
 * 是因为原来那三档**藏得住东西**：
 * 「其他事务」既不是交付也不是跟进，选哪一档都可能看不见它 ——
 * 实测里选「交付项目」反而会把它显示出来，选「跟进项目」却看不到。
 * 一个筛选器把某类数据变成谁都找不到，比多一个选项危险得多。
 */
export const CATEGORY_FILTERS: readonly { value: ProjectModeFilter; label: string; title?: string }[] = [
  { value: 'all', label: '全部类别', title: '合同项目、跟进项目、其他事务都显示' },
  ...PROJECT_CATEGORY_ORDER.map(cat => ({
    value: CATEGORY_TO_MODE[cat],
    label: PROJECT_CATEGORY_META[cat].label,
    title: `${PROJECT_CATEGORY_META[cat].when}・${PROJECT_CATEGORY_META[cat].money}`
  }))
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
