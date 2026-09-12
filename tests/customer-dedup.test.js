// 客户查重。2026-09-12 金恩来：「客户管理中有 3 个『测试1』……
// 我记得之前是有做过去重的功能的，不知道为什么改着改着就没有了！」
//
// 他没记错，但比「没了」更难缠：**去重从来只做了一半。**
//   · 建项目弹窗里查了（而且是 `c.name === name` 这种严格相等）
//   · 客户管理页一次都没查过
//   · 服务端不查，数据库也没唯一索引
// 同一个动作走两个门结果不一样 —— 他正是这么撞上的。
//
// 这份测试盯两件事：① 判断规则本身对不对 ② 规则有没有留在唯一的收口处。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.runtime/customerIdentity.test.cjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/customerIdentity.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
], { stdio: 'pipe' });
const { normalizeCompanyName, findDuplicateByName } = require(out);

const C = (id, name) => ({ id, name });

test('同一家公司的几种打法要认成同一家', () => {
  /*
    客户名是人手打的。同一家公司在两个人手里能打出好几种样子，
    而它们在业务上就是同一家 —— 认不出来就会劈成两条客户档案，
    合同、项目、回款各挂一半，以后查「这家做过什么」两边都只看到一半。
  */
  const list = [C('C1', '温州天越包装有限公司')];
  for (const v of [
    '温州天越包装有限公司 ',      // 尾随空格
    ' 温州天越包装有限公司',      // 前导空格
    '温州 天越 包装有限公司',     // 中间空格
    '温州天越包装有限公司',        // 原样
  ]) {
    assert.ok(findDuplicateByName(v, list), `「${v}」没被认成已有客户`);
  }
});

test('全角半角要归一 —— 「测试１」和「测试1」是同一个', () => {
  /*
    中文输入法下数字和括号很容易打成全角，而人眼看不出区别。
    他截图里那三个「测试1」就长得一模一样。
  */
  assert.equal(normalizeCompanyName('测试１'), normalizeCompanyName('测试1'));
  assert.equal(normalizeCompanyName('优福包装科技（浙江）有限公司'),
               normalizeCompanyName('优福包装科技(浙江)有限公司'));
  assert.ok(findDuplicateByName('测试１', [C('C1', '测试1')]));
});

test('真的不同名就不许认成同一家', () => {
  /*
    反方向更危险：并过头会把两家真实客户合成一条，
    那是**丢数据**，比多一条重复记录严重得多。
  */
  const list = [C('C1', '测试1')];
  assert.equal(findDuplicateByName('测试2', list), null);
  assert.equal(findDuplicateByName('测试11', list), null);
  assert.equal(findDuplicateByName('温州测试1', list), null);
});

test('空名字不算重复 —— 否则两条空记录会互相匹配', () => {
  assert.equal(findDuplicateByName('', [C('C1', '')]), null);
  assert.equal(findDuplicateByName('   ', [C('C1', '测试1')]), null);
});

test('改现有客户时要排除它自己', () => {
  /*
    不排除的话，打开「测试1」点保存，系统会说「和『测试1』重名」——
    和自己重名，人完全看不懂。
  */
  const list = [C('C1', '测试1'), C('C2', '测试2')];
  assert.equal(findDuplicateByName('测试1', list, 'C1'), null);
  assert.ok(findDuplicateByName('测试1', list, 'C2'), '别人重名还是要拦');
});

