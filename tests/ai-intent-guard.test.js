// 高风险动作的意图核对。
//
// ── 实测到的问题（2026-08-31）─────────────────────────────────
// 老板打了一句「在吗」，AI 回「收到，现在执行系统自我诊断并自动修复」，
// 然后真的跑了一遍全系统自检。
//
// 模型不是笨，是**从上下文惯性推断**：前面几轮都在做自检，它顺着接下去。
// 而代码这边照单全收——**AI 说要执行就执行，从没核对过用户是不是真要这个。**
//
// 单独跑 npm run health:ai（干净上下文）时模型是正常的，
// 说明光靠提示词管不住这件事：**只要历史里出现过，它就可能重复。**
// 所以要在代码里核对。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const load = () => {
  const js = ts.transpileModule(read('src/modules/ai_center/intentGuard.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
};

test('「在吗」不能触发系统自检 —— 老板实际踩的那个', () => {
  const { checkActionIntent } = load();
  const r = checkActionIntent({ diagnose: { autoFix: true } }, '在吗');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['diagnose']);
});

test('明确说了要自检，就该放行', () => {
  /*
    反向验证。只挡不放的话功能就没了——
    而「怕误触发所以一律不做」比误触发更让人弃用系统。
  */
  const { checkActionIntent } = load();
  for (const said of ['做一次系统自检', '帮我诊断一下系统', '系统体检', '自我修复一下', '排查下问题']) {
    assert.equal(checkActionIntent({ diagnose: {} }, said).ok, true, `「${said}」被误挡了`);
  }
});

test('确认回款必须是用户自己提到的', () => {
  // 不可撤销的财务动作，不能靠模型从上下文推
  const { checkActionIntent } = load();
  assert.equal(checkActionIntent({ confirm_receivable: { contractId: 'CT-1' } }, '在吗').ok, false);
  assert.equal(checkActionIntent({ confirm_receivable: { contractId: 'CT-1' } }, '好的谢谢').ok, false);
  assert.equal(checkActionIntent({ confirm_receivable: { contractId: 'CT-1' } }, '鸿涛那笔回款到账了').ok, true);
  assert.equal(checkActionIntent({ confirm_receivable: { contractId: 'CT-1' } }, '确认收款').ok, true);
});

test('完成项目也要核对', () => {
  const { checkActionIntent } = load();
  assert.equal(checkActionIntent({ complete_project: { projectId: 'P-1' } }, '嗯嗯').ok, false);
  assert.equal(checkActionIntent({ complete_project: { projectId: 'P-1' } }, '这个项目做完了').ok, true);
});

test('低风险动作不核对 —— 全都要求逐字对上，AI 就没法用了', () => {
  /*
    「录一条线索」推错了删掉重录就行；
    「确认回款」推错了不可撤销。挡的是**代价不对等**的那几个，不是所有动作。
  */
  const { checkActionIntent } = load();
  assert.equal(checkActionIntent({ lead: { name: '某某' }, customer: {}, reminder: {} }, '在吗').ok, true);
});

test('追问的话要说清「没执行」并给一句能照抄的指令', () => {
  /*
    只说「我没做」，用户不知道该怎么办；
    给一句能直接照抄的话，他复制一下就行。
  */
  const { buildIntentPrompt } = load();
  const msg = buildIntentPrompt(['diagnose'], { diagnose: '系统自我诊断' });
  assert.match(msg, /没有执行任何操作/, '没说清什么都没做');
  assert.match(msg, /系统自检/, '没给出能照抄的指令');
});

test('对话框真的接了意图核对，而且在权限闸之前', () => {
  /*
    顺序有讲究：连意图都不成立的动作，不必再去谈权限——
    否则用户会先看到「你没权限」，被引导去要一个他根本不需要的权限。
  */
  const src = stripComments(read('components/AIChatWidget.tsx'));
  assert.match(src, /checkActionIntent\(actionData,\s*userMessage\)/, '意图核对没有被调用');
  const intentAt = src.indexOf('checkActionIntent(actionData');
  const gateAt = src.indexOf('gateAiActions(actionData');
  assert.ok(intentAt > 0 && gateAt > 0, '找不到意图核对或权限闸');
  assert.ok(intentAt < gateAt, '意图核对排在权限闸之后了');
});

test('核对用的是用户原话，不是 AI 的回复', () => {
  /*
    **这条最容易写错。** 拿 AI 的回复去核对必然通过——
    AI 说「现在执行系统自检」，里面当然有「自检」两个字。
    那样这道闸等于自己给自己盖章。
  */
  const src = stripComments(read('components/AIChatWidget.tsx'));
  assert.match(src, /executeSystemActions\(fullResponseText,\s*currentText\)/,
    '没有把用户原话传进去，或者传成了 AI 的回复');
});

test('动作被挡时，模型那段话不能显示出来', () => {
  /*
    **2026-08-31 第二次踩：** 意图核对挡住了自检，
    界面上却同时出现两条——
      黄框：「没有执行任何操作」
      白框：「已触发系统自检并自动修复低级问题」

    第二句是模型按「动作会执行」写的，动作没执行，那句就是**假的**。
    两条自相矛盾，用户不知道该信哪个。**这比不拦还糟：系统在骗人。**
  */
  const src = stripComments(read('components/AIChatWidget.tsx'));
  assert.match(src, /return '__intent_blocked__'/, '意图被挡时没有返回可识别的标记');
  assert.match(src, /executedActionType === '__intent_blocked__'[\s\S]{0,120}return;/,
    '被挡之后没有跳过模型回复的渲染——那句假话还会显示出来');
});

test('打招呼要正常回一句，不要输出动作', () => {
  // 用户问「在吗」只是确认你还在，不是要你干活
  const src = read('components/AIChatWidget.tsx');
  const prompt = src.slice(src.indexOf('let systemPrompt ='), src.indexOf('// V5.0: Override system prompt'));
  assert.match(prompt, /打招呼|闲聊/, '提示词没交代闲聊该怎么回');
  assert.match(prompt, /不要输出任何动作块/, '没说清闲聊时不该输出动作');
});

test('系统提示要和 AI 的回答在界面上区分开', () => {
  /*
    黄框是代码发的（权限不足、意图不明、操作被拦），
    白框带头像的才是 AI 说的话。两者可信度完全不同：
    系统提示描述的是确定发生的事实，AI 说的话可能是猜的。
    只靠颜色区分，用户分不清「这句是谁说的」。
  */
  const src = read('components/AIChatWidget.tsx');
  assert.match(src, /系统提示 · 不是 AI 的回答/, '系统提示没有标签，用户分不清是谁说的');
});
