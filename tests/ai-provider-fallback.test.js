// AI 模型路由：DeepSeek 优先，但不能变成死规矩。
//
// ── 背景 ──────────────────────────────────────────────────────
// 2026-09-03：DeepSeek 欠费，于是每一次对话都要先打一趟 DeepSeek、
// 等它返回 Insufficient Balance、再转 Kimi。一个人聊十句就白等十个来回。
//
// 而余额不足这种事，下一秒不会自己变好 —— 重试一万次都是同一个答案。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '../server/app.js'), 'utf8');

test('DeepSeek 失败能自动回退 Kimi', () => {
  assert.match(src, /catch \(err\) \{[\s\S]{0,300}kimiThenGemini\(params\)/,
    'DeepSeek 挂了没有回退路径 —— 便宜不能变成「只能用这个」');
});

test('不会自愈的错误才熔断，会自愈的不熔断', () => {
  /*
    余额不足 / 密钥失效 / 模型不存在 → 下一秒不会好，停用一段时间是对的。
    网络抖动 / 超时 → 下一次就可能好，为它停用主力模型反而更贵。
  */
  const fn = src.slice(src.indexOf('const noteDeepSeekFailure'), src.indexOf('const requestAI'));
  for (const kw of ['insufficient balance', 'unauthorized', 'not found the model']) {
    assert.ok(fn.toLowerCase().includes(kw), `${kw} 应该触发熔断`);
  }
  for (const kw of ['timeout', 'ECONNRESET', 'abort']) {
    assert.ok(!fn.toLowerCase().includes(kw.toLowerCase()),
      `${kw} 是会自愈的错误，不该熔断`);
  }
});

test('一次成功就立刻恢复，不用等冷却走完', () => {
  // 充值之后不该还要干等十分钟
  assert.match(src, /clearDeepSeekPause\(\);\s*\/\/ 成功即恢复/,
    '成功后没有立刻解除熔断');
});

test('文本和视觉两条路都接了熔断', () => {
  assert.ok((src.match(/noteDeepSeekFailure\(err\)/g) || []).length >= 2,
    '只有一条路接了熔断，另一条欠费时还会每次白等');
  assert.ok((src.match(/!deepSeekPaused\(\)/g) || []).length >= 2,
    '熔断期间仍会去打 DeepSeek');
});

test('视觉优先 DeepSeek，Kimi 兜底', () => {
  /*
    2026-09-03 查账号可用模型时发现 DeepSeek 有 deepseek-v4-flash-vision-exp，
    「含图片必须走 Kimi」这个前提已经过时。
    但它带 -exp，所以必须能退到 Kimi —— 合同图片识别是干活的路径，
    不能为了省钱走死。
  */
  assert.match(src, /DEEPSEEK_VISION_MODEL/, '没有配置 DeepSeek 视觉模型');
  const block = src.slice(src.indexOf('if (messagesHaveImage(params.messages))'),
                          src.indexOf('if (messagesHaveImage(params.messages))') + 1200);
  assert.match(block, /DeepSeek 视觉/, '含图片时没有先试 DeepSeek');
  assert.match(block, /kimiThenGemini/, 'DeepSeek 视觉失败后没有回退 Kimi');
});

test('总经理和系统管理员没有每日额度限制', () => {
  /*
    上线到稳定运行期间，这两个账号要能随便测。
    卡住他们省下的那点钱，远不如「因为怕超额而不敢用」的损失大。
  */
  const usage = fs.readFileSync(path.resolve(__dirname, '../server/services/aiUsage.js'), 'utf8');
  assert.match(usage, /ADMIN:\s*Infinity/, '总经理被限额了');
  assert.match(usage, /SYS_ADMIN:\s*Infinity/, '系统管理员被限额了');
});

test('对话框里的「预算」不能说得像配额', () => {
  /*
    原来写「预算 1023/12000 tokens (9%)」。这行只是上下文大小提示，
    超了照发。但看起来就像被限量了，用的人会不敢多问 ——
    而这套系统的价值恰恰在于多问。
  */
  const widget = fs.readFileSync(path.resolve(__dirname, '../components/AIChatWidget.tsx'), 'utf8');
  assert.match(widget, /不限量/, '没有说清这不是配额');
  assert.doesNotMatch(widget, /预算 \{msg\.requestMeta\.estimatedTokens\}/,
    '还留着「预算 x/y」的旧写法');
  assert.doesNotMatch(widget, /model: 'kimi-k2\.5'/,
    '前端写死了模型名，而且写死的是一个已经不存在的模型');
});
