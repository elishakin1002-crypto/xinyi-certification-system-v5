/**
 * 字段档案 —— 系统里每个术语数的是什么。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么这份字典必须从代码里长出来（2026-09-18）
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来：「系统的字段的解释或者定义你可以生成一份档案，放在系统中。」
 *
 * 最容易的做法是手写一份 Word 发给大家 —— 也是**最没用**的做法。
 * 手写的字典三个月后一定和代码对不上，而且没有任何机制会告诉你它对不上了。
 * 那时候它比没有更糟：人照着一份错的定义去核对数字，
 * 对不上就以为系统坏了（这正是 2026-09-17 那 37 条字段问题造成的局面）。
 *
 * 所以这里用的是**活文档**（living documentation）的做法：
 *
 *   · **词条名从常量里取**（`TERM_PROJECT.active` 等）—— 名字不可能漂移，
 *     改代码里的词，档案跟着变
 *   · **口径说明写在这里**，一条一条对应
 *   · `tests/field-dictionary.test.js` **双向卡死**：
 *     常量里有的词，字典里必须有解释；
 *     字典里写的词，必须真的还存在于代码里
 *
 * 新加一个术语忘了写口径 → 测试红。删掉一个术语忘了清档案 → 测试红。
 * 这样它才是机制，不是一份会过期的文档。
 *
 * ── 每条为什么都要写「口径」和「常见误解」──────────────────────
 *
 * 只写名字等于没写。37 条问题里最难缠的几条都不是名字错，
 * 是**同一个名字底下数的东西不一样**（三个「回款率」三个分母、
 * 三个「本周」三种窗口）。所以每条必须回答：
 *   数的是什么 / 不包括什么 / 人最容易误解成什么
 */
import { TERM_PROJECT, TERM_TASK, TERM_CONTRACT, TERM_RECEIVABLE, TERM_WINDOW } from '../glossary';
import {
  AUDIT_STATUS_LABEL, AUDIT_SEVERITY_LABEL, CONTRACT_RISK_LABEL, TASK_STATUS_LABEL,
  SETTLEMENT_STATUS_LABEL, REMINDER_SEVERITY_LABEL, INTEL_URGENCY_LABEL, FIELD
} from '../labels';

export type DictEntry = {
  /** 界面上显示的词。**从常量取，不写字面量** */
  term: string;
  /** 数的是什么 —— 要具体到"包括什么、不包括什么" */
  口径: string;
  /** 人最容易误解成什么。没有就不写 */
  易误解?: string;
};

export type DictSection = {
  id: string;
  title: string;
  intro?: string;
  entries: DictEntry[];
};

