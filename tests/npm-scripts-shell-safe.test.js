// npm 脚本不许依赖某一种 shell 的 glob 展开。
//
// ── 为什么（2026-09-18）────────────────────────────────────────
//
// CI 从 2026-09-04 起一直是红的，根因是一行：
//
//     "test": "node --test --test-concurrency=1 tests/**/*.test.js"
//
// **我本机是 zsh，`**` 默认展开；CI 跑的是 `bash -e`，默认不展开**
// （globstar 关着）。于是 node 收到一串没展开的字面量，
// 报 `Could not find '.../tests/**/*.test.js'` 然后退出码 1。
//
// 也就是说：CI 那八道闸门里，**「跑测试」这一道从来没真的跑过**。
// 而本机永远是绿的，所以没人怀疑。
//
// 修法是把 glob 用引号包住，交给 node 自己展开 —— 两种 shell 行为一致。
//
// 这条测试盯的是形状：**npm 脚本里出现未加引号的 `**` 就红**。
// 不然下一个人写 `lint src/**/*.ts` 会重蹈覆辙，而且同样只在 CI 上炸。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');

test('npm 脚本里的 ** 必须加引号 —— 否则只在 zsh 里能用，CI 的 bash 上不展开', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const 违规 = [];
  for (const [名, 命令] of Object.entries(pkg.scripts || {})) {
    /*
      找「没被引号包住的 **」。
      先把所有引号内的片段挖掉，剩下的部分里还有 ** 就是裸的。
    */
    const 去掉引号内容 = String(命令)
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''");
    if (去掉引号内容.includes('**')) 违规.push(`${名}: ${命令}`);
  }
  assert.deepEqual(违规, [],
    '这些 npm 脚本用了没加引号的 `**`：\n  ' + 违规.join('\n  ')
    + '\n\n本机 zsh 会展开它，CI 的 bash 默认不会（globstar 关着）——'
    + '结果是本机绿、CI 红，而且报的错看不出是 shell 差异。'
    + '\n把 glob 用双引号包起来，让工具自己展开。');
});
