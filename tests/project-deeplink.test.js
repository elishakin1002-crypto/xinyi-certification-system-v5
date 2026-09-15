// 项目详情要有自己的地址 —— 发得出链接、刷新还在、后退能关。
//
// 2026-09-15 Codex 逐页清点顺带记了一句：
//   「项目详情为同页展开，没有单独的详情 hash 可直接刷新」
// 它只当成"没法测"，但这本身就是缺口。后果都很日常：
//   · 总助想跟顾问说「你看下嘉力那个项目」—— 发不出链接
//   · 刷新一下退回列表，刚看到哪儿全没了
//   · 按浏览器后退，详情不关，直接跳出这一页
// 连带还有一条：详情上的任何改动都没法「刷新再看一眼」，
// 而那正是我们查「点了到底存没存住」的标准手法。
//
// ── 加完之后第一次实测就踩了第二个坑 ────────────────────────────
//
// 总助打开 `#/projects?p=P-...`，页面显示「共 0 个项目」——
// 「范围」默认「与我相关」，那个项目是别人的，直接被筛掉，
// 连行都没渲染，自然无处展开。
// **链接发过去对方打开是空的，等于这个功能没有。**
// 和当天上午「合同说已立项、项目管理里找不到」是同一个形状：
// 东西在，但默认筛选把它藏了。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');
const src = () => stripComments(fs.readFileSync(path.join(root, 'pages/Projects.tsx'), 'utf8'));

test('展开哪个项目必须写进地址，不能只存本地状态', () => {
  const s = src();
  assert.match(s, /searchParams[\s\S]{0,80}get\('p'\)|URLSearchParams\(location\.search\)\.get\('p'\)/,
    '没有从地址里读 ?p= —— 那刷新和分享都回不到原来那个项目');
  assert.match(s, /const toggleProject =/, '没有统一的展开入口');
  assert.match(s, /params\.set\('p', id\)/, '展开时没有把项目 id 写进地址');
});

test('所有打开详情的入口都要走地址，不许直接 setExpandedProject', () => {
  /*
    加 URL 同步那次差点漏掉两处：从工作台跳过来的 openDetailId，
    和逾期任务清单里的那个按钮。它们直接 setExpandedProject，
    而跟着 location.search 跑的 effect 会在同一轮把它清掉 ——
    表现是「点了跳过来，停在列表页什么都没展开」，不报错。
  */
  const s = src();
  const bad = [...s.matchAll(/setExpandedProject\(/g)].length;
  assert.equal(bad, 1,
    `有 ${bad} 处直接调 setExpandedProject（应该只剩 URL 同步那一处）`
    + ' —— 其它入口要走 openProject / toggleProject，否则会被 URL 同步清掉');
});

test('带地址进来时，挡住这个项目的筛选要放开，并说明原因', () => {
  /*
    否则链接发过去，对方看到的是「共 0 个项目」。
    放开之后还要说一句为什么 —— 数字突然变了而没有解释，
    比看不见更让人糊涂。
  */
  const s = src();
  const eff = s.slice(s.indexOf("const target = projects.find(p => p.id === id)"));
  assert.ok(eff.length > 100, '没有「带 id 进来时保证看得见」这段逻辑');
  assert.match(eff.slice(0, 700), /setViewScope\('all'\)/, '没有在目标不属于我时放开范围筛选');
  assert.match(eff.slice(0, 700), /setModeScope\('all'\)/, '没有放开类别筛选');
  assert.match(eff.slice(0, 700), /setFilterStatus\('All'\)/, '没有放开状态筛选');
  assert.match(eff.slice(0, 900), /为了让你看到/, '放开了筛选却没告诉人为什么');
});
