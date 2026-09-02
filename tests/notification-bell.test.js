// 顶部铃铛。
//
// ── 改之前是什么样 ────────────────────────────────────────────
// onClick={() => navigate('/dashboard')}
// 而人多半就站在工作台上，所以表现为「点了没有任何反应」。
// 红点上挂着 24，点下去什么都不发生 —— 用不了两天就没人再看它。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('铃铛打开面板，不是跳转页面', () => {
  /*
    提醒的本质是「打断」：人正在录合同时瞄一眼红点。
    跳走会丢掉手上的活，看完还得自己找回来 ——
    结果是大家索性不点，红点变成永久装饰。
  */
  const src = read('components/Layout.tsx');
  assert.match(src, /onClick=\{\(\) => setIsBellOpen/, '铃铛没有改成开面板');
  assert.doesNotMatch(src, /<button onClick=\{\(\) => navigate\('\/dashboard'\)\} className="relative p-2/,
    '还留着「点铃铛跳工作台」的旧写法');
});

test('按对象聚合，不按条罗列', () => {
  /*
    线上现在 226 条提醒。同一个项目可能挂 5 条（逾期、缺日志、待验收…），
    一条条列出来直接刷屏，而人真正要决定的是「先处理哪个项目」。
  */
  const src = read('components/Layout.tsx');
  assert.match(src, /const bellGroups = useMemo/, '没有用聚合，会变成逐条罗列');
  assert.match(src, /aggregatedReminders/, '没有用已有的 aggregatedReminders 聚合结果');
  assert.match(src, /\.slice\(0, 12\)/,
    '没有截断 —— 滚动条越长越像「这事我处理不完」，反而让人不点');
});

test('点进去自动标已读', () => {
  /*
    再要求点一次「标为已读」，等于让人为了消红点做一件与业务无关的事。
    人不会做，红点永远消不掉，整个提醒机制就失效了。
  */
  const src = read('components/Layout.tsx');
  assert.match(src, /markRemindersRead\(group\.samples\.map/,
    '打开提醒时没有顺手标记已读');
});

test('标记已读不等于删除', () => {
  /*
    原来只有 dismissReminder，它把提醒直接从列表删掉 ——
    「我看过了」和「这件事没了」变成同一个动作。
    看过之后想回头确认「上周那条逾期提醒说的是哪个客户」就找不回来。
  */
  const src = read('context/AppContext.tsx');
  assert.match(src, /const markRemindersRead = \(ids: string\[\]\) => \{/, '没有标记已读的方法');
  assert.match(src, /isRead: true/, '标记已读没有真的改 isRead');
  assert.doesNotMatch(src, /const markRemindersRead[\s\S]{0,300}prev\.filter/,
    '标记已读把记录删掉了 —— 那是 dismiss，不是已读');
});

test('全部已读只动自己能看到的', () => {
  /*
    「全部标为已读」如果把别人的提醒也标掉，
    等于替同事把他的待办清了 —— 而他毫不知情。
  */
  const src = read('context/AppContext.tsx');
  assert.match(src, /const markAllRemindersRead[\s\S]{0,200}visibleReminders/,
    '全部已读没有限定在本人可见范围内');
});

test('未读数上限 99+', () => {
  const src = read('components/Layout.tsx');
  assert.match(src, /99 \? '99\+'/,
    '三位数会把红点撑变形，而且「127 还是 128 条」对人没有意义');
});
