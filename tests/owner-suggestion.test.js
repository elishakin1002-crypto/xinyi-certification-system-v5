// 建议负责人 —— 这活该派给谁。
//
// 2026-09-11 金恩来提了两件事，这份测试盯的就是这两件：
//
//   「全员上的话，难免会遇到同样的客户做同样咨询的抢客户的情况」
//   「你以建议的形式派活挺好的」
//
// 所以：① 同客户同服务必须回到原来那个人（防抢客户的锚）
//       ② 永远只是建议，认不出就说认不出，不硬派
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.runtime/ownerSuggestion.test.cjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/ownerSuggestion.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
], { stdio: 'pipe' });
const { buildSuggestion, buildSuggestionRecord } = require(out);

const CONSULTANTS = ['黄邦煜', '梁杰', '黄佳佳', '商春姿', '陈诗蕾', '郑园园', '林元波', '曾瑞锨', '温婵然'];

const svc = (name) => ({ id: `SI-${name}`, name });
const customers = [
  { id: 'C-PACK', name: '优福包装', industry: '包装装潢及其他印刷' },
  { id: 'C-FOOD', name: '宏宏食品', industry: '食品制造业' },
  { id: 'C-NEW', name: '新来的包装厂', industry: '包装装潢及其他印刷' },
];
const projects = [
  // 优福包装的食包 QS 是商春姿做的
  { id: 'P1', name: '优福包装 咨询服务合同书', customerId: 'C-PACK', manager: '商春姿',
    status: 'Completed', serviceItems: [svc('QS 食品相关产品生产许可')] },
  // 宏宏食品的 SC 是黄佳佳做的
  { id: 'P2', name: '宏宏食品 咨询服务合同书', customerId: 'C-FOOD', manager: '黄佳佳',
    status: 'Completed', serviceItems: [svc('SC 食品生产许可')] },
];
const base = { customers, projects, activeConsultants: CONSULTANTS };

test('同客户 + 同服务 → 回到原来那个人（防抢客户）', () => {
  /*
    金恩来：「难免会遇到同样的客户做同样咨询的抢客户的情况。」

    优福包装的食包续期，就该回到商春姿手上 ——
    不是谁先在系统里看见谁抢走。
    这同时也是对的业务判断：她熟悉这家厂的车间、见过他们的问题。
  */
  const s = buildSuggestion({ ...base, serviceText: 'QS 食品相关产品生产许可', customerId: 'C-PACK' });
  assert.equal(s.candidates[0].name, '商春姿');
  assert.ok(
    s.candidates[0].reasons.some(r => r.includes('做过这家客户的')),
    '没有把「做过这家客户的这类服务」作为理由说出来 —— 没有理由的建议不叫建议'
  );

  // 分差要拉得开，否则排序一有风吹草动就翻盘
  const second = s.candidates[1];
  if (second) assert.ok(s.candidates[0].score - second.score >= 30, '首选和备选分差太小，锚不住');
});

test('客户熟悉度不能压过「会不会做」', () => {
  /*
    2026-09-11 第一版真实翻过车：
    包装厂要做 ISO9001，系统首选了**商春姿** —— 因为她服务过这家客户、
    做过包装行业，35 分压过了黄邦煜的 30 分。

    可商春姿做的是食包、台账、校准、工商代理，**她不做体系认证**。

    所以资格是硬门槛，熟悉度只在门槛之内排序。
  */
  const s = buildSuggestion({ ...base, serviceText: 'ISO9001 质量管理体系认证', customerId: 'C-PACK' });
  assert.equal(s.candidates[0].name, '黄邦煜');
  assert.ok(!s.candidates.some(c => c.name === '商春姿'),
    '商春姿不做体系认证，却因为熟悉这家客户被推荐了 —— 熟悉度压过了资格');
});

test('实际做过，就算资格 —— 花名册可能不全', () => {
  /*
    资格的第二个来源：他**真的做过**这家客户的这类服务。
    花名册会过时、会漏写，而「他真做过」是比任何表格都硬的证据。
  */
  const withOddHistory = {
    ...base,
    projects: [...projects, {
      id: 'P3', name: '某厂 咨询服务合同书', customerId: 'C-FOOD', manager: '温婵然',
      status: 'Completed', serviceItems: [svc('SC 食品生产许可')],
    }],
  };
  // 温婵然的花名册方向是台账，不是 SC —— 但她做过这家客户的 SC
  const s = buildSuggestion({ ...withOddHistory, serviceText: 'SC 食品生产许可', customerId: 'C-FOOD' });
  assert.ok(s.candidates.some(c => c.name === '温婵然'),
    '她实际做过这家客户的这类服务，却因为不在花名册方向表里被排除了');
});

