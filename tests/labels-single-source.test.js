// 枚举的界面文案只能有一份，页面不许自己写。
//
// ── 为什么要有这条（2026-09-17）────────────────────────────────
//
// 金恩来：「为什么字段的统一这样的致命的问题，你怎么一直没有提出来，
//   知道我发现来，你才来改，这难道不是一个基础问题吗？」
//
// 一次静态排查查出 37 条，其中 12 条「同义异名」几乎全是同一个形状：
// **同一个枚举值，每个页面、每个断点各写一套 switch 或三元表达式。**
// 桌面那份通常是对的，手机那份是后加的、漏了分支：
//
//   · 中风险合同在手机上显示「正常」——手机只判 High（C19）
//   · 不符合项四态在手机上压成两态（A01）
//   · 审计日志手机端直接显示 USER_CREATE（A10）
//   · 任务 Pending / Skipped 都显示「进行中」（C08）
//
// 光把这几处改对没用 —— 下一个断点、下一个页面照样会漏
// （CLAUDE.md 二点五第 4 条：要人记住的规矩早晚有人记不住）。
// 所以把映射收进 src/modules/labels.ts，并用这条测试**禁止再手写**。
//
// 这条测试盯的是形状，不是某一句文案：
// 只要有人在页面里重新写出 `=== 'Major' ? '严重'` 这类映射，它就红。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `labels-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/labels.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`
], { stdio: 'pipe' });
const L = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch { /* 已经没了 */ } });

/** 注释要抹白不要删掉 —— 删掉行号会整体上移，报出来的位置指向不相干的代码 */
const 抹白注释 = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

const 页面文件 = () => {
  const files = [];
  const walk = (dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      if (fs.statSync(p).isDirectory()) { walk(path.join(dir, name)); continue; }
      if (/\.tsx$/.test(name)) files.push(path.join(dir, name));
    }
  };
  ['pages', 'components'].forEach(walk);
  return files;
};

test('认不出来的值不许回退成一个让人放心的状态', () => {
  /*
    这是整个 labels.ts 存在的第二个理由，比"统一叫法"更要紧。

    RiskBadge 原来写的是「不是 high 也不是 medium，就是低风险」，
    于是**没评估过的合同显示绿色的「低风险」**。
    和「没有正在生效的登录」「0 次越权请求」是同一条规矩：
    别把"不知道"说成一个让人走开的结论。
  */
  assert.equal(L.contractRiskLabel(''), '未评估');
  assert.equal(L.contractRiskLabel(undefined), '未评估');
  assert.equal(L.contractRiskTone(''), 'gray', '未评估不许给绿色');
  assert.equal(L.contractRiskLabel('Medium'), '中风险', '中风险不许掉进"正常"');
  assert.equal(L.contractRiskLabel('Weird'), '未知风险(Weird)', '认不出的值要显示出来，好让人去查');

  assert.equal(L.auditStatusLabel('Verifying'), '待验证');
  assert.equal(L.auditStatusLabel('Open'), '待整改', '「等对方整改」和「等我方验证」是两个人在等');
  assert.equal(L.taskStatusLabel('Skipped'), '已跳过', '「决定不做」不是「正在做」');
  assert.equal(L.taskStatusLabel('Pending'), '待开始');
});

test('「没有下一步了」要说清是哪一种', () => {
  // 零任务的项目正是「待补信息」那张卡要抓的，说成"做完了"就藏起来了
  assert.equal(L.noNextTaskReason([]), '尚未安排任务');
  assert.equal(L.noNextTaskReason(null), '尚未安排任务');
  assert.equal(L.noNextTaskReason([{ status: 'Completed' }, { status: 'Skipped' }]), '无待办任务（含已跳过）');
  assert.equal(L.noNextTaskReason([{ status: 'Completed' }]), '所有任务已完成');
});

test('页面不许自己写枚举文案 —— 手写一次就会漏一个断点', () => {
  /*
    盯的是「值 → 中文」这种映射的写法，不是禁止出现这些词。
    例如 `severity === 'Major' ? '严重'`、`status === 'Closed' ? '已关闭'`。
    真要新增一个值，改 labels.ts，那里改会被 review 看到。
  */
  /*
    判据要精确到「你是不是在重复实现一份已有的映射」。

    第一版写成「任何枚举值的三元表达式产出中文就算」，结果抓到四条无辜的：
      · `status === 'Open' ? '未关闭'`       ← 筛选桶名，不是状态文案
      · `s.status === 'draft' ? '确认结算'`   ← 动作按钮文案
      · 战略战役状态                           ← 另一个域，术语表里没有
    过度匹配的测试会逼人加例外，加着加着就没人信它了（这个项目栽过）。

    所以只在**产出的中文正好等于术语表里的标准文案**时才算重复实现。
  */
  const 标准文案 = new Set([
    ...Object.values(L.AUDIT_STATUS_LABEL), ...Object.values(L.AUDIT_SEVERITY_LABEL),
    ...Object.values(L.CONTRACT_RISK_LABEL), ...Object.values(L.TASK_STATUS_LABEL),
    ...Object.values(L.SETTLEMENT_STATUS_LABEL), ...Object.values(L.REMINDER_SEVERITY_LABEL),
    ...Object.values(L.INTEL_URGENCY_LABEL)
  ]);
  const 枚举三元 = /===\s*'(?:Major|Minor|Observation|Open|Rectifying|Verifying|Closed|High|Medium|Low|Pending|InProgress|Skipped|draft|confirmed|paid|high|medium|low)'\s*\?\s*'([^']+)'/g;
  const 手写映射 = (line) => {
    枚举三元.lastIndex = 0;
    let m;
    while ((m = 枚举三元.exec(line))) if (标准文案.has(m[1])) return true;
    return false;
  };
  const 违规 = [];
  for (const rel of 页面文件()) {
    const src = 抹白注释(fs.readFileSync(path.join(root, rel), 'utf8'));
    src.split('\n').forEach((line, i) => {
      if (手写映射(line)) 违规.push(`${rel}:${i + 1}  ${line.trim().slice(0, 96)}`);
    });
  }
  assert.deepEqual(违规, [],
    '这些地方在页面里手写枚举→文案的映射，另一个断点/页面早晚会漏一个分支：\n  '
    + 违规.join('\n  ')
    + '\n\n改用 src/modules/labels.ts 里的 xxxLabel()。');
});

test('术语表里的每个映射都得有人用 —— 定了不用等于没定', () => {
  const src = 页面文件().map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(root, 'src/ui/statusBadge.tsx'), 'utf8')
    + fs.readFileSync(path.join(root, 'services/dashboardMetrics.ts'), 'utf8');
  const 没人用 = ['auditStatusLabel', 'auditSeverityLabel', 'contractRiskLabel',
    'taskStatusLabel', 'knowledgeCategoryLabel', 'reminderSeverityLabel',
    'intelUrgencyLabel', 'settlementStatusLabel', 'noNextTaskReason']
    .filter(name => !src.includes(name));
  assert.deepEqual(没人用, [],
    '这些映射定了却没有任何页面在用，多半是那一处又自己写了一套：' + 没人用.join('、'));
});
