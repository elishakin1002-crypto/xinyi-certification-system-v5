// 账号有效期：填得进去、拦得住、**而且提前告诉人**。
//
// 2026-09-10 核对 P0-4 时发现它一直只做了一半：
// 有效期输入框有、服务端到期也真的拦，但**没有任何人会被提前告知**。
// 实际形态是：兼职某天早上突然登不进来，打电话过来问，才有人想起有效期到了。
//
// 补的时候又踩到一个更深的坑，见下面第二条。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
// 注释里就在讲这些坑，连注释一起查会把自己带偏（坑 #26）
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('userProfiles 映射必须带上 accountExpiresAt —— 它是这份数据进前端的唯一入口', () => {
  /*
    这一条是真正的根因，比提醒本身更值得钉住。

    hydrateProfilesFromAuth 里那个 map **只挑了 6 个字段**，
    服务端明明返回了 accountExpiresAt，在这一步被静默丢掉。

    于是我照着 accountExpiresAt 写的提醒逻辑，条件恒为假 ——
    一条提醒都发不出来，**而且不报任何错**。
    我第一次跑还以为是自己日期算错了。

    这类「白名单式字段映射」是静默丢数据的高发地：
    加字段的人改了后端和类型定义，唯独想不到还有这么一层。
  */
  const ctx = read('context/AppContext.tsx');
  const map = ctx.slice(ctx.indexOf('const hydrateProfilesFromAuth'), ctx.indexOf('hydrateProfilesFromAuth();'));
  assert.ok(map.length > 200, '没截到花名册同步那段，测试要跟着结构改');

  assert.match(map, /accountExpiresAt:/, 'userProfiles 映射漏了 accountExpiresAt —— 依赖它的提醒会静默失效');
  assert.match(map, /status:/, 'userProfiles 映射漏了 status —— 停用账号会收到「即将到期」提醒');
});

test('到期前 7 天有提醒，而且发给改得动的人', () => {
  const code = strip(read('context/AppContext.tsx'));
  const scan = code.slice(code.indexOf('const runSystemScans'), code.indexOf('const scanInterval'));

  assert.match(scan, /AUTO-ACCT-EXPIRE-/, '没有账号到期提醒');
  assert.match(scan, /daysLeft/, '没有按剩余天数判断');

  /*
    发给 ADMIN / SYS_ADMIN —— 只有他们能改有效期。
    发给本人没用：他既改不了也帮不上忙，只是徒增焦虑。
  */
  const block = scan.slice(scan.indexOf('AUTO-ACCT-EXPIRE-'));
  assert.match(block, /forRole:\s*\['ADMIN',\s*'SYS_ADMIN'\]/, '到期提醒没发给能改有效期的人');

  // 停用的账号不该再提醒
  assert.match(scan, /status === 'disabled'/, '停用账号也会收到到期提醒');
});

test('日期比较用「天」，不掺时分秒', () => {
  /*
    账号有效期是「哪一天」这个粒度。掺进时分秒的话，
    「今天到期」在下午会算成负数、被当成已过期漏掉 ——
    和 account-delegation 里 dayOffset 用 UTC 踩的是同一类坑。
  */
  const code = strip(read('context/AppContext.tsx'));
  const block = code.slice(code.indexOf('AUTO-ACCT-EXPIRE-') - 1200, code.indexOf('AUTO-ACCT-EXPIRE-'));
  assert.match(block, /T00:00:00/, '没有把有效期归到当天零点');
  assert.match(block, /startOfToday/, '没有把「今天」也归到零点，比较会掺进时分秒');
});

test('新加的提醒类型必须在铃铛里有跳转，否则点了没反应', () => {
  /*
    linkTypeRoute 里没有对应项时，handleOpenReminderGroup 直接 return ——
    表现就是**点了没有任何反应**。铃铛当初的老毛病就是这个，
    每加一种 linkType 都要在那张表里加一行。
  */
  const layout = strip(read('components/Layout.tsx'));
  const table = layout.slice(layout.indexOf('const linkTypeRoute'), layout.indexOf('const handleOpenReminderGroup'));
  assert.match(table, /employee:\s*'\/employees'/, '账号到期提醒点进去没有落点');

  // 类型定义也要放行，否则根本编译不过
  assert.match(read('types.ts'), /'audit'\s*\|\s*'employee'/, 'Reminder.linkType 没有 employee');
});
