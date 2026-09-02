// AI 对话框的动作权限。
//
// ── 这批用例守的是什么 ────────────────────────────────────────
// AI 对话框是一条**绕过界面的通道**。界面上顾问看不到「确认回款」按钮，
// 但他可以对 AI 说「确认某某合同的钱到账了」。
//
// 2026-08-31 查出来：11 个动作里只有 2 个（建客户、建合同）做了权限校验，
// 剩下 9 个直接执行——其中 confirm_receivable 是**不可撤销的财务动作**。
// 而服务端当时是 observe 模式（判定 + 记账，一律放行），兜不住。
//
// 权限做在界面上是不够的：只要还有第二条能触发同一个动作的路，
// 那条路上就得有同一道闸。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const load = () => {
  const src = read('src/modules/ai_center/actionPermissions.ts')
    .replace(/^import .*$/gm, '');   // 只要运行时逻辑，类型导入去掉
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
};

/** 只放行列出的动作，其余一律拒绝——模拟某个角色 */
const allowOnly = (...allowed) => (action) =>
  allowed.includes(action) ? { allowed: true } : { allowed: false, reason: `缺少权限 ${action}` };

test('确认回款必须要 PAYMENT_CONFIRM —— 这是最要紧的一条', () => {
  /*
    确认到账在系统里做了就撤不回来，而且会触发项目付款状态、
    客户价值分级一连串级联。顾问在界面上碰不到这个按钮，
    通过 AI 也不能碰到。
  */
  const { AI_ACTION_PERMISSION, gateAiActions } = load();
  assert.equal(AI_ACTION_PERMISSION.confirm_receivable, 'PAYMENT_CONFIRM');

  const consultant = allowOnly('TASK_COMPLETE', 'CUSTOMER_EDIT', 'CONTRACT_CREATE');
  const r = gateAiActions({ confirm_receivable: { contractId: 'CT-1', receivableId: 'R-1' } }, consultant);
  assert.equal(r.allowed, false, '顾问通过 AI 确认回款没有被拦住');
  assert.equal(r.denied[0].label, '确认回款到账');
});

