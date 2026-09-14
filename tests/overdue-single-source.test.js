// 「逾期」在全系统只能有一份判定。
//
// 2026-09-14 金恩来：「逾期任务显示 5，点击后跳转到项目管理，
//   没有看到任何逾期任务……另外超期未完成任务显示的是 0……
//   如果功能一样就要统一字段，而且字段要和实际功能挂钩，不能词不达意。」
//
// 查下来同一个概念有**三份实现**，而且结论不同：
//
//   src/modules/taskFlow.ts      isOverdue           截止日当天结束才算   ← 不算今天
//   services/dashboardMetrics.ts diffDays(...) < 0   过了零点就算         ← 算今天
//   pages/Projects.tsx           isOverdueTask       同上                 ← 算今天
//
// 于是工作台数出 5 条，点进项目管理一条都没有。
//
// ── 这个不一致有一半是我当天造成的 ────────────────────────────
//
// 上午修了 taskFlow.isOverdue（「今天到期不算逾期」），
// **却没去查「同样的东西还有几处」** —— 而 CLAUDE.md 第六章第 2 条
// 列的第一个问题就是这个。修一处、漏两处，比不修更糟：
// 不修的时候三处至少是一致的错，修完变成了互相矛盾。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const strip = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');
const code = (rel) => strip(fs.readFileSync(path.join(root, rel), 'utf8'));

/** 会读到任务截止日期、可能自己判逾期的文件 */
const SUSPECTS = [
  'pages/Projects.tsx',
  'pages/MyTasks.tsx',
  'pages/Dashboard.tsx',
  'services/dashboardMetrics.ts',
  'components/MyWorkWidget.tsx',
];

test('判逾期的实现只能有一份 —— 别处不许自己再写一个', () => {
  /*
    两种自制写法都要拦：
      new Date(deadline).getTime() < Date.now()
      diffDays(deadline, now) < 0
    它们看着都对，但和 taskFlow.isOverdue 在「今天到期」上结论相反。
  */
  const offenders = [];
  for (const f of SUSPECTS) {
    const src = code(f);
    if (/new Date\(String\(\s*\w+\.deadline[^)]*\)\)\.getTime\(\)\s*<\s*Date\.now\(\)/.test(src)) {
      offenders.push(`${f}：又出现了 new Date(deadline) < Date.now()`);
    }
    if (/diffDays\(\s*\w+\.deadline[^)]*\)\s*<\s*0/.test(src)) {
      offenders.push(`${f}：又出现了 diffDays(deadline, ...) < 0`);
    }
  }
  assert.deepEqual(offenders, [],
    '判逾期又有了第二份实现：\n  ' + offenders.join('\n  ')
    + '\n  全系统只用 src/modules/taskFlow.ts 的 isOverdue。');
});

test('要判逾期的文件必须引 taskFlow —— 不引就说明它自己另算了一套', () => {
  for (const f of ['pages/Projects.tsx', 'services/dashboardMetrics.ts']) {
    const src = code(f);
    assert.match(src, /isOverdue/, `${f} 里没有用 isOverdue`);
    assert.match(src, /from '.*taskFlow'/, `${f} 没有从 taskFlow 引判定 —— 多半是自己又写了一份`);
  }
});

test('界面上不许再出现「超期」—— 和「逾期」是同一件事，两个词只会让人以为是两回事', () => {
  /*
    金恩来：「超期未完成任务（和逾期任务表达不同，不知道是不是一个意思。
    我觉得若是一个意思的不同表达，整个系统要全部严查并统一，否则会乱）」

    他是对的。统一用「逾期」：财务那边「逾期账款」是行业术语改不掉，
    一个词好过两个词。
  */
  const scanDirs = ['pages', 'components', 'src/modules', 'src/ui'];
  const offenders = [];
  const walk = (dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(path.join(dir, name)); continue; }
      if (!/\.(tsx?|ts)$/.test(name)) continue;
      const src = strip(fs.readFileSync(p, 'utf8'));
      if (src.includes('超期')) offenders.push(path.join(dir, name));
    }
  };
  scanDirs.forEach(walk);
  assert.deepEqual(offenders, [],
    '这些文件的界面文案里还有「超期」，统一成「逾期」：\n  ' + offenders.join('\n  '));
});

test('「有逾期任务的项目」这个筛选名要和它数的东西对上', () => {
  /*
    它原来叫「逾期未完成任务」，但筛选条件数的是**项目**：
        p.status !== Completed && p.tasks.some(isOverdueTask)
    于是页面上「逾期任务数 5」（数任务）和「逾期未完成任务 0」（数项目）
    并存，两个都叫"任务"，人只会觉得系统不靠谱。
  */
  const src = code('pages/Projects.tsx');
  assert.match(src, /label: '有逾期任务的项目'/, '筛选项名字又和它数的东西对不上了');
  assert.ok(!/label: '逾期未完成任务'/.test(src), '改回了那个名实不符的旧名字');
});
