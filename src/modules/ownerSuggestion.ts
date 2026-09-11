import { Project, Customer } from '../../types';
import { groupServiceLine, isOutsourced, SERVICE_OWNERS, ServiceGroup, SERVICE_GROUP_META } from './serviceLine';
import { groupIndustry } from './industry';

/**
 * 建议负责人 —— 这活该派给谁。
 *
 * ══════════════════════════════════════════════════════════════
 * 金恩来 2026-09-11 问的就是这个
 * ══════════════════════════════════════════════════════════════
 *
 * 「你这个建议要怎么实现呢？在输入项目名称和项目的服务内容时
 *   根据少量信息判断推荐吗？」
 *
 * **不是。只靠输入那几个字是最弱的做法。**
 *
 * 系统手上已经有比「刚敲进去的一行字」强得多的信号，
 * 而最强的那个恰好解决他同时提的另一个担心：
 *
 * 「全员上的话，难免会遇到同样的客户做同样咨询的抢客户的情况。」
 *
 * ── 四个信号，按强弱排 ────────────────────────────────────────
 *
 * ① **这家客户以前是谁做的同类服务**（最强，权重 50）
 *    这是防抢客户的**锚**。客户 A 去年的 SC 是佳佳做的，今年续期还找上门，
 *    那就该是佳佳 —— 不是谁先看见谁抢走。
 *    这条同时也是对的业务判断：他熟悉这家厂的车间、见过他们的问题。
 *
 * ② **服务类型对不对方向**（权重 30）
 *    照花名册的岗位职责。新客户没有历史时，这条是主力。
 *
 * ③ **做过同行业**（权重 15）
 *    「同行业做过就能复用」那条资产的另一面 —— 做过包装厂的人再接包装厂更快。
 *
 * ④ **当前手上活多少**（权重 ±5，只用来微调排序）
 *    **故意给得很小。** 负荷是排序时的平手决胜，不是决定因素 ——
 *    让「谁闲」压过「谁熟这家客户」，就又回到了随机派活。
 *    真正的用法是把数字**显示出来**给派活的人看，让他自己判断。
 *
 * ── 为什么是「建议」不是「自动派」 ────────────────────────────
 *
 * 金恩来确认：「你以建议的形式派活挺好的。」
 *
 * 系统不知道的事太多了：谁在休假、谁这周要出差、客户点名要谁、
 * 哪个顾问和这家老板处得来。自动派会让人觉得系统在替他做主，
 * 然后他就绕过系统 —— 那才是真正的失败。
 *
 * ── 为什么要记「建议了谁 / 实际选了谁」 ──────────────────────
 *
 * 金恩来：「随 AI 对系统越来越了解，后面推荐肯定也会更有依据和准确。」
 *
 * 会，但**不会自己变准** —— 得有数据喂它。
 * 而最值钱的数据恰恰是「系统建议了 A，人却选了 B」这件事：
 * 那里面装着规则没有编码进去的全部现实。
 * 所以 buildSuggestion 的结果要连同人的最终选择一起存下来（见 SuggestionRecord），
 * 这是将来让推荐变准的唯一燃料。没有它，三年后推荐还是今天这个水平。
 */

export interface OwnerCandidate {
  /** 顾问姓名 —— 花名册是唯一真相源，这里不用 id，因为规则表按姓名写 */
  name: string;
  score: number;
  /** 给人看的理由，按强弱排。**没有理由的建议不叫建议，叫猜** */
  reasons: string[];
  /** 手上在制项目数，显示给派活的人自己判断 */
  activeProjects: number;
}

export interface OwnerSuggestion {
  serviceGroup: ServiceGroup;
  /** 走第三方合作时为 true —— 这时候不该推荐任何内部顾问 */
  outsourced: boolean;
  /**
   * 这家客户的这类服务，以前是谁做的。没有就是空。
   *
   * ── 为什么要把它单独拎出来（2026-09-11）────────────────────────
   *
   * 金恩来指出我原来的设计放错了对象：
   * 「我用梁杰的号登录准备建总经理已经分配给我的项目，建的时候看见下面
   *   提醒我说我的同事还没有项目，要不要分配给他，会不会有些奇怪」
   *
   * 对的 —— **建议是给派活的人看的，不是给干活的人看的**。
   * 查了同类工具也是这样：Jira 的负责人建议藏在下拉框里（点开才看到），
   * PSA 类工具是「系统提候选 → 交付负责人确认」，推荐对象都是派活的人。
   *
   * 所以日常建议改成**拉取式**（点「看看建议」才展开）。
   *
   * **但有一种情况必须主动弹**：这家客户的这类服务以前是别人做的。
   * 那正是他担心的抢客户场景，而且此时要说的不是「建议派给他」，
   * 而是「以前是他做的，确认要换人吗」—— 是**提醒**，不是建议。
   *
   * 两者分开，日常就不吵人，该吵的时候一定吵得到。
   */
  previousOwner: string | null;
  /** 建议人选，最多 3 个，第一个是首选。可能为空 */
  candidates: OwnerCandidate[];
  /** 一句话说清系统的判断，空字符串表示没什么可说的 */
  note: string;
}

