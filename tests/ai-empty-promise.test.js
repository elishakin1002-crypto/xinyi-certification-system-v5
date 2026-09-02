// 「空头承诺」：模型说了「请稍候」，但没输出动作块。
//
// ── 这是什么问题 ──────────────────────────────────────────────
// 对话框**只在同一轮执行动作**——把 <execute_action> 解析出来、执行、显示结果。
// 没有「稍后」这回事：这一轮结束，就不会再有动作发生。
//
// 但模型按聊天习惯说话，会讲「现在为您重新执行系统自检，请稍候」，
// 然后什么动作块都不输出。界面停在那句话上，用户等两分钟以为系统卡死。
//
// 2026-08-31 老板反馈「机器人还是坏的」，实际就是这个：
// 前一轮明明正常跑完了自检，下一轮说了句「请稍候」就没下文。
// **这比真的报错更糟，因为它看起来像在工作。**
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
  const js = ts.transpileModule(read('src/modules/ai_center/emptyPromise.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
};

test('说了「请稍候」却没有动作块 —— 判为空头承诺', () => {
  const { isEmptyPromise } = load();
  // 老板那次实际收到的原话
  assert.equal(isEmptyPromise('在的，抱歉刚才系统返回异常。现在为您重新执行**系统自检与自动修复**，请稍候。'), true);
  assert.equal(isEmptyPromise('好的，正在为您处理'), true);
  assert.equal(isEmptyPromise('这就为您执行'), true);
  assert.equal(isEmptyPromise('我来为您重新运行一次'), true);
});

test('有动作块就不算 —— 它真的会做', () => {
  /*
    这条是关键的反向判定：带动作块时说「请稍候」是合理的（动作确实在执行），
    误报会让每次正常操作都跟一句「没有真的开始执行」，很快就没人看提示了。
  */
  const { isEmptyPromise } = load();
  assert.equal(isEmptyPromise(
    '好的，现在为您执行系统自检，请稍候。\n<execute_action>{"diagnose":{"autoFix":true}}</execute_action>'), false);
});

test('普通回答不能被误判', () => {
  const { isEmptyPromise } = load();
  for (const t of [
    '知识库里关于 ISO 9001 的要点是……',
    '这个客户的合同已经归档了。',
    '我查不到这条记录，建议你去合同管理里搜一下编号。',
    '',
  ]) {
    assert.equal(isEmptyPromise(t), false, `误判了：${t}`);
  }
});

test('提示的话要说清「不是坏了」和「你该怎么办」', () => {
  /*
    只说「没有执行」，用户会以为系统坏了；
    只说「请重说一次」，用户不知道为什么。两句都要有。
  */
  const { EMPTY_PROMISE_NOTICE } = load();
  assert.match(EMPTY_PROMISE_NOTICE, /没有真的开始执行/);
  assert.match(EMPTY_PROMISE_NOTICE, /同一时刻|没有「稍后再做」/);
  assert.match(EMPTY_PROMISE_NOTICE, /再说一次|讲明白/);
});

test('提示词里明确禁止说「稍候」', () => {
  // 兜底能补救，但治本在提示词——别让模型先说出那句话
  const src = read('components/AIChatWidget.tsx');
  const prompt = src.slice(src.indexOf('let systemPrompt ='), src.indexOf('// V5.0: Override system prompt'));
  assert.match(prompt, /你没有「稍后」/, '提示词没说清「操作只在这一次回复里发生」');
  assert.match(prompt, /禁止[\s\S]{0,40}请稍候/, '没有明确禁止说「请稍候」');
});

test('对话框真的接了兜底判定', () => {
  const src = stripComments(read('components/AIChatWidget.tsx'));
  assert.match(src, /isEmptyPromise\(fullResponseText\)/, '兜底没有被调用');
  assert.match(src, /EMPTY_PROMISE_NOTICE/, '判定了但没把提示显示出来');

  /*
    必须用**原始回复**判定，不能用去掉动作块之后的 displayableText——
    那个变量里动作块已经被删了，每一条带动作的回复都会被误判成空头承诺。
  */
  assert.ok(!/isEmptyPromise\(displayableText\)/.test(src),
    '拿去掉动作块的文本去判定，正常操作会被全部误报');
});
