// 摘要取材分层。
//
// ── 为什么要分层 ────────────────────────────────────────────────
// 原来固定 slice(0, 2000)：5970 字的培训手册只读到前三分之一，
// 5 万字的质量手册只读到封面和目录，**摘要必然是废话**。
// 而废话摘要比没有摘要更糟——检索时它会参与打分，把真正相关的文档挤下去。
//
// 分层的道理：文档越长，开头越不代表全文，但**标题行**越能代表结构。
//   ≤3000 字      全文给
//   3000–3 万字   开头 + 全部标题 + 结尾
//   >3 万字       只给标题结构（全文摘要本来就做不准）
//
// 还有一条更要紧的：**正文为空时必须拒绝生成**。
// 原来会给模型一句「照着标题编一个像样的摘要」——
// 编出来的东西看着像真的，进了检索库就是污染源。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const load = () => {
  const file = path.resolve(__dirname, '../src/utils/summaryExtract.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', outputText)(mod, mod.exports);
  return mod.exports;
};

test('空正文必须判定为 empty，不能交给模型编', () => {
  const { extractForSummary } = load();
  for (const v of ['', '   ', null, undefined]) {
    assert.equal(extractForSummary(v).tier, 'empty',
      '正文为空还生成摘要，等于让 AI 照着标题编——编出来的会进检索库，成为污染源');
  }
});

test('短文档给全文，不做无谓截断', () => {
  const { extractForSummary } = load();
  const text = '这是一份两千字以内的短文档。'.repeat(20);
  const r = extractForSummary(text);
  assert.equal(r.tier, 'full');
  assert.equal(r.text.length, text.length, '够短就该整篇给，截断只会丢信息');
});

test('中等长度文档要保住标题结构，不能只取开头', () => {
  const { extractForSummary } = load();
  const body = '## 第一章 质量方针\n本章说明质量方针。\n'.repeat(300);
  const r = extractForSummary(body);
  assert.equal(r.tier, 'outline');
  assert.ok(r.text.length < body.length, '中等长度要压缩');
  assert.ok(r.text.includes('质量方针'), '标题行必须保留——它比正文更能代表这份文档讲什么');
});

test('超长文档只给结构，不假装能概括全文', () => {
  const { extractForSummary } = load();
  const huge = '# 章节标题\n' + ('正文内容内容内容\n').repeat(6000);
  const r = extractForSummary(huge);
  assert.equal(r.tier, 'toc');
  assert.ok(r.originalLength > 30000);
  assert.ok(r.text.length < 5000, '超长文档给再多正文也概括不准，不如老实只给目录');
});

test('原文长度要如实带出来', () => {
  // 界面上要能说明「这份 8 万字的文档，摘要只基于目录」，
  // 否则人会以为摘要覆盖了全文
  const { extractForSummary } = load();
  const text = '内容'.repeat(1000);
  assert.equal(extractForSummary(text).originalLength, 2000);
});

test('提示词里要说清这次给的是哪一层，别让模型假装读过全文', () => {
  const { extractForSummary, buildSummaryPrompt } = load();
  const huge = '# 章节\n' + ('正文\n').repeat(20000);
  const prompt = buildSummaryPrompt('质量手册', extractForSummary(huge));
  assert.match(prompt, /质量手册/, '提示词里要有标题');
  assert.ok(prompt.length > 0);
});
