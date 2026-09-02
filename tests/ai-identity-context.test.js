// AI 要知道在跟谁说话。
//
// ── 实测（2026-08-31）────────────────────────────────────────
// 老板问 AI「我是谁」，AI 答「我这边看不到你的身份信息，无法判断你是谁」。
//
// 权限那三道闸是知道的（checkActionPermission 用的就是登录用户），
// 但**对话本身是身份盲的**——提示词里一个字都没提。
//
// 后果不只是答不出这一句：谁问都是同一套话，
// 顾问问「这个客户为什么流失」时，AI 可能顺口说出成交价——
// 而顾问在界面上根本看不到那个数字。
//
// 落的是这条原则的后半句：
//   AI 能做的，不能超过让它做的那个人自己能做的（动作映射表，已落地）
//   **AI 能说的，不能超过那个人自己能看到的**（这批用例）
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * 连同它依赖的动作映射表一起编译。
 *
 * **不要剥掉 import**：剥了之后 TS 编译出来的模块里，
 * 对 AI_ACTION_PERMISSION 的引用就变成一个未定义的全局变量，
 * 报的是 ReferenceError——看起来像业务代码有问题，其实是加载器写错了。
 * 正确做法是让 TS 正常发出 require，再给它一个垫片。
 */
const load = () => {
  const compile = (rel) => ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const run = (js, req) => {
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
    return mod.exports;
  };

  // 类型导入在运行时是空的，给个空对象即可
  const ap = run(compile('src/modules/ai_center/actionPermissions.ts'), () => ({}));
  const id = run(compile('src/modules/ai_center/identityContext.ts'),
    (spec) => (String(spec).includes('actionPermissions') ? ap : {}));
  return { ...ap, ...id };
};

const allowAll = () => true;
const allowNone = () => false;

test('提示词里要写清用户是谁', () => {
  const { buildIdentityContext } = load();
  const ctx = buildIdentityContext({ name: '曾云俊', roles: ['ADMIN'] }, allowAll);
  assert.match(ctx, /曾云俊/, '没写姓名');
  assert.match(ctx, /老板（总经理）/, '没写角色的中文名——「ADMIN」对用户没有意义');
  assert.match(ctx, /我是谁/, '没交代被问到身份时该怎么答');
});

test('能做什么、不能做什么都要列出来', () => {
  /*
    只列「不能做」的话，AI 不知道自己还能干嘛，会过度保守；
    只列「能做」的话，被要求做不了的事时它会硬试，然后撞在权限闸上。
  */
  const { buildIdentityContext } = load();
  const ctx = buildIdentityContext({ name: '林元波', roles: ['CONSULTANT'] },
    (a) => ['TASK_COMPLETE', 'CUSTOMER_CREATE', 'PROJECT_EDIT_INFO'].includes(a));
  assert.match(ctx, /他可以让你做：/);
  assert.match(ctx, /不能.{0,4}让你做：/);
  assert.match(ctx, /确认回款到账/, '没有把「不能做」的动作点名出来');
  assert.match(ctx, /找总经理/, '没告诉 AI 被要求时该怎么回');
});

test('顾问的说话口径：不谈金额和提成', () => {
  /*
    **这条是原则后半句的核心。**
    顾问在界面上看不到合同金额，AI 要是顺口说出来，
    权限设计就被绕过去了——而且绕得神不知鬼不觉。
  */
  const { buildIdentityContext } = load();
  const ctx = buildIdentityContext({ name: '林元波', roles: ['CONSULTANT'] }, allowNone);
  assert.match(ctx, /不要讨论合同金额/);
  assert.match(ctx, /提成/);
  assert.match(ctx, /价格的事要问总经理/, '没给出被问到时的标准回答');
});

test('一人多角色时口径取并集，不是取最严', () => {
  /*
    销售兼顾问的人**本来就能看到自己谈的单子的金额**。
    按最严算的话，AI 比界面还紧，他会觉得系统在妨碍他——
    那种「安全」是假的，只会把人赶去用微信。
  */
  const { buildIdentityContext } = load();
  const ctx = buildIdentityContext({ name: '某某', roles: ['SALES', 'CONSULTANT'] }, allowAll);
  assert.match(ctx, /可以谈他自己经手的合同金额/, '销售那条口径丢了');
});

test('没登录时如实说不知道，不猜', () => {
  const { buildIdentityContext } = load();
  const ctx = buildIdentityContext(null, allowNone);
  assert.match(ctx, /未登录|身份未知/);
  assert.match(ctx, /不要猜测/);
  assert.match(ctx, /不要执行任何写操作/, '身份不明时还允许写操作');
});

test('对话框真的把身份段拼进了提示词', () => {
  /*
    模块写好没接线等于没做。
    而且要确认拼进去的是**当前登录用户**，不是某个写死的值。
  */
  const src = stripComments(read('components/AIChatWidget.tsx'));
  assert.match(src, /buildIdentityContext\(/, '身份段没有被构建');
  assert.match(src, /\$\{identityContext\}/, '构建了但没拼进提示词');
  assert.match(src, /currentUser \? \{ name: currentUser\.name/, '没有用当前登录用户');
});

test('权限判断用的是界面同一份，不另起一套', () => {
  /*
    另起一套的话两边迟早对不上：
    AI 说「你可以录合同」，用户一试被拦——比不说更糟。
  */
  const src = stripComments(read('components/AIChatWidget.tsx'));
  assert.match(src, /\(action\) => checkActionPermission\(action\)\.allowed/,
    '身份段的权限判断没有复用 checkActionPermission');
});
