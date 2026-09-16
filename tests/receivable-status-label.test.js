// 一笔应收的状态，只能有一个说法 —— 筛选器、桌面表格、手机卡片、导出文件全一致。
//
// 2026-09-16 逐面板核对时发现，同一个状态在同一个页面上有两套说法：
//     已收到钱   桌面「已到账」   手机「已核销」
//     还没收到   桌面「待确认」   手机「待确认」   而筛选器写的是「待回款」
// 财务点顶上的「待回款」筛出来的行，每一行却写着「待确认」——
// 她没法判断这是不是同一件事。
//
// 而且「待确认」被用错了地方。这个词本身有用，但它只该指
// **真的有人报备了已收款、等财务核对**（r.paymentClaim）的那一种。
// 用在所有未付款的行上就是词不达意：那条根本没人报备过，就是还没收到钱。
//
// 修的时候还踩了一次「改一处漏一处」：先只改了桌面表格，
// 浏览器里一看还是「待确认」—— 因为当时渲染的是手机卡片那一支。
// 这是这个项目最高频的 bug 形态，所以这次直接收口成一个函数。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'pages/Finance.tsx'), 'utf8');
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

test('每一个状态徽章都必须引用统一函数 —— 少一处就会分叉', () => {
  /*
    先写成「统计有几处在用」，结果把其中一处改回硬编码，测试居然还是绿的
    （8 处减 1 还有 7 处，仍然满足"至少 7 处"）。**这就是假绿。**

    改成逐个检查：状态徽章都长成
        <图标 ... /> 文案</span>
    的样子（图标是 CheckCircle / AlertCircle / RefreshCcw / Clock）。
    每一个这样的位置后面必须跟 {receivableStatusLabel(r)}，
    写死任何一个词都会红，并指出是哪一行。
  */
  assert.match(src, /const receivableStatusLabel =/, '没有统一的状态文案函数');

  /*
    只认**状态词本身**。第一版按"图标后面跟中文"来判，
    把「驳回/撤销」这个按钮和一句「已驳回: …」的说明也算了进去 ——
    又是范围划太宽。状态词是封闭的一小撮，直接列出来最准。

    筛选器上的「待回款/已逾期/已到账」是**选项名**不是行状态，
    它们不跟在图标后面，所以不会被这条抓到。
  */
  const STATUS_WORDS = ['已到账', '已核销', '待回款', '待确认', '已逾期', '被驳回'];
  const ICONS = /<(CheckCircle|AlertCircle|RefreshCcw|Clock)\b[^>]*\/>\s*([^<{]{0,8})/g;
  const bad = [];
  let m;
  while ((m = ICONS.exec(src))) {
    const after = (m[2] || '').trim();
    if (!STATUS_WORDS.some(w => after.startsWith(w))) continue;
    bad.push(`第 ${src.slice(0, m.index).split('\n').length} 行附近：写死了「${after}」`);
  }
  assert.deepEqual(bad, [],
    '这些状态徽章把文案写死了，没走 receivableStatusLabel：\n  ' + bad.join('\n  ')
    + '\n  桌面和手机各写各的，同一个状态迟早两个说法（已经发生过：已到账 vs 已核销）。');
});

test('不许再出现「已核销」这种只在手机上用的说法', () => {
  /*
    同一件事换个屏幕换个说法，人会以为是两种状态。
    这一页的口径以顶部筛选器为准：待回款 / 已逾期 / 已到账。
  */
  assert.ok(!src.includes('已核销'),
    '「已核销」又回来了 —— 桌面叫「已到账」，同一个状态不能两个词');
});

test('「待确认」只能用在真有人报备已收款的那一种', () => {
  const fn = src.slice(src.indexOf('const receivableStatusLabel'), src.indexOf('const todayStr'));
  assert.ok(fn.length > 100, '没截到 receivableStatusLabel');
  assert.match(fn, /paymentClaim.*待确认|待确认[\s\S]{0,80}paymentClaim/,
    '「待确认」没有和 paymentClaim 绑在一起 —— 没人报备过的行不该说"待确认"');
  assert.match(fn, /return '待回款'/,
    '没有「待回款」这一档 —— 它必须和顶部筛选器的说法一致');
});

test('导出文件里的状态和界面上显示的是同一份', () => {
  /*
    导出原来自己维护了一张 STATUS_TEXT 表。两张表迟早分叉，
    而且分叉时没人会发现 —— 导出的人和看屏幕的人不是同一时刻。
  */
  assert.ok(!/STATUS_TEXT/.test(src),
    '导出又自己维护了一张状态文案表 —— 和界面迟早对不上');
  const exp = src.slice(src.indexOf('const exportReceivables'), src.indexOf('const filteredReceivables'));
  assert.match(exp, /receivableStatusLabel\(r\)/, '导出没有走统一的状态文案');
});