test('提示词里列出的每个动作，映射表里都必须有', () => {
  /*
    **这条是防漏的关键。**
    加一个新动作时，作者只会去改提示词（不改就没人会用），
    但很容易忘了在映射表里加一行——而漏掉的那个动作是**无人看守**的。
    所以这里直接拿提示词当真相来源，两边对不上就红。
  */
  const { AI_ACTION_PERMISSION } = load();
  const widget = read('components/AIChatWidget.tsx');
  const promptStart = widget.indexOf('支持的动作键');
  assert.ok(promptStart > 0, '提示词里的动作清单找不到了，这条用例失效');
  const promptBlock = widget.slice(promptStart, widget.indexOf('金额单位一律为元'));

  // 提示词里的格式是「   - key: {...}  说明」
  const declared = [...promptBlock.matchAll(/^\s*-\s*([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 10, `只解析出 ${declared.length} 个动作，提示词格式可能变了`);

  const missing = declared.filter((k) => !AI_ACTION_PERMISSION[k]);
  assert.deepEqual(missing, [],
    `这些动作在提示词里能用，但映射表里没有 → 它们是无人看守的：${missing.join('、')}`);
});

test('有一个动作不许，整批都不执行', () => {
  /*
    不做「能做的先做、不能做的跳过」。
    「建合同 + 确认回款」里合同建了、回款没确认，
    用户以为整件事办完了，实际账目是错的——
    这种半成品比直接失败更难发现。
  */
  const { gateAiActions } = load();
  const sales = allowOnly('CONTRACT_CREATE', 'CUSTOMER_CREATE', 'LEAD_CREATE');
  const r = gateAiActions({
    contract: { title: 'X', amount: 10000 },
    confirm_receivable: { contractId: 'CT-1' },
  }, sales);
  assert.equal(r.allowed, false, '整批没有被拦下');
  assert.equal(r.denied.length, 1);
  assert.equal(r.denied[0].key, 'confirm_receivable');
});

test('老板什么都能做', () => {
  const { AI_ACTION_PERMISSION, gateAiActions } = load();
  const admin = () => ({ allowed: true });
  const everything = Object.fromEntries(Object.keys(AI_ACTION_PERMISSION).map((k) => [k, {}]));
  assert.equal(gateAiActions(everything, admin).allowed, true);
});

test('自我诊断用 SYSTEM_DIAGNOSE，不是 PROJECT_AI_DIAGNOSE', () => {
  /*
    ① 提示词是**请求**，不是边界。原来只在提示词里写「仅管理员」——
       模型可以不照做，用户也可以直接构造带动作块的输入。

    ② 第一版补校验时映射错了：用了 PROJECT_AI_DIAGNOSE。
       那个是「诊断某个项目的交付风险」（业务动作，总助也有），
       而 AI 的 diagnose 是「检查整套系统并自动修复配置」（运维动作）。
       后果：前端放行总助，服务端 /api/admin/diagnose 只认 ADMIN，
       **总助撞上一个看起来像 bug 的 403**。
  */
  const { AI_ACTION_PERMISSION, gateAiActions } = load();
  assert.equal(AI_ACTION_PERMISSION.diagnose, 'SYSTEM_DIAGNOSE');

  const consultant = allowOnly('TASK_COMPLETE');
  assert.equal(gateAiActions({ diagnose: { autoFix: true } }, consultant).allowed, false);

  // 总助有 PROJECT_AI_DIAGNOSE 但没有 SYSTEM_DIAGNOSE——必须也被挡住，
  // 否则前端放行、服务端拒绝，两边又对不上
  const manager = allowOnly('PROJECT_AI_DIAGNOSE', 'PROJECT_CREATE', 'PROJECT_EDIT_INFO');
  assert.equal(gateAiActions({ diagnose: {} }, manager).allowed, false,
    '总助被前端放行了，但服务端只认 ADMIN——他会撞上一个像 bug 的 403');
});

test('SYSTEM_DIAGNOSE 只给老板和系统管理员，和服务端对齐', () => {
  // 服务端是 requireSessionRoles(['ADMIN'])，权限矩阵不能比它宽
  const caps = read('constants.ts').match(/export const ROLE_CAPABILITIES[^=]*=\s*\{([\s\S]*?)\n\};/)[1];
  const holders = [...caps.matchAll(/(\w+):\s*\{\s*actions:\s*\[([\s\S]*?)\]/g)]
    .filter(m => /'SYSTEM_DIAGNOSE'/.test(m[2])).map(m => m[1]);
  assert.deepEqual(holders.sort(), ['ADMIN', 'SYS_ADMIN'],
    `SYSTEM_DIAGNOSE 给到了 ${holders.join('、')}，比服务端宽`);
});

test('不认识的键不拦，也不算受管动作', () => {
  // 比如 create_project 这种附带标志位，不该被当成动作拦下来
  const { gateAiActions } = load();
  const r = gateAiActions({ create_project: true, 随便什么: 1 }, () => ({ allowed: false }));
  assert.equal(r.allowed, true);
});

test('对话框真的接了这道闸，不是白写一个模块', () => {
  /*
    模块写好没接线等于没做——知识检索模块就这么断了三个月，
    AI 一直在用无关文档回答，没有任何报错。
  */
  const src = stripComments(read('components/AIChatWidget.tsx'));
  assert.match(src, /gateAiActions\(actionData,\s*checkActionPermission\)/, '动作总闸没有被调用');

  // 必须在任何一个动作执行**之前**
  const gateAt = src.indexOf('gateAiActions(actionData');
  const firstAction = src.indexOf('actionData.customer');
  assert.ok(gateAt > 0 && firstAction > 0, '找不到闸或第一个动作');
  assert.ok(gateAt < firstAction, '总闸在动作执行之后才判定，那时已经写进去了');
});

test('提示词要告诉模型这个人能做什么、不能做什么', () => {
  /*
    不说的话，顾问问「帮我确认回款」，AI 会热情地照做、然后被拦下，
    用户看到的是「系统坏了」。提前说清楚，AI 会直接回「这件事要找总经理」。

    2026-08-31 这段从「只列不能做的」升级成了完整身份段
    （见 src/modules/ai_center/identityContext.ts）：
    只列「不能做」的话，AI 不知道自己还能干嘛，会过度保守。

    这不是安全措施——拦截在 gateAiActions 和服务端，这里只是体验。
  */
  const src = stripComments(read('components/AIChatWidget.tsx'));
  assert.match(src, /buildIdentityContext\(/, '没有构建身份段');
  assert.match(src, /\$\{identityContext\}/, '构建了但没拼进提示词');

  const id = read('src/modules/ai_center/identityContext.ts');
  assert.match(id, /他可以让你做/, '身份段里没列出能做的动作');
  assert.match(id, /不能.{0,4}让你做/, '身份段里没列出不能做的动作');
});

test('退出登录要清掉 AI 对话历史', () => {
  /*
    对话历史在 localStorage 里，**reload 清不掉**——
    重载、关标签页、关浏览器都活着。

    老板问完提成和报价的事退出，顾问在同一台办公室电脑登录、
    打开 AI 对话框，老板那整段对话原样还在。
    服务端鉴权对这个完全无能为力：那些字早就在这台机器上了。
  */
  const src = stripComments(read('components/Layout.tsx'));
  const fn = src.slice(src.indexOf('const handleLogout'), src.indexOf('const [globalQuery'));
  assert.match(fn, /dataService\.remove\('chat_history'\)/, '退出时没有清 AI 对话历史');
});
