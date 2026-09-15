// 点了要有反应，被拦了要说话 —— 两种「静悄悄」都算 bug。
//
// 2026-09-15 Codex 逐页清点报的两条，都属于这一类：
//
// ① 顾问依次敲 #/finance、#/intel、#/strategy、#/ai-center，
//    每次都静悄悄回到工作台，屏幕上一个字都没有。
//    拦是对的（权限没漏），但人判断不了是地址打错了、页面没了、
//    还是自己没权限 —— 三种情况对应三种完全不同的下一步。
//
// ② 全局搜索输入「浙江嘉力」，下拉里写着「客户管理 1 · 合同管理 1 ·
//    项目管理 1」，点「搜索」或按回车**界面零变化**。
//    真因：命中多个模块时 handleGlobalSearchSubmit 直接
//        setIsGlobalResultPanelOpen(true); return;
//    而面板在输入框获得焦点时就已经打开了 —— 把一个 true 再设一次 true。
//    更能说明问题的是按钮自己的 tooltip 写着「优先跳转：客户管理」：
//    **按钮承诺了跳转，代码却在这一支提前 return。**
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

test('路由守卫拦人时必须带上原因，不许静悄悄跳回工作台', () => {
  const src = stripComments(read('components/ProtectedRoute.tsx'));
  assert.ok(!/<Navigate to="\/dashboard" replace \/>/.test(src),
    '又变回静悄悄的 Navigate 了 —— 人不知道自己是没权限还是页面没了');
  assert.match(src, /state=\{\{\s*accessDenied/,
    '跳转时没有把「被拦的是哪一页、为什么」带过去');
  assert.match(src, /reason/, '没有给出原因文案');
});

test('落地页要把被拦的原因显示出来，而且只显示一次', () => {
  const src = stripComments(read('components/Layout.tsx'));
  assert.match(src, /accessDenied/, 'Layout 没有读被拦的原因，那守卫传过去等于没传');
  assert.match(src, /role="alert"[\s\S]{0,400}accessDenied\.path/,
    '没有把「打不开哪一页」显示出来');
  // 显示完要清掉 state，否则刷新又弹一次，人会以为再次被拦
  assert.match(src, /state: null/,
    '显示后没有清掉 location.state —— 刷新会再弹一次');
});

test('全局搜索：命中多个模块时也必须跳转，不许原地不动', () => {
  /*
    守的是「按钮要兑现自己 tooltip 的承诺」。
    早退那一支恢复回来的话，点搜索就又是零反应了。
  */
  const src = stripComments(read('components/Layout.tsx'));
  const fn = src.slice(src.indexOf('const handleGlobalSearchSubmit'), src.indexOf('const handleOpenScopeResult'));
  assert.ok(fn.length > 100, '没截到 handleGlobalSearchSubmit');
  assert.ok(!/groupedHitScopes\.length > 1[\s\S]{0,120}return;/.test(fn),
    '命中多个模块时又提前 return 了 —— 面板本来就是开着的，点搜索会零反应');
  assert.match(fn, /navigate\(/, '搜索提交没有跳转');
  assert.match(fn, /resolveGlobalSearchTarget/, '没有解析要跳去哪个模块');
});

test('底部悬浮按钮不许压住页面最后一行内容', () => {
  /*
    右下角 AI 助手是固定定位。手机上它正好盖住线索页最后一个筛选标签，
    人看不见也点不到 —— 而且完全不报错。
  */
  const src = stripComments(read('components/Layout.tsx'));
  const main = src.slice(src.indexOf('<main data-onboard="workspace-content"'));
  assert.match(main.slice(0, 260), /pb-\d+/,
    'main 没有底部留白 —— 悬浮按钮会压住手机上的最后一行内容');
});

test('手机宽度下标题区不许和操作按钮抢宽度', () => {
  /*
    合同页原来是 `flex justify-between items-center`，没有任何断点。
    375px 下右边两个按钮占掉大半，「合同管理」四个字断成多行。
  */
  const src = stripComments(read('pages/Contracts.tsx'));
  assert.ok(!/<div className="mb-6 flex justify-between items-center">/.test(src),
    '合同页标题区又变回没有断点的 flex justify-between —— 375px 下标题会被挤成竖排');
  assert.match(src, /flex flex-col gap-3 sm:flex-row/,
    '合同页标题区没有在窄屏下换成竖排');
});

test('线索页状态筛选不许藏在看不见的横向滚动里', () => {
  const src = stripComments(read('pages/Leads.tsx'));
  assert.ok(!/flex space-x-2 w-full md:w-auto overflow-x-auto no-scrollbar/.test(src),
    '又改回 overflow-x-auto + no-scrollbar 了 —— 能滚但看不出能滚，最后一个标签会被切掉');
  assert.match(src, /flex flex-wrap gap-2 w-full md:w-auto md:flex-nowrap/,
    '状态筛选没有在窄屏下换行');
});
