// 服务类型归类 —— 「客户按服务类型分配」这条规则能不能在系统里落地。
//
// 2026-09-10 金恩来：「客户不是根据服务类型确定及分配的吗？」
//
// 规则是对的，而且比「谁跟哪个客户」好 —— 它可推导。
// 但当时系统推不出来：合同 service_line 是自由文本，10 份合同 10 种写法。
//
// 这份测试盯的是**分错人的那几种情况**。和行业归类不同，
// 这里归错是有代价的：活会派给不对的人。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.runtime/serviceLine.test.cjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/serviceLine.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
], { stdio: 'pipe' });
const { groupServiceLine, looksLikeServiceName, isSameServiceGroup, suggestOwnerByService } = require(out);

test('同一个服务的不同写法要归到一起', () => {
  /*
    这是整件事的起点：线上 10 份合同 10 种写法，
    「SC食品生产许可证」和「SC 食品生产许可」只差一个空格和两个字，
    字符串比较认不出是同一件事，于是「按服务类型分配」落不了地。
  */
  assert.equal(groupServiceLine('SC食品生产许可证'), '食品生产许可');
  assert.equal(groupServiceLine('SC 食品生产许可'), '食品生产许可');
  assert.ok(isSameServiceGroup('SC食品生产许可证', 'SC 食品生产许可'));

  assert.equal(groupServiceLine('QS 食品相关产品生产许可证认证咨询服务'), '食品相关产品');
  assert.equal(groupServiceLine('QS 食品相关产品生产许可'), '食品相关产品');
});

test('QS（食包）不能被当成 SC（食品厂）—— 派错人', () => {
  /*
    「食品相关产品生产许可」里既有「食品」也有「生产许可」，
    按 SC 的关键词会命中。但它是食包（商春姿），不是食品厂 SC（黄佳佳）。
    **规则顺序就是这条测试的全部意义**：QS 必须排在 SC 前面。
  */
  assert.equal(groupServiceLine('食品相关产品生产许可证'), '食品相关产品');
  assert.notEqual(groupServiceLine('食品相关产品生产许可证'), '食品生产许可');

  assert.equal(suggestOwnerByService('食品相关产品生产许可证').owner, '商春姿');
  assert.equal(suggestOwnerByService('SC 食品生产许可').owner, '黄佳佳');
});

test('体系认证里带别的大类关键词，不能被抢走', () => {
  /*
    ISO 22000 叫「食品安全管理体系」—— 含「食品」
    ISO 45001 叫「职业健康安全管理体系」—— 含「安全」和「职业」
    这些都是体系认证（黄邦煜），不是食品许可、不是安全生产、不是职业卫生。
    所以体系规则必须排在最前面。
  */
  assert.equal(groupServiceLine('ISO 22000 食品安全管理体系认证'), '体系认证');
  assert.equal(groupServiceLine('ISO14001环境管理体系和ISO45001职业健康安全管理体系咨询服务'), '体系认证');
  assert.equal(groupServiceLine('ISO三体系、诚信体系、社会责任咨询服务'), '体系认证');
  assert.equal(groupServiceLine('ISO/TS 16949 认证'), '体系认证');
});

test('项目名/合同名不是服务名，不许参与归类', () => {
  /*
    默认服务项拿项目名命名（buildDefaultServiceItem），
    于是库里一大半「服务项名称」叫「XX公司 咨询服务合同书」。

    硬按关键词去套，「咨询服务合同书」会命中一堆规则，归出来纯属噪音。
    更要紧的是**分母**：2026-09-11 第一次跑覆盖率，59 条里 30 条未分类，
    看着像规则只覆盖一半；拆开才发现其中 26 条根本不是服务名，
    真正的漏洞只有 2 个。分母错了，结论就会错，而且错在「要大改规则」这个方向。
  */
  ['浙江博峰数字科技有限公司 咨询服务合同书',
   '温州铸鼎机械有限公司 认证到期挖角跟进',
   '【情报跟进】平阳温州康田包装有限公司：塑编塑包/食品级包装企业资料核验与认证'
  ].forEach((s) => {
    assert.equal(looksLikeServiceName(s), false, `「${s}」被当成了服务名`);
    assert.equal(groupServiceLine(s), '未分类');
  });

  assert.equal(looksLikeServiceName('SC 食品生产许可'), true);
});

test('认不出来就说认不出来，不硬猜负责人', () => {
  /*
    和行业归类最大的不同：行业归错只是多看几篇资料，
    **服务归错是把活派给不对的人**。所以拿不准一律落「未分类」，
    并且不给建议负责人 —— 让人去指定。
  */
  assert.equal(groupServiceLine('待评估'), '未分类');
  assert.equal(suggestOwnerByService('待评估').owner, null);

  // 「未分类」之间不能互相算同类，否则一堆认不出的会互相匹配
  assert.equal(isSameServiceGroup('待评估', '政策窗口/复评'), false);
});

test('花名册里没人做的大类，不许瞎指派', () => {
  /*
    医疗器械、饲料添加剂这类单项许可，《信义在职员工表》里
    **没有任何人的岗位职责覆盖**。系统必须如实说「没人对应」，
    而不是就近派给某个顾问。
  */
  const r = suggestOwnerByService('医疗器械经营/生产许可证');
  assert.equal(r.group, '其他许可');
  assert.equal(r.owner, null, '给没人做的服务硬派了一个负责人');
});

test('一个大类有多个人时，第一个是建议、其余是备选', () => {
  const r = suggestOwnerByService('ISO9001 认证咨询服务');
  assert.equal(r.owner, '黄邦煜');
  assert.ok(r.alternatives.includes('梁杰'), '体系认证还有梁杰，应该作为备选给出来');
});

test('12 个大类名本身都要认得出 —— 表单下拉传的就是它', () => {
  /*
    2026-09-11 踩到的坑，而且**我的测试当时是绿的**：

    表单加了「服务类型」下拉后，选中的值就是大类名本身。
    但 `groupServiceLine('体系认证')` 返回「未分类」——
    关键词规则里写的是 `管理体系|三体系|ISO…`，
    「体系认证」四个字一条都不匹配。

    而先前那条用例用的是「食品相关产品」，它**恰好**出现在自己的关键词里，
    所以测试过了 —— **抽样抽到了唯一能通过的那个**。

    所以这条改成遍历全部大类，一个不漏。挑代表做抽样，
    在这种「每一项规则各不相同」的场合是靠不住的。
  */
  const { SERVICE_GROUPS: groups } = require(out);
  const bad = groups.filter((g) => g !== '未分类' && groupServiceLine(g) !== g);
  assert.deepEqual(bad, [],
    `这些大类名传进去认不出自己：${bad.map((g) => `${g}→${groupServiceLine(g)}`).join('、')}`);
});
