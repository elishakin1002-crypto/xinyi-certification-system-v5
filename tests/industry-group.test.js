// 行业归类：把工商口径的 180 个细分行业，归到信义按业务实际区分的大类。
//
// 金恩来 2026-09-08：「只要这个行业我们之前做过，大部分体系文件是可以复用的，
// 就是改一下公司抬头和部分数据！」
//
// **这是信义最核心的效率来源。** 但线上实测：466 条客户/线索记录
// 散在 180 个行业值里，其中 110 个只出现过一次 ——
// 于是「同行业做过就能复用」在系统里根本查不出来。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

let _mod = null;
const load = () => {
  if (_mod) return _mod;
  const out = path.join(os.tmpdir(), `industry-t-${process.pid}.cjs`);
  execFileSync(path.resolve(root, 'node_modules/.bin/esbuild'), [
    path.resolve(root, 'src/modules/industry.ts'),
    '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
  ], { stdio: 'pipe' });
  _mod = require(out);
  return _mod;
};

test('工商口径的同类厂，要归到同一个大类', () => {
  const { groupIndustry } = load();
  /*
    这四个在工商是四个行业，**在信义眼里是同一件事：包装厂** ——
    体系文件互相能抄。归不到一起，复用就无从谈起。
  */
  ['包装装潢及其他印刷', '其他纸制品制造', '纸和纸板容器制造', '塑料包装箱及容器制造']
    .forEach(v => assert.equal(groupIndustry(v), '包装印刷', `${v} 没归进包装印刷`));

  ['汽车零部件及配件制造', '摩托车零部件及配件制造']
    .forEach(v => assert.equal(groupIndustry(v), '汽摩配', `${v} 没归进汽摩配`));

  ['塑料零件及其他塑料制品制造', '塑料丝、绳及编织品制造', '塑料薄膜制造']
    .forEach(v => assert.equal(groupIndustry(v), '塑料橡胶', `${v} 没归进塑料橡胶`));
});

test('做设备的不能被下游行业的词抓走', () => {
  /*
    规则从上往下匹配，先命中的赢。
    「包装专用设备制造」是做机器的，不是包装厂 ——
    归错了，检索会把机械厂的经验推给包装厂看。
  */
  const { groupIndustry } = load();
  assert.equal(groupIndustry('包装专用设备制造'), '机械设备');
  assert.equal(groupIndustry('印刷专用设备制造'), '机械设备');
  assert.equal(groupIndustry('塑料加工专用设备制造'), '机械设备');
  assert.equal(groupIndustry('皮革、毛皮及其制品加工专用设备制造'), '机械设备');
});

test('没见过的值也要能归对', () => {
  /*
    行业值来自工商数据，是**开放集合** —— 明天来个新客户就可能带来
    第 181 个值。所以用关键词规则而不是枚举表：
    逐条枚举的表永远补不完，补不上的会静默落进「其他」。
  */
  const { groupIndustry } = load();
  assert.equal(groupIndustry('某某彩印包装制品有限公司经营范围'), '包装印刷');
  assert.equal(groupIndustry('新型塑胶制品制造'), '塑料橡胶');
  assert.equal(groupIndustry(''), '其他');
  assert.equal(groupIndustry(undefined), '其他');
  assert.equal(groupIndustry('待 AI 分析'), '其他', '占位值不该被当成真行业');
});

test('同行判断只在归得出大类时才成立', () => {
  const { isSameIndustryGroup } = load();
  assert.equal(isSameIndustryGroup('包装装潢及其他印刷', '纸和纸板容器制造'), true);
  assert.equal(isSameIndustryGroup('包装装潢及其他印刷', '汽车零部件及配件制造'), false);
  /*
    两个都归不进大类时**不算同行** —— 否则「其他未列明制造业」
    会和所有归不了类的公司互相当同行，那是噪音不是信号。
  */
  assert.equal(isSameIndustryGroup('其他未列明制造业', '其他制造业'), false);
});

test('检索要真的用上行业，不能只是声明了字段', () => {
  /*
    RetrievableDoc 上早就有 industry，但**从来没有参与过打分** ——
    声明了没用，和当初那个 getCategoryBadge 一样。
    这条测试盯住它别再变回死代码。
  */
  const src = read('src/modules/knowledge/retrieval.ts');
  assert.match(src, /isSameIndustryGroup\(industry, doc\.industry\)/, '检索没有按行业加权');
  assert.match(src, /score \*= 1\.6/, '同行业没有加权系数');
  // 不能做成硬过滤 —— 那样「包装厂第一次做 SC」会一篇都搜不到
  assert.ok(!/if \(industry && doc\.industry && !isSame/.test(src), '同行业做成了硬过滤，跨行业的标准原文会被挤掉');

  assert.match(read('components/AIChatWidget.tsx'), /industry: mentioned\?\.industry/,
    'AI 检索没有把客户行业传进去');
});

test('经验条目要按大类打标签', () => {
  const src = read('src/modules/knowledge/lessons.ts');
  assert.match(src, /const group = groupIndustry\(industry\)/, '经验没有归大类');
  assert.match(src, /group, industry/, '标签里没有同时保留大类和原始行业值');
});