test('新客户没有历史时，靠服务方向', () => {
  const s = buildSuggestion({ ...base, serviceText: 'SC 食品生产许可', customerId: 'C-NEW' });
  assert.equal(s.candidates[0].name, '黄佳佳');
  assert.ok(s.candidates[0].reasons.some(r => r.includes('方向')));
});

test('第三方合作的服务，不推荐任何内部顾问', () => {
  /*
    金恩来 2026-09-11：「医疗器械、饲料添加剂这类许可，这类是和第三方合作的。」

    这和「认不出来」是两件事，必须分开 —— 否则每来一单医疗器械，
    系统都提示「请指定负责人」，而正确答案永远是「这个不归内部做」，
    于是这条提示每次都是噪音，人很快学会无视它。
  */
  const s = buildSuggestion({ ...base, serviceText: '医疗器械经营/生产许可证' });
  assert.equal(s.outsourced, true);
  assert.equal(s.candidates.length, 0, '走第三方的活还推荐了内部顾问');
  assert.match(s.note, /第三方/);
});

test('任何服务类型都可能外包 —— 选了「外包」就不推荐内部人；「合作」仍要推荐', () => {
  /*
    金恩来 2026-09-11：「第三方服务各类服务都有。」

    所以「走不走第三方」是**项目上的一个勾**，不是服务大类的性质。
    体系认证这种明明内部有人做的，具体某一单也可能外包 ——
    这时候再推荐黄邦煜就是错的。

    和 billable 一样：属性，不是类别。拿一个正交维度去切类别，
    必然出现装不下的组合（「合同项目 vs 非合同项目」那次就是这么错的）。
  */
  const s = buildSuggestion({ ...base, serviceText: 'ISO9001 质量管理体系认证', customerId: 'C-PACK', projectType: 'Outsourced' });
  assert.equal(s.outsourced, true);
  assert.equal(s.candidates.length, 0, '这一单标了外包，却还在推荐内部顾问');
  assert.match(s.note, /合作方/, '没提醒填合作方 —— 「这活谁做的」会断在这里');

  // 不选外包时照常推荐，别把功能整个关掉了
  const normal = buildSuggestion({ ...base, serviceText: 'ISO9001 质量管理体系认证', customerId: 'C-PACK' });
  assert.equal(normal.candidates[0].name, '黄邦煜');

  /*
    'Joint'（和第三方一起做）**必须照常推荐** —— 合作做的活，
    信义这边仍然要有人负责。把 Joint 也当成外包一并拦掉，
    就会出现「一起做的项目没人管」，那是比不推荐更糟的结果。
  */
  const joint = buildSuggestion({ ...base, serviceText: 'ISO9001 质量管理体系认证', customerId: 'C-PACK', projectType: 'Joint' });
  assert.equal(joint.outsourced, false, '「合作」被当成了「外包」');
  assert.equal(joint.candidates[0].name, '黄邦煜', '合作项目也要有信义这边的负责人');
});

test('认不出来就说认不出来，不硬派人', () => {
  const s = buildSuggestion({ ...base, serviceText: '帮忙看一下那个事' });
  assert.equal(s.serviceGroup, '未分类');
  assert.equal(s.candidates.length, 0, '认不出服务类型却还是推荐了人');
  assert.match(s.note, /请自己指定/);

  // 还没填的时候，话要说得不一样 —— 「认不出」和「还没填」是两种状态
  const empty = buildSuggestion({ ...base, serviceText: '' });
  assert.match(empty.note, /还没填/);
});

test('离职/不在花名册的人不会被推荐', () => {
  const s = buildSuggestion({
    ...base, serviceText: 'SC 食品生产许可', customerId: 'C-FOOD',
    activeConsultants: CONSULTANTS.filter(n => n !== '黄佳佳'),   // 假设他离职了
  });
  assert.ok(!s.candidates.some(c => c.name === '黄佳佳'), '已离职的人还在被推荐');
});

test('要记下「建议了谁 / 实际选了谁」 —— 这是将来让推荐变准的燃料', () => {
  /*
    金恩来：「随 AI 对系统越来越了解，后面推荐肯定也会更有依据和准确。」

    会，但不会自己变准 —— 得有数据喂它。
    而最值钱的恰恰是「系统建议 A、人却选了 B」这件事：
    那里面装着规则没编码进去的全部现实（休假、出差、客户点名、处不来）。
  */
  const s = buildSuggestion({ ...base, serviceText: 'SC 食品生产许可', customerId: 'C-FOOD' });

  const followed = buildSuggestionRecord('P-NEW', s, '黄佳佳');
  assert.equal(followed.overridden, false);
  assert.equal(followed.suggested, '黄佳佳');

  const overridden = buildSuggestionRecord('P-NEW', s, '陈诗蕾');
  assert.equal(overridden.overridden, true, '人改了系统的建议，却没被标记出来 —— 那条记录就白存了');
  assert.equal(overridden.chosen, '陈诗蕾');
  assert.ok(overridden.suggestedReasons.length > 0, '没记下当初为什么这么建议，事后无从复盘');
});

