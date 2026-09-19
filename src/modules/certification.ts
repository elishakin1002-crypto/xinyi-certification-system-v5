/**
 * 证书：种类、周期、提醒时机 —— 全系统只此一份。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个文件（2026-09-19）
 * ══════════════════════════════════════════════════════════════
 *
 * 改之前，证书的三件事散在三个地方，而且都是错的：
 *
 *   ① 周期写死在 context/AppContext.tsx 的 generateAuditPlan 里：
 *      只认 `_5Y`（5 年），**其余一律按 3 年**。
 *      金恩来 2026-09-19：「不是所有的认证都是 3 年换证，
 *      这个换证时间应该根据证件种类来定。」
 *      他说得对，而且"认不出就当 3 年"正是这个项目反复栽过的那种错：
 *      **认不出的值不许回退成一个看起来正常的值**（见 labels.ts）。
 *
 *   ② 证书只能挂在客户身上（Customer.certificates），
 *      而最值钱的证书恰恰是"还不是我们客户"的那些。
 *
 *   ③ 到期提醒排的是 30/15/7 天 —— 那是给自己客户防漏审核用的，
 *      拿去挖角等于提醒响的时候仗已经打完了。
 *
 * ── 这个文件只管"判断"，不管"存哪" ────────────────────────────
 *
 * 纯函数，不碰数据库、不碰 React。这样测试能直接钉住每一条口径，
 * 而且服务端和前端用的是同一份 —— 不会出现"页面上算一套、接口算另一套"。
 */

import { normalizeCompanyName, normalizeUscc } from './customerIdentity';

/* ══════════════════════════════════════════════════════════════
   一、企业主体的身份 —— 证书挂在这上面，不挂线索也不挂客户
   ══════════════════════════════════════════════════════════════ */

/**
 * 一家企业的「身份钥匙」。
 *
 * ── 为什么不强制要统一社会信用代码（2026-09-19）────────────────
 *
 * 金恩来问：「客户详情是不是一定要填社会信用代码？不填证书就挂不上去？」
 *
 * **不是，也绝不能是。** 情报的典型场景就是信息不全 ——
 * 销售在饭桌上听说"某某厂的 9001 明年三月到期"，这时候连全称都未必准，
 * 更不会有信用代码。要求填代码才能记，等于把最该记的那些挡在门外。
 *
 * 所以两级钥匙：
 *   有代码   → 用代码（唯一、可靠，不怕改名）
 *   没有代码 → 用规范化企业名（去掉空格/括号差异），并**明确标记成弱匹配**
 *
 * 弱匹配必须让人看得见（`isWeak`）：同名企业在中国很常见，
 * 靠名字认人早晚认错。界面上要说"未绑定信用代码，可能认错"，
 * 而不是假装这条记录和别的一样可靠。
 *
 * 以后补上代码时，用同名把旧记录捞出来合并 —— 所以弱钥匙也要能查。
 */
export interface SubjectKey {
  /** 实际用来关联的键 */
  key: string;
  /** 'uscc' = 信用代码（强）；'name' = 规范化企业名（弱） */
  kind: 'uscc' | 'name';
  /** true 表示这是靠名字认的，可能认错 —— 界面必须提示 */
  isWeak: boolean;
}

export const subjectKeyOf = (input: { uscc?: string | null; companyName?: string | null }): SubjectKey | null => {
  const uscc = normalizeUscc(input?.uscc || '');
  if (uscc) return { key: `uscc:${uscc}`, kind: 'uscc', isWeak: false };
  const name = normalizeCompanyName(input?.companyName || '');
  if (name) return { key: `name:${name}`, kind: 'name', isWeak: true };
  // 两样都没有 —— 这条记录没有主体可挂，调用方必须拦下来，不能默默存一条孤儿
  return null;
};

/* ══════════════════════════════════════════════════════════════
   二、证书种类表 —— 有效期按种类定，不是一律三年
   ══════════════════════════════════════════════════════════════ */

/**
 * 监督节点的类型。
 * 「监督审核」和「年审」是两回事：前者是认证机构上门审，
 * 后者（如两化融合）是提交材料复审。文案不同，工作量也不同。
 */
export type SupervisionKind = 'surveillance' | 'annualReview';

export interface CertTypeMeta {
  /** 界面上的名字 */
  label: string;
  /** 有效期（月）。null = 长期有效 / 按批次，不能推算到期日 */
  validMonths: number | null;
  /** 有效期内的监督节点，单位是"发证后第几个月" */
  supervision: ReadonlyArray<{ month: number; kind: SupervisionKind }>;
  /** 一句话说明，界面上给人看的 */
  note: string;
}

