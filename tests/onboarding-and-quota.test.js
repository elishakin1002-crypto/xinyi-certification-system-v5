// 新手引导 + 「我自己的 AI 额度」。
//
// 这两件事看起来无关，其实是同一条原则的两面：
// **让人知道自己在什么位置，而且不打扰他。**
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

// ── AI 配置中心收窄 ────────────────────────────────────────────

test('AI 配置中心只给总经理和系统管理员', () => {
  /*
    2026-09-04 之前每个角色都有 NAV_AI_CENTER，顾问、销售、财务都能打开。
    里面是模型选择、成本上限、提示词这类设置 ——
    改错一个值影响全公司，而顾问既没有判断依据也不该承担这个责任。
  */
  const src = read('constants.ts');
  const block = src.slice(src.indexOf('export const ROLE_PERMISSIONS'),
                          src.indexOf('export const INTEL_REGIONS'));
  const roleLine = (r) => block.match(new RegExp(`\\n\\s*${r}: \\[([^\\]]*)\\]`))?.[1] || '';

  for (const r of ['ADMIN', 'SYS_ADMIN']) {
    assert.ok(roleLine(r).includes('NAV_AI_CENTER'), `${r} 应该保留 AI 配置中心`);
  }
  for (const r of ['MANAGER', 'SALES', 'CONSULTANT', 'FINANCE']) {
    assert.ok(!roleLine(r).includes('NAV_AI_CENTER'),
      `${r} 不该能进 AI 配置中心 —— 改错一个值影响全公司`);
  }
});

test('但每个人都能看到自己的用量', () => {
  /*
    「不给配置权」不等于「不让人知道自己用了多少」。
    一个人不知道还剩多少，只有两种结局：
    怕超额而不敢用（系统就白做了），或者撞上限时以为系统坏了。
  */
  const app = read('server/app.js');
  assert.match(app, /app\.get\('\/api\/ai\/my-usage'/, '没有查自己用量的接口');
  /*
    只返回自己的。谁用得多是管理话题，不该让同事之间互相看见 ——
    那会变成无形的比较压力，而用得多用得少本来就和绩效无关。
  */
  const block = app.slice(app.indexOf("app.get('/api/ai/my-usage'"),
                          app.indexOf("app.get('/api/ai/my-usage'") + 1200);
  assert.doesNotMatch(block, /byUser|actor_name/,
    'my-usage 返回了别人的用量');
});

test('额度显示平时不出声，快满了才出现', () => {
  /*
    额度定得很宽（顾问一天 30 万 tokens，约正常用量的 7 倍），
    正常干活根本碰不到。天天把「你已用 2%」摆在眼前，
    只会让人觉得自己在被计量、被考核，反而不敢用。
  */
  const src = read('components/MyAiUsage.tsx');
  assert.match(src, /const SHOW_FROM_PCT = 70/, '没有设置显示阈值');
  assert.match(src, /usage\.pct < SHOW_FROM_PCT\) return null/,
    '低用量时没有隐藏 —— 会变成天天提醒');
  assert.match(src, /usage\.unlimited/,
    '不限量的账号（总经理/系统管理员）不该显示进度条');
  assert.match(src, /明天零点/,
    '没说清撞上限之后会怎样 —— 不确定比数字本身更让人不敢用');
});

// ── 新手引导 ───────────────────────────────────────────────────

test('引导按角色分，不是一套通用的', () => {
  /*
    通用引导会把所有功能过一遍，而顾问用不到财务、财务不管交付。
    看一堆无关的东西，结果是该记住的那三步反而没记住。
  */
  const src = read('src/modules/onboarding/steps.ts');
  for (const r of ['CONSULTANT', 'FINANCE', 'MANAGER', 'ADMIN', 'SALES']) {
    assert.match(src, new RegExp(`\\n  ${r}: \\{`), `${r} 没有自己的引导`);
  }
});

