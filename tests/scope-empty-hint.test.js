// 有「与我相关 / 全公司」的页面，筛空了必须说明白。
//
// ── 为什么（2026-09-18）────────────────────────────────────────
//
// 「与我相关」是默认值，而**默认值最容易把人骗了**：
// 总助、总经理多半不亲自当归属人，一进来就是空的 ——
// 空白页不会告诉他「不是没有，是你在看自己那一档」。
//
// 这次是我自己在验收时栽的：总助刚归档完一份合同，去「已归档」里找，
// **找不到** —— 范围默认「与我相关」，而她不是那份合同的归属人。
// 我第一反应是"归档把合同弄丢了"，查了三轮才发现是范围。
// 我都会被骗，同事更会。
//
// 项目管理 2026-09-15 已经为同一个失败模式加过一行提示（带「看全公司」按钮），
// 合同管理漏了 —— 又一次「改一处漏一处」。
//
// 这条测试盯的是**形状**：凡是有范围切换的页面，都必须有这一行。
// 以后再加一个带范围切换的页面而忘了，它会红。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const 抹白注释 = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

const 业务页 = () => fs.readdirSync(path.join(root, 'pages'))
  .filter(f => f.endsWith('.tsx'))
  .map(f => ({ name: f.replace('.tsx', ''), src: fs.readFileSync(path.join(root, 'pages', f), 'utf8') }));

test('有范围切换的页面，筛空了必须告诉人"不是没有，是你在看自己那一档"', () => {
  const 缺提示 = [];
  for (const { name, src } of 业务页()) {
    const code = 抹白注释(src);
    /*
      判据：**同时**出现「与我相关」和「全公司」两个选项，才算有范围切换。
      只出现一个词的（比如文案里提了一句）不算 —— 否则会误伤。
    */
    const 有范围 = /['"`>]与我相关/.test(code) && /['"`>]全公司/.test(code);
    if (!有范围) continue;
    const 有提示 = /你名下没有[^，]*，全公司还有/.test(code);
    if (!有提示) 缺提示.push(name);
  }
  assert.deepEqual(缺提示, [],
    '这些页面有「与我相关 / 全公司」切换，但筛空时不说明原因：\n  ' + 缺提示.join('、')
    + '\n\n空白页会让人以为"东西没了"。照 pages/Projects.tsx 的做法加一行：'
    + '只在「我的是 0、公司的不是 0」时出现，并直接给「看全公司」按钮。');
});

test('那一行只在真的筛空时出现，不能常驻', () => {
  /*
    常驻的提示就是噪音，人两天就学会无视它 ——
    和「一个永远消不掉的红色数字」是同一条。
    所以条件必须包含「当前列表为空」和「全公司不为空」两个。
  */
  for (const [file, 列表变量] of [['pages/Projects.tsx', 'filteredProjects'], ['pages/Contracts.tsx', 'filteredContracts']]) {
    const code = 抹白注释(fs.readFileSync(path.join(root, file), 'utf8'));
    const re = new RegExp(`${列表变量}\\.length === 0 && \\w+ > 0`);
    assert.match(code, re,
      `${file} 的空态提示没有同时判「当前为空」和「全公司不为空」—— 会变成常驻噪音`);
  }
});
