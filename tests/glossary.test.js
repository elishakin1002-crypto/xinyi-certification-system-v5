// 术语只能有一个说法 —— 靠测试守，不靠人记。
//
// 2026-09-15 金恩来：「这个系统的字段是否统一，这块是基础啊，
//   否则后面会越做越乱……如果功能一样就要统一字段，
//   而且字段要和实际功能挂钩，不能词不达意。」
//
// 把所有角色的头部卡片摊开之后，同一个概念有三四种说法：
//   进行中的项目   在制项目总数 / 当前在制项目数 / 进行中项目 / 人均在制项目数
//   已完成的项目   已完成项目（卡片） vs 已结项（状态标签）—— 同一页两个词
//   逾期的任务     已逾期任务 / 逾期任务数 / 逾期未完成任务 / 未完成任务
//
// ── 为什么这是测试而不是一份文档 ──────────────────────────────
//
// CLAUDE.md 二点五第 4 条：**要人记住的规矩，早晚有人记不住。**
// 写一份「术语规范」放在 docs 里，下一个人（或下一个 AI）不会去读。
// 落成测试之后，用错词当场红，而且红的时候直接告诉他该用哪个。
//
// 这就是领域驱动设计里 Ubiquitous Language 的工程做法：
// 术语定义成常量（src/modules/glossary.ts），界面引用常量，测试禁止自由发挥。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `glossary-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/glossary.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`
], { stdio: 'pipe' });
const { TERM_PROJECT, TERM_TASK, DEPRECATED_TERMS } = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch { /* 已经没了 */ } });

/** 扫界面文件；注释里出现旧词是允许的（那是在讲历史） */
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

const uiFiles = () => {
  const files = [];
  const walk = (dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      if (fs.statSync(p).isDirectory()) { walk(path.join(dir, name)); continue; }
      if (/\.(tsx|ts)$/.test(name) && !/\.d\.ts$/.test(name)) files.push(path.join(dir, name));
    }
  };
  ['pages', 'components', 'services', 'src/modules', 'src/ui'].forEach(walk);
  // 术语表自己会列出被淘汰的词，不扫它
  return files.filter(f => !f.endsWith('glossary.ts'));
};

test('被淘汰的说法不许出现在界面文案里', () => {
  /*
    每条都给出"该用哪个"，而不是只说"这个不行" ——
    项目规矩：给用户的文案要说清后果和下一步，给开发者的报错也一样。
  */
  const offenders = [];
  for (const f of uiFiles()) {
    const src = stripComments(fs.readFileSync(path.join(root, f), 'utf8'));
    for (const [bad, good] of Object.entries(DEPRECATED_TERMS)) {
      if (src.includes(bad)) offenders.push(`${f}：「${bad}」→ 请改成「${good}」`);
    }
  }
  assert.deepEqual(offenders, [],
    '界面上出现了被淘汰的说法：\n  ' + offenders.join('\n  ')
    + '\n\n术语表在 src/modules/glossary.ts，一个概念只留一个词。');
});

test('工作台卡片标题要引术语常量，不许再各写各的字符串', () => {
  /*
    这条是"机制"那一半：只禁止旧词不够 —— 下次有人写「在办项目」，
    旧词表里没有，测试不会红，于是又多一个说法。
    引用常量之后，想换说法就得改术语表，改术语表会被看见。
  */
  const metrics = stripComments(fs.readFileSync(path.join(root, 'services/dashboardMetrics.ts'), 'utf8'));
  assert.match(metrics, /from '\.\.\/src\/modules\/glossary'/, 'dashboardMetrics 没有引术语表');
  assert.match(metrics, /title: TERM_PROJECT\.active/, '「进行中项目」没有走术语常量');
  assert.match(metrics, /title: TERM_TASK\.overdue/, '「逾期任务」没有走术语常量');
});

test('「逾期任务」只算进行中项目里的 —— 两个页面必须同口径', () => {
  /*
    金恩来的截图：工作台「进行中项目 0 / 逾期任务 5」，
    而项目管理同名统计是 0。真因是工作台把**已结项项目里没勾完的任务**
    也算了进来。

    后果不是数字不好看，是**一个永远消不掉的红色数字** ——
    点进去还找不到对应项目。人很快就不再信任所有红色数字，
    而真正紧急的那条也在红色里。

    已结项项目里的残留任务是"结项收尾没做干净"，
    该在结项那一刻处理（完结清单就是干这个的），不该天天挂在待办上。
  */
  const metrics = stripComments(fs.readFileSync(path.join(root, 'services/dashboardMetrics.ts'), 'utf8'));
  assert.match(metrics, /const activeProjectIds = new Set\(myActiveProjects\.map/,
    '没有把范围限定在进行中项目');
  assert.match(metrics, /myOverdueTasks = myOpenTasksInActive\.filter/,
    '「我的逾期任务」又把已结项项目里的任务算进来了');
});

test('术语表里每个词都得有人用 —— 定了不用等于没定', () => {
  /*
    防的是另一头：术语表越写越长，而界面上还是各写各的。
    只查最核心的几个（项目状态、任务状态），别把表变成许愿池。
  */
  const all = uiFiles()
    .map(f => fs.readFileSync(path.join(root, f), 'utf8'))
    .join('\n');
  for (const [key, word] of Object.entries({ ...TERM_PROJECT, ...TERM_TASK })) {
    assert.ok(
      all.includes(word) || all.includes(`TERM_PROJECT.${key}`) || all.includes(`TERM_TASK.${key}`),
      `术语「${word}」定义了但全系统没人用 —— 要么用起来，要么从术语表里删掉`
    );
  }
});

test('情报日报不许再写进知识中心 —— 这是 2026-09-13 定下的', () => {
  /*
    金恩来 2026-09-13：「情报雷达的内容有必要沉淀到知识中心吗？感觉有点多余。」
    结论是不必要，按钮当天下线。

    但下线的只是按钮，生成函数留着成了**死代码地雷**，
    而且它用 `DOC-INTEL-DIGEST-${Date.now()}` 当 id，同一天点两次就两条。
    2026-09-14 函数已删，2026-09-15 他又在界面上看到 3 篇 ——
    那是历史数据（生产已清空，本机也清了）。

    这条测试守的是「别再长回来」：
    以后谁想恢复这个功能，会先看到这条红灯和这段说明。
  */
  const offenders = [];
  for (const f of uiFiles()) {
    const src = stripComments(fs.readFileSync(path.join(root, f), 'utf8'));
    if (/情报雷达日报|DOC-INTEL-DIGEST/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    '又出现了往知识中心写情报日报的代码：\n  ' + offenders.join('\n  ')
    + '\n  这个功能 2026-09-13 已经下线（金恩来：「感觉有点多余」）。'
    + '\n  真要恢复，先跟他确认，并且文档 id 必须是确定性的（按日期），不能用 Date.now()。');
});
