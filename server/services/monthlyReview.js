// 月度经营判断：这个月该把精力放在哪。
//
// ── 为什么不是「战略推演」────────────────────────────────────────
// 原来的战略模块输出 SWOT + BCG 矩阵，那是给大企业做年度规划的框架。
// 对一家 200-400 合同/年、几个人的公司，它会输出
// 「优势：本地化服务；劣势：人手不足；机会：政策推动」——
// 每条都对，每条都不指向任何具体动作。实测：上线至今**一次都没被用过**
// （strategic_insight 为空、strategic_tasks 0 条）。
//
// 老板缺的不是战略框架，是**每个月该把精力放哪**的判断。这两件事不一样。
//
// ── 这个模块只做一件事：把「能支撑判断的事实」摆出来 ──────────────
// AI 负责从事实里挑出该做的三件事，但**事实必须是真的、可核对的**。
// 所以这里只做数据聚合，不做任何推断——推断交给模型，
// 而模型说的每一条都要能指回下面某个具体数字。
//
// 缺数据就明说缺。宁可让老板看到「这块没数据所以判断不了」，
// 也不能让 AI 拿着空数据编一条听起来合理的建议。
const pool = require('../db/pool');

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
};

/**
 * 签约趋势。**这是最能看出问题的一张表**，也是原来完全没喂给 AI 的。
 * 原来的 serializeWorldState 只给当前快照（有多少客户、多少线索），
 * 没有时间维度——AI 只能做静态描述，做不了「这个月不对劲」的判断。
 */
const signingTrend = async () => {
  const { rows } = await pool.query(`
    select to_char(sign_date, 'YYYY-MM') as month,
           count(*)::int as deals,
           coalesce(sum(amount), 0)::bigint as amount
      from contracts
     where sign_date is not null
       and to_char(sign_date, 'YYYY-MM') >= $1
     group by 1 order by 1`, [monthsAgo(13)]);

  /*
    补齐空月份。**没有合同的月份不会出现在 group by 结果里**，
    而「连续两个月一单没签」恰恰是最该被看见的信号——
    不补齐的话它在数据里是隐形的。
  */
  const filled = [];
  for (let i = 12; i >= 0; i--) {
    const m = monthsAgo(i);
    const hit = rows.find((r) => r.month === m);
    filled.push({ month: m, deals: hit ? hit.deals : 0, amount: hit ? Number(hit.amount) : 0 });
  }
  return filled;
};

/** 逾期回款。金额、笔数、最久的那一笔 */
const overdueReceivables = async () => {
  const { rows } = await pool.query(
    'select id, customer_name as "customerName", receivables from contracts where receivables is not null');
  const today = new Date().toISOString().slice(0, 10);
  const items = [];
  for (const c of rows) {
    for (const r of (Array.isArray(c.receivables) ? c.receivables : [])) {
      const due = String(r.dueDate || '');
      if (r.status !== 'paid' && due && due < today) {
        const days = Math.floor((Date.now() - Date.parse(due)) / 86400000);
        items.push({ customer: c.customerName || '(未填客户名)', amount: Number(r.amount || 0), dueDate: due, overdueDays: days });
      }
    }
  }
  items.sort((a, b) => b.overdueDays - a.overdueDays);
  return {
    count: items.length,
    totalAmount: items.reduce((s, x) => s + x.amount, 0),
    worst: items.slice(0, 5),
  };
};

/** 交付卡点：哪个环节的任务最常卡住。这是「哪里在漏效率」的直接证据 */
const deliveryBottlenecks = async () => {
  const { rows } = await pool.query("select tasks from projects where project_status = 'Active'");
  const today = new Date().toISOString().slice(0, 10);
  const byTitle = new Map();
  let openTotal = 0;
  let overdueTotal = 0;
  for (const p of rows) {
    for (const t of (Array.isArray(p.tasks) ? p.tasks : [])) {
      if (t.status === 'Completed' || t.status === 'Skipped') continue;
      openTotal++;
      const late = t.deadline && String(t.deadline) < today;
      if (late) {
        overdueTotal++;
        const key = String(t.title || '未命名').slice(0, 24);
        byTitle.set(key, (byTitle.get(key) || 0) + 1);
      }
    }
  }
  return {
    openTasks: openTotal,
    overdueTasks: overdueTotal,
    topStuck: [...byTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([title, count]) => ({ title, count })),
  };
};