/**
 * 种类表。
 *
 * **这张表以后要搬进数据库变成可编辑的配置** —— 信义自己加新种类时
 * 不该来找开发改代码。放在这里是第一步：先把"有效期按种类定"这件事
 * 从写死的 if/else 里解出来，并且有测试钉住。
 *
 * 有效期数字联网核对过（2026-09-19）：
 *   体系类（9001/14001/45001）、知识产权贯标、两化融合、绿色食品 → 3 年
 *   有机产品认证 → **1 年**，年度复审
 *   食品生产许可证（SC）→ **5 年**
 */
export const CERT_TYPES: Record<string, CertTypeMeta> = {
  ISO9001: {
    label: 'ISO 9001 质量管理体系',
    validMonths: 36,
    supervision: [{ month: 12, kind: 'surveillance' }, { month: 24, kind: 'surveillance' }],
    note: '三年一个周期，第 1、2 年各一次监督审核，第 3 年再认证。'
  },
  ISO14001: {
    label: 'ISO 14001 环境管理体系',
    validMonths: 36,
    supervision: [{ month: 12, kind: 'surveillance' }, { month: 24, kind: 'surveillance' }],
    note: '同 9001 的周期。三体系常常一起做、一起换。'
  },
  ISO45001: {
    label: 'ISO 45001 职业健康安全管理体系',
    validMonths: 36,
    supervision: [{ month: 12, kind: 'surveillance' }, { month: 24, kind: 'surveillance' }],
    note: '同 9001 的周期。三体系常常一起做、一起换。'
  },
  IP_GUANBIAO: {
    label: '知识产权管理体系贯标',
    validMonths: 36,
    supervision: [{ month: 12, kind: 'surveillance' }, { month: 24, kind: 'surveillance' }],
    note: '三年有效。'
  },
  LIANGHUA: {
    label: '两化融合管理体系',
    validMonths: 36,
    supervision: [{ month: 12, kind: 'annualReview' }, { month: 24, kind: 'annualReview' }],
    note: '三年有效，但**每年要年审**（提交材料复审，不是上门审核）。'
  },
  GREEN_FOOD: {
    label: '绿色食品',
    validMonths: 36,
    supervision: [{ month: 12, kind: 'annualReview' }, { month: 24, kind: 'annualReview' }],
    note: '三年有效，期满续展。'
  },
  ORGANIC: {
    label: '有机产品认证',
    validMonths: 12,
    supervision: [],
    note: '**只有一年**。周期短、复审频繁，节奏和体系类完全不同。'
  },
  SC_FOOD: {
    label: '食品生产许可证（SC）',
    validMonths: 60,
    supervision: [],
    note: '五年有效。是行政许可，不是认证 —— 换证流程和体系类不一样。'
  }
};

/**
 * 认不出的种类**不猜**。
 *
 * 老代码是 `if (ruleId.endsWith('_5Y')) ... else 按三年`，
 * 于是任何没见过的种类都被静悄悄地当成三年，到期日、监督节点、
 * 提醒全都是错的，而且**界面上看起来完全正常**。
 *
 * 这里返回 null，由调用方显示「未知种类，请先选一个」——
 * 和 labels.ts 里「未知(原值)」是同一条规矩。
 */
export const certTypeOf = (typeId?: string | null): CertTypeMeta | null =>
  (typeId && Object.prototype.hasOwnProperty.call(CERT_TYPES, typeId)) ? CERT_TYPES[typeId] : null;

/* ══════════════════════════════════════════════════════════════
   三、提醒锚点 —— 按「这一触的目的」定，不是按比例缩放
   ══════════════════════════════════════════════════════════════ */

/**
 * 我们和这张证书的关系。提醒节奏完全不同，所以必须是显式字段。
 *   ours   —— 我们做的，要防止漏审核（交付责任）
 *   others —— 别人做的，目标是换证时抢过来（销售）
 */
export type CertRelation = 'ours' | 'others';

/** 一个提醒锚点：到期前多少天，为什么要在这时候碰他 */
export interface TouchAnchor {
  /** 到期前第几天 */
  daysBefore: number;
  /** 这一触的目的 —— 界面上直接显示，销售才知道该说什么 */
  purpose: string;
}

