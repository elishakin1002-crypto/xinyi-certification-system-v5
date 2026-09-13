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

test('合同不许被一键推进知识中心 —— 那是绕过金额权限的路', () => {
  /*
    2026-09-13 金恩来问「电子档案是不是该和知识中心一起管」，
    顺着查出这个按钮是一条**权限旁路**：

      · 顾问看合同金额被遮成 ¥ ***（刻意设计：防比价、防议价）
      · 顾问有知识中心权限，而知识中心**不按人过滤**
      · 这个按钮把合同 PDF 原件复制进知识中心 —— PDF 上写着金额

    一个按钮把一整套权限设计架空。另外两条也站不住：
    category 硬写成 'Template'（合同不是模板）、
    content 是「系统生成的占位符」（推进去也搜不到）。
  */
  const page = code('pages/Contracts.tsx');
  assert.ok(!/handlePushToKnowledge/.test(page),
    '「推到知识中心」又回来了 —— 顾问能借它看到被遮住的合同金额');
  assert.ok(!/存入知识中心/.test(page), '入口文案还在，说明按钮没删干净');
});

test('顾问看不到金额这条设计还在 —— 上面那条的前提', () => {
  /*
    如果哪天顾问被授予 CONTRACT_VIEW_AMOUNT，上面那条的理由就不成立了，
    到时候该重新讨论，而不是让测试静悄悄地继续绿着。
  */
  const c = code('constants.ts');
  const m = /\n  CONSULTANT: \{([\s\S]*?)\n  \},/.exec(c);
  assert.ok(!/CONTRACT_VIEW_AMOUNT/.test(m[1]),
    '顾问被授予了看金额的权限 —— 请重新评估合同能不能进知识中心');
});

test('知识中心上传也要真的存盘 —— 同一个 bug 的第二处', () => {
  /*
    2026-09-13 金恩来：「我看了一下现在的知识中心里还是有合同的」。

    顺着看下去发现知识中心的上传也是 `URL.createObjectURL(file)` ——
    和合同附件同一个 bug。体检结果：40 篇里 **7 篇是 blob 死链**，
    列表上看着正常，点开是空白。

    注意：文件里还会剩一处 createObjectURL，那一处是**正当**的 ——
    把 doc.content 当场变成 Blob 下载、下一行就 revoke，不存库。
    所以这里不能简单地"禁止出现 createObjectURL"，要看它有没有被存进 sourceUrl。
  */
  const page = code('pages/Knowledge.tsx');
  assert.ok(!/sourceUrl:\s*URL\.createObjectURL/.test(page),
    '知识文档的 sourceUrl 又存成 blob 临时地址了 —— 刷新就变死链');
  assert.match(page, /\/api\/uploads\/knowledge/, '没有走服务端真实上传');
  assert.match(page, /没有创建这条记录/, '上传失败时还在建记录 —— 那会直接变成一条死链');
});

test('打不开的文档要说清是「没存下来」，不是「演示数据」', () => {
  /*
    原文案：「【演示模式】此为纯演示条目，无实体内容。」
    —— 会让人以为是样例，于是不管它。实际是历史遗留的死链，需要重新上传。
  */
  const page = code('pages/Knowledge.tsx');
  assert.ok(!/演示模式.*无实体内容/.test(page), '又把死链说成演示数据了');
  assert.match(page, /sourceUrl.*startsWith\('blob:'\)/, '没有把 blob 判成失效');
});

test('「机密」这两个字不许再用来形容 AI 权限', () => {
  /*
    金恩来：「点击合同，标签上写着全员可见，又写着机密模式是什么意思？」

    因为是**两个不同的轴**：
      · 可见范围 = 哪些人能打开（accessRoles）
      · aiVisible = AI 能不能读

    中文「机密」默认指对人保密，所以「全员可见 + 机密」读起来自相矛盾。
    改成直说 AI，两个轴各说各的就不打架了。
  */
  const page = code('pages/Knowledge.tsx');
  assert.ok(!/机密模式/.test(page), '又出现「机密模式」—— 和「全员可见」放一起会自相矛盾');
  assert.ok(!/>机密</.test(page), '徽章又写成「机密」了');
  assert.match(page, /AI 不可读/, '没有改成直说 AI 的说法');
});

test('识别服务也不许造 blob —— 那才是知识中心死链的根', () => {
  /*
    知识中心有两条入库路径，我第一次只修了页面那条，
    实测传一份文件上去**还是 blob** —— 因为另一条走识别服务，
    页面只是原样接收 `doc.sourceUrl`。

    「同一件事有几个出口」这个问题，这次是我自己没数清楚。
  */
  const svc = code('services/ingestion/knowledge.ts');
  assert.ok(!/sourceUrl:\s*URL\.createObjectURL/.test(svc),
    '识别服务又把 blob 当成 sourceUrl 了');
  assert.match(svc, /\/api\/uploads\/knowledge/, '识别服务没有真的存盘');

  const page = code('pages/Knowledge.tsx');
  assert.ok(!/sourceUrl: doc\.sourceUrl \|\| '#'/.test(page),
    "存不上盘时又拿 '#' 顶上了 —— 会变成「看起来有文件其实没有」的记录");
});

test('删附件要走 contractRepo，不能走 state store —— 两条路别走岔', () => {
  /*
    2026-09-13：我第一版把删除端点写在 app.js，走 saveContractsDataset。
    接口返回 200，**库里纹丝不动**。

    因为合同有两条写入路径：
      · /attachments/upload   → contractRepo（关系表 contracts）
      · /attachments（元数据） → saveContractsDataset（state store）
    而 contracts 不在 relationalProjection 的 PROJECTED 名单里，
    两边不会互相同步 —— 删除走错那条，等于删了个空气。

    这也正是当初那句「后端无删除接口，前端删了刷新又回来」的真实由来：
    **不是没接口，是两条路走岔了。**

    实测（.artifacts/check-attachment-remove.cjs）：
    删之前 3 条 → 删之后 2 条 → 刷新仍是 2 条。
  */
  const uploads = code('server/routes/uploads.js');
  assert.match(uploads, /router\.delete\('\/api\/contracts\/:id\/attachments\/:attachmentId'/,
    '删除端点不在 uploads.js 里 —— 它必须和上传走同一个 repo');
  assert.match(uploads, /contractRepo\.removeAttachment/, '没有用 contractRepo 删');

  const app = code('server/app.js');
  assert.ok(!/app\.delete\('\/api\/contracts\/:id\/attachments/.test(app),
    'app.js 里又出现一个删除端点 —— 那条路写不到关系表，会「删了又回来」');

  const repo = code('server/repos/contractRepo.js');
  assert.match(repo, /removeAttachment: async/, 'contractRepo 缺 removeAttachment');
});

test('前端「移除附件」按钮要在 —— 不然重传完一堆死的混着好的', () => {
  /*
    生产 12 份合同挂着 blob 死链，重传只是"再加一条"。
    旧那条删不掉的话，每份合同都会变成「一条死的 + 一条好的」，
    谁也分不清该点哪个。
  */
  const page = code('pages/Contracts.tsx');
  assert.ok(!/移除附件入口已下线/.test(page), '移除入口又被下线了');
  assert.match(page, /contractService\.removeAttachment\(/, '按钮没有真的调删除接口');
});