test('10. 「以前是谁做的」要单独拎出来 —— 它是提醒，不是建议', () => {
  /*
    2026-09-11 金恩来指出我把对象搞错了：
    「我用梁杰的号登录准备建总经理已经分配给我的项目，建的时候看见下面
      提醒我说我的同事还没有项目，要不要分配给他，会不会有些奇怪」

    对的：**建议是给派活的人看的，不是给干活的人看的**。
    查了同类工具也一致 —— Jira 的负责人建议藏在下拉框里（点开才看到），
    PSA 类工具是「系统提候选 → 交付负责人确认」。

    所以日常建议改成拉取式（点开才展开），
    **只有一种情况主动弹：这家客户的这类服务以前是别人做的** ——
    那正是抢客户的场景，而且措辞是「确认要换人吗」，不是「建议派给他」。

    这条测试钉住 previousOwner 这个字段，因为界面靠它决定弹不弹。
  */
  const s = buildSuggestion({ ...base, serviceText: 'QS 食品相关产品生产许可', customerId: 'C-PACK' });
  assert.equal(s.previousOwner, '商春姿', '没认出这家客户的这类服务以前是谁做的');

  // 新客户没有历史 → 不该弹提醒
  const fresh = buildSuggestion({ ...base, serviceText: 'QS 食品相关产品生产许可', customerId: 'C-NEW' });
  assert.equal(fresh.previousOwner, null, '新客户不该有「以前是谁做的」');

  // 同客户但不同服务 → 也不该弹（那不是抢客户）
  const other = buildSuggestion({ ...base, serviceText: 'ISO9001 质量管理体系认证', customerId: 'C-PACK' });
  assert.equal(other.previousOwner, null, '不同服务不算抢客户，不该主动提醒');

  // 外包/认不出时字段也要在，不能是 undefined
  assert.equal(buildSuggestion({ ...base, serviceText: '医疗器械经营/生产许可证' }).previousOwner, null);
  assert.equal(buildSuggestion({ ...base, serviceText: '帮忙看一下那个事' }).previousOwner, null);
});

test('11. 服务类型直接选时，不再依赖项目名怎么写', () => {
  /*
    金恩来：「这个名称没有固定规范大家怎么写的可能都有，这也是问题」

    他说中了 —— 生产上 10 份合同 10 种写法。所以表单加了服务类型下拉，
    选了就用选的值，没选才退回猜项目名。

    这条验证：直接传大类名字也能正确归类（表单传的就是大类名）。
  */
  const s = buildSuggestion({ ...base, serviceText: '食品相关产品', customerId: 'C-PACK' });
  assert.equal(s.serviceGroup, '食品相关产品', '直接传服务大类名却没认出来');
  assert.equal(s.previousOwner, '商春姿');
});

test('12. 建完项目必须真的把这笔记下来 —— 光有 buildSuggestionRecord 等于没有', () => {
  /*
    2026-09-11。上一版把 buildSuggestionRecord 写好了、测试也过了，
    **但没有任何地方调用它** —— 记录函数存在，记录从未发生。
    「越用越准」于是永远是一句空话，而且不报错、查不出来。

    这个项目里同一类事故已经发生过两次（accountExpiresAt、vendorName）：
    东西写好了，中间少一根线，功能悄悄不生效。

    所以这条钉三件事，缺一条就是断线：
      ① 建项目之后真的调了 buildSuggestionRecord
      ② 用的是新项目的真 id（曾经因为 addProject 只返回 true/false 而拿不到）
      ③ 发去了 business_events（已有的账本，不新建表）
  */
  const src = fs.readFileSync(path.join(root, 'pages/Projects.tsx'), 'utf8');
  assert.ok(/buildSuggestionRecord\(\s*saved\.id\s*,/.test(src),
    '没有拿新项目的真 id 去记 —— 空 id 的记录攒多少都分析不出东西');
  assert.ok(/project\.owner\.suggestion\.(overridden|followed)/.test(src),
    '没有把「建议被采纳 / 被改掉」作为事件类型发出去');
  assert.ok(src.includes("'/api/business-events'"),
    '记录没有落到已有的业务事件账本里');

  // addProject 必须把项目本身还回来，否则上面那个 saved.id 永远是 undefined
  const ctx = fs.readFileSync(path.join(root, 'context/AppContext.tsx'), 'utf8');
  assert.ok(/addProject:\s*\(p: AddProjectInput\) => Promise<Project \| null>/.test(ctx),
    'addProject 又退回只返回 true/false 了 —— 调用方就拿不到新项目的 id');
});
