// 字段档案必须和代码同步 —— 双向卡死。
//
// ── 为什么（2026-09-18）────────────────────────────────────────
//
// 金恩来：「系统的字段的解释或者定义你可以生成一份档案，放在系统中。」
//
// 最容易的做法是手写一份文档 —— 也是最没用的做法：
// 三个月后它一定和代码对不上，而且**没有任何机制会告诉你它对不上了**。
// 那时候它比没有更糟：人照着一份错的定义核对数字，对不上就以为系统坏了。
// 这正是 2026-09-17 那 37 条字段问题造成的局面。
//
// 所以这条测试卡两个方向：
//   ① 代码里有的术语，档案里必须有解释   → 新加术语忘了写口径就红
//   ② 档案里写的术语，代码里必须还存在   → 删了术语忘了清档案就红
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const build = (rel, name) => {
  const out = path.join(os.tmpdir(), `${name}-${process.pid}.cjs`);
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'),
    [path.join(root, rel), '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`], { stdio: 'pipe' });
  return { mod: require(out), out };
};
const dict = build('src/modules/help/fieldDictionary.ts', 'dict');
const glo = build('src/modules/glossary.ts', 'glo');
const lab = build('src/modules/labels.ts', 'lab');
test.after(() => { for (const f of [dict.out, glo.out, lab.out]) { try { fs.unlinkSync(f); } catch {} } });

const 档案词 = new Set(dict.mod.allDictEntries().map(e => e.term));

test('代码里的每个术语，档案里都要有解释', () => {
  /*
    只查**会出现在界面上的术语常量**。
    FIELD 里有些是表单标签（如"本期应收金额"），也算术语，一并查。
  */
  const 代码词 = [];
  const collect = (obj, label) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') 代码词.push([`${label}.${k}`, v]);
    }
  };
  collect(glo.mod.TERM_PROJECT, 'TERM_PROJECT');
  collect(glo.mod.TERM_TASK, 'TERM_TASK');
  collect(glo.mod.TERM_CONTRACT, 'TERM_CONTRACT');
  collect(glo.mod.TERM_RECEIVABLE, 'TERM_RECEIVABLE');
  collect(glo.mod.TERM_WINDOW, 'TERM_WINDOW');
  collect(lab.mod.AUDIT_STATUS_LABEL, 'AUDIT_STATUS');
  collect(lab.mod.AUDIT_SEVERITY_LABEL, 'AUDIT_SEVERITY');
  collect(lab.mod.CONTRACT_RISK_LABEL, 'CONTRACT_RISK');
  collect(lab.mod.TASK_STATUS_LABEL, 'TASK_STATUS');
  collect(lab.mod.SETTLEMENT_STATUS_LABEL, 'SETTLEMENT_STATUS');

  const 缺解释 = 代码词.filter(([, v]) => !档案词.has(v)).map(([k, v]) => `${k} = 「${v}」`);
  assert.deepEqual(缺解释, [],
    '这些术语在代码里用着，但字段档案里没有解释：\n  ' + 缺解释.join('\n  ')
    + '\n\n补进 src/modules/help/fieldDictionary.ts。只定名字不定口径等于没统一。');
});

