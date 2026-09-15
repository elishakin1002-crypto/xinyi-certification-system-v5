// 写失败必须让人看见。
//
// 2026-09-07：金恩来用顾问账号新建项目 —— 填完表单、点了「确认立项」、
// 列表里也出现了，但服务端返回 403（顾问本来就没有建项目的权限）。
// 前端只在控制台打了一行 warn，**没回滚、没提示**，刷新之后项目消失。
//
// 这是最糟的一类 bug：人以为办成了，实际什么都没发生，
// 而且过一会儿东西还不见了 —— 他会以为系统把数据弄丢了。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('写失败一律回滚、一律弹出来', () => {
  const ctx = read('context/AppContext.tsx');
  assert.match(ctx, /const reportWriteFailure = React\.useCallback/, '没有统一的失败上报');

  /*
    原来的回滚挂在 shouldVerifyWrites 上，而它默认是关的 ——
    等于生产环境里所有写失败都是静默的。
  */
  const catches = ctx.split('.catch(error => {').slice(1);
  const silent = catches.filter((block) => {
    const body = block.slice(0, 400);
    return body.includes('console.warn') && !body.includes('reportWriteFailure');
  });
  assert.equal(silent.length, 0, `还有 ${silent.length} 处写失败只打日志不告诉人`);

  // 回滚不能再看那个默认关着的开关
  const rollbackGated = catches.filter((b) => b.slice(0, 300).includes('shouldVerifyWrites'));
  assert.equal(rollbackGated.length, 0, '回滚还挂在 shouldVerifyWrites 开关上');
});

test('失败提示要说人话，并且不会自己消失', () => {
  const ctx = read('context/AppContext.tsx');
  assert.match(ctx, /你的账号没有这个权限/, '403 没翻译成人能懂的话');
  assert.match(ctx, /登录已过期/, '401 没翻译');
  assert.match(ctx, /网络没连上/, '断网没翻译');

  const layout = read('components/Layout.tsx');
  assert.match(layout, /没有保存成功/, '界面上没有失败提示');
  assert.match(layout, /刚才那条已经撤回/, '没说清楚数据现在是什么状态 —— 人最怕存了一半');
  assert.match(layout, /dismissWriteFailure/, '提示关不掉');
});

test('点不动的按钮不该出现', () => {
  /*
    顾问没有 PROJECT_CREATE —— 项目由总助或总经理立项，顾问执行，
    这个分工本身是对的。错的是照样把按钮摆在那里，
    让他填完整张表才在后台被拒。
  */
  const src = read('pages/Projects.tsx');
  /*
    注意：**不能传 {}**。顾问的数据范围是「只能操作自己负责的」，
    权限函数看到有 context 就去查归属，空对象里没有归属信息 → 判定不是你的 → 拒绝。
    结果是整个「新建项目」按钮对顾问消失了，而权限表里明明有 PROJECT_CREATE。
    新建类动作本来就没有「现有归属」，不该传。
  */
  assert.match(src, /const canCreateProject = checkActionPermission\('PROJECT_CREATE'\)\.allowed/,
    '没按权限判断能不能建项目，或者又传了 {} 进去');
  assert.match(src, /\{canCreateProject && \(\n\s*<button onClick=\{openCreateModal\}/,
    '「新建项目」按钮没有按权限隐藏');
});

test('立项之后要能看见它', () => {
  /*
    负责人不是自己时，新项目落在「与我相关」之外 ——
    人点完确认，列表里什么都没多出来，合理的第一反应是「没建成」，
    然后再建一次。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /setViewScope\(mine \? 'related' : 'all'\)/,
    '负责人不是自己时没有自动切到能看到它的范围');
  assert.match(src, /这样你才看得到它/,
    '切了筛选却不解释 —— 界面自己跳一下同样莫名其妙');

  // 自己排第一并标出来，降低选错概率
  assert.match(src, /name === myName \? `\$\{name\}（我自己）` : name/,
    '负责人下拉里没有把自己标出来');
});

test('校验没过要说哪里不对，不能只是不动', () => {
  /*
    2026-09-07 反馈「服务清单点击确认添加没有反应」：
    名称为空时按钮直接 return，一声不吭。
    点了没反应是最难查的一类问题 —— 没有报错、没有日志，
    连「哪里不对」都不知道，只能反复点。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /先填服务名称，比如「ISO9001 认证咨询」/, '空名称仍然静默拒绝');
  assert.match(src, /activeServiceDraft\.error && \(/, '错误提示没有显示出来');
});

test('顾问能自己立项，负责人 ID 也要落库', () => {
  /*
    2026-09-07 放开：原来只有总经理和总助能立项，理由是「上面派、顾问执行」。
    这话在流程图上成立，在 13 个人的公司里不成立 ——
    顾问在客户现场发现要多做一项体系，得回来找总助、总助再找他确认，
    **一件他自己最清楚的事要绕两个人**，绕不动就记在本子上了。
  */
  const { loadCapabilities } = require('../server/authz/authorize');
  const acts = Array.from(loadCapabilities().CONSULTANT?.actions || []);
  assert.ok(acts.includes('PROJECT_CREATE'), '顾问还是不能立项');
  assert.ok(acts.includes('PROJECT_ASSIGN_MANAGER'), '立了项却不能指派负责人，等于建了个死项目');

  /*
    ownerUserId 落库很关键：丢了它，「与我相关」就退化成按姓名匹配 ——
    同名的人互相看到对方的项目；有人改了姓名，他名下的项目当场全消失。
    这两种情况都不会报错。
  */
  /*
    2026-09-15 放宽：原来钉的是字面量 `...(p.ownerUserId ? { ownerUserId: p.ownerUserId } : {})`。
    当天把归属收口成「无主就兜底到当前操作人」的局部变量后，
    写法变成 `...(ownerUserId ? { ownerUserId } : {})`，这条当场红了 —— 而 ID 并没有丢。
    要守的是「有值就一定带进去」，不是那一串字符。
  */
  const ctx = read('context/AppContext.tsx');
  assert.match(ctx, /\.\.\.\((?:p\.)?ownerUserId \? \{ ownerUserId(?::\s*p\.ownerUserId)? \} : \{\}\)/,
    '新建项目时把负责人 ID 丢了');
  assert.match(ctx, /\.\.\.\(p\.customerId \? \{ customerId: p\.customerId \} : \{\}\)/,
    '新建项目时把客户 ID 丢了 —— 项目在客户档案里会挂不上');
});

test('服务项排在任务前面，空任务态指回服务项', () => {
  /*
    原来任务在上、服务项在下。人打开项目第一眼是空的任务区，
    自然去点「+」一条条手加 —— 加完才发现下面有服务项可选，
    而选一个服务项系统会自动把任务全带出来。白干一遍。

    界面顺序就该等于做事顺序：先确定卖了什么，再谈怎么做。
  */
  const src = read('pages/Projects.tsx');
  const svc = src.indexOf('order-2 bg-gray-50/50');
  const task = src.indexOf("order-3 space-y-6");
  assert.ok(svc > 0 && task > 0, '找不到这两块，测试要跟着结构改');
  assert.ok(svc < task, '服务项还排在任务后面');

  assert.match(src, /多数情况不用手加 —— 到上面「服务项」里选一项客户买的服务/,
    '任务为空时没有把人指回服务项');
});
