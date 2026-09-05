/**
 * 历史合同批量导入 —— 只入账，不建项目。
 *
 * ── 为什么单独做一条路，而不是让人用「新建合同」录 ────────────
 *
 * 新建合同表单默认勾着「同时创建交付项目」，因为**新签合同确实该建项目**：
 * 签了就要交付，交付要有人跟。
 *
 * 但历史合同是已经做完的事。一条条录进去如果顺手建了项目，
 * 结果是项目列表里凭空多出几百个「进行中」的僵尸项目，
 * 顾问的在制项目数、总助的派活看板、项目延误率全被污染 ——
 * 而这些数字恰恰是用来判断「现在忙不忙」的。
 *
 * 靠人记得每次去取消那个勾不行：几百条里漏一次就得手工清理。
 * 所以历史导入**在代码层面就没有建项目这条路**，不是靠勾选框。
 *
 * ── 为什么解析和写入分开 ──────────────────────────────────────
 * 这里只做「读表格 → 变成结构化数据 + 挑出有问题的行」，不碰任何状态。
 * 好处是导入前能先给人看一眼「将导入 N 条、跳过 M 条、X 行有问题」，
 * 而不是点完才知道结果。**几百条的操作，撤销的成本远高于确认的成本。**
 */

export interface ParsedContractRow {
  /** 表格里的行号（从 2 开始，1 是表头）—— 报错要能指回原文件 */
  rowNo: number;
  contractNo: string;
  customerName: string;
  title: string;
  amount: number;
  signDate: string;
  serviceLine: string;
  contactPerson: string;
  remarks: string;
}

export interface RowProblem {
  rowNo: number;
  /** 原样带上客户名，人一眼能对上是哪一行 */
  label: string;
  reason: string;
}

export interface ContractImportPlan {
  ready: ParsedContractRow[];
  duplicates: RowProblem[];
  problems: RowProblem[];
  totalRows: number;
}

/*
  表头别名。

  同事导出的表格来自不同地方（老系统、财务台账、手工整理），
  列名不可能统一。与其要求他们改表头，不如这边多认几个 ——
  **让人改文件格式是最容易失败的一步**，他改错了还以为是系统坏了。
*/
const FIELD_ALIASES: Record<keyof Omit<ParsedContractRow, 'rowNo'>, string[]> = {
  contractNo: ['合同编号', '合同号', '编号', '合同编码', 'contractno', 'no'],
  customerName: ['客户名称', '客户', '公司名称', '企业名称', '甲方', 'customer'],
  title: ['合同名称', '项目名称', '合同标题', '标题', 'title'],
  amount: ['合同金额', '金额', '总金额', '含税金额', 'amount'],
  signDate: ['签订日期', '签约日期', '签订时间', '日期', '签署日期', 'signdate'],
  serviceLine: ['服务类型', '业务类型', '认证类型', '服务项', '体系', 'serviceline'],
  contactPerson: ['联系人', '对接人', '客户联系人', 'contact'],
  remarks: ['备注', '说明', '注释', 'remark', 'remarks'],
};

const norm = (v: unknown) => String(v ?? '').trim();
const normKey = (v: unknown) => norm(v).toLowerCase().replace(/[\s()（）:：*]/g, '');

/** 找出表格里每个字段对应的实际列名 */
export const mapHeaders = (headers: string[]): Partial<Record<keyof ParsedContractRow, string>> => {
  const out: Partial<Record<keyof ParsedContractRow, string>> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const hit = headers.find(h => aliases.some(a => normKey(h) === normKey(a)))
      // 完全相等找不到时再放宽到包含，覆盖「合同金额（元）」这种
      || headers.find(h => aliases.some(a => normKey(h).includes(normKey(a))));
    if (hit) out[field as keyof ParsedContractRow] = hit;
  }
  return out;
};

/**
 * 金额可能是数字，也可能是 "¥12,000.00" / "12000元" 这种字符串。
 * 解析不出来就返回 NaN 交给上面报错，**绝不当成 0** ——
 * 一条金额为 0 的合同混进台账，比一条导入失败的记录危险得多。
 */
