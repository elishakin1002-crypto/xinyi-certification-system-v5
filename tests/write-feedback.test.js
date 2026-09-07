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
  assert.match(src, /const canCreateProject = checkActionPermission\('PROJECT_CREATE', \{\}\)\.allowed/,
    '没按权限判断能不能建项目');
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
  assert.match(src, /setViewScope\('all'\);\s*\n\s*setCreatedNotice/,
    '负责人不是自己时没有自动切到能看到它的范围');
  assert.match(src, /不在「与我相关」里，已切到「全公司」让你看到它/,
    '切了范围却不解释 —— 界面自己跳一下同样莫名其妙');

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
