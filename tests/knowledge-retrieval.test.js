// 知识库检索。用**信义真实的文档标题**来测，不用编的例子。
//
// ── 为什么要有这个文件 ──────────────────────────────────────────
// 2026-08-24 之前，检索是拿用户输入的整句话做子串匹配：
//
//     if (title.includes(q)) score += 8;    // q = "包装厂的复盘"
//
// 标题里当然不会出现一整句问话，所以**所有文档恒定 0 分**，
// 排序退化成「按数组顺序取前 4 篇」。
// 实测：问「包装厂的复盘」，匹配不到《客户复盘｜东莞市万豪包装有限公司》。
//
// 这类失效不报错。AI 照样回答，只是没用上公司自己的知识——
// 看上去像「AI 不懂我们的业务」，实际是检索压根没生效。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

/*
  retrieval.ts 是 TypeScript，node:test 不能直接跑。
  用项目里已有的 TypeScript 编译器**真转译**，不要自己写正则剥类型——
  第一版就是拿正则凑的，剥不干净，六条用例全部报语法错误。
  编译器就在 node_modules 里，用它。

  检索是知识中心唯一重要的功能，不能因为「是 TS 测不了」就不测。
*/
const ts = require('typescript');
const loadRetrieval = () => {
  const file = path.resolve(__dirname, '../src/modules/knowledge/retrieval.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, require);
  return mod.exports;
};

/** 信义库里真实存在的文档标题 */
const DOCS = [
  { id: 'd1', title: '客户复盘｜平阳县新锦油茶种植专业合作社｜SC食品生产许可证', summary: '油茶合作社 SC 认证复盘', content: '本次服务为 SC 食品生产许可证辅导，客户为农产品加工企业。' },
  { id: 'd2', title: '客户复盘｜东莞市万豪包装有限公司｜ISO 9001 质量管理体系', summary: '包装企业 ISO 9001 复盘', content: '包装制造企业首次通过 ISO 9001 认证，过程中体系文件编写耗时较长。' },
  { id: 'd3', title: '客户复盘｜优福包装科技（浙江）有限公司｜QS 食品相关产品生产许可', summary: '食品包装 QS 复盘', content: '食品相关产品生产许可，涉及塑料包装材料。' },
  { id: 'd4', title: '新员工入职培训手册V1.0', summary: '新人入职流程与制度', content: '公司考勤制度、报销流程、客户拜访规范。' },
  { id: 'd5', title: '温州德匠包装有限公司(1)', summary: '客户企业资料', content: '包装企业基本信息与经营范围。' },
];

test('问「包装厂的复盘」，要能找到包装企业的复盘文档', () => {
  const { rankDocs } = loadRetrieval();
  const hits = rankDocs('包装厂的复盘', DOCS);
  assert.ok(hits.length > 0, '一条都没检索到——这正是修之前的表现');
  const ids = hits.map((h) => h.doc.id);
  assert.ok(ids.includes('d2') || ids.includes('d3'),
    `应当命中包装企业的复盘，实际返回：${hits.map((h) => h.doc.title.slice(0, 20)).join(' / ')}`);
});

test('标准号是最关键的检索词，ISO 9001 要能精确命中', () => {
  const { rankDocs } = loadRetrieval();
  const hits = rankDocs('ISO 9001 认证要准备什么', DOCS);
  assert.ok(hits.length > 0, 'ISO 9001 检索不到任何东西');
  assert.equal(hits[0].doc.id, 'd2', `ISO 9001 的复盘应当排第一，实际第一是：${hits[0].doc.title}`);
});

test('问食品相关的，不该把新员工培训手册排前面', () => {
  const { rankDocs } = loadRetrieval();
  const hits = rankDocs('食品生产许可证怎么办', DOCS);
  assert.ok(hits.length > 0);
  assert.notEqual(hits[0].doc.id, 'd4', '培训手册和食品许可证无关，不该排第一');
  assert.ok(['d1', 'd3'].includes(hits[0].doc.id));
});

test('完全不相关的问题，宁可什么都不返回', () => {
  /*
    塞一篇无关文档进 AI 的上下文，比不塞更糟：
    AI 会照着那篇答，而使用者以为那就是公司的规定。
  */
  const { rankDocs } = loadRetrieval();
  const hits = rankDocs('今天天气怎么样', DOCS);
  assert.equal(hits.length, 0, `不相关的问题却返回了：${hits.map((h) => h.doc.title).join(' / ')}`);
});

test('检索词能正确切出标准号和中文词', () => {
  const { extractTerms } = loadRetrieval();
  const terms = extractTerms('ISO 22000 食品安全体系怎么做');
  assert.ok(terms.includes('ISO'), '标准号英文部分要保留');
  assert.ok(terms.includes('22000'), '标准号数字部分要保留——它是最有区分度的词');
  assert.ok(terms.some((t) => t === '食品'), '中文业务词要切出来');
  assert.ok(!terms.includes('怎么'), '「怎么」这类问句功能词要过滤掉，它在每个问题里都有');
});

test('返回结果要说明命中了哪些词', () => {
  // 界面上要能回答「为什么给我这篇」，否则用户不知道该不该信
  const { rankDocs } = loadRetrieval();
  const hits = rankDocs('ISO 9001 体系文件', DOCS);
  assert.ok(hits.length > 0);
  assert.ok(Array.isArray(hits[0].hits) && hits[0].hits.length > 0, '没有返回命中词');
});

test('可信层级影响排序：标准原文 > 我们的经验 > AI 草稿', () => {
  /*
    同样相关的两份材料，标准原文该排在经验总结前面——
    经验可能只适用于某一类客户，标准是普遍成立的。
    AI 草稿降权最狠：还没人审过，只配当提示，不配当依据。
  */
  const { rankDocs } = loadRetrieval();
  const same = { summary: 'ISO 9001 内审要求', content: '内审的具体要求与频次。' };
  const docs = [
    { id: 'draft', title: 'ISO 9001 内审要点', ...same, trustLevel: 'aiDraft' },
    { id: 'exp', title: 'ISO 9001 内审要点', ...same, trustLevel: 'ourExperience' },
    { id: 'std', title: 'ISO 9001 内审要点', ...same, trustLevel: 'official' },
  ];
  const hits = rankDocs('ISO 9001 内审', docs, { limit: 3 });
  assert.equal(hits.length, 3);
  assert.equal(hits[0].doc.id, 'std', '标准原文该排第一');
  assert.equal(hits[2].doc.id, 'draft', 'AI 草稿该排最后');
});

test('过期的依据要降权，并标出来', () => {
  /*
    标准改版后旧版依据还在库里，AI 照着答就是错的。
    过期的知识**比没有知识更危险**——它看起来仍然权威。
  */
  const { rankDocs } = loadRetrieval();
  const docs = [
    { id: 'old', title: 'ISO 9001 内审要点', summary: '旧版要求', content: '旧版内审要求内容。',
      trustLevel: 'official', validUntil: '2020-01-01' },
    { id: 'new', title: 'ISO 9001 内审要点', summary: '现行要求', content: '现行内审要求内容。',
      trustLevel: 'official' },
  ];
  const hits = rankDocs('ISO 9001 内审', docs, { limit: 2 });
  assert.equal(hits[0].doc.id, 'new', '现行版本要排在过期版本前面');
  const old = hits.find((h) => h.doc.id === 'old');
  assert.equal(old?.expired, true, '过期要标出来，界面和提示词里都得让人看见');
});

test('没标可信层级的按「我们的经验」处理，不能享受标准原文待遇', () => {
  const { rankDocs } = loadRetrieval();
  const hits = rankDocs('ISO 9001 内审',
    [{ id: 'x', title: 'ISO 9001 内审要点', summary: '要求', content: '内审要求。' }]);
  assert.equal(hits[0].trustLevel, 'ourExperience', '默认从严：来路不明的不能当标准原文');
});