interface SuggestInput {
  /** 用户刚填的服务内容 / 项目名称 —— 最弱的信号，但新项目常常只有这个 */
  serviceText?: string;
  /**
   * 自己做 / 外包 / 合作。
   *
   * 金恩来 2026-09-11：「第三方服务各类服务都有。」
   * 所以这跟服务类型无关 —— 体系认证也可能外包。
   *
   * 用**现成的 ProjectType**，不另加 outsourced 布尔值：
   * 系统里本来就有这三个值和 vendorName / purchasingCost，
   * 再加一套就是同一件事两个模型（这个项目在这上面栽过很多次）。
   *
   * 只有 'Outsourced' 才不推荐内部人；'Joint' 仍然要有信义这边的负责人。
   */
  projectType?: 'Self-Operated' | 'Outsourced' | 'Joint';
  /** 选中的客户（有的话）—— 客户历史是最强信号，全靠它 */
  customerId?: string;
  customers: Customer[];
  projects: Project[];
  /** 花名册上还在职的顾问姓名，用来过滤掉离职的人 */
  activeConsultants: string[];
}

const WEIGHT = { history: 50, direction: 30, industry: 15, load: 5 };

/** 一个项目「属于」哪个服务大类 —— 服务项名称优先，退回项目名 */
const projectServiceGroup = (p: Project): ServiceGroup => {
  const items = (p.serviceItems || []).map(si => String((si as any).name || ''));
  for (const name of items) {
    const g = groupServiceLine(name);
    if (g !== '未分类') return g;
  }
  return groupServiceLine(p.name);
};

