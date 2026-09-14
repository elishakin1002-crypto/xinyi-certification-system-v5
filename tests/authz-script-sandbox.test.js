// 巡检脚本不许碰真实数据 —— 而且这件事要可证，不能靠我说。
//
// 2026-09-14 金恩来：「若是证实上线后需要对系统升级维护，
//   巡检脚本时会去删真实数据吗？那问题就大了。现在的数据删了也就删了，
//   正式运营后要删真实数据那问题就大了，是不是可以巡检时自己新建一个，
//   再去测试删除权限？」
//
// 他说的正是对的，而且点破了我上一版的两个问题：
//   ① 用假 id 调 DELETE，只证明「没被 403」，**根本没验证删除真的能用**
//   ② PATCH/PUT 还在拿真实记录发 `{}`
//
// 现在的做法：巡检自己建样本、全程只碰样本、跑前跑后给真实表点名。
// 这组测试钉住这三条，因为它们一旦松掉，后果是别人的真实记录。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'scripts/authz-matrix-live.mjs'), 'utf8');
/** 扫源码先去注释 —— 上面那段历史里就写着 ZZZ-NOT-EXIST 和「真实 id」 */
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

test('每个改/删类请求前都要过一道样本箱闸门', () => {
  assert.match(src, /const assertOnlyTouchesSandbox = /, '闸门函数没了');
  assert.match(
    src,
    /assertOnlyTouchesSandbox\(url, ep\.method, injected\);/,
    '发请求之前没有调闸门 —— 装了闸门不用等于没装'
  );
  assert.match(src, /throw new Error\(\s*`巡检试图对非样本记录发/, '闸门只是提醒，没有中止');
});

test('闸门的异常不许被「网络错误」那个 catch 吞掉', () => {
  /*
    第一版写的是 `} catch { status = -1; }` —— 闸门抛的异常正好落进去，
    于是它一边被拦一边继续跑，等于没拦。
    这条是整组里最容易悄悄失效的一条。
  */
  assert.match(
    src,
    /if \(String\(e\?\.message \|\| ''\)\.includes\('非样本记录'\)\) throw e;/,
    '闸门异常又被 catch 吞了'
  );
});

test('闸门查的是「我填进去的 id」，不是「看起来像 id 的路径段」', () => {
  /*
    按形状猜必然误伤：`/api/leads/:id/follow-ups` 里的字面量 `follow-ups`
    含短横线，第一版就把它当成 id，闸门在第一条路由上就把脚本拦死了。
    这个项目里"按形状猜"已经错过四次（遮罩判定那次最典型）。
  */
  assert.ok(
    !/looksLikeId/.test(src),
    '又改回按形状猜 id 了 —— 字面量路径段会被误判'
  );
  assert.match(src, /return \{ url: filled, injected \}/, 'fillParams 没有把填进去的 id 报上来');
});

test('删除要对着现造的样本删，而不是对着假 id 换个 404', () => {
  assert.ok(
    !/ZZZ-NOT-EXIST/.test(src),
    '又回到假 id 那一版了 —— 那样删除接口坏掉也测不出来'
  );
  assert.match(
    src,
    /if \(ep\.method === 'DELETE' && ep\.url\.includes\(':'\) && SANDBOX_FACTORY\[kind\]\)/,
    '删除前没有现造一条新样本'
  );
});

test('跑前跑后要给真实表点名，对不上就判失败', () => {
  assert.match(src, /const before = await census\(\)/, '跑前没点名');
  assert.match(src, /const after = await census\(\)/, '跑后没点名');
  assert.match(src, /巡检动了真实数据 —— 这是事故/, '对不上时没有报成事故');
  assert.match(src, /drifted\.length\) \{[\s\S]{0,400}process\.exitCode = 1/, '报了事故但退出码还是 0');
});

test('点名要扣掉巡检自己的样本，否则天天误报', () => {
  assert.match(
    src,
    /not like '%\$\{SANDBOX_TAG\}%'/,
    '点名没排除样本 —— 样本自己增增减减会被当成真实数据变化'
  );
});

test('审计流水只查变少，不查变多', () => {
  /*
    business_events 记的是「谁做了什么、谁被拒了什么」，
    巡检跑一轮必然往里写几十条 denied —— 那是它在正常工作。
    把这个也报成事故的话，狼来了喊多了，真出事那次就没人看了。
    但它**变少**是另一回事：审计流水少一条都是痕迹被抹了。
  */
  assert.match(src, /const APPEND_ONLY_TABLES = new Set\(\['business_events'\]\)/, '没有区分流水账表');
  assert.match(
    src,
    /APPEND_ONLY_TABLES\.has\(table\) && delta > 0\) continue;/,
    '流水账变多也被当成事故'
  );
});

test('样本牵连出来的提醒和事件也要一起收干净', () => {
  /*
    造 5 条样本，连带生出 6 条提醒 + 66 条业务事件。
    样本一删，这些就成了指向不存在记录的孤儿 ——
    金恩来同一天问的「提醒越挂越多」，根子就是这个。
  */
  assert.match(src, /delete from reminders where link_id = any\(\$1\)/, '样本牵连的提醒没收');
  assert.match(src, /delete from business_events where subject_id = any\(\$1\)/, '样本牵连的事件没收');
});

test('提醒也要进「空记录」名单 —— 它当初漏在外面', () => {
  assert.match(src, /\['reminders', 'title', '提醒'\]/, '空记录检查里没有提醒');
});