export const FIELD_DICTIONARY: DictSection[] = [
  {
    id: 'project',
    title: '项目',
    entries: [
      { term: TERM_PROJECT.active, 口径: '状态是「进行中」的项目数。已结项的不算。' },
      { term: TERM_PROJECT.completed, 口径: '走完结项流程（结清单 + PDCA）的项目。',
        易误解: '和「任务已完成」「合同已完成」不是一回事 —— 结项是一个有仪式的动作。' },
      { term: TERM_PROJECT.withOverdueTask, 口径: '进行中、且名下至少有一条任务过了截止日还没做完的项目。数的是**项目**，不是任务条数。',
        易误解: '一个项目有 5 条逾期任务，这里也只算 1。' },
      { term: TERM_PROJECT.dueSoon, 口径: '进行中、且（项目交期在未来 7 天内，或有未完成任务在未来 7 天内到期）。含今天。',
        易误解: '**不含已经过期的** —— 那些在「有逾期任务的项目」里。这一档说的是"还来得及"。' },
      { term: TERM_PROJECT.needsSetup, 口径: '进行中、且满足任一条：没有负责人 / 一条任务都没排 / 交付类但金额是 0。',
        易误解: '这类项目不逾期（因为没任务）、不报错，会安安静静烂掉 —— 所以单独列一张卡。' },
      { term: '人均进行中项目数', 口径: '已认领的进行中项目数 ÷ 真实负责人人数。',
        易误解: '「待指派」不是员工，不进分母，名下的项目也不进分子。' },
      { term: '项目延误率', 口径: '有逾期任务的进行中项目数 ÷ 进行中项目数。数的是项目，不是任务。' },
    ]
  },
  {
    id: 'project-status',
    title: '项目状态（单个项目）',
    entries: [
      { term: TERM_PROJECT.statusActive, 口径: '在做。' },
      { term: TERM_PROJECT.statusCompleted, 口径: '已经走完结项流程。' },
      { term: TERM_PROJECT.statusRisk, 口径: '被人工标了风险。',
        易误解: '和「有逾期任务」是两回事：一个是人的判断，一个是日期算出来的。' },
      { term: TERM_PROJECT.statusPending, 口径: '立了项但还没开始排任务。' },
    ]
  },
  {
    id: 'task',
    title: '任务',
    entries: [
      { term: TERM_TASK.open, 口径: '状态不是「已完成」也不是「已跳过」的任务。',
        易误解: '**跳过算了结** —— 人已经交代过为什么不做了，不再算未完成。' },
      { term: TERM_TASK.overdue, 口径: '过了截止日还没做完，**而且只算进行中项目里的**。',
        易误解: '已结项项目里没勾完的任务不算 —— 那是收尾没做干净的记录问题，不该天天挂在人的待办上。' },
      { term: TERM_TASK.dueSoon, 口径: '未来 7 天内到期、还没做完的任务。' },
      { term: TASK_STATUS_LABEL.Pending, 口径: '排上了但还没开始。' },
      { term: TASK_STATUS_LABEL.InProgress, 口径: '正在做。' },
      { term: TASK_STATUS_LABEL.Completed, 口径: '做完了。' },
      { term: TASK_STATUS_LABEL.Skipped, 口径: '决定不做了，并填了原因。',
        易误解: '和「还没开始」完全不同：一个是没轮到，一个是已经做了决定。' },
      { term: FIELD.projectManager, 口径: '整个项目的负责人。' },
      { term: FIELD.taskOwner, 口径: '某一条任务的执行人。',
        易误解: '和项目负责人可以不是同一个人 —— 一份合同常有多个服务项由不同咨询师做。任务没指定执行人时，显示「由项目负责人承接」。' },
    ]
  },
  {
    id: 'money',
    title: '钱：应收、实收、回款率',
    intro: '这一组最容易混。记住一句：**「应收」按约定的收款日算，「实收」按钱真正到账的日子算，两者本来就对不上，差额就是该收没收到的。**',
    entries: [
      { term: '本月应收', 口径: '约定收款日落在本月的金额合计，不管收没收到。' },
      { term: '本月实收', 口径: '**实际到账日**落在本月的金额合计 —— 这个月账上真进了多少，能对银行流水。',
        易误解: '2026-09-18 之前的回款没有记到账日，那些**不进任何一个月**，界面会单独提示有几笔。硬按到期日归月就是在重犯以前的错。' },
      { term: '回款率', 口径: '已收金额 ÷ **合同总额**。全系统只有这一个口径。',
        易误解: '分母不是"回款节点计划总额" —— 少录一期节点分母变小，回款率反而变好看，数据缺失就被藏起来了。所以合同金额没拆进节点的部分会单独提示。' },
      { term: '催收率', 口径: '**已经到期的应收**里收到了多少（已收 ÷ 已到期应收）。未到期的钱不进分母。',
        易误解: '它和「回款率」是一对，各答一个问题：回款率看**进度**（这单收了多少），催收率看**该收的收上来没有**。昨天刚签的合同回款率 0% 是正常的（钱还没到期），催收率才是真正的警报。' },
      { term: '回款/签约比', 口径: '近七个月到账金额 ÷ 同期新签合同金额。',
        易误解: '**不是回款率**。往年签的合同今年收到钱，分子有分母没有，这个比值可能超过 100%。' },
      { term: TERM_RECEIVABLE.overdue, 口径: '过了约定收款日还没收到的款。不限时间窗口。',
        易误解: '**没填收款日的不算逾期** —— 没约定就没有迟到，那是资料缺失，该去补。' },
      { term: TERM_RECEIVABLE.upcoming, 口径: '未来 30 天内到期、还没收到的应收。' },
      { term: FIELD.receivableNode, 口径: '合同拆出来的一期收款。',
        易误解: '这是公司**要收**的钱，和顾问结算（公司**要付**的钱）是两回事。' },
      { term: '待补项目金额', 口径: '交付类项目但项目金额是 0。',
        易误解: '量的是**项目金额**，不是合同金额 —— 合同金额可能早就填好了，只是没带到项目上。' },
    ]
  },
  {
    id: 'settlement',
    title: '顾问结算（公司要付的钱）',
    entries: [
      { term: SETTLEMENT_STATUS_LABEL.draft, 口径: '结算单建出来了，还没人确认。' },
      { term: SETTLEMENT_STATUS_LABEL.confirmed, 口径: '确认过了，等付款。' },
      { term: SETTLEMENT_STATUS_LABEL.paid, 口径: '已经付出去了。' },
      { term: '未支付结算金额（含待确认）', 口径: '待确认 + 待支付两档的合计。',
        易误解: '它一定大于按「待支付」筛出来的金额 —— 中间还差一道确认。' },
    ]
  },
  {
    id: 'contract',
    title: '合同',
    entries: [
      { term: TERM_CONTRACT.statusActive, 口径: '在履行中的合同。' },
      { term: TERM_CONTRACT.statusCompleted, 口径: '履约完毕。',
        易误解: '项目那边叫「已结项」，是故意用不同的词：结项有仪式（结清单 + PDCA），合同完成只是履约完。' },
      { term: CONTRACT_RISK_LABEL.High, 口径: '人工标的高风险。' },
      { term: CONTRACT_RISK_LABEL.Medium, 口径: '人工标的中风险。' },
      { term: CONTRACT_RISK_LABEL.Low, 口径: '人工标的低风险。' },
      { term: TERM_CONTRACT.statusPending, 口径: '合同签了，但还没到生效日。' },
      { term: '未评估', 口径: '这份合同还**没有人评过风险**。',
        易误解: '不等于「没风险」。以前这种情况显示成绿色的「正常」，人会放心走开。' },
    ]
  },
  {
    id: 'audit',
    title: '不符合项',
    entries: [
      { term: AUDIT_STATUS_LABEL.Open, 口径: '已经登记，等对方整改。' },
      { term: AUDIT_STATUS_LABEL.Rectifying, 口径: '对方正在整改。' },
      { term: AUDIT_STATUS_LABEL.Verifying, 口径: '对方说改完了，等我方验证。',
        易误解: '和「整改中」是两个人在等 —— 一个等客户，一个等我们自己。手机上曾经把这两档合并显示成「整改中」。' },
      { term: AUDIT_STATUS_LABEL.Closed, 口径: '验证通过，关闭。',
        易误解: '不叫「已归档」—— 归档是合同和模板的说法。' },
      { term: AUDIT_SEVERITY_LABEL.Major, 口径: '严重不符合项。' },
      { term: AUDIT_SEVERITY_LABEL.Minor, 口径: '一般不符合项。' },
      { term: AUDIT_SEVERITY_LABEL.Observation, 口径: '观察项，不构成不符合。' },
      { term: FIELD.auditDeadline, 口径: '约定的整改完成日期。' },
    ]
  },
  {
    id: 'window',
    title: '时间窗口',
    intro: '三个词对应三种窗口，**不要混用**。同事看到两个「本周」数字不一样，多半就是窗口不同。',
    entries: [
      { term: TERM_WINDOW.naturalWeek, 口径: '本周一零点到现在。记日志、看工时用这个。' },
      { term: TERM_WINDOW.last7d, 口径: '今天往前数七天（滚动）。看"最近有没有在动"用这个。' },
      { term: TERM_WINDOW.next7d, 口径: '今天往后数七天（滚动）。看"接下来要交什么"用这个。' },
    ]
  },
  {
    id: 'scope',
    title: '范围与归属',
    entries: [
      { term: '与我相关', 口径: '我是项目负责人、我负责其中某个服务项、或有任务在我名下；**外加还没人认领的项目**。' },
      { term: '还没人认领', 口径: '负责人是「待指派」这类占位词、或者根本没填。',
        易误解: '这类项目对**所有人**可见 —— 藏起来的话它谁都看不到，会一直烂在那儿。看到了就指个负责人，它就只出现在那个人的列表里了。' },
      { term: '全公司', 口径: '不按归属过滤，看公司全部数据（只读，用来了解别人的进度）。' },
    ]
  },
  {
    id: 'misc',
    title: '其它',
    entries: [
      { term: REMINDER_SEVERITY_LABEL.high, 口径: '提醒的最高一档，要今天处理。' },
      { term: REMINDER_SEVERITY_LABEL.medium, 口径: '提醒的中间一档，要留意。' },
      { term: REMINDER_SEVERITY_LABEL.low, 口径: '提醒的最低一档。' },
      { term: INTEL_URGENCY_LABEL.high, 口径: '情报紧急度：高。' },
      { term: '允许 AI 引用', 口径: '这份资料**允许**被 AI 在回答时引用。',
        易误解: '只是一个许可开关。不代表 AI 已经读过、已经建好索引、或者模型被训练过。' },
      { term: '待修改密码账号', 口径: '下次登录必须改密码的账号数。',
        易误解: '不等于「还没首次登录」—— 管理员刚给谁重置过密码，那个人也会被算进来。' },
      { term: '只看启用账号', 口径: '过滤掉已停用的账号。',
        易误解: '账号启用 ≠ 在职。这一页允许登记兼职和临时合作方。' },
      { term: FIELD.unifiedSocialCreditCode, 口径: '企业的唯一标识，系统拿它查重。' },
      { term: FIELD.contactPhone, 口径: '联系电话，手机或座机都可以。' },
    ]
  }
];

/** 扁平化，给搜索用 */
export const allDictEntries = (): Array<DictEntry & { section: string }> =>
  FIELD_DICTIONARY.flatMap(s => s.entries.map(e => ({ ...e, section: s.title })));

/** 按词精确查 —— 帮助中心「解释这一项」用得上 */
export const lookupTerm = (term: string): (DictEntry & { section: string }) | undefined => {
  const key = String(term || '').trim();
  if (!key) return undefined;
  return allDictEntries().find(e => e.term === key);
};