/**
 * 提醒锚点。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么是这几个数（2026-09-19 重做）
 * ══════════════════════════════════════════════════════════════
 *
 * 第一版我按「认证机构提前 2-3 个月排再认证审核」反推，得出
 * 「到期前 9/6/4 个月」。**那是错的**，因为它站在认证机构的角度。
 *
 * 金恩来纠正：「三体系我们现在一般半个月就做下来，慢的一个月，
 *   加急一周……但这里设置的提醒毕竟是和客户提早确定合作意向，
 *   所以提醒时间的确定要以销售目的为优先。」
 *
 * 交付只要两三周，说明**交付周期根本不是约束**。
 * 真正的约束是"对方什么时候决定找谁做"。
 *
 * 行业里续约触达的时机是按**合同金额和决策复杂度**定的：
 *   大额多方审批 180 天 / 中等 90 天 / 小额决策简单 30-60 天
 * 信义的单子几万块、老板一个人拍板，属于最后一档；
 * 但**挖角比续约难**（要先建立关系），所以要早一档。
 *
 * ── 第二版我还犯了个错，一并记下 ────────────────────────────
 *
 * 我写过「1 年期的除以 3，得 60/30/15/5 天」。金恩来问"为什么除以 3"——
 * **问得对，没有任何依据**，纯粹是我拿 3 年期的数字按比例缩。
 * 锚点的意义不会随周期等比例缩小：一年一换的证书，客户本来就熟门熟路，
 * 不需要"提前半年建立关系"那一档；而"最后 5 天"更是没有意义的数字。
 *
 * 所以改成**按每一触的目的来定**，周期短的种类直接少一档。
 */
const ANCHORS_OTHERS_LONG: TouchAnchor[] = [
  { daysBefore: 180, purpose: '占位：让他知道有你这个选项，拿到对的联系人。不为成交。' },
  { daysBefore: 90, purpose: '决策窗口：正式接触、报方案。行业里这个档位的续约沟通就从这里开始。' },
  { daysBefore: 45, purpose: '最后窗口：跟进逼单。' },
  { daysBefore: 15, purpose: '加急救场：「一周能下来」——别人这时候已经不敢接了，这是我们的主场。' }
];

const ANCHORS_OTHERS_SHORT: TouchAnchor[] = [
  // 一年一换的证书不设"占位"档：客户每年都在办，认识谁早就定了，
  // 提前半年去碰只会被当成骚扰。直接从决策窗口开始。
  { daysBefore: 60, purpose: '决策窗口：正式接触、报方案。' },
  { daysBefore: 30, purpose: '最后窗口：跟进逼单。' },
  { daysBefore: 10, purpose: '加急救场：「一周能下来」。' }
];

const ANCHORS_OURS: TouchAnchor[] = [
  // 自己的客户是**交付责任**不是销售：漏了监督审核证书会被暂停。
  // 所以节奏短而密，目的也不同 —— 是"别忘了办"，不是"争取他"。
  { daysBefore: 90, purpose: '排期：确认换证时间，安排材料。' },
  { daysBefore: 60, purpose: '催材料：客户那边该准备的东西到位没有。' },
  { daysBefore: 30, purpose: '兜底：还没动的，这时候必须推动，否则会脱期。' }
];

/**
 * 某张证书该在到期前哪几个时点被提醒。
 *
 * 认不出种类时返回空数组 —— **不给默认节奏**。
 * 给了的话，一个填错种类的证书会安安静静地按错误节奏提醒，
 * 而没有任何人会发现。
 */
export const touchAnchors = (typeId: string | null | undefined, relation: CertRelation): TouchAnchor[] => {
  const meta = certTypeOf(typeId);
  if (!meta) return [];
  if (relation === 'ours') return ANCHORS_OURS;
  // 一年以内的算"短周期"
  return (meta.validMonths !== null && meta.validMonths <= 12) ? ANCHORS_OTHERS_SHORT : ANCHORS_OTHERS_LONG;
};

/* ══════════════════════════════════════════════════════════════
   四、按企业合并 —— 一家企业三张证，不能提醒三次
   ══════════════════════════════════════════════════════════════ */

export interface CertLike {
  id?: string;
  uscc?: string | null;
  companyName?: string | null;
  typeId?: string | null;
  expiryDate?: string | null;
  relation?: CertRelation;
}

export interface CompanyTouch {
  subject: SubjectKey;
  companyName: string;
  /** 触发这次接触的那张证书 —— 最早到期的 */
  driver: CertLike;
  /** 这家企业在窗口期内的**所有**证书，一次谈完 */
  certs: CertLike[];
  daysToDriverExpiry: number;
  purpose: string;
}

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * 把到了触达时点的证书，**按企业合并成一次接触**。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要合并（2026-09-19）
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来：「一份合同里可能有多种认证服务，涉及多张认证证书，
 *   这个时机或者说具体时间你要怎么参考呢？」
 *
 * 关键是**续约的单位不是合同，是证书**。行业里那些"提前 90 天"的
 * 数字，单位是一份会到期的合同；到我们这儿，会到期的是一张张证书，
 * 而三体系的三张证到期日常常错开几周。
 *
 * 所以：**提醒按证书算，接触按企业合并。**
 * 触发点取这家企业**最早到期**的那张，然后把窗口期内的其它证书
 * 一起带出来，一次谈完。
 *
 * 行业里这叫 co-terming（把多笔续约对齐到同一个日子），
 * 公认的好处是"把客户的注意力集中在一次对话上，而不是摊薄成
 * 十几次各自被随手打发的小续约"。对我们还多一层好处：
 * 三张证一起换，交付成本更低，也更好谈价。
 *
 * 顺带一个业务建议：换证时可以主动提议把几张证的到期日对齐，
 * 以后年年都省事 —— 这是成熟做法，不是我们自己发明的花样。
 */
