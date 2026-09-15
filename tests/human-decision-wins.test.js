// 自动流程不许覆盖人已经做过的决定。
//
// 2026-09-15 金恩来连着两轮说「标记已分拣点了没反应」。
// 前两轮我各修了一处（后端 PATCH 查不到就 404、前端徽章漏了 triaged），
// 他说还是不行 —— 因为**真正的原因在第三处**：
//
//   context/AppContext.tsx 的 upsertMarketSignals 原来是
//       list.forEach(s => map.set(s.id, s))
//   抓回来的整条直接盖掉已有的，**连 status 一起盖**。
//
// 时序：点分拣 → 前端改 triaged、后端也存成功（实测 200）
//       → 十分钟一次的轮询拉 /api/intel/latest（读抓取缓存，里面还是 new）
//       → 这一行把 triaged 盖回 new
// 全程不报错，所以查了两轮都没查到。
//
// 要守的规矩：
//   **内容**（标题、摘要、评分）—— 抓取方权威，该覆盖
//   **决定**（分拣状态、认领人、转化去向）—— 人权威，绝不能覆盖
// 这和「重新生成的提醒不能冲掉已读状态」是同一条。
// 人发现自己做的事第二天又回来了，就不会再做了。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

/** 把 upsertMarketSignals 的函数体抠出来 */
const upsertBody = () => {
  const src = fs.readFileSync(path.join(root, 'context/AppContext.tsx'), 'utf8');
  const start = src.indexOf('const upsertMarketSignals =');
  assert.ok(start > 0, '找不到 upsertMarketSignals，测试要跟着结构改');
  return stripComments(src.slice(start, src.indexOf('const updateMarketSignal =', start)));
};

test('抓取回来的情报不许整条盖掉已有的 —— status 会被一起盖', () => {
  const body = upsertBody();
  assert.ok(!/list\.forEach\(s => map\.set\(s\.id, s\)\)/.test(body),
    '又变回整条覆盖了 —— 人点的「已分拣」会被十分钟一次的轮询刷回「待处理」');
  assert.match(body, /MARKET_SIGNAL_STATUS\.NEW/,
    '合并时没有判断「这条有没有人动过」');
  assert.match(body, /status: existing\.status/,
    '合并时没有保留人已经设好的分拣状态');
});

test('往服务端回写时也要带上保留后的状态', () => {
  /*
    只在前端保留不够：这次轮询照样会把库里的 triaged 刷成 new，
    等于把同一个 bug 搬到服务端，下次换台电脑打开又是「待处理」。
  */
  const body = upsertBody();
  const writeBack = body.slice(body.indexOf('signalService.isEnabled()'));
  assert.ok(writeBack.length > 40, '没截到回写那一段');
  assert.ok(!/upsertSignals\(list\)/.test(writeBack),
    '回写的还是原始的 list —— 库里的分拣状态会被刷回 new');
  assert.match(writeBack, /existing\.status/,
    '回写时没有保留人设好的状态');
});

test('「决定类」字段清单写全了 —— 认领人和转化去向也不能被覆盖', () => {
  /*
    只保 status 不够：认领了谁、已经转成哪个项目，同样是人做的决定。
    漏一个就是下次再来一轮「点了没反应」。
  */
  const body = upsertBody();
  for (const f of ['ownerUserId', 'convertedTo']) {
    assert.ok(body.includes(f), `合并时没有保留「${f}」—— 它也是人做的决定，不是抓取来的内容`);
  }
});