export const parseAmount = (raw: unknown): number => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const s = norm(raw).replace(/[¥￥,\s]/g, '').replace(/元$/, '');
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * 日期规整成 YYYY-MM-DD。
 *
 * Excel 里的日期常常是**从 1900-01-01 起算的序列号**（比如 45000），
 * 直接当字符串用会写进一个 1970 年的日期，而且没人会发现。
 */
export const parseDate = (raw: unknown): string => {
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    // Excel 序列号。减 25569 换算成 Unix 天数（1900 闰年 bug 已含在这个常数里）
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = norm(raw);
  if (!s) return '';
  const m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 把表格数据变成导入计划。**不写任何状态。**
 *
 * existingNos / existingKeys 用来判重：
 * 有合同编号就按编号判，没有编号的按「客户+金额+签订日期」判 ——
 * 历史台账里没编号的行不少，完全不判重的话，
 * 同一份表格导两次就会出现两套一模一样的合同。
 */
export const buildImportPlan = (
  rows: Record<string, unknown>[],
  existing: { contractNo?: string; customerName: string; amount: number; signDate: string }[]
): ContractImportPlan => {
  const plan: ContractImportPlan = { ready: [], duplicates: [], problems: [], totalRows: rows.length };
  if (rows.length === 0) return plan;

  /*
    表头从**所有行**收集，不能只看第一行。

    sheet_to_json 对空单元格是直接不给这个 key 的 ——
    第一行如果恰好没填合同编号，那一列就从表头里消失了，
    结果是整份文件的合同编号全被忽略、判重退化成模糊匹配，
    而这一切不会有任何报错。
  */
  const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r || {}))));
  const map = mapHeaders(headers);

  const existingNos = new Set(
    existing.map(c => normKey(c.contractNo)).filter(Boolean)
  );
  const fuzzyKey = (customerName: string, amount: number, signDate: string) =>
    `${normKey(customerName)}|${Math.round(amount)}|${signDate}`;
  const existingKeys = new Set(existing.map(c => fuzzyKey(c.customerName, c.amount, c.signDate)));

  // 同一个文件里自己重复也要挡住
  const seenNos = new Set<string>();
  const seenKeys = new Set<string>();

  rows.forEach((row, i) => {
    const rowNo = i + 2;
    const get = (f: keyof ParsedContractRow) => (map[f] ? row[map[f] as string] : undefined);

    const customerName = norm(get('customerName'));
    const contractNo = norm(get('contractNo'));
    const amount = parseAmount(get('amount'));
    const signDate = parseDate(get('signDate'));
    const label = customerName || contractNo || `第 ${rowNo} 行`;

    const missing: string[] = [];
    if (!customerName) missing.push('客户名称');
    if (!Number.isFinite(amount)) missing.push('合同金额');
    if (!signDate) missing.push('签订日期');
    if (missing.length) {
      plan.problems.push({ rowNo, label, reason: `缺少或读不出：${missing.join('、')}` });
      return;
    }

    const noKey = normKey(contractNo);
    const key = fuzzyKey(customerName, amount, signDate);
    if ((noKey && (existingNos.has(noKey) || seenNos.has(noKey))) || existingKeys.has(key) || seenKeys.has(key)) {
      plan.duplicates.push({ rowNo, label, reason: contractNo ? `合同编号 ${contractNo} 已存在` : '同客户同金额同日期的合同已存在' });
      return;
    }
    if (noKey) seenNos.add(noKey);
    seenKeys.add(key);

    plan.ready.push({
      rowNo,
      contractNo,
      customerName,
      title: norm(get('title')) || `${customerName} 历史合同`,
      amount,
      signDate,
      serviceLine: norm(get('serviceLine')) || '历史合同',
      contactPerson: norm(get('contactPerson')),
      remarks: norm(get('remarks')),
    });
  });

  return plan;
};

/** 导入时给每条打的标记，方便事后把历史数据挑出来 */
export const HISTORY_IMPORT_TAG = '【历史导入】';
