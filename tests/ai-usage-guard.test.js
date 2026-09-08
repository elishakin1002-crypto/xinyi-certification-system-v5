// 盯住「AI 会不会悄悄开始烧钱」。
//
// 2026-09-07 金恩来：「系统中还有哪些需要调用 api 主动扫描的地方？
// 要提前帮我先搜索出来，评估好是否有必要这么弄！」
//
// 审计结果（见 docs/AI用量审计.md）：两个月总共 60 次调用、7 万 token，
// **全部是人点出来的，定时任务 0 次**。
//
// 但这个性质很脆弱：任何人加一个 useEffect 里的模型调用，
// 量级就从「一天几次」变成「每次有人打开页面」——
// 而且不会有任何报错，只有月底账单会说话。这几条测试就是盯它的。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const listFiles = (dir, ext) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.resolve(root, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (ext.some((x) => e.name.endsWith(x))) out.push(rel);
    }
  };
  walk(dir);
  return out;
};

/** 会真的花钱的调用长什么样 */
const MODEL_CALL = /aiService\.\w+\(|fetch\(\s*['"`]\/api\/ai\/(chat|generate)['"`]/;

test('没有页面一打开就调模型', () => {
  /*
    这是最容易失控的一类：页面在 useEffect 里调模型，
    于是每有人打开一次就是一笔钱，而且没人会意识到 ——
    因为它不报错，界面也看不出区别。

    做法：把每个 useEffect 的函数体抠出来，看里面有没有模型调用。
    只读用量表（/api/ai/my-usage）不算 —— 那不碰模型。
  */
  const offenders = [];
  for (const f of [...listFiles('pages', ['.tsx']), ...listFiles('components', ['.tsx'])]) {
    const src = read(f);
    // 逐个 useEffect( 往后取 600 字符，够覆盖绝大多数副作用体
    let i = src.indexOf('useEffect(');
    while (i !== -1) {
      const body = src.slice(i, i + 600);
      if (MODEL_CALL.test(body)) offenders.push(`${f} 第 ${src.slice(0, i).split('\n').length} 行附近`);
      i = src.indexOf('useEffect(', i + 1);
    }
  }
  assert.deepEqual(offenders, [],
    `这些地方在挂载副作用里调了模型 —— 每打开一次页面就是一笔钱：\n${offenders.join('\n')}`);
});

test('两个定时任务都不调模型', () => {
  /*
    情报雷达容易被误会成「每天烧一笔」，因为它确实跑 10 个行业的查询。
    但那些是**搜索请求**不是模型请求，产出标着 web-heuristic。
    这条测试防的是将来有人给它接上模型却没算清一天几次。
  */
  const app = read('server/app.js');

  const intel = app.slice(app.indexOf('const runIntelFetch'), app.indexOf('const runIntelFetch') + 20000);
  assert.match(intel, /modelUsed: 'web-heuristic'/,
    '情报抓取不再标 web-heuristic —— 是不是接上模型了？接之前先算清一天最多几次');

  const digest = app.slice(app.indexOf('const scheduleErrorDigest'), app.indexOf('const scheduleErrorDigest') + 1500);
  assert.ok(!/callDeepSeek|callProvider|aiComplete/.test(digest),
    '错误摘要开始调模型了 —— 它每天固定跑一次，接模型前要想清楚值不值');
});

test('用量记录要能回答「谁在花钱、花在哪」', () => {
  /*
    审计能做下去，靠的是 ai_usage_log 里有 actor_kind / feature / total_tokens。
    少一个维度，下次就只能回答「一共调了多少次」，
    回答不了「是人点的还是自动跑的」—— 而那才是要紧的问题。
  */
  const usage = read('server/services/aiUsage.js');
  ['actor_kind', 'feature', 'total_tokens', 'model_used'].forEach((col) => {
    assert.ok(usage.includes(col), `ai_usage_log 少了 ${col}，审计时就回答不了关键问题`);
  });
});

test('知识文件不会因为上传就被 AI 读一遍', () => {
  /*
    新手引导里曾经写反过（说「每一份上传的文件 AI 都要读一遍」），
    金恩来 2026-09-07 指出：「这个没有必要啊！」
    实际行为是对的 —— 点按钮才读。这条测试钉住这个行为，
    顺便钉住文案不要再写反。
  */
  const steps = read('src/modules/onboarding/steps.ts');
  assert.ok(!/每一份.{0,6}文件.{0,10}都.{0,4}读/.test(steps),
    '引导里又出现「每份文件都读一遍」的说法了');

  const guide = read('src/modules/help/pageGuide.ts');
  assert.match(guide, /点了按钮才会生成/, '本页详解里没说清「点了才读」');
});
