// 按钮点了必须有反应 —— 不许留「看起来能用、点了什么都不发生」这第三种状态。
//
// 2026-09-16 Codex 清点时挑出 4 个有按钮外壳但没接任何动作的地方，
// 我复验了其中两个，属实：
//     pages/Projects.tsx「发起结算」 —— 绿色主按钮、带图标、有 hover，点了没反应
//     pages/Finance.tsx 「导出对账单」—— 同上
// 财务点「导出对账单」什么都不发生，他只会以为系统坏了，或者以为导出失败去找人。
//
// 这和「点了已分拣刷新变回待处理」「合同说已立项但项目管理里没有」是同一类：
// **界面承诺了一件事，代码没做**。不报错，所以测试全绿、控制台干净。
//
// 处理方式只有两种，没有第三种：
//   A. 真接上动作
//   B. 文案说实话（「开发中」「敬请期待」「从 Excel 导入」），并给出口
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** 文案里已经说明「还没做」的，不算死按钮 —— 它没有骗人 */
const HONEST_PLACEHOLDER = /开发中|敬请期待|即将上线|暂未开放|从 ?Excel ?导入/;

/**
 * 显式声明的例外：**点击由祖先节点接住**，所以按钮自己没有 onClick。
 *
 * 为什么用声明而不是让测试自己去找祖先：JSX 里判断"谁是我的祖先"要真解析，
 * 正则做不准 —— 做不准的规则会随别人写新代码而失效
 * （CLAUDE.md 二点五第 1 条：不许「看起来像 X 就当 X」，改成显式声明）。
 *
 * **加条目必须写清理由。** 只写文件行号不写为什么，等于把这条测试关掉。
 */
const BUBBLES_TO_ANCESTOR = [
  { file: 'pages/Customers.tsx', label: '查看客户详情', why: '客户列表行尾的「›」，整行 <tr onClick={openDetail}> 接住' },
  { file: 'pages/Leads.tsx', label: 'ChevronRight', why: '线索列表行尾的「›」，整行 <tr onClick={openDetail}> 接住' },
];

const walk = (dir, out = []) => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const name of fs.readdirSync(abs)) {
    const rel = path.join(dir, name);
    if (fs.statSync(path.join(root, rel)).isDirectory()) { walk(rel, out); continue; }
    if (/\.tsx$/.test(name)) out.push(rel);
  }
  return out;
};

/**
 * 抓出每个 <button ...> 开标签，连同它到 </button> 的内容。
 *
 * 开标签的结束不能只找第一个 '>' —— 属性里的箭头函数（`() => ...`）
 * 和 JSX 表达式里都有 '>'。所以按大括号深度走，深度为 0 时的 '>' 才是真结束。
 * （写这条测试时先踩了一次，抓出来的标签全是半截。）
 */
const buttons = (src) => {
  const out = [];
  let i = 0;
  while ((i = src.indexOf('<button', i)) !== -1) {
    let depth = 0, j = i + 7, tagEnd = -1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { tagEnd = j; break; }
    }
    if (tagEnd === -1) break;
    const close = src.indexOf('</button>', tagEnd);
    out.push({
      tag: src.slice(i, tagEnd + 1),
      inner: close === -1 ? '' : src.slice(tagEnd + 1, close),
      line: src.slice(0, i).split('\n').length,
    });
    i = tagEnd + 1;
  }
  return out;
};

test('界面上不许有「点了什么都不发生」的按钮', () => {
  const offenders = [];
  for (const f of [...walk('pages'), ...walk('components')]) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const b of buttons(src)) {
      // 接了任何一种点击处理，就算活的
      if (/on(Click|MouseDown|PointerDown|KeyDown)\s*=/.test(b.tag)) continue;
      // 提交按钮由 <form onSubmit> 接住
      if (/type\s*=\s*["']submit["']/.test(b.tag)) continue;
      /*
        ── 隐形文件选择框盖在按钮上（2026-09-16 加）────────────────

        「导入 Excel」这类按钮的标准做法是：一个透明的
        <input type="file" className="absolute inset-0 ... opacity-0">
        盖在按钮上面，点击其实点的是 input。按钮自己确实没有 onClick，
        但它**能用**。

        我第一版测试把这类全报成死按钮（Finance、Leads、Customers 的
        OCR填充各一个）。Codex 上一轮的方法论里恰恰写了要"补查上传框覆盖"
        —— 它比我的测试周全。
      */
      const before = src.slice(Math.max(0, src.indexOf(b.tag) - 700), src.indexOf(b.tag));
      if (/type=["']file["'][\s\S]{0,200}opacity-0/.test(before)) continue;

      /*
        文案说明了「还没做」—— 它没骗人。
        注意要把**属性**也算进来：有的图标按钮没有可见文字，
        「开发中」写在 title 上（pages/Leads.tsx 的语音输入就是）。
        我第一版写成 (inner + tag).replace(/<[^>]*>/g,' ')，
        而 tag 本身就是一整个 `<button ...>`，整条被当成标签剥掉了，
        title 里的说明也一起没了 —— 又一次「按形状猜」。
      */
      const text = b.tag + ' ' + b.inner.replace(/<[^>]*>/g, ' ');
      if (HONEST_PLACEHOLDER.test(text)) continue;

      const label = b.inner.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)
        || (b.tag.match(/title\s*=\s*["']([^"']+)/) || [])[1]
        || (b.tag.match(/aria-label\s*=\s*["']([^"']+)/) || [])[1]
        || '(图标按钮)';
      // 点击由祖先接住的，必须在 BUBBLES_TO_ANCESTOR 里声明过、并写了理由
      const declared = BUBBLES_TO_ANCESTOR.find(e =>
        e.file === f && (b.tag + b.inner).includes(e.label) && String(e.why || '').trim());
      if (declared) continue;

      offenders.push(`${f}:${b.line}  「${label}」`);
    }
  }
  assert.deepEqual(offenders, [],
    '这些按钮没有接任何点击动作，也不是表单提交，文案里也没说明「开发中」：\n  '
    + offenders.join('\n  ')
    + '\n\n人点下去什么都不会发生，而且不报错 —— 他只会以为系统坏了。'
    + '\n只有两种处理：真接上动作，或者把文案改成说实话（「开发中」「敬请期待」）并给出口。');
});

test('导出对账单导的是当前筛选结果，金额要从分换回元', () => {
  /*
    两个都出过事：
    · 导全量 —— 人筛了半天状态和月份，导出却给他一整本，这个按钮等于没用
    · 金额**多换算了一次** —— 库里存的是「分」，但仓储层 kind:'amount'
      已经自动 ÷100，到前端时就是「元」。第一版又除了一次，
      导出来 ¥10,000 变成 100.00，小了一百倍。
      页面显示 ¥18,000、导出文件合计 180.00 —— 这种错只有真导一次
      打开看数字才会发现，代码和类型检查都不会拦。
  */
  const src = fs.readFileSync(path.join(root, 'pages/Finance.tsx'), 'utf8');
  const fn = src.slice(src.indexOf('const exportReceivables'), src.indexOf('const filteredReceivables'));
  assert.ok(fn.length > 200, '找不到 exportReceivables');
  assert.match(fn, /filteredReceivables\.map/, '导出用的不是筛选后的结果');
  assert.ok(!/amount[^)]*\)\s*\/ 100/.test(fn),
    '金额又除了一次 100 —— 仓储层已经把分换成元了，再除一次会小一百倍');
  assert.match(fn, /uFEFF/, '没有加 BOM —— Excel 打开中文会是乱码');
});
