/*
  设计语言的闸门 —— 手搓的样式不许再变多。

  ══════════════════════════════════════════════════════════════
  为什么需要它（2026-09-20）
  ══════════════════════════════════════════════════════════════

  金恩来：「设计语言也要弄一个规范，不要每次设计或者修改出来的代码，
    还要为 UI 专门再调整一次甚至多次。」

  查下来，**规范早就有了**：src/ui/index.tsx 里有 Badge / SectionCard /
  StatCard / buttonClass / Modal / 统一色板。问题是没有任何东西逼人用它。

  证据就是我自己：2026-09-19 做证书区时，我手写了
    `rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black`
  而不是调 buttonClass()。于是两个并排的动作一个 160px 一个 400px，
  金恩来来回指了三轮才弄整齐。

  ── 为什么写成测试，而不是写进文档 ────────────────────────────

  联网查了一圈，AI 写代码场景下成熟团队的共识是同一句话：
  **把每一条约定变成"构建时大声失败的东西"。**
  原话大意是：AI 对报错有反应 —— 编译错误会直接回到它的循环里逼它当场改；
  而写在风格指南里的违规，三周后才会出现在某个人的待办里。

  这也正是 CLAUDE.md 二点五之四：「要人记住的规矩，早晚有人记不住。」

  ── 为什么用"棘轮"而不是"一刀切" ──────────────────────────────

  这个仓库已经有几百处手搓样式，全部禁掉会让整个测试立刻变红，
  然后被人加个跳过、从此失效 —— 那比没有更糟（这个项目见过假绿的测试）。

  所以记一个基线数字：**允许不减少，但绝不允许变多**。
  新写的代码必须用规范；旧的等有空再还。
  基线只能往下调，不许往上调 —— 往上调就是在给自己开后门，
  code review 里一眼能看见。
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(__dirname, 'fixtures', 'design-system-baseline.json');

/** 要管的目录 —— 页面和组件。src/ui 自己是规范的定义处，不在管辖范围内 */
const DIRS = ['pages', 'components'];

const walk = (dir) => {
  const out = [];
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name.name)) out.push(full);
  }
  return out;
};

/*
  注释里出现类名是正常的（讲为什么这么写），不能算违规。
  **整行删掉会让行号错位**，所以是"抹白"：换成等长空格。
*/
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i) + ' '.repeat(line.length - i);
    })
    .join('\n');

/**
 * 什么算"手搓"。
 *
 * 只盯**已经有现成规范**的三样，不搞"禁止一切内联类名"——
 * 那种规则会把无数正常写法也判成违规，很快就没人信它了。
 */
const RULES = [
  {
    id: 'button',
    /*
      按钮：同时出现圆角 + 内边距 + 粗体字号，基本就是在手搓一个按钮。
      应该用 buttonClass()（src/ui/index.tsx）。
    */
    hint: '用 buttonClass() 代替手写按钮样式',
    re: /className=["'{`][^"'`}]*\brounded-(?:lg|xl)\b[^"'`}]*\bpx-\d[^"'`}]*\bfont-(?:bold|black)\b[^"'`}]*["'`}]/g
  },
  {
    id: 'field-card',
    /* 字段卡片：应该用 fieldCardClass / FieldCard */
    hint: '用 fieldCardClass 或 <FieldCard> 代替手写字段卡片',
    re: /rounded-xl border border-gray-100 bg-white px-3 py-2/g
  },
  {
    id: 'field-label',
    /* 字段名那行小灰字：应该用 fieldLabelClass */
    hint: '用 fieldLabelClass 代替手写字段标签样式',
    re: /text-\[11px\] font-bold text-gray-400 uppercase/g
  }
];

const countViolations = () => {
  const counts = {};
  for (const rule of RULES) counts[rule.id] = 0;
  for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      for (const rule of RULES) {
        counts[rule.id] += (src.match(rule.re) || []).length;
      }
    }
  }
  return counts;
};

test('手搓的 UI 样式不许再变多（新代码必须用 src/ui 的规范）', () => {
  const now = countViolations();
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

  const grew = [];
  for (const rule of RULES) {
    const before = baseline[rule.id];
    const after = now[rule.id];
    assert.equal(typeof before, 'number', `基线里缺 ${rule.id}，跑 node scripts/design-system-baseline.mjs 重新生成`);
    if (after > before) grew.push(`  · ${rule.id}：${before} → ${after}（多了 ${after - before} 处）\n    ${rule.hint}`);
  }

  assert.deepEqual(
    grew,
    [],
    '\n\n新代码里又手搓了 UI 样式：\n\n' + grew.join('\n')
    + '\n\n规范在 src/ui/index.tsx。缺哪一类就**往那里加一个**，'
    + '\n不要在页面里现搓一个 —— 现搓的那一刻起，同一个东西就有两套长相了。'
    + '\n（这条测试是棘轮：数字只许降不许升。确实还清了旧账，'
    + '\n  跑 node scripts/design-system-baseline.mjs 把基线调下去。）\n'
  );
});

test('基线本身是收紧的方向 —— 不许有人偷偷把它调高', () => {
  /*
    棘轮唯一的破绽是把基线往上调。
    这条测试拦不住有意为之（那要靠 code review），
    但能拦住"顺手调一下让测试变绿"——
    真实数字必须 ≤ 基线，基线本身也不能比真实数字大太多，
    否则就是给未来留了一堆额度。
  */
  const now = countViolations();
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  for (const rule of RULES) {
    assert.ok(
      baseline[rule.id] - now[rule.id] <= 5,
      `${rule.id} 的基线（${baseline[rule.id]}）比实际（${now[rule.id]}）高出太多 —— `
      + '基线是用来收紧的，不是用来预留额度的。跑 node scripts/design-system-baseline.mjs 重新生成。'
    );
  }
});
