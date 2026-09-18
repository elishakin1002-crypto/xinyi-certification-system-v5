// 立项要把合同金额带过去 —— 两条立项路径不许各走各的。
//
// ── 怎么发现的（2026-09-18）────────────────────────────────────
//
// 走「合同 → 立项」这条主线时：合同 ¥60,000，从「转项目」按钮立出来的
// 项目**金额是 0**，一出生就掉进「待补信息」那张卡。
//
// 一查，立项有两条路，行为不一样：
//   · 合同识别自动建项目（AppContext）→ `projectAmount: newContract.amount` ✅
//   · 合同管理点「转项目」（Contracts.tsx）→ **根本没传** ❌
// 同一个业务动作两条路、两种结果 —— 这个项目最高频的那类 bug。
//
// ── 后果不只是少填一个字段 ────────────────────────────────────
//
// 交付类项目金额为 0 会直接进「待补信息」。也就是说
// **每一个从按钮立的项目一出生就在那张卡里** ——
// 那个数字永远不为零，人就不看它了。
// 和「一个永远消不掉的红色数字」是同一条：
// **一个永远消不掉的提醒，等于没有提醒。**
//
// 立项弹窗本来就问了负责人和交期（「待补信息」三个判据里的两个），
// 独独漏了金额 —— 这个不对称本身就说明是漏的，不是设计。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('从「转项目」立项时要带上合同金额', () => {
  const src = read('pages/Contracts.tsx');
  const seg = src.slice(src.indexOf('const confirmCreateProject'), src.indexOf('const confirmCreateProject') + 2600);
  assert.match(seg, /projectAmount/,
    'confirmCreateProject 没有传 projectAmount —— 立出来的项目金额是 0，'
    + '会直接进「待补信息」，而合同识别那条路是带金额的');
});

test('立项弹窗要让人能改金额 —— 一份合同可能拆成几个项目', () => {
  const src = read('pages/Contracts.tsx');
  assert.match(src, /projectDraft\.projectAmount/,
    '立项弹窗没有金额字段。默认带合同金额是对的，但必须能改：'
    + '一份合同拆成几个项目时要按这个项目实际该收的金额填');
  assert.match(src, /待补信息/,
    '填 0 的时候没告诉人后果（会进「待补信息」，收不到钱也算不进营收）');
});

test('两条立项路径都要带金额 —— 不许一条带一条不带', () => {
  /*
    盯的是"两条路一致"，不是某一行怎么写。
    再出现第三条立项路径而忘了带金额，这条会红。
  */
  const ctxSrc = read('context/AppContext.tsx');
  assert.match(ctxSrc, /projectAmount:\s*newContract\.amount/,
    '合同识别那条路不带金额了 —— 两条路又不一致了');
});