test('查重必须在 addCustomer 里，不能只写在某个页面上', () => {
  /*
    这条才是防重犯的那一条。

    上一版规则只写在建项目弹窗里，客户管理页没有 —— 于是同一个动作
    走两个门结果不一样。在第二个页面再补一遍，就是第三处、第四处。

    addCustomer 是三条入口（建项目弹窗 / 客户管理 / AI 助手）
    共同的收口，规则放那儿才不会再漏。
  */
  const ctx = fs.readFileSync(path.join(root, 'context/AppContext.tsx'), 'utf8');
  assert.match(ctx, /const addCustomer[\s\S]{0,800}?judgeDuplicate\(/,
    'addCustomer 里没有查重 —— 规则又散回页面上了');
  assert.match(ctx, /verdict\.kind === 'same'[\s\S]{0,200}?duplicated: true/,
    '发现重名后没有「不建、返回已有那家」');
});

test('页面不许自己再写一套查重规则', () => {
  /*
    一旦某个页面自己 `customers.find(c => c.name === ...)`，
    它就又是一份独立规则，会和收口处那份慢慢长歪。
    页面可以**读**规则（findDuplicateByName）来提示，但不能自造。
  */
  for (const f of ['pages/Projects.tsx', 'pages/Customers.tsx']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const homemade = /customers\s*\.find\(\s*c\s*=>\s*c\.name\s*===/.test(src);
    assert.equal(homemade, false, `${f} 里又自己写了一套按名字查重`);
  }
});

test('重名时必须告诉人 —— 静默复用会被当成功能坏了', () => {
  /*
    他这次的原话：「我还是用了『直接建新客户』，结果我去客户管理看，
    并没有新客户产生」。系统当时做的其实是对的（复用已有那家），
    **但它一个字都没说**，所以看起来就是坏了。
  */
  const proj = fs.readFileSync(path.join(root, 'pages/Projects.tsx'), 'utf8');
  assert.match(proj, /created\.duplicated/, '建项目弹窗没有区分「复用了已有客户」和「新建了」');
  const cust = fs.readFileSync(path.join(root, 'pages/Customers.tsx'), 'utf8');
  assert.match(cust, /judgeDuplicate\(/, '客户管理页保存前没有查重');
});

test('身份优先按统一社会信用代码判 —— 改了名也认得出是同一家', () => {
  /*
    2026-09-12 金恩来：「客户的名字规范应该怎么统一？同样名字的客户可以出现吗？」

    答案：身份是**法人主体**，不是那串字。公司会改名、会被简写、
    会打错字，而统一社会信用代码不会。
  */
  const { judgeDuplicate } = require(out);
  const list = [{ id: 'C1', name: '温州天越包装有限公司', unifiedSocialCreditCode: '91330300MA2ABCDE1X' }];

  // 改过名，代码没变 —— 还是同一家
  const v = judgeDuplicate({ name: '浙江天越新材料有限公司', unifiedSocialCreditCode: '91330300MA2ABCDE1X' }, list);
  assert.equal(v.kind, 'same');
  assert.equal(v.by, 'uscc', '代码相同时应该按代码判，不是按名字');
});

test('重名但代码不同 —— 真的是两家，要放行', () => {
  /*
    「温州XX包装厂」（个体户）和「温州XX包装有限公司」简写后可能撞车。
    这种情况系统分得清，就不该拦 —— 依据是工商代码，不是让人拍脑袋。

    这条是「默认拦死」的唯一例外，必须守住：
    拦过头会让真实存在的两家公司录不进来。
  */
  const { judgeDuplicate } = require(out);
  const list = [{ id: 'C1', name: '温州鸿达包装', unifiedSocialCreditCode: '91330300AAAAAAAA1X' }];
  const v = judgeDuplicate({ name: '温州鸿达包装', unifiedSocialCreditCode: '91330300BBBBBBBB2Y' }, list);
  assert.equal(v.kind, 'namesake', '两家代码不同的公司重名，应该放行');
});

test('只有一边填了代码，仍然按名字算同一家', () => {
  /*
    现实：生产库 11 家客户里只有 3 家填了代码。
    只要有一边没填，就没有「分得清」这个前提，只能按名字保守处理 ——
    **保守 = 认成同一家**，因为合并两条比劈成两半容易。
  */
  const { judgeDuplicate } = require(out);
  const list = [{ id: 'C1', name: '温州天越包装有限公司' }];
  assert.equal(judgeDuplicate({ name: '温州天越包装有限公司', unifiedSocialCreditCode: '91330300MA2ABCDE1X' }, list).kind, 'same');
});

test('客户管理页重名要拦死，不许再弹「确定还要新建吗」', () => {
  /*
    2026-09-12 第二次改。第一版我弹了个 confirm 让人自己决定，他当场问回来：
    「这些不是来想的就可以了吗？怎么还要我来想？」

    他说得对：一个人在录客户的那三秒钟里，没有信息也没有义务判断
    「这两条该不该合并」—— 那是数据模型的问题，该在这边定死。
  */
  const raw = fs.readFileSync(path.join(root, 'pages/Customers.tsx'), 'utf8');
  // 注释里要留着这段历史（为什么不再这么做），所以只看会跑到的代码
  const cust = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/确定还要新建吗/.test(cust), '又把「建不建重复客户」这个决定丢回给用户了');
  assert.match(cust, /verdict\.kind === 'same'/, '没有按判定结果拦下重复创建');
});
