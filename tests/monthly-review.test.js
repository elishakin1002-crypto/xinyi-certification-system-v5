// 月度经营判断的数据快照。
//
// ── 这个模块的职责边界 ──────────────────────────────────────────
// 它**只做数据聚合，不做任何推断**。推断交给模型，
// 但模型说的每一条都要能指回快照里某个具体数字。
//
// 所以这些用例测的全是「事实摆得对不对」，不测 AI 说了什么。
// 事实错了，后面再聪明的模型也只会给出错的建议——
// 而且是**听起来同样合理**的错建议，比明显的错更危险。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const SRC = fs.readFileSync(path.resolve(__dirname, '../server/services/monthlyReview.js'), 'utf8');

test('签约趋势必须补齐空月份', () => {
  /*
    没有合同的月份不会出现在 group by 结果里，
    而「连续两个月一单没签」恰恰是最该被看见的信号——
    不补齐的话它在数据里是隐形的。

    实测信义的数据：2025-12、2026-01 连续两个月零签约，
    2026-03 之后连续六个月零签约。这些空档原来完全喂不给 AI。
  */
  assert.match(SRC, /补齐空月份/, '缺少补齐逻辑');
  assert.match(SRC, /for \(let i = 12; i >= 0; i--\)/,
    '没有按月份逐个补齐，零签约的月份会在数据里隐形');
});

test('原来的战略模块只给静态快照，没有时间维度', () => {
  // 这条记录的是「为什么要重做」，避免将来有人把趋势那段删掉
  assert.match(SRC, /时间维度/, '注释里没说清为什么需要趋势数据');
});

test('数据缺口必须如实报出来，不能让 AI 拿空数据硬凑', () => {
  /*
    缺数据时 AI 会用它有的东西凑一条建议，而那条建议听起来同样合理。
    明确告诉模型「这块没有数据」，它才会说「判断不了」而不是编。
  */
  assert.match(SRC, /const dataGaps/, '缺少数据缺口检查');
  assert.match(SRC, /证书档案为空/, '没检查证书档案——那是续单机会的基础');
  assert.match(SRC, /没填行业/, '没检查行业缺失');
  assert.match(SRC, /无法回答「我们主要输在哪」/, '没检查流失原因缺失');
});

test('提示词里要求每条建议指回具体数字', () => {
  /*
    不要求指回数字，AI 就会输出「加强客户维护」「提升交付效率」这类——
    每条都对，每条都不指向任何动作。这正是原来 SWOT 那套的问题。
  */
  const prompt = SRC.slice(SRC.indexOf('const buildPrompt'), SRC.indexOf('module.exports'));
  assert.match(prompt, /指回.*具体数字|具体数字/, '没要求建议必须有数字依据');
  assert.match(prompt, /明确说判断不了/, '没要求数据不足时如实说');
  assert.match(prompt, /只给三条/, '没限制条数——给十条等于没给');
  assert.match(prompt, /这周能开始做/, '没要求具体到可执行');
});

test('提示词里带了公司的真实情况', () => {
  // 不说清是什么公司，AI 会按大企业的框架来答
  const prompt = SRC.slice(SRC.indexOf('const buildPrompt'), SRC.indexOf('module.exports'));
  assert.match(prompt, /认证咨询/, '没说清行业');
  assert.match(prompt, /200-400/, '没说清业务量——量级决定了什么建议才现实');
  assert.match(prompt, /咨询师 10 人/, '没说清团队规模——12 人和 3 人该给的建议完全不同');
  assert.match(prompt, /同时是公司主要的销售/, '没说清获客高度依赖一个人这个结构性事实');
  assert.match(prompt, /没有专职销售，也没有专职财务/, '没说清哪些岗位是缺的');
});

test('客户名要正确取出来，不能是 undefined', () => {
  /*
    PG 返回的是 customer_name（下划线），JS 里读 customerName 会得到 undefined。
    第一次跑快照时逾期清单显示的全是「undefined ¥18,000 逾期 422 天」——
    一份让老板去催款的建议，却说不出该催谁。
  */
  assert.match(SRC, /customer_name as "customerName"/, '没做列名别名映射');
  assert.match(SRC, /\|\| '\(未填客户名\)'/, '没有兜底，取不到名字时会显示 undefined');
});
