// 从合同标题里猜公司名 —— 不用 AI。
//
// 2026-09-14 金恩来：「在合同管理中新建合同时若是没有现成的关联客户，
//   点新建客户时默认直接把合同里对方公司的名字填上去……这个能力需要调用 AI 吗？」
//
// 不需要。信义的合同标题本身就带公司全称，把文书名和标准号削掉就是了。
//
// ── 这组测试真正要守住的是「宁可多留字，不要削掉公司名」 ────────
//
// 猜出来的结果是**填进输入框的默认值**，人看得见改得动。
// 多留两个字，人删一下就完事；
// 而把「温州康田包装有限公司」削成「温州康田」，人不一定会注意到，
// 客户档案里存错全称，以后开票、发证书都要返工。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `companyFromTitle-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/companyFromTitle.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`
], { stdio: 'pipe' });
const { guessCompanyFromContractTitle: guess } = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch { /* 已经没了 */ } });

test('公司全称要完整留下，一个字都不许少', () => {
  /*
    这几条是生产库里真实出现过的合同标题（清理前）。
    括号是公司名的一部分 —— 「优福包装科技（浙江）有限公司」削掉括号就是另一家公司了。
  */
  assert.equal(guess('优福包装科技（浙江）有限公司 咨询服务合同书'), '优福包装科技（浙江）有限公司');
  assert.equal(guess('浙江博峰数字科技有限公司 咨询服务合同书'), '浙江博峰数字科技有限公司');
  assert.equal(guess('温州康田包装有限公司ISO9001认证咨询服务合同'), '温州康田包装有限公司');
  assert.equal(guess('平阳县新锦油茶种植专业合作社 SC生产许可咨询合同'), '平阳县新锦油茶种植专业合作社');
});

test('「包装」「食品」这类词是公司名的一部分，绝不能当成服务名删掉', () => {
  /*
    这是最危险的一类误伤：把「食品安全管理体系认证」列进服务词表时，
    如果顺手把「食品」也列进去，「温州宏宏食品有限公司」就会变成「温州宏宏有限公司」——
    一个看起来很正常、但其实不存在的公司。
  */
  assert.equal(guess('温州宏宏食品有限公司 食品安全管理体系认证咨询合同'), '温州宏宏食品有限公司');
  assert.equal(guess('龙港市茶里茶气食品包装有限公司 咨询服务合同'), '龙港市茶里茶气食品包装有限公司');
  assert.equal(guess('苍南县塑编包装厂 体系认证咨询合同'), '苍南县塑编包装厂');
});

test('标题后面跟的不是"合同"二字时，也要能切出公司名', () => {
  /*
    这条专门盯 COMPANY_TAILS 那条路（找「有限公司/合作社/厂」这类结尾）。

    2026-09-14 写完第一版测试时我做了反证：把 COMPANY_TAILS 清空，
    **测试照样全绿** —— 说明那几条用例走的都是"削后缀"那条退路，
    COMPANY_TAILS 有没有都一样。一条不会红的测试等于没有测。

    这里的标题后面跟的是「2026年度台账指导」，不在文书后缀表里，
    只有靠公司结尾词才切得干净：
      有 COMPANY_TAILS → 温州宏宏食品有限公司          ✓
      没有            → 温州宏宏食品有限公司2026年度   ✗
  */
  assert.equal(guess('温州宏宏食品有限公司2026年度台账指导'), '温州宏宏食品有限公司');
  assert.equal(guess('苍南县龙港印刷厂 内审员培训'), '苍南县龙港印刷厂');
});

test('没有公司性质词的标题，削后缀；削完太短就当猜不出来', () => {
  /*
    「猜不出来」返回空串，让人自己填 —— 这比填一个残缺的名字好：
    残缺的名字人可能直接保存了，空的则一定会被填。
  */
  assert.equal(guess('技术服务合同'), '', '只有文书名，没有公司名，应该放弃');
  assert.equal(guess('合同'), '');
  assert.equal(guess(''), '');
  assert.equal(guess(undefined), '');
});

test('标题里有两家公司时两边都留下，让人自己判断', () => {
  /*
    取最靠后的那个公司结尾，而不是第一个。
    取第一个会悄悄丢掉一方；两边都留着，人一眼看出不对会自己改。
  */
  const r = guess('温州康田包装有限公司与浙江信义企业管理有限公司合作协议');
  assert.ok(r.includes('温州康田包装有限公司'), '丢了甲方');
  assert.ok(r.includes('浙江信义企业管理有限公司'), '丢了乙方');
});

test('结果要能直接填进输入框 —— 首尾不带标点和空格', () => {
  assert.equal(guess('  温州盛世机车业有限公司 · 咨询服务合同书  '), '温州盛世机车业有限公司');
  assert.equal(guess('温州优堡五金制品有限公司，ISO 14001 认证咨询'), '温州优堡五金制品有限公司');
});

test('合同页面要真的用上它 —— 有函数没人调等于没做', () => {
  const page = fs.readFileSync(path.join(root, 'pages/Contracts.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(page, /guessCompanyFromContractTitle/, '合同页面没有调用它');
});