export const buildSuggestion = (input: SuggestInput): OwnerSuggestion => {
  const { serviceText, customerId, customers, projects, activeConsultants, projectType } = input;
  const serviceGroup = groupServiceLine(serviceText);

  /*
    两条走第三方的路，说法要不一样 —— 人看到的提示不同，该做的事也不同：
      ① 这一单**勾了外包**    任何服务类型都可能，人已经知道了，只要提醒他填合作方
      ② 这个大类**内部没人做** 人可能还不知道，要告诉他这类活信义不自己做
  */
  if (projectType === 'Outsourced') {
    return {
      serviceGroup,
      outsourced: true,
      previousOwner: null,
      candidates: [],
      note: '整单外包给第三方，不派内部负责人 —— 把合作方填上，'
        + '否则将来查「这活谁做的」会断在这里。',
    };
  }
  // 'Joint' 故意不拦：合作做的活，信义这边**仍然要有**负责人，照常推荐
  if (isOutsourced(serviceGroup)) {
    return {
      serviceGroup,
      outsourced: true,
      previousOwner: null,
      candidates: [],
      note: `「${serviceGroup}」内部没人做，这类一律走第三方 —— 记得写清合作方和对接人。`,
    };
  }

  const inHouse = new Set(activeConsultants);
  const customer = customerId ? customers.find(c => c.id === customerId) : undefined;
  const theirs = customer
    ? projects.filter(p => p.customerId === customer.id && String(p.manager || '').trim())
    : [];
  const sameService = theirs.filter(p => serviceGroup !== '未分类' && projectServiceGroup(p) === serviceGroup);

  /*
    ── 先定「谁有资格做」，再在有资格的人里面排序 ──

    2026-09-11 第一版把「会不会做」和「熟不熟这家客户」放在一起加分，
    结果拿真实数据一跑就出事：**包装厂要做 ISO9001，系统首选了商春姿**——
    因为她服务过这家客户、做过包装行业，35 分压过了黄邦煜的 30 分。

    可商春姿做的是食包、台账、校准、工商代理，**她不做体系认证**。

    客户熟悉度再高也不能让一个不做这项业务的人接这个活。
    所以资格是**硬门槛**，熟悉度/行业/负荷只在门槛之内排序。

    资格有两个来源，第二个同样重要：
      ① 花名册上这是他的方向
      ② **他实际做过这家客户的这类服务** —— 花名册可能不全、可能过时，
         而「他真做过」是比任何表格都硬的证据
  */
  const qualified = new Map<string, string[]>();   // 姓名 → 资格理由
  const addQualified = (name: string, why: string) => {
    const n = String(name || '').trim();
    if (!n || !inHouse.has(n)) return;             // 离职或不在花名册的，不推荐
    const cur = qualified.get(n) || [];
    if (!cur.includes(why)) cur.push(why);
    qualified.set(n, cur);
  };

  (SERVICE_OWNERS[serviceGroup] || []).forEach(name => addQualified(name, `「${serviceGroup}」是这人的方向`));
  sameService.forEach(p => addQualified(String(p.manager), `做过这家客户的「${serviceGroup}」`));

  const scores = new Map<string, { score: number; reasons: string[] }>();
  qualified.forEach((why, name) => scores.set(name, { score: 0, reasons: [...why] }));
  const bump = (name: string, points: number, reason?: string) => {
    const cur = scores.get(name);
    if (!cur) return;                              // 没资格的不参与排序，加分也没用
    cur.score += points;
    if (reason && !cur.reasons.includes(reason)) cur.reasons.push(reason);
  };

  // ── ① 客户历史：同客户 + 同服务，最强 ──
  /*
    这是防抢客户的**锚**。续期、复审、加体系，本来就该回到原来那个人手上，
    而不是变成「谁先在系统里看见谁抢走」。
    也是对的业务判断：他熟悉这家厂的车间、见过他们的问题。
  */
  sameService.forEach(p => bump(String(p.manager), WEIGHT.history));

  // 同客户但做的是别的服务 —— 只在他本来就有资格时才加分，而且弱得多
  if (sameService.length === 0) {
    theirs.forEach(p => bump(String(p.manager), Math.round(WEIGHT.history * 0.4), '服务过这家客户（别的项目）'));
  }

  // ── ② 服务方向：花名册里排第一的那个略占优 ──
  (SERVICE_OWNERS[serviceGroup] || []).forEach((name, idx) => {
    bump(name, idx === 0 ? WEIGHT.direction : Math.round(WEIGHT.direction * 0.8));
  });

  // ── ③ 同行业经验 ──
  // 只在有资格的人之间拉开差距 —— 做过同行业不构成「会做这项服务」
  const industryGroup = customer ? groupIndustry(customer.industry) : '其他';
  if (customer && industryGroup !== '其他') {
    const doneSameIndustry = new Set(
      projects
        .filter(p => {
          const c = customers.find(x => x.id === p.customerId);
          return c && c.id !== customer.id && groupIndustry(c.industry) === industryGroup;
        })
        .map(p => String(p.manager || '').trim())
        .filter(Boolean)
    );
    doneSameIndustry.forEach(name => bump(name, WEIGHT.industry, `做过${industryGroup}行业的客户`));
  }

  // ── ④ 负荷：只微调，不决定 ──
  const load = new Map<string, number>();
  projects.forEach(p => {
    const m = String(p.manager || '').trim();
    if (!m) return;
    const done = String((p as any).status || '') === 'Completed';
    if (!done) load.set(m, (load.get(m) || 0) + 1);
  });
  const loads = [...inHouse].map(n => load.get(n) || 0);
  const avgLoad = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
  scores.forEach((v, name) => {
    const mine = load.get(name) || 0;
    // 比平均少 → 小幅加分；比平均多 → 小幅减分。幅度封顶在 WEIGHT.load
    const delta = Math.max(-WEIGHT.load, Math.min(WEIGHT.load, Math.round((avgLoad - mine) * 2)));
    v.score += delta;
  });

  const candidates: OwnerCandidate[] = [...scores.entries()]
    .map(([name, v]) => ({
      name,
      score: v.score,
      // 同一条理由可能加了多次（客户有好几个同类项目），去重后保持强弱顺序
      reasons: [...new Set(v.reasons)],
      activeProjects: load.get(name) || 0,
    }))
    .sort((a, b) => b.score - a.score || a.activeProjects - b.activeProjects)
    .slice(0, 3);

  let note = '';
  if (serviceGroup === '未分类') {
    note = serviceText?.trim()
      ? '认不出这是哪类服务 —— 请自己指定负责人；顺便把服务内容写具体一点，下次系统就认得了。'
      : '还没填服务内容 —— 填了之后这里会给出建议人选。';
  } else if (candidates.length === 0) {
    note = `「${serviceGroup}」（${SERVICE_GROUP_META[serviceGroup].hint}）在花名册里没有对应的人，请自己指定。`;
  }

  /*
    「以前是谁做的」取同客户+同服务里最近的那一位。
    只要有这个人，界面就该主动提醒 —— 哪怕他不是评分第一。
  */
  const previousOwner = sameService.length
    ? String(sameService[sameService.length - 1].manager || '').trim() || null
    : null;

  return { serviceGroup, outsourced: false, previousOwner, candidates, note };
};

/**
 * 一次派活的决定记录。
 *
 * **这才是让推荐将来变准的燃料。** 存的重点不是「系统推了谁」，
 * 是「系统推了谁、人最终选了谁、两者差在哪」——
 * 差异里装着规则没编码进去的全部现实（休假、出差、客户点名、处不来）。
 *
 * 攒够之后能直接回答两个问题：
 *   · 哪一类服务的推荐最不准 → 那类的规则要改
 *   · 某个人是不是总被推荐却总不被选 → 花名册上的方向是不是过时了
 */
export interface SuggestionRecord {
  at: string;
  projectId: string;
  serviceGroup: ServiceGroup;
  suggested: string | null;
  suggestedReasons: string[];
  chosen: string;
  /** 人选的和系统推的不一样 —— 这一条才是要拿去分析的 */
  overridden: boolean;
}

export const buildSuggestionRecord = (
  projectId: string,
  suggestion: OwnerSuggestion,
  chosen: string
): SuggestionRecord => {
  const top = suggestion.candidates[0] || null;
  return {
    at: new Date().toISOString(),
    projectId,
    serviceGroup: suggestion.serviceGroup,
    suggested: top?.name || null,
    suggestedReasons: top?.reasons || [],
    chosen,
    overridden: Boolean(top && top.name !== chosen),
  };
};