/** 客户结构：行业分布与集中度。集中度太高是真实风险 */
const customerMix = async () => {
  const { rows } = await pool.query(`
    select coalesce(nullif(industry, ''), '(未填行业)') as industry,
           count(*)::int as customers
      from customers group by 1 order by 2 desc`);
  const { rows: top } = await pool.query(`
    select customer_name, coalesce(sum(amount), 0)::bigint as amount
      from contracts group by 1 order by 2 desc limit 5`);
  const total = top.reduce((s, x) => s + Number(x.amount), 0);
  return {
    byIndustry: rows,
    topCustomers: top.map((t) => ({ name: t.customer_name, amount: Number(t.amount) })),
    top5Share: total > 0 ? Number((top.reduce((s, x) => s + Number(x.amount), 0) / total).toFixed(2)) : 0,
  };
};

/**
 * 数据缺口。**必须如实报出来**。
 *
 * 缺数据时 AI 会用它有的东西硬凑一条建议，而那条建议听起来同样合理。
 * 明确告诉模型「这块没有数据」，它才会说「这块判断不了」，
 * 而不是编一条。老板据此知道该去补什么。
 */
const dataGaps = async () => {
  const gaps = [];
  const q = async (sql) => (await pool.query(sql)).rows[0];

  const cert = await q("select count(*)::int n from customers where certificates is not null and certificates::text <> '[]'");
  if (cert.n === 0) {
    gaps.push('客户证书档案为空——认证到期续单是最稳的复购来源，没有这个数据就看不到续单机会');
  }
  const ind = await q("select count(*)::int n from customers where coalesce(nullif(industry,''),'')=''");
  if (ind.n > 0) gaps.push(`${ind.n} 个客户没填行业——按行业做的判断会失真`);

  const lost = await q("select count(*)::int n from leads where lead_status = 'Lost'");
  if (lost.n === 0) gaps.push('没有标记为流失的线索——无法回答「我们主要输在哪」');

  return gaps;
};

/** 汇总一份月度经营快照。所有数字都能在系统里核对到具体记录 */
const buildSnapshot = async () => {
  const [trend, overdue, bottleneck, mix, gaps] = await Promise.all([
    signingTrend(), overdueReceivables(), deliveryBottlenecks(), customerMix(), dataGaps(),
  ]);
  return { month: monthKey(), signingTrend: trend, overdueReceivables: overdue,
           deliveryBottlenecks: bottleneck, customerMix: mix, dataGaps: gaps };
};

/**
 * 提示词。三条硬要求，每条都对应一个曾经出过的问题：
 *   ① 每条建议必须指回具体数字 —— 否则就是套话
 *   ② 数据不足时明说判断不了 —— 否则 AI 会编一条听起来合理的
 *   ③ 只给 3 条 —— 给 10 条等于没给，老板一条也不会做
 */
const buildPrompt = (snapshot) => `
你是这家认证咨询公司的经营顾问。公司在浙江温州一带（温州/苍南/平阳/龙港），
做 ISO 体系和产品认证辅导。

团队构成（2026-08 实际）：
- 总经理 1 人（曾云俊），**同时是公司主要的销售**
- 总经理助理 1 人
- 咨询师 10 人
- 没有专职销售，也没有专职财务

一年 200-400 单，摊到 10 个咨询师身上是人均 20-40 单/年。
判断时要考虑这个结构——获客高度依赖一个人，是这家公司最大的结构性风险。

下面是本月的经营数据。请给出**这个月最该做的三件事**。

严格要求：
1. 每条建议必须**指回下面某个具体数字**，写清是哪个数字让你这么建议的。
   给不出数字依据的建议不要写。
2. 数据里没有的东西**明确说判断不了**，不要推测。
   比如没有流失原因数据，就不要猜"可能是价格问题"。
3. 只给三条。给十条等于没给。
4. 每条要具体到**这周能开始做**，不要"加强管理""提升效率"这类。

数据：
${JSON.stringify(snapshot, null, 2)}

只输出 JSON，不要 markdown 代码块：
{
  "period": "${snapshot.month}",
  "actions": [
    { "title": "一句话说清做什么", "why": "依据的具体数字", "firstStep": "这周先做什么", "urgency": "high|medium|low" }
  ],
  "cannotJudge": ["因为缺少某某数据，所以判断不了某某"],
  "dataToFix": ["建议补上的数据，以及补了能回答什么问题"]
}
`.trim();

module.exports = { buildSnapshot, buildPrompt, signingTrend, overdueReceivables,
                   deliveryBottlenecks, customerMix, dataGaps };
