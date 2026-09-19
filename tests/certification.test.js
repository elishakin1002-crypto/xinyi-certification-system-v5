/*
  证书：种类周期、提醒锚点、按企业合并。

  这些测试盯的是「会不会悄悄失效」，每一条都对应一个真出过的错：

  · 认不出的种类被当成 3 年（老 generateAuditPlan 的 else 分支）
  · 没有统一社会信用代码就记不了证书（会把最该记的情报挡在门外）
  · 一家企业三张证提醒三次（然后所有人开始无视提醒）
  · 同一档锚点天天重复触发
  · 「客户随口说的」和「官网查到的」长得一样
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

// 用 esbuild 打成一个临时 CJS 再 require —— 和 tests/cash-basis.test.js 同一个做法。
// （第一版我想当然用了 tsc，项目里根本没人那么干。改这里之前先看那个文件。）
const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `certification-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'),
  [path.join(root, 'src/modules/certification.ts'), '--bundle', '--platform=node',
    '--format=cjs', `--outfile=${out}`], { stdio: 'pipe' });
const C = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch {} });

/* ── 一、种类和有效期 ─────────────────────────────────────── */

test('有效期按种类定，不是一律三年', () => {
  assert.equal(C.certTypeOf('ISO9001').validMonths, 36);
  assert.equal(C.certTypeOf('ORGANIC').validMonths, 12, '有机产品认证只有一年');
  assert.equal(C.certTypeOf('SC_FOOD').validMonths, 60, '食品生产许可证五年');
});

test('认不出的种类返回 null —— 不许静悄悄当成三年', () => {
  /*
    老代码：if (ruleId.endsWith('_5Y')) {...} else { 按三年 }
    于是填错种类的证书，到期日、监督节点、提醒全是错的，
    而界面上看起来完全正常。这是这个项目最典型的那种坑。
  */
  assert.equal(C.certTypeOf('ISO90001'), null, '打错一个字不能当成 ISO9001');
  assert.equal(C.certTypeOf(''), null);
  assert.equal(C.certTypeOf(undefined), null);
  assert.equal(C.certTypeOf('__proto__'), null, '原型链上的属性不算已知种类');
});

test('两化融合是年审不是监督审核 —— 两件事工作量不同，文案不能混', () => {
  assert.equal(C.certTypeOf('LIANGHUA').supervision[0].kind, 'annualReview');
  assert.equal(C.certTypeOf('ISO9001').supervision[0].kind, 'surveillance');
});

/* ── 二、企业主体的身份 ───────────────────────────────────── */

test('没有统一社会信用代码也能挂证书 —— 但要标成弱匹配', () => {
  /*
    金恩来 2026-09-19：「客户详情是不是一定要填社会信用代码？
      不填证书就挂不上去？」

    不能是。情报的典型场景就是信息不全：听说某厂的证快到期了，
    这时候连全称都未必准。要求填代码才能记，等于把最该记的挡在门外。
  */
  const weak = C.subjectKeyOf({ companyName: '温州天越包装有限公司' });
  assert.equal(weak.kind, 'name');
  assert.equal(weak.isWeak, true, '靠名字认人可能认错，界面必须提示');

  const strong = C.subjectKeyOf({ uscc: '91330300MA2ABCDE1X', companyName: '温州天越包装有限公司' });
  assert.equal(strong.kind, 'uscc');
  assert.equal(strong.isWeak, false, '有代码就不该再提示"可能认错"');
});

test('企业名和代码都没有时返回 null —— 不许默默存一条孤儿记录', () => {
  assert.equal(C.subjectKeyOf({}), null);
  assert.equal(C.subjectKeyOf({ companyName: '   ' }), null);
});

/* ── 三、提醒锚点 ─────────────────────────────────────────── */

test('自己的客户和别人家的，提醒节奏完全不同', () => {
  const ours = C.touchAnchors('ISO9001', 'ours').map(a => a.daysBefore);
  const others = C.touchAnchors('ISO9001', 'others').map(a => a.daysBefore);

  assert.deepEqual(ours, [90, 60, 30], '自己的客户是交付责任：短而密');
  assert.deepEqual(others, [180, 90, 45, 15], '别人家的要先建立关系：早一档起步');
});

test('一年期证书不设「提前半年占位」那一档', () => {
  /*
    我写过「1 年期的除以 3 → 60/30/15/5 天」，金恩来问为什么除以 3 ——
    **没有依据**，纯粹按比例缩。锚点的意义不随周期等比缩小：
    一年一换的证书客户本来就熟门熟路，提前半年去碰只会被当成骚扰。
  */
  const short = C.touchAnchors('ORGANIC', 'others').map(a => a.daysBefore);
  assert.equal(short.length, 3, '短周期少一档');
  assert.ok(Math.max(...short) <= 60, `最早一触不该早于 60 天，实际 ${Math.max(...short)}`);
});

test('认不出种类就没有提醒节奏 —— 不给默认，否则错误节奏无人察觉', () => {
  assert.deepEqual(C.touchAnchors('不存在的种类', 'others'), []);
});

