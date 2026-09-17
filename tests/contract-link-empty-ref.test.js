// 「没填」不许被当成一个可以匹配的值。
//
// 2026-09-17 实测（本机库，真浏览器）：
//   嘉力那张合同没填合同号（contractNo = NULL）。
//   新建 8 个不关联任何合同的项目（contractRef = NULL），负责人是验收顾问。
//   然后：
//     · 项目管理列表里，这 8 个项目的「客户」列全写着「浙江嘉力生物技术开发有限公司」
//     · 验收顾问打开合同管理「与我相关」，**嘉力那张合同出现在他的列表里**
//       —— 他跟这张合同毫无关系
//
// 真因是这一句到处都在写：
//     projects.find(p => p.contractRef === contract.id || p.contractRef === contract.contractNo)
// 两边都没填时 `NULL === NULL` 为真，合同就"认领"了一个不相干的项目；
// 而合同的归属（isMyContract）是拿关联项目的负责人算的，于是归属也跟着错。
//
// 生产上一定会遇到：一年 200~400 张合同，漏填一个合同号，
// 它就变成磁铁，把所有没关联合同的项目都吸过去。
//
// 当时 19 处同款写法里，6 处有人手工加了 `contract.contractNo &&` 守卫、8 处没有 ——
// 典型的「改一处漏一处」。所以这条测试盯两件事：
//   1. 口径本身：空引用永远不匹配
//   2. **没有人再手写这个比较** —— 只要有人写回去，第 2 条就红
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `contract-link-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/contractLink.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`
], { stdio: 'pipe' });
const { refMatchesContract, findContractByRef, findProjectByContract, contractRefKeys } = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch { /* 已经没了 */ } });

const 嘉力合同 = { id: 'CT-1789440937758', contractNo: null, customerName: '浙江嘉力生物技术开发有限公司' };
const 无关项目 = { id: 'P-UAT-H', contractRef: null, manager: '验收-咨询顾问' };
const 嘉力项目 = { id: 'P-1789440937759', contractRef: 'CT-1789440937758', manager: '黄佳佳' };

test('两边都没填，不许算匹配 —— 这就是把嘉力合同塞给无关顾问的那一步', () => {
  assert.equal(refMatchesContract(null, 嘉力合同), false);
  assert.equal(refMatchesContract(undefined, 嘉力合同), false);
  assert.equal(refMatchesContract('', 嘉力合同), false);
  assert.equal(refMatchesContract('   ', 嘉力合同), false, '导入的数据里真有全空格的');
});

test('合同没有任何可引用的键时，它不该认领任何项目', () => {
  const 无号无id合同 = { id: '', contractNo: '' };
  assert.equal(contractRefKeys(无号无id合同).length, 0);
  assert.equal(findProjectByContract([无关项目, 嘉力项目], 无号无id合同), undefined);
});

test('没填合同号的合同，只认真正引用它 id 的那个项目', () => {
  // 无关项目排在前面：靠数组顺序侥幸躲过去不算修好
  const 找到 = findProjectByContract([无关项目, 嘉力项目], 嘉力合同);
  assert.equal(找到?.id, 'P-1789440937759', '认错了项目，合同归属和「已立项」就全错');
});

test('正常匹配还要照常工作 —— 只堵空值，不许顺手堵死真关联', () => {
  assert.equal(refMatchesContract('CT-1789440937758', 嘉力合同), true);
  assert.equal(refMatchesContract('XY-2025-001', { id: 'CT-9', contractNo: 'XY-2025-001' }), true);
  assert.equal(refMatchesContract(' XY-2025-001 ', { id: 'CT-9', contractNo: 'XY-2025-001' }), true,
    '两边都 trim，前后空格不该让真关联失效');
  assert.equal(findContractByRef([嘉力合同], 'CT-1789440937758')?.id, 'CT-1789440937758');
  assert.equal(findContractByRef([嘉力合同], null), undefined);
});

test('不许再有人手写 `=== contract.contractNo` 这类比较', () => {
  /*
    盯形状不盯写法。
    这个 bug 之所以能活这么久，是因为它被手工修过 6 处、漏了 8 处——
    只要还允许手写，第 9 处早晚会出现，而且照样不报错。
  */
  const 要查的文件 = [
    'pages/Projects.tsx', 'pages/Contracts.tsx', 'pages/Audit.tsx',
    'pages/Customers.tsx', 'context/AppContext.tsx'
  ];
  const 手写比较 = /===\s*(?:\w+\.)?contractNo\b|contractNo\s*===/;
  const 违规 = [];
  /*
    注释要「抹白」不能「删掉」。
    第一版直接删，行号全体上移，报出来的位置指向不相干的代码——
    人照着去看，看到的是一行没问题的代码，只会怀疑测试坏了。
    证据指错地方的测试比没有测试更糟。
  */
  const 抹白注释 = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  for (const rel of 要查的文件) {
    const src = 抹白注释(fs.readFileSync(path.join(root, rel), 'utf8'));
    src.split('\n').forEach((line, i) => {
      if (手写比较.test(line)) 违规.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(违规, [],
    '这些地方在手写合同引用比较，空值会互相匹配 —— 改用 src/modules/contractLink.ts');
});
