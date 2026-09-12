// 合同 PDF 识别的接线。2026-09-12 金恩来：「合同识别直接提示失败」
//
// 查出来的不是他的文件有问题，是**每一个 PDF 都识别不了**：
//
//   · index.html 全局挂着 pdf.min.js@2.16.105
//   · package.json 里装的是 pdfjs-dist@5.4.624
//   · documentParsers 先看 window.pdfjsLib —— **旧的那份永远赢**
//   · 而 2.16 配套的 worker 文件从来没放进 public/vendor/
//     → workerSrc 指向 404 → 抛错 → 被 catch 吞掉 → 返回空
//     → 上层判定「文本和 OCR 都失败」→ 提示「请改用清晰扫描件」
//
// 最后那句是最坏的部分：**它把锅甩给用户的文件**。
// 人会照着去重扫一遍，再失败一次，然后以为是自己的问题。
//
// 真实解析由 .artifacts/check-pdf-parse.cjs 开浏览器跑真 PDF 验证
// （修好之后：文本 199 字 + 扫描件兜底 1 页）。这里守的是接线不许再长歪。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
/** 扫源码的断言一律先去注释 —— 注释里写着 bug 的名字，会误伤也会误放 */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');

test('pdf.js 只能有一份 —— 不许再全局挂一个旧版本', () => {
  /*
    两份实现时，「哪份赢」靠的是加载顺序，不是谁更新。
    这次就是旧的赢了，而且赢得悄无声息。
  */
  assert.ok(!/<script[^>]*vendor\/pdf(\.min)?\.js/.test(code('index.html')),
    'index.html 又全局加载 pdf.js 了 —— 它会盖掉 npm 那份');
  assert.ok(!fs.existsSync(path.join(root, 'public/vendor/pdf.min.js')),
    'public/vendor/pdf.min.js 又回来了 —— 手工维护的副本正是这次事故的根源');
});

test('解析器不许优先用 window.pdfjsLib', () => {
  const src = code('services/documentParsers.ts');
  assert.ok(!/const globalPdfJs[\s\S]{0,120}?return globalPdfJs/.test(src),
    'getPdfJs 又回到「有全局就用全局」了');
});

test('必须显式指定 workerSrc —— v5 不认 disableWorker', () => {
  /*
    pdfjs-dist v5 移除了 disableWorker，拿不到 workerSrc 就直接抛
    `No "GlobalWorkerOptions.workerSrc" specified.`
    留着那个参数只会让下一个人以为「已经关掉 worker 了」。
  */
  const src = code('services/documentParsers.ts');
  assert.match(src, /GlobalWorkerOptions\.workerSrc\s*=/,
    '没有设置 workerSrc —— 每个 PDF 都会失败');
  assert.match(src, /pdf\.worker\.mjs\?url/,
    'worker 地址没交给打包器给（写死路径就又要人工同步了）');
  assert.ok(!/disableWorker/.test(src),
    'disableWorker 在 v5 已经无效，留着会误导');
});

test('失败原因要留下来，不能只 console.warn', () => {
  /*
    这才是这个 bug 藏这么久的原因：异常被吞掉，只剩一句
    「请改用清晰扫描件」。吞异常本身没错（不能炸页面），
    错在把**原因**也一起吞了。
  */
  const src = code('services/documentParsers.ts');
  assert.match(src, /export const getLastParseFailure/, '没有对外暴露失败原因');
  assert.ok(!/catch \(error\) \{\s*console\.warn\([^)]*\);\s*return (''|\[\])/.test(src),
    '又出现「只 warn 一行就返回空」的写法');
});

test('报错不许把锅甩给用户的文件', () => {
  /*
    原文案：「PDF 未提取到可读内容（文本/OCR均失败）。请改用清晰扫描件
    或先转图片后上传。」—— 这句话在系统自己坏掉时照样会出现，
    而且指挥用户去做一件完全没用的事（重扫一遍）。
  */
  for (const f of ['services/ingestion/contract.ts', 'pages/Contracts.tsx']) {
    const src = code(f);
    assert.ok(!/请改用清晰扫描件/.test(src), `${f} 还在让用户去重扫文件`);
    assert.match(src, /getLastParseFailure\(\)/, `${f} 的报错没有带上真实原因`);
  }
});