test('档案里写的术语，代码里必须还在用', () => {
  /*
    反方向：删掉一个术语忘了清档案，人会照着一个已经不存在的词去找。
    只检查那些**来自常量**的词（自由文本条目如"本月实收"不在此列，
    它们是卡片标题，由下一条测试管）。
  */
  const 常量词 = new Set([
    ...Object.values(glo.mod.TERM_PROJECT), ...Object.values(glo.mod.TERM_TASK),
    ...Object.values(glo.mod.TERM_CONTRACT), ...Object.values(glo.mod.TERM_RECEIVABLE),
    ...Object.values(glo.mod.TERM_WINDOW),
    ...Object.values(lab.mod.AUDIT_STATUS_LABEL), ...Object.values(lab.mod.AUDIT_SEVERITY_LABEL),
    ...Object.values(lab.mod.CONTRACT_RISK_LABEL), ...Object.values(lab.mod.TASK_STATUS_LABEL),
    ...Object.values(lab.mod.SETTLEMENT_STATUS_LABEL), ...Object.values(lab.mod.REMINDER_SEVERITY_LABEL),
    ...Object.values(lab.mod.INTEL_URGENCY_LABEL), ...Object.values(lab.mod.FIELD)
  ].filter(v => typeof v === 'string'));

  // 档案里可以有自由文本条目（卡片标题），但凡是"长得像常量词"的必须还在
  /*
    扫描范围要含 src/modules —— 有些界面文案的唯一来源就在那里
    （比如 labels.ts 里 contractRiskLabel 的「未评估」兜底）。
    第一版漏了它，把一个正在用的词报成"失效"。
  */
  const 界面文本 = ['pages', 'components', 'services', 'src/modules', 'src/ui'].flatMap(dir => {
    const walk = (d) => {
      const abs = path.join(root, d);
      if (!fs.existsSync(abs)) return [];
      return fs.readdirSync(abs).flatMap(n => {
        const p = path.join(abs, n);
        return fs.statSync(p).isDirectory() ? walk(path.join(d, n))
          : /\.(tsx|ts)$/.test(n) ? [fs.readFileSync(p, 'utf8')] : [];
      });
    };
    return walk(dir);
  }).join('\n');

  const 失效 = dict.mod.allDictEntries()
    .map(e => e.term)
    .filter(t => !常量词.has(t) && !界面文本.includes(t));
  assert.deepEqual(失效, [],
    '档案里这些词在代码和界面上都找不到了，多半是改名或删除时忘了同步档案：\n  '
    + 失效.join('\n  '));
});

test('每条都要写口径，不能只有名字', () => {
  const 空口径 = dict.mod.allDictEntries().filter(e => !String(e.口径 || '').trim()).map(e => e.term);
  assert.deepEqual(空口径, [],
    '这些条目只有名字没有口径 —— 只定名字不定口径等于没统一：' + 空口径.join('、'));
});

test('按词能查到 —— 帮助中心「解释这一项」要用', () => {
  const 任一 = dict.mod.allDictEntries()[0];
  assert.ok(dict.mod.lookupTerm(任一.term), 'lookupTerm 查不到自己列出来的词');
  assert.equal(dict.mod.lookupTerm('这个词不存在'), undefined);
  assert.equal(dict.mod.lookupTerm(''), undefined);
});

test('字段档案这一页只做渲染，不许自己写词条', () => {
  /*
    这条防的是**第二份字典**。

    最容易发生的退化是：有人要在页面上加一条解释，
    直接在 pages/Glossary.tsx 里写死一段文字 —— 于是系统里有了两份字典，
    一份有测试卡着、一份没有，几个月后它们说的不是一回事。
    这个项目里同一条规则两份副本的故事已经有一长串了
    （权限三份、persona 四份、任务列表三处、归属四份）。

    所以页面只允许**渲染** FIELD_DICTIONARY，自己不许有词条数据。
  */
  const src = fs.readFileSync(path.join(root, 'pages/Glossary.tsx'), 'utf8');

  assert.match(src, /FIELD_DICTIONARY/, '页面没有引字典 —— 那它渲染的是哪来的数据？');
  assert.ok(!/口径:\s*'/.test(src),
    'pages/Glossary.tsx 里出现了 `口径: ...` —— 词条数据只能写在 fieldDictionary.ts，'
    + '写在页面里就成了第二份字典，而这一份没有测试卡着。');

  // 口径和易误解都要渲染出来：只显示名字等于没有档案
  assert.match(src, /\.口径/, '没有渲染「口径」—— 只列名字等于没定义');
  assert.match(src, /易误解/, '没有渲染「易误解」—— 那正是人卡住的地方');

  // 查不到时要给出路，不能只说"没有"
  assert.match(src, /EmptyState/, '搜不到时没有空状态');
  assert.match(src, /档案漏了/, '空状态没告诉人"查不到可能是档案的问题"，人只会以为自己不会搜');
});
