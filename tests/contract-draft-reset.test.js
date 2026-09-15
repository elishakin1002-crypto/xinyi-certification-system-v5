// 合同录入弹窗关掉之后必须清空 —— 三条关闭路径都要清。
//
// 2026-09-15 Codex 逐页清点报了一条「取消后重开，未保存内容仍保留」。
// 我在真浏览器里把三条关闭路径逐条跑了一遍，**都正确清空**：
//     取消按钮 → closeContractModal → resetContractDraft  ✅
//     右上角 X → closeContractModal → resetContractDraft  ✅
//     点遮罩   → 不关闭弹窗（防误触把填了一半的合同丢掉）  ✅
// 所以那条是误报。
//
// 但既然查了，就把它钉住 —— 这个行为很容易在加新字段时悄悄破掉：
// resetContractDraft 是一张手写的清单，**新增一个 useState 而忘了加进来**，
// 上一份合同的残留就会被带进下一份。而且不报错。
// 这正是 CLAUDE.md 二点五第 1 条说的「白名单式清理」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'pages/Contracts.tsx'), 'utf8');
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');
const clean = stripComments(src);

test('开和关都要清空草稿 —— 少一边都会把上一份带进下一份', () => {
  const open = clean.slice(clean.indexOf('const openContractModal'), clean.indexOf('const closeContractModal'));
  const close = clean.slice(clean.indexOf('const closeContractModal'), clean.indexOf('const closeContractModal') + 260);
  assert.match(open, /resetContractDraft\(\)/, '打开弹窗时没有清空草稿');
  assert.match(close, /resetContractDraft\(\)/, '关闭弹窗时没有清空草稿');
});

test('取消按钮和右上角 X 必须走同一个关闭函数', () => {
  /*
    两个入口各写各的是这个项目最高频的 bug 形态。
    只要有一个直接 setIsModalOpen(false)，它那条路径就不清草稿。
  */
  const strays = [...clean.matchAll(/setIsModalOpen\(false\)/g)].length;
  assert.equal(strays, 1,
    `有 ${strays} 处直接 setIsModalOpen(false)（应该只剩 closeContractModal 里那一处）`
    + ' —— 其它关闭入口绕过了清空，上一份合同会被带进下一份');
});

test('resetContractDraft 要清掉弹窗里所有的临时状态', () => {
  /*
    它是一张手写清单，新增 useState 却忘了加进来 = 残留，而且不报错。
    这里把弹窗用到的临时状态列出来对一遍：漏了哪个，红的时候直接说是哪个。
  */
  const reset = clean.slice(clean.indexOf('const resetContractDraft'), clean.indexOf('const openContractModal'));
  const MUST_CLEAR = [
    ['setFormData', '表单字段'],
    ['setExtractedReceivables', 'AI 识别出的回款节点'],
    ['setExtractedServiceItems', 'AI 识别出的服务项'],
    ['setFileAttachments', '已上传的附件'],
    ['setFromLeadId', '「从哪条线索转来的」'],
    ['setRiskAssessment', '风险评估结果'],
    ['setDocContent', '识别出的合同正文'],
  ];
  const missing = MUST_CLEAR.filter(([fn]) => !reset.includes(fn)).map(([fn, why]) => `${fn}（${why}）`);
  assert.deepEqual(missing, [],
    'resetContractDraft 漏清了这些，上一份合同的内容会被带进下一份：\n  ' + missing.join('\n  '));
});
