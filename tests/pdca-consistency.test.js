// 客户复盘：**前后端必须产出一致的结果**。
//
// ── 为什么单独测这件事 ──────────────────────────────────────────
// 复盘有两处生成：服务端 completeProject.js、前端 AppContext。
// 走哪一处取决于写开关（VITE_PROJECTS_API_WRITE_ENABLED）。
//
// 2026-08-24 查出两边已经漂移：
//   服务端  带标准号、可信层级(ourExperience)、行业标签
//   前端    只有标题和分类
// 于是同一个业务动作，产出的复盘质量**取决于一个环境变量**，
// 而没有任何人知道，也不会有任何报错。
//
// 这类漂移的通用形态是「同一件事两份实现」，是这套系统里
// 一多半 bug 的根因模式：线索联系人丢失、任务响应形状不一致、
// 事务校验缺失，全是这个。
//
// 现在规则收在 src/modules/knowledge/standards.ts，两边都引它。
// 这些用例守住的是「别再各写各的」。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const loadShared = () => {
  const file = path.resolve(__dirname, '../src/modules/knowledge/standards.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', outputText)(mod, mod.exports);
  return mod.exports;
};

const SERVER = fs.readFileSync(path.resolve(__dirname, '../server/services/completeProject.js'), 'utf8');
const CLIENT = fs.readFileSync(path.resolve(__dirname, '../context/AppContext.tsx'), 'utf8');

test('标准识别规则只有一份，前后端都引它', () => {
  assert.match(SERVER, /standards\.ts/,
    '服务端又自己维护了一份标准规则——两份必然漂移');
  assert.match(CLIENT, /from '\.\.\/src\/modules\/knowledge\/standards'/,
    '前端没有引用共用的标准模块');
  // 服务端不应再出现自己的规则表
  assert.ok(!/const STANDARD_PATTERNS\s*=/.test(SERVER),
    '服务端还留着自己的 STANDARD_PATTERNS，说明没真的改用共用模块');
});

test('两边的复盘都要带可信层级、标准、行业', () => {
  for (const [name, src] of [['服务端', SERVER], ['前端', CLIENT]]) {
    assert.match(src, /trustLevel: 'ourExperience'/,
      `${name}生成的复盘没标可信层级——AI 引用时会把它当成标准原文`);
    assert.match(src, /standards,/, `${name}生成的复盘没带标准标签`);
    assert.match(src, /industry:/, `${name}生成的复盘没带行业标签`);
  }
});

test('两边用同一个函数拼标题', () => {
  assert.match(SERVER, /buildPdcaTitle\(/, '服务端没用共用的标题函数');
  assert.match(CLIENT, /buildPdcaTitle\(/, '前端没用共用的标题函数');
});

test('服务项名里没标准时，标题要补上标准号', () => {
  /*
    实测有 2/5 的复盘标题是「客户复盘｜某某公司｜咨询服务合同书」，
    完全看不出做的是什么体系。标准是这行业最有区分度的检索词。
  */
  const { buildPdcaTitle } = loadShared();
  const t = buildPdcaTitle('浙江博峰数字科技有限公司', '咨询服务合同书', ['ISO 14001', 'ISO 45001']);
  assert.match(t, /ISO 14001/, '标题没带上标准号，搜不到');
  assert.match(t, /浙江博峰/, '客户名要保留——那是人认出这份复盘的方式');
});

test('服务项名里已有标准时，不重复追加', () => {
  const { buildPdcaTitle } = loadShared();
  const t = buildPdcaTitle('东莞市万豪包装', 'ISO 9001 质量管理体系认证', ['ISO 9001']);
  assert.equal((t.match(/ISO 9001/g) || []).length, 1, '标准号重复出现了两次');
});

test('识别得出信义常做的那些标准', () => {
  const { detectStandards } = loadShared();
  const cases = [
    ['甲方收到ISO14001/ISO45001认证电子版证书时', ['ISO 14001', 'ISO 45001']],
    ['SC食品生产许可证辅导', ['SC']],
    ['QS 食品相关产品生产许可', ['QS']],
    ['HACCP 体系建立', ['HACCP']],
  ];
  for (const [text, expected] of cases) {
    const got = detectStandards(text);
    for (const e of expected) {
      assert.ok(got.includes(e), `「${text}」应识别出 ${e}，实际：${got.join('、') || '(空)'}`);
    }
  }
});

test('前端的级联回退分支已删除，开关关掉时明确报错', () => {
  /*
    原来有 completeProjectLocal 和 convertSignalToFollowUpProjectLocal 两份
    纯前端级联，作为「后端写开关关闭时」的回退。
    但它们和后端产出**不一样**：本地版一份知识文档都不生成。
    一旦走回退，项目完成了、提醒发了，唯独复盘没了，而没有任何报错。
    静默降级比报错危险得多。
  */
  assert.ok(!/completeProjectLocal\(/.test(CLIENT), '前端级联回退又回来了');
  assert.ok(!/convertSignalToFollowUpProjectLocal\(/.test(CLIENT), '情报级联回退又回来了');
  assert.match(CLIENT, /VITE_PROJECTS_API_WRITE_ENABLED 未开启/,
    '开关关掉时要明确报错，不能静默走另一套逻辑');
});
