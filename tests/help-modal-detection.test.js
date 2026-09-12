// 帮助那边的「现在是不是开着一个弹窗」判断。
//
// 2026-09-11 金恩来：「点击头像时，右下角的问号怎么还在那里？
//                    一个问题为什么要来回处理都没有发现并解决？」
//
// 他问得对。这是同一个选择器第三次坑人了 ——
// `.fixed.inset-0` 在这个项目里既是弹窗遮罩，也是下拉菜单的
// 「点外面关掉我」层，还是 AI 面板和侧边栏。靠长相分不出来。
//
// 前两次的补法都是再加一条形状规则（排 z-index、量尺寸），
// 这次不加了：**让这一层自己声明身份**（data-dismiss-layer）。
// 这份测试盯两件事：
//   ① 判断函数真的把声明过的层排除了
//   ② 以后新加的下拉菜单没漏标
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/**
 * 取出每一处 `fixed inset-0` 所在的完整 JSX 标签。
 *
 * **不能用 `/<div[^>]*fixed inset-0[^>]*>/`** —— 我第一版就是这么写的，
 * 结果测试是绿的、但把标记删掉它照样绿：
 * `onClick={() => ...}` 里的箭头本身带一个 `>`，
 * `[^>]*` 到那里就断了，onClick 根本没被截进来。
 *
 * 一个「删掉被测的东西也不会红」的测试，比没有测试更糟 ——
 * 它让人以为这件事有人守着。所以这里老老实实数花括号找标签结尾。
 */
const fullScreenLayerTags = (src) => {
  const out = [];
  for (let i = src.indexOf('fixed inset-0'); i !== -1; i = src.indexOf('fixed inset-0', i + 1)) {
    const start = src.lastIndexOf('<', i);
    if (start === -1 || !/^<\w/.test(src.slice(start, start + 2))) continue;
    let depth = 0;
    let end = -1;
    for (let j = start; j < src.length; j++) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { end = j; break; }
    }
    if (end !== -1) out.push(src.slice(start, end + 1));
  }
  return out;
};

test('帮助的弹窗判断必须排除「点空白处关闭」层', () => {
  /*
    症状：点一下头像，右下角冒出一个问号，
    标题写着「这个弹窗要我填什么？」—— 而那只是个菜单，没东西要填。

    真因：头像菜单为了接住「点外面关掉我」，铺了一层 fixed inset-0。
    它铺满整屏、可见、z-index 正常，**和真弹窗的遮罩一模一样**，
    于是 visibleModals() 把它算成弹窗，modalOpen 变 true。

    不报错、不影响任何功能 —— 只是每次点头像都多冒一个问号出来，
    正是这个项目里最难发现的那一类。
  */
  const src = read('components/HelpHub.tsx');
  assert.ok(
    /el\.closest\('\[data-dismiss-layer\]'\)\s*\)\s*return false/.test(src),
    'visibleModals() 没有排除 data-dismiss-layer —— 点头像又会冒出问号'
  );
});

test('每一个「点空白处关闭」层都要标 data-dismiss-layer —— 漏一个就再犯一次', () => {
  /*
    这条才是真正防重犯的那一条。

    上一条只保证判断函数认这个标记；**但标记是要人去加的**，
    而这个项目最高频的 bug 就是「同样的东西改一处漏一处」
    （权限三份定义、任务列表三处、工作台六套）。

    所以这里反着查：Layout 里每一个 fixed inset-0 的层，
    只要它的作用是 onClick 关闭某个浮层，就必须带这个标记。
  */
  const src = read('components/Layout.tsx');

  const layers = fullScreenLayerTags(src);
  assert.ok(layers.length >= 3, `Layout 里没找到几处全屏层（找到 ${layers.length} 处），选择器是不是过时了`);

  // 只管「点一下就关掉某个东西」的那种层
  const dismissers = layers.filter(t => /onClick=\{\(\)\s*=>\s*set\w+\(false\)\}/.test(t));
  assert.ok(dismissers.length >= 3,
    `没认出几个「点空白处关闭」层（只认出 ${dismissers.length} 个）—— 抓取标签的写法八成又断在 => 的箭头上了`);

  const missing = dismissers.filter(tag => !tag.includes('data-dismiss-layer'));

  assert.deepEqual(missing, [],
    '这些「点空白处关闭」层没标 data-dismiss-layer，点开它们会在右下角冒出问号：\n' +
    missing.map(t => '  ' + t.slice(0, 120)).join('\n'));
});

test('真弹窗不许被标成 dismiss 层 —— 标反了帮助就永远讲整页', () => {
  /*
    反方向也要守。把这个标记加到真弹窗的遮罩上，
    「打开帮助时先讲当前弹窗」就会整个失效，而且同样不报错 ——
    帮助照样弹出来，只是讲的是整页，看上去像「这功能就这样」。
    那正是坑 1 当年的症状。
  */
  const files = ['pages/Projects.tsx', 'pages/Leads.tsx', 'pages/Contracts.tsx',
    'pages/Customers.tsx', 'pages/Knowledge.tsx', 'pages/Audit.tsx',
    'pages/Finance.tsx', 'pages/Employees.tsx', 'src/ui/index.tsx'];
  const bad = [];
  for (const f of files) {
    fullScreenLayerTags(read(f))
      .filter(t => t.includes('data-dismiss-layer'))
      .forEach(t => bad.push(`${f}: ${t.slice(0, 100)}`));
  }
  assert.deepEqual(bad, [], '业务弹窗的遮罩被标成了 dismiss 层，帮助会讲不到这个弹窗：\n' + bad.join('\n'));
});
