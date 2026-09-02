// 知识入库准入：什么该存、什么不该存。
//
// 要挡两类东西，**性质完全不同**：
//
//   ① 空白记录表单/通用模板 —— 体积和检索质量问题。
//      100 家客户的《内审检查表》90% 相同，存 100 份会把真正有价值的
//      复盘和经验从检索结果里挤下去。
//
//   ② 客户填好的记录 —— **合规风险**。客户的生产记录、检验数据、
//      人员名册属于客户自己，存进我们系统意味着我们要为它的保管
//      和泄露负责，客户换服务商时也说不清。
//
// 做成提示而不是硬拦：识别靠特征匹配，一定有误判。
// 硬拦会让人传不上真正要传的文件，然后他绕过系统发微信——那比存进来更糟。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const load = () => {
  const file = path.resolve(__dirname, '../src/modules/knowledge/intake.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', outputText)(mod, mod.exports);
  return mod.exports;
};

test('客户填好的生产/检验记录：建议不要存进系统', () => {
  const { adviseIntake } = load();
  const r = adviseIntake('某某食品厂生产记录2026',
    '生产日期：2026-03-12  批号：A2603  投料量：500kg\n检验结果：合格  实测值：0.03');
  assert.equal(r.verdict, 'customerRecord');
  assert.equal(r.discourageStore, true, '这是客户的经营数据，存进来我们要为它负责');
  assert.equal(r.suggestAiVisible, false);
  assert.ok(r.reason.includes('客户'), '要说清为什么不该存，不能只给个拒绝');
});

test('讲「怎么做检验记录」的辅导材料不该被误伤', () => {
  /*
    单个特征就判定太容易误伤：一份讲方法论的辅导材料
    自然会提到「检验结果」，但它是我们的经验，不是客户的数据。
    所以要两个以上特征才判定。
  */
  const { adviseIntake } = load();
  const r = adviseIntake('如何指导客户建立检验记录制度',
    '本文说明检验结果应当如何记录、由谁签字、保存多久。');
  assert.notEqual(r.verdict, 'customerRecord', '我们自己的方法论被当成客户数据挡下了');
});

test('空白记录表单：可以存，但不进 AI 语料', () => {
  const { adviseIntake } = load();
  for (const title of ['内审检查表（空白）', '不合格品记录表', '设备点检表模板']) {
    const r = adviseIntake(title, '序号  日期  项目  结论  签名');
    assert.equal(r.verdict, 'genericTemplate', `${title} 没被识别为通用表单`);
    assert.equal(r.discourageStore, false, '模板可以存，只是不该每家存一份、也不该进语料');
    assert.equal(r.suggestAiVisible, false,
      '100 家客户的同类表单进语料，会把真正有价值的复盘挤下去');
  }
});

test('客户复盘、经验总结这类正常放行', () => {
  const { adviseIntake } = load();
  const r = adviseIntake('客户复盘｜东莞市万豪包装｜ISO 9001',
    '本次服务的卡点在体系文件编写阶段，客户人手不足导致延期两周。');
  assert.equal(r.verdict, 'ok');
  assert.equal(r.suggestAiVisible, true, '这正是最该让 AI 学的东西，不能误伤');
});

test('提示里要带上命中的特征，方便人判断是不是误判', () => {
  // 只说「这份不该存」而不说为什么，人只会觉得系统在找茬
  const { adviseIntake } = load();
  const r = adviseIntake('检验记录表',
    '生产日期 批号 检验结果 实测值 合格判定');
  assert.ok(r.signals.length > 0, '没有给出命中的特征');
});

test('上传界面真的接了准入检查，不是白写一个模块', () => {
  /*
    模块写好但没接线，等于没做——今天已经踩过一次：
    检索模块和调用方之间断了三个月，AI 一直在用无关文档回答。
  */
  const src = fs.readFileSync(path.resolve(__dirname, '../pages/Knowledge.tsx'), 'utf8');
  assert.match(src, /adviseIntake\(/, '上传流程没有调用准入检查');
  assert.match(src, /finalAiVisible = false/,
    '识别为表单或客户数据后，必须强制不进语料——不能只提示不生效');
});
