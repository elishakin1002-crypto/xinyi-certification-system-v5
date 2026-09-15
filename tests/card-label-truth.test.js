// 卡片的「名字」和「数字」必须是同一回事 —— 词不达意也是 bug。
//
// 2026-09-15 金恩来：「如果功能一样就要统一字段，而且字段要和实际功能挂钩，
//   不能词不达意。」
//
// 上一轮我做的是「把词统一」（术语表 + 禁止旧词），但没做
// 「每张卡的数字和它的标签是不是一回事」—— 而后者才是他问的。
// 结果项目管理上留着这么两张挨着的卡：
//     第三张「有任务卡住的项目」 值 = 项目个数
//     第四张「有逾期任务的项目」 值 = 逾期任务条数
// 两张都叫「…的项目」，一张数项目一张数任务。
// 而且两张卡背后的筛选条件是**同一个**（项目状态只有 Active/Completed，
// 所以 `!== Completed` 就等于 `=== Active`），点哪张进的都是同一份清单。
//
// 这条测试守两件事：数任务的卡不许叫「项目」，两张卡不许再分裂成两个筛选。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `cardlabel-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/glossary.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`
], { stdio: 'pipe' });
const { TERM_PROJECT, TERM_TASK } = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch { /* 已经没了 */ } });

const projects = () => fs.readFileSync(path.join(root, 'pages/Projects.tsx'), 'utf8');

/** 抓出每张 StatCard 的 value 和 label 配对 */
const statCards = (src) => {
  const out = [];
  /*
    收尾必须是**独占一行**的 `/>`：属性里的 `icon={<Briefcase ... />}`
    自己带一个 `/>`，非贪婪匹配会停在那里，抓出来的 body 是空的。
    我写这条测试时就先踩了一次 —— 又是「看起来像 X 就当 X」。
  */
  const re = /<StatCard\b([\s\S]*?)\n\s*\/>/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1];
    const value = (body.match(/value=\{([^}]*)\}/) || [])[1];
    const label = (body.match(/label=\{([^}]*)\}/) || body.match(/label="([^"]*)"/) || [])[1];
    const onClick = (body.match(/onClick=\{([^}]*)\}/) || [])[1];
    if (value) out.push({ value: value.trim(), label: (label || '').trim(), onClick: (onClick || '').trim() });
  }
  return out;
};

test('数任务条数的卡片不许叫「…的项目」', () => {
  const cards = statCards(projects());
  assert.ok(cards.length >= 4, `没抓到项目管理的统计卡（只抓到 ${cards.length} 张），测试要跟着结构改`);

  const offenders = cards
    // value 里带 Tasks 的就是在数任务
    .filter(c => /Tasks\b/.test(c.value))
    // 而 label 里出现「项目」就是在说项目
    .filter(c => /项目/.test(c.label) && !/TERM_TASK/.test(c.label));

  assert.deepEqual(offenders, [],
    '这些卡片数的是任务，名字却叫「项目」：\n  '
    + offenders.map(c => `value=${c.value}  label=${c.label}`).join('\n  ')
    + '\n\n数任务就叫 TERM_TASK.overdue（逾期任务），数项目才叫 TERM_PROJECT.withOverdueTask。');
});

test('数项目个数的卡片不许叫「任务」', () => {
  const cards = statCards(projects());
  const offenders = cards
    .filter(c => /stats\.(active|completed|stuck)\b/.test(c.value))
    .filter(c => /^「?任务/.test(c.label) || /TERM_TASK\.overdue/.test(c.label));
  assert.deepEqual(offenders, [],
    '这些卡片数的是项目，名字却叫「任务」：\n  '
    + offenders.map(c => `value=${c.value}  label=${c.label}`).join('\n  '));
});