test('每个引导都短 —— 超过五步等于没看', () => {
  /*
    引导的目的不是教会全部功能，是让人今天能把活干完。
    十步以上的引导，人会从第四步开始一路点「下一步」。
  */
  const src = read('src/modules/onboarding/steps.ts');
  const roles = src.split(/\n  (?=[A-Z_]+: \{\n\s+version)/).slice(1);
  assert.ok(roles.length >= 4, '解析引导块失败，测试要跟着结构改');
  roles.forEach((block) => {
    const steps = (block.match(/\n      \{\n\s+route:|\n      \{\n\s+target:|COMMON_END|FEEDBACK_END/g) || []).length;
    assert.ok(steps <= 6, `某个角色的引导有 ${steps} 步，太长了`);
  });
});

test('跳过键要显眼，不能藏', () => {
  /*
    强制看完的引导只会让人乱点，什么都没记住。
    藏跳过键换来的「完成率」是假的。
  */
  const src = read('components/OnboardingTour.tsx');
  assert.match(src, /跳过/, '没有跳过入口');
  assert.match(src, /onClick=\{finish\}[\s\S]{0,200}跳过/,
    '跳过键没有接上关闭动作');
});

test('能重看，而且入口找得到', () => {
  /*
    第一次登录时人最想做的是「赶紧看看这东西长什么样」，引导反而是干扰。
    等他用了两天遇到问题，才是真正想看引导的时候 ——
    那时候找不到入口，这个功能就白做了。
  */
  const layout = read('components/Layout.tsx');
  assert.match(layout, /重看新手引导/, '账号菜单里没有重看入口');
  assert.match(layout, /forceOpen=\{replayTour\}/, '重看没有接上强制打开');
});

test('看过就不再自动弹，但内容更新后会再弹一次', () => {
  /*
    每次登录都弹一遍，第三次就变成骚扰。
    但用布尔值记的话，引导内容改了也没人会知道 —— 所以比版本号。
  */
  const src = read('components/OnboardingTour.tsx');
  assert.match(src, /if \(seen < tour\.version\) setOpen\(true\)/,
    '没有按版本号判断，改了内容老用户看不到');
  assert.match(src, /dataService\.set\(seenKey\(currentUser\.id\), tour\.version\)/,
    '看完没有记下版本号');
});

test('系统管理员也有引导，但讲的是系统不是业务', () => {
  /*
    最初这里断言的是「SYS_ADMIN 不该有引导」—— 想法是他不需要学怎么录线索。
    结果是账号菜单里的「重看新手引导」**点了毫无反应**：
    getTour 返回 null，组件直接 return null，连个提示都没有。

    一个点了没反应的菜单项，比没有这个菜单项更糟 ——
    人会以为系统坏了。所以给他一份讲系统管理的引导。
  */
  const src = read('src/modules/onboarding/steps.ts');
  const block = src.slice(src.indexOf('export const TOURS'), src.indexOf('export const getTour'));
  assert.match(block, /\n  SYS_ADMIN: \{/, '系统管理员没有引导，重看按钮会点了没反应');

  const sys = block.slice(block.indexOf('\n  SYS_ADMIN: {'));
  const body = sys.slice(0, sys.indexOf('\n  },\n  ') + 5);
  assert.doesNotMatch(body, /录线索|跟进客户|报价/, '系统管理员的引导不该讲业务流程');

  // 多角色的人（我自己既是 ADMIN 又是 SYS_ADMIN）优先看系统管理那份
  const order = src.slice(src.indexOf('export const getTour'));
  assert.match(order, /\['SYS_ADMIN'/, 'SYS_ADMIN 应该排在角色优先级第一位');
});

// ── 删除账号 ───────────────────────────────────────────────────

test('能删错误，不能删历史', () => {
  /*
    建错的测试账号会永远躺在名单里，每次看名单都要多花一秒确认「这是干嘛的」。
    但删掉有活动记录的账号，business_events 里「是谁做的」就成了孤儿 ——
    而追加式账本存在的全部意义就是事后查得出谁做的。
  */
  const store = read('server/authStore.js');
  assert.match(store, /const deleteUserIfUnused = async/, '没有删除账号的方法');

  const fn = store.slice(store.indexOf('const deleteUserIfUnused'),
                          store.indexOf('module.exports'));
  for (const t of ['business_events', 'contracts', 'projects', 'ai_usage_log']) {
    assert.ok(fn.includes(t), `删除前没检查 ${t} —— 会删出孤儿记录`);
  }
  assert.match(fn, /停用/, '拒绝时没告诉人该改用停用');
});

test('删除接口要鉴权，而且不能删自己', () => {
  const app = read('server/app.js');
  assert.match(app, /app\.delete\('\/api\/auth\/users\/:id'/, '没有删除接口');

  const route = app.slice(app.indexOf("app.delete('/api/auth/users/:id'"),
                          app.indexOf("app.delete('/api/auth/users/:id'") + 1400);
  assert.match(route, /requireAuthActionSession\('EMPLOYEE_DISABLE'\)/,
    '删除接口没鉴权 —— 任何人都能删账号');
  assert.match(route, /不能删除自己的账号/,
    '删自己会当场登不进来，而且几乎总是误操作');
  assert.match(route, /EMPLOYEE_DELETE/, '删除没写审计日志');
});

test('前端不预判能不能删，把服务端的理由原样显示', () => {
  /*
    能不能删的依据在服务端（有没有记录），前端拿不到。
    猜一个只会猜错，灰掉的按钮还不告诉人为什么灰。
  */
  const src = read('pages/Employees.tsx');
  assert.match(src, /setPendingDelete\(user\)/, '列表里没有删除按钮');
  assert.match(src, /user\.id !== currentUser\.id/, '自己那行也显示了删除键');
  assert.match(src, /err instanceof Error \? err\.message : '删除失败'/,
    '没把服务端的拒绝理由显示出来');
  assert.match(src, /pendingDelete && \(/, '删除没有确认步骤');
});
