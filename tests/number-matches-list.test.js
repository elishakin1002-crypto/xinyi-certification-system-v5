/*
  卡片上的数字，必须等于点进去看到的行数。

  ══════════════════════════════════════════════════════════════
  金恩来 2026-09-20 一口气报了三条，形状完全一样
  ══════════════════════════════════════════════════════════════

  · 工作台「进行中项目 2」，点进项目管理变成 3
  · 项目管理「有逾期任务的项目 2」，列表里 3 条
  · 铃铛角标 4 条未读，下拉面板只有 2 条

  他的原话：「这是要让同事练习调查力，找不同吗？谁会在一开始就注意到
    『共 3 项逾期任务·涉及 2 个项目』这个提示呢？」
  「这种数字和实际内容上的不统一只会带来混乱。」

  三条的真因不同，但后果一样 —— **数字承诺的和你看到的不是一回事**。
  一个数字只要被"解释"过一次，人就不再信它。
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/*
  注释里出现旧写法是**正常且必要的**（说明当初为什么删掉它），
  不能算违规。**整行删掉会让行号错位**，所以是"抹白"：换成等长空格。
  第一版我忘了这一步，于是自己写的那段"这张卡已删"的注释
  把测试搞红了 —— 一条查"别再写这个"的测试，被"解释为什么不写它"绊倒。
*/
const readCode = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i) + ' '.repeat(line.length - i);
    })
    .join('\n');

test('「我的项目」只能有一份实现 —— 不许谁再自己写一个', () => {
  /*
    工作台 2 vs 项目管理 3 的真因：
    services/dashboardMetrics.ts 自己写了一份 projectIsMine（不含待指派），
    而项目管理页用 ownership.ts 的 isMyProject（含待指派）。
    两个函数、两个结果、界面上同一个词。
  */
  const dm = read('services/dashboardMetrics.ts');
  assert.match(dm, /isOwnedByMe/, '工作台必须用 ownership.ts 的实现');
  assert.equal(
    /const projectIsMine[\s\S]{0,200}?ownedByUser\(/.test(dm), false,
    'dashboardMetrics 又自己写了一份「我的项目」判断 —— 必须走 ownership.ts'
  );

  const own = read('src/modules/ownership.ts');
  assert.match(own, /export const isMyProject/, '「与我相关」的实现应在 ownership.ts');
  assert.match(own, /export const isOwnedByMe/, '「我负责的」的实现应在 ownership.ts');
  assert.match(own, /isOwnedByMe[\s\S]{0,300}isUnownedProject\(project\)\) return false/,
    'isOwnedByMe 必须排除待指派 —— 那正是它和 isMyProject 的唯一区别');
});

test('工作台点进项目管理时，落在「我负责的」而不是「与我相关」', () => {
  // 卡片写的是"我负责的"，落地页就必须是同一个范围，否则 2 会变成 3
  const src = read('pages/Projects.tsx');
  assert.match(src, /setViewScope\([^)]*\?\s*'mine'\s*:/,
    "工作台焦点应把范围设成 'mine'（我负责的），不是 'related'");
  assert.match(src, /'all'\s*\|\s*'related'\s*\|\s*'mine'/, '范围类型要有 mine 这一档');
});

test('范围选项里「我负责的」和「与我相关」都要有，且说清区别', () => {
  const src = read('src/modules/projectCategory.ts');
  assert.match(src, /value: 'mine'[^\n]*label: '我负责的'/);
  assert.match(src, /value: 'related'[^\n]*label: '与我相关'/);
  // 两条说明必须把"含不含待指派"讲出来 —— 不讲的话，两个选项看起来是一回事
  const mineLine = src.split('\n').find((l) => l.includes("value: 'mine'")) || '';
  const relLine = src.split('\n').find((l) => l.includes("value: 'related'")) || '';
  assert.match(mineLine, /不含/, '「我负责的」要说明不含待指派');
  assert.match(relLine, /加上|含/, '「与我相关」要说明包含待指派');
});

test('「有逾期任务的项目」列出来的是项目，不是任务', () => {
  /*
    原来是 flatMap(项目 => 项目的逾期任务)，标题写「项目」列的却是任务，
    于是卡片 2、列表 3。现在按项目列，一个项目一行。
  */
  const src = read('pages/Projects.tsx');
  const start = src.indexOf('有逾期任务的项目</h2>');
  assert.ok(start > 0, '找不到逾期列表');
  const block = src.slice(start, start + 2000);
  assert.equal(/flatMap\(project =>[^\n]*tasks/.test(block), false,
    '又改回按任务平铺了 —— 那样卡片数和列表行数必然对不上');
  assert.match(block, /filteredProjects\s*\n?\s*\.filter\(project =>[^\n]*isOverdueTask\)/,
    '应当先筛出"有逾期任务的项目"，再一个项目一行');
});

test('铃铛角标 = 面板里的件数，不是原始提醒条数', () => {
  /*
    成熟做法：Gmail / Slack 的角标数的是**会话**，不是会话里的消息条数 ——
    角标承诺的是"点进去有几件事等你"。
  */
  const src = read('components/Layout.tsx');
  assert.equal(
    /\{unreadReminders\.length > 99 \? '99\+' : unreadReminders\.length\}/.test(src), false,
    '角标又用回原始条数了 —— 和面板显示的件数对不上'
  );
  assert.match(src, /bellBuckets\.total > 99 \? '99\+' : bellBuckets\.total/,
    '角标应显示 bellBuckets.total（面板里实际能看到的件数）');
});

test('咨询师看板不许再出现"猜标题"的指标', () => {
  /*
    金恩来：「客户待确认事项到底什么意思？」
    答案是它没有确切含义 —— 按标题里有没有「确认/回传/审核/签字/盖章」猜的。

    用 readCode（抹掉注释）：注释里会引用旧写法说明为什么删，那不算违规。
  */
  const src = readCode('services/dashboardMetrics.ts');
  assert.equal(
    /确认\|回传\|审核\|签字\|盖章/.test(src), false,
    '又用标题关键词猜指标了。要做这张卡就给任务加显式字段，不许猜。'
  );
  assert.equal(/'客户待确认事项'/.test(src), false, '这张卡已删，不该再出现');
  assert.equal(/'本周完成任务数'/.test(src), false,
    '这张卡已删（看到它不会产生任何行动，且和底部的本周日志/工时重复）');
  assert.match(src, /'今天要做'/, '应有「今天要做」——答的是"现在做什么"');
});
