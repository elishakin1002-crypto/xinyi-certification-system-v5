// 数据没拿到时，兜底必须是空的，不许是虚构公司。
//
// 2026-09-17 Codex 数据交叉复核发现：
// 销售打开客户管理，看到「科诺华科技（深圳）有限公司 / 陈爱丽 /
// 累计合作金额 ¥50,000」—— 而库里只有浙江嘉力一个客户、一份 ¥18,000 合同。
// 换任何其它角色看同一页，显示的都是真实的嘉力。
// 这条假记录**没有「样例」标签**，进统计、能点开、和真客户混在一起。
//
// 真因：`dataService.get('customers_v8', MOCK_CUSTOMERS)` ——
// 第二个参数是"取不到时用什么"，于是取不到时就把 constants.ts 里的
// 演示公司当成真客户渲染出来。
//
// **销售会照着这条记录去联系一家不存在的公司。**
// 空白页只是没信息，假客户是错信息，后者坏得多。
//
// 项目本来有正规的样例机制（SampleList + 「样例 · 不是真实数据」），
// MOCK_* 这条路绕过了它。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

test('业务数据的初始值不许来自 MOCK_* —— 那是给样例用的，不是兜底', () => {
  const src = stripComments(fs.readFileSync(path.join(root, 'context/AppContext.tsx'), 'utf8'));
  const 违规 = [];
  src.split('\n').forEach((line, i) => {
    // dataService.get('xxx', MOCK_YYY) —— 第二个参数就是"取不到时用什么"
    if (/dataService\.get[^)]*,\s*MOCK_[A-Z_]+/.test(line)) {
      违规.push(`context/AppContext.tsx:${i + 1}  ${line.trim().slice(0, 100)}`);
    }
  });
  assert.deepEqual(违规, [],
    '这些地方拿 MOCK_* 当"数据取不到时"的兜底，会把虚构公司当成真客户渲染出来：\n  '
    + 违规.join('\n  ')
    + '\n\n要展示示例，走 src/modules/onboarding/sampleRecords.ts + SampleList，'
    + '那条路会明写「样例 · 不是真实数据」。');
});

test('真要展示的示例必须自带「样例」标识', () => {
  /*
    只堵兜底不够：万一有人换个写法把 MOCK_* 塞进列表，
    照样是无标签的假数据。所以再盯一条 ——
    示例记录的 id 必须以 sample- 开头，页面靠它区分。
  */
  const samples = fs.readFileSync(path.join(root, 'src/modules/onboarding/sampleRecords.ts'), 'utf8');
  const ids = [...samples.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(ids.length >= 5, '样例记录少得不正常，是不是被删了？');
  const 没前缀 = ids.filter(id => !id.startsWith('sample-'));
  assert.deepEqual(没前缀, [],
    '这些样例记录的 id 没有 sample- 前缀，页面就分不出它们是不是真数据：' + 没前缀.join('、'));
});
