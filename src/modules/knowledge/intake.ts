/**
 * 知识入库准入：这份文档该不该存、该不该让 AI 学。
 *
 * ── 要挡两类东西，性质完全不同 ──────────────────────────────────
 *
 * ① 空白记录表单 / 通用模板
 *    100 家客户的《内审检查表》90% 是相同的。存 100 份既占体积，
 *    又在检索时互相挤占——AI 答出来的东西越来越像模板。
 *    **不是不能存，是不该每家存一份、更不该都进 AI 语料。**
 *
 * ② 客户填好的记录（客户的经营数据）
 *    这是**合规风险**，不是体积问题。客户的生产记录、检验数据、
 *    人员名册属于客户自己的经营信息，放进我们的系统意味着：
 *      · 我们承担了本不该承担的保管责任
 *      · 客户换服务商时，这些数据留在我们这里说不清
 *      · 万一泄露，责任在我们
 *    这类**一律不存**，只在客户现场看、辅导完留在客户那里。
 *
 * ── 为什么做成"提示"而不是"硬拦" ────────────────────────────────
 * 识别靠文件名和内容特征，一定有误判。硬拦会让人传不上真正需要的文件，
 * 然后他就绕过系统、发微信了——那比存进来更糟。
 * 所以：**明确提示 + 默认不进语料 + 让人自己决定**。
 * 唯一硬拦的是明确含客户经营数据特征的，那是合规底线。
 */

export type IntakeVerdict = 'ok' | 'genericTemplate' | 'customerRecord';

export interface IntakeAdvice {
  verdict: IntakeVerdict;
  /** 给人看的一句话，说清为什么 */
  reason: string;
  /** 建议的处理：存不存、进不进 AI 语料 */
  suggestAiVisible: boolean;
  /** true = 建议不要存进系统（合规原因） */
  discourageStore: boolean;
  /** 命中的特征，方便人判断是不是误判 */
  signals: string[];
}

/** 空白记录表单 / 通用模板的特征 */
const TEMPLATE_PATTERNS: Array<[RegExp, string]> = [
  [/空白|模板|范本|样表|样本/, '文件名含「空白/模板/范本」'],
  [/记录表|检查表|登记表|签到表|点检表/, '文件名是某种记录表'],
  [/^\s*(表|附表|表格)\s*[A-Z0-9一二三四五六七八九十\-.]*\s*$/, '标题只是一个表号'],
];

/*
  客户填好的记录的特征。

  判据不是「有没有表格」，而是**里面有没有客户具体的经营数据**：
  日期 + 数值 + 人名的组合，是记录被填写过的标志。
  空白表单只有栏目名，填过的才有这些。
*/
const CUSTOMER_DATA_PATTERNS: Array<[RegExp, string]> = [
  [/生产日期|批号|批次号|投料量|产量记录/, '含生产批次数据'],
  [/检验结果|化验数据|检测值|实测值|合格判定/, '含检验实测数据'],
  [/员工花名册|人员名单|身份证号|工号.*姓名/, '含人员信息'],
  [/客户名单|供应商名录|采购清单/, '含客户或供应商名录'],
  [/销售额|营业额|成本核算|财务报表/, '含客户经营财务数据'],
];

const matchAll = (text: string, patterns: Array<[RegExp, string]>): string[] =>
  patterns.filter(([re]) => re.test(text)).map(([, label]) => label);

/**
 * 判断一份待入库的文档。
 *
 * @param title 文件名或标题
 * @param content 已抽取的正文（可为空——扫描件抽不出文字时就是空的）
 */
export const adviseIntake = (title: string, content = ''): IntakeAdvice => {
  const t = String(title || '');
  const body = String(content || '').slice(0, 5000);   // 只看开头，够判断了
  const blob = `${t}\n${body}`;

  // ── 先判合规，这条优先级最高 ──
  const dataSignals = matchAll(blob, CUSTOMER_DATA_PATTERNS);
  if (dataSignals.length >= 2) {
    /*
      要两个以上特征才判定，单个太容易误伤——
      比如一份讲「怎么做检验记录」的辅导材料会提到「检验结果」，
      但它是我们的方法论，不是客户的数据。
    */
    return {
      verdict: 'customerRecord',
      reason: '这份文件里像是客户自己的经营数据。客户的生产、检验、人员信息属于客户，'
            + '存进我们系统意味着我们要为它的保管和泄露负责——建议不要上传，辅导完留在客户那边。',
      suggestAiVisible: false,
      discourageStore: true,
      signals: dataSignals,
    };
  }

  // ── 再判通用模板 ──
  const tplSignals = matchAll(t, TEMPLATE_PATTERNS);
  if (tplSignals.length > 0) {
    return {
      verdict: 'genericTemplate',
      reason: '这像是一份通用的记录表单或模板。100 家客户的同类表单大同小异，'
            + '每家存一份会把真正有价值的复盘和经验从检索结果里挤下去。'
            + '建议：只在知识中心留一份通用版，客户专用的那份留在项目附件里。',
      suggestAiVisible: false,
      discourageStore: false,
      signals: tplSignals,
    };
  }

  return { verdict: 'ok', reason: '', suggestAiVisible: true, discourageStore: false, signals: [] };
};
