// 合同原件必须真的存下来。
//
// 2026-09-13 金恩来：「客户管理中可以直接预览合同，但合同管理却不能」。
// 顺着查下去，查出来的是比预览严重得多的事：
//
//   **生产上 12 份有附件的合同，附件 url 全是 `blob:http://...`**
//
// blob 是浏览器的临时地址：只在上传的那个标签页里有效，刷新就失效，
// 换台电脑、换个人永远打不开。也就是说 —— **上传过的合同原件，
// 一份都没真的存下来**，而界面上看起来一切正常。
//
// 而服务端**早就有真实的上传接口**（server/routes/uploads.js，
// 存盘 + 返回 /api/files/...），前端一直没用它，
// 走的是只记元数据那条，把 blob 地址当 url 存了进去。
// 又是「有两条路，用错了那条」—— 和两份 pdf.js、两份查重规则同一类。
//
// 真实行为由 .artifacts/check-attachment-upload.cjs 验：
// 真上传一份 PDF → 库里存的是 /api/files/... → 那个地址真能取到文件（HTTP 200）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
/** 扫源码先去注释 —— 注释里写着 bug 的名字，会误伤也会误放 */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('前端不许再用 createObjectURL 当附件地址', () => {
  /*
    这是整件事的根：blob 地址存进库，看起来有文件，其实什么都没有。
  */
  const page = code('pages/Contracts.tsx');
  assert.ok(!/createObjectURL/.test(page),
    '又出现 createObjectURL —— 存进去的会是刷新就失效的临时地址');
});

test('走的必须是服务端那个真实上传接口', () => {
  const svc = code('services/contractService.ts');
  assert.match(svc, /attachments\/upload/, '没有调用真实上传接口');
  assert.match(svc, /new FormData\(\)/, '不是 multipart 上传');
  assert.ok(!/'Content-Type': 'multipart/.test(svc),
    '手写了 multipart 的 Content-Type —— 会丢掉 boundary，服务端收不到文件');

  const page = code('pages/Contracts.tsx');
  assert.match(page, /contractService\.uploadAttachment\(/, '给已有合同加附件没走上传接口');
  assert.match(page, /contractService\.uploadLooseFile\(/, '建合同时上传的文件没走上传接口');
});

test('拿不到文件就说拿不到，不许拿示例文件顶上', () => {
  /*
    原来预览在没有 url 时会回落到外部示例文件
    （w3.org 的 dummy.pdf / via.placeholder.com 的占位图）。

    **给人看一份假合同，比直接报错糟得多**：
    报错他会去查，看到假的他会以为文件好好地在那儿。
    那两个地址还是外网的，内网根本打不开，
    而部署自检里的「外部 CDN 引用 0 处」只数构建产物，抓不到运行时请求。
  */
  const page = code('pages/Contracts.tsx');
  assert.ok(!/dummy\.pdf/.test(page), '又回落到外部示例 PDF 了');
  assert.ok(!/placeholder\.com/.test(page), '又回落到外部占位图了');
  assert.match(page, /url\.startsWith\('blob:'\)/,
    '没有把历史遗留的 blob 地址判成「取不到」');
});

test('历史遗留的 blob 附件要说清楚「原件没存下来」', () => {
  /*
    生产上那 12 份已经是坏的。点预览时不能只说「不支持预览」——
    那会让人以为是格式问题，继续以为文件还在。
    要说清：它从来没被真的存下来，请重新上传。
  */
  const page = code('pages/Contracts.tsx');
  assert.match(page, /没有真的存下来/, '没有对历史 blob 附件给出如实的说明');
  assert.match(page, /请重新上传/, '没有告诉人下一步该做什么');
});

test('「报备已收款」是动作，不是状态', () => {
  /*
    金恩来：「录入一份合同，合同为什么默认已经收款？」—— 其实没有。
    状态图标是黄色时钟（未付），那里是一个**按钮**：
    销售/顾问点它报备"我收到钱了"，通知财务核对。

    但原文案写「已收款，请核对」，读起来是陈述句，又是淡蓝色小字、
    紧挨着金额 —— 看着就像系统在说"这笔已经收了"。
    他是最熟系统的人都读反了。**按钮文案要写动作，别写状态。**
  */
  const page = code('pages/Contracts.tsx');
  assert.ok(!/>\s*已收款，请核对\s*</.test(page),
    '按钮文案又变回陈述句了，会被当成"系统说已经收款"');
  assert.match(page, /报备已收款/, '没有改成动作式文案');
});