export const companyTouchesDue = (
  certs: ReadonlyArray<CertLike>,
  today: string,
  /** 合并窗口：驱动证书之后多少天内到期的，算同一次接触。默认 60 天 */
  bundleWindowDays = 60
): CompanyTouch[] => {
  const byCompany = new Map<string, { subject: SubjectKey; items: CertLike[] }>();

  for (const c of certs || []) {
    const subject = subjectKeyOf({ uscc: c?.uscc, companyName: c?.companyName });
    if (!subject) continue;              // 没有主体的记录不参与，由别处报出来
    if (!String(c?.expiryDate || '').trim()) continue;   // 没有到期日就无从推算
    const slot = byCompany.get(subject.key) || { subject, items: [] };
    slot.items.push(c);
    byCompany.set(subject.key, slot);
  }

  const out: CompanyTouch[] = [];

  for (const { subject, items } of byCompany.values()) {
    const sorted = [...items].sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));

    // 驱动证书 = 最早到期、且**已经够到至少一个锚点**的那张
    const driver = sorted.find((c) => reachedAnchors(
      dayDiff(today, String(c.expiryDate)),
      touchAnchors(c.typeId, c.relation === 'ours' ? 'ours' : 'others')
    ).length > 0);
    if (!driver) continue;

    const days = dayDiff(today, String(driver.expiryDate));
    const relation: CertRelation = driver.relation === 'ours' ? 'ours' : 'others';
    const reached = reachedAnchors(days, touchAnchors(driver.typeId, relation));
    // 当前该说什么，取**最近够到的那一档**（daysBefore 最小的那个）
    const current = reached[reached.length - 1];

    out.push({
      subject,
      companyName: String(driver.companyName || ''),
      driver,
      certs: sorted.filter((c) => dayDiff(String(driver.expiryDate), String(c.expiryDate)) <= bundleWindowDays),
      daysToDriverExpiry: days,
      purpose: current?.purpose || ''
    });
  }

  return out.sort((a, b) => a.daysToDriverExpiry - b.daysToDriverExpiry);
};

/**
 * 到今天为止**已经够到**的锚点，从远到近排。
 *
 * ── 为什么是「已经够到」而不是「正好是今天」（2026-09-19）────
 *
 * 第一版我写的是「落在哪一档区间里」，那会**每天都算触发一次** ——
 * 到期前 90 到 46 天之间，天天提醒同一件事，铃铛会被刷爆，
 * 然后所有人开始无视提醒。这个项目已经吃过一次提醒泛滥的亏。
 *
 * 也不能写成「正好等于 90 天」：服务停一天、或者那天没人开系统，
 * 这一触就永远错过了，而且**没有任何痕迹**。
 *
 * 所以返回"已经够到的全部锚点"，由调用方按
 * （证书 + 锚点天数）去重 —— 已经建过提醒的不再建。
 * 这样跑几次都一样，停机补跑也不会漏。幂等比准时重要。
 */
export const reachedAnchors = (daysToExpiry: number, anchors: ReadonlyArray<TouchAnchor>): TouchAnchor[] =>
  anchors
    .filter((a) => daysToExpiry <= a.daysBefore)
    .sort((a, b) => b.daysBefore - a.daysBefore);

/* ══════════════════════════════════════════════════════════════
   五、来源和可信度 —— 不确定的东西不许显示成确定的
   ══════════════════════════════════════════════════════════════ */

/**
 * 这条证书信息是**哪来的**。
 *
 * 必须是字段，不能省：「客户随口说的到期日」和「官网查到的到期日」
 * 该采取的行动完全不同 —— 前者要先去核实，后者可以直接排跟进。
 * 不分开的话，一条饭桌上听来的日期会和官方数据长得一模一样。
 */
export const CERT_SOURCE = {
  ourDelivery: '我们交付的',
  official: '官方平台查到的',
  customerSaid: '客户自己说的',
  peerSaid: '同行或第三方说的',
  guess: '推测的'
} as const;

export type CertSource = keyof typeof CERT_SOURCE;

/** 只有我们交付的和官方查到的算「已核实」，其余一律未核实 */
export const isVerified = (source?: CertSource | null): boolean =>
  source === 'ourDelivery' || source === 'official';

/**
 * 界面上显示的可信度标签。
 * 未核实的必须**明说**，不能留空 —— 留空会被当成"没问题"。
 */
export const confidenceLabel = (source?: CertSource | null): string =>
  isVerified(source) ? '已核实' : '未核实（按此安排前先确认）';