test('已经够到的锚点全部返回，由调用方去重 —— 停机补跑不会漏', () => {
  const anchors = C.touchAnchors('ISO9001', 'others');

  assert.deepEqual(C.reachedAnchors(200, anchors).map(a => a.daysBefore), [], '还没到第一档');
  assert.deepEqual(C.reachedAnchors(180, anchors).map(a => a.daysBefore), [180], '正好到第一档');
  assert.deepEqual(C.reachedAnchors(50, anchors).map(a => a.daysBefore), [180, 90],
    '停机三个月后补跑，前两档都要能补出来');
  assert.deepEqual(C.reachedAnchors(-5, anchors).map(a => a.daysBefore), [180, 90, 45, 15],
    '已经过期的，四档全都够到了');
});

/* ── 四、按企业合并 ───────────────────────────────────────── */

const cert = (o) => ({ relation: 'others', typeId: 'ISO9001', ...o });

test('一家企业三张证，只产生一次接触 —— 三张一起谈', () => {
  /*
    金恩来：「一份合同里可能有多种认证服务，涉及多张认证证书，
      这个时机你要怎么参考呢？」

    续约的单位不是合同，是证书；而三体系的三张证到期日常常错开几周。
    所以提醒按证书算，**接触按企业合并**，取最早到期的那张当触发点。
  */
  const certs = [
    cert({ id: 'A', companyName: '温州天越包装有限公司', typeId: 'ISO9001', expiryDate: '2027-03-10' }),
    cert({ id: 'B', companyName: '温州天越包装有限公司', typeId: 'ISO14001', expiryDate: '2027-03-25' }),
    cert({ id: 'C', companyName: '温州天越包装有限公司', typeId: 'ISO45001', expiryDate: '2027-04-02' })
  ];
  const touches = C.companyTouchesDue(certs, '2026-12-11');   // 距 A 约 89 天

  assert.equal(touches.length, 1, '一家企业一次接触，不是三次');
  assert.equal(touches[0].driver.id, 'A', '触发点是最早到期的那张');
  assert.equal(touches[0].certs.length, 3, '窗口期内的另外两张要一起带出来');
  assert.match(touches[0].purpose, /决策窗口/, '要告诉销售这一触该干什么');
});

test('不同企业分别产生接触，按紧急程度排序', () => {
  const certs = [
    cert({ id: 'X', companyName: '甲公司', expiryDate: '2027-03-01' }),
    cert({ id: 'Y', companyName: '乙公司', expiryDate: '2026-12-20' })
  ];
  const touches = C.companyTouchesDue(certs, '2026-12-11');
  assert.equal(touches.length, 2);
  assert.equal(touches[0].driver.id, 'Y', '快到期的排前面');
});

test('还没够到第一个锚点的企业不产生接触', () => {
  const certs = [cert({ id: 'Z', companyName: '丙公司', expiryDate: '2028-01-01' })];
  assert.deepEqual(C.companyTouchesDue(certs, '2026-12-11'), []);
});

test('没有到期日、没有主体的记录不参与 —— 不能凭空造一条接触', () => {
  const certs = [
    cert({ id: 'N1', companyName: '丁公司' }),                    // 没有到期日
    cert({ id: 'N2', expiryDate: '2026-12-20' })                  // 没有企业名也没有代码
  ];
  assert.deepEqual(C.companyTouchesDue(certs, '2026-12-11'), []);
});

test('有代码的和没代码的同名企业算两个主体 —— 不许靠名字硬凑', () => {
  /*
    弱匹配只在"两边都没有代码"时才成立。
    一边有代码一边没有，不能假定是同一家 —— 真同一家的话，
    该做的是把代码补上，而不是让系统替人猜。
  */
  const certs = [
    cert({ id: 'P', uscc: '91330300MA2ABCDE1X', companyName: '戊公司', expiryDate: '2026-12-20' }),
    cert({ id: 'Q', companyName: '戊公司', expiryDate: '2026-12-21' })
  ];
  const touches = C.companyTouchesDue(certs, '2026-12-11');
  assert.equal(touches.length, 2, '合并了就是在替人猜');
});

/* ── 五、来源和可信度 ─────────────────────────────────────── */

test('只有我们交付的和官方查到的算已核实', () => {
  assert.equal(C.isVerified('ourDelivery'), true);
  assert.equal(C.isVerified('official'), true);
  assert.equal(C.isVerified('customerSaid'), false, '客户随口说的不算核实过');
  assert.equal(C.isVerified('peerSaid'), false);
  assert.equal(C.isVerified('guess'), false);
});

test('未核实必须明说，不能留空 —— 留空会被当成没问题', () => {
  assert.match(C.confidenceLabel('customerSaid'), /未核实/);
  assert.ok(C.confidenceLabel(undefined).trim().length > 0, '来源缺失时也要有话说');
  assert.match(C.confidenceLabel(undefined), /未核实/);
});