test('项目管理的每张卡都数项目，且各有各的筛选', () => {
  /*
    2026-09-15 定的规矩（金恩来：「不要为了好看而显示，
    要为了好用提效而设计」）：

      **这一页列的是项目，所以每张卡都数项目。**

    任务粒度的数字归「我的任务」和工作台。这一条一次消掉整类混乱 ——
    在这之前第三、四张卡一个数项目一个数任务，却都叫「…的项目」，
    而且背后是同一个筛选条件（项目只有 Active/Completed 两种状态，
    `!== Completed` 就等于 `=== Active`），点哪张都是同一份清单。

    守三件事：
      1. 标签只能来自 TERM_PROJECT（数任务的词进不来）
      2. 四张卡的筛选互不相同（不许两张卡是同一份清单）
      3. 数字必须是「项目个数」（filter(...).length），不许 reduce 累加任务
  */
  const src = projects();
  const cards = statCards(src);
  assert.equal(cards.length, 4, `项目管理应该是 4 张统计卡，现在抓到 ${cards.length} 张`);

  for (const c of cards) {
    assert.match(c.label, /^TERM_PROJECT\./,
      `卡片标签「${c.label}」没走 TERM_PROJECT —— 这一页只数项目，`
      + '数任务的数字请放到「我的任务」或工作台');
  }

  const filters = cards.map(c => (c.onClick.match(/selectOverview\('([^']+)'\)/) || [])[1]);
  assert.ok(filters.every(Boolean), '有卡片没有接到 selectOverview');
  assert.equal(new Set(filters).size, filters.length,
    `有两张卡指向同一个筛选（${filters.join(', ')}）—— 那它们是同一份清单，只该留一张`);

  // overviewStats 里每个字段都必须是项目个数
  const stats = src.slice(src.indexOf('const overviewStats'), src.indexOf('const filteredProjects'));
  assert.ok(!/reduce\(\(sum[\s\S]*?tasks[\s\S]*?length/.test(stats),
    'overviewStats 里有把任务条数累加起来的写法 —— 这一页的卡片只数项目');
  for (const c of cards) {
    const field = (c.value.match(/overviewStats\.(\w+)/) || [])[1];
    assert.ok(field, `卡片 ${c.label} 的值不是从 overviewStats 来的`);
    assert.match(stats, new RegExp(`${field}:[^\n]*\\.length`),
      `overviewStats.${field} 不是「项目个数」（没有 .length）—— 卡片说 N，点进去必须是 N 行`);
  }
});

test('卡片点进去的筛选，列表必须真的支持', () => {
  /*
    防的是「卡片点了没反应」：selectOverview 传了一个
    matchesOverviewStatus 里没处理的值，于是点了等于没点、
    还把选中态高亮了 —— 又一个不报错的失效。
  */
  const src = projects();
  const filters = statCards(src)
    .map(c => (c.onClick.match(/selectOverview\('([^']+)'\)/) || [])[1])
    .filter(Boolean);
  const matcher = src.slice(src.indexOf('const matchesOverviewStatus'), src.indexOf('const matchesModeScope'));
  for (const f of filters) {
    assert.ok(matcher.includes(`'${f}'`),
      `卡片会把筛选切到 '${f}'，但 matchesOverviewStatus 里没有这一档 —— 点了会没反应`);
  }
});

test('任务状态白名单必须跟着共享枚举走，不许服务端自己列', () => {
  /*
    2026-09-15 Codex 发现：前端支持四态（Pending/InProgress/Completed/Skipped），
    项目接口的 normalizeTaskStatus 只认两态，其余静默回退成 Pending。

    后果是顾问点「进行中」或「跳过」（还填了原因），经过这个接口就变回「待处理」，
    不报错、不提示。更糟的是 Skipped 被改回 Pending 之后这条任务重新算未完成，
    第二天又出现在「我今天的活」里催他 —— 一件他已经交代过为什么不做的事。
  */
  const { TASK_STATUS } = require(path.join(root, 'src/constants/status.js'));
  assert.deepEqual(Object.values(TASK_STATUS).sort(),
    ['Completed', 'InProgress', 'Pending', 'Skipped'],
    '共享枚举里的任务状态变了，下面这条断言要跟着看一遍');

  const app = fs.readFileSync(path.join(root, 'server/app.js'), 'utf8');
  assert.ok(!/\['Pending',\s*'Completed'\]\.includes\(status\)/.test(app),
    "server/app.js 又把任务状态白名单写死成两态了 —— InProgress 和 Skipped 会被静默改回 Pending");
  assert.match(app, /TASK_STATUS_VALUES\.includes\(status\)/,
    'normalizeTaskStatus 没有走共享枚举');
  assert.match(app, /require\('\.\.\/src\/constants\/status\.js'\)/,
    'server/app.js 没有引共享的状态常量');
});
