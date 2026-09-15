// 「厂商名」不是「模型名」。
//
// 2026-09-15 Codex 走查：总助·战略管理点「让 AI 读这些数字」，
// 等满 60 秒后报「AI 模型配置有误（指定的模型不存在）」。
//
// 真因：调用方写的是 `aiService.generateJSON('kimi', ...)` —— 传的是**厂商名**，
// 而这个字符串被原样当成模型名发给 Moonshot。实测：
//     用 model=kimi → 404 Not found the model kimi or Permission denied
// 而账号里真实可用的是 kimi-k3、kimi-k2.6、kimi-k2.7-code 这些。
//
// ── 为什么不是"把调用方改成写全称"就完了 ────────────────────────
//
// 「我要用 kimi」是很自然的写法，下一个人还会这么写，
// 而且写错时的症状是**等满 60 秒再报一句看不懂的话**，排查成本很高。
// 所以在 normalizeModelName 里认厂商别名 —— 让自然的写法也是对的写法。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'services/aiService.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('厂商名要能翻成真实模型名', () => {
  assert.match(src, /PROVIDER_ALIAS/, '没有厂商别名表');
  for (const [alias, real] of [['kimi', 'kimi-k3'], ['deepseek', 'deepseek-chat'], ['gemini', 'gemini-3-flash']]) {
    assert.match(src, new RegExp(`${alias}: '${real}'`), `别名表里缺 ${alias} → ${real}`);
  }
  assert.match(src, /PROVIDER_ALIAS\[stripped\.toLowerCase\(\)\]/, '别名表定义了但没用上');
});

test('真实模型名要原样透传 —— 别名表不能把它们也改掉', () => {
  /*
    防的是另一头：如果实现写成"凡是含 kimi 就换成 kimi-k3"，
    那么显式指定 kimi-k2.6 的地方会被悄悄换掉 —— 而这类替换不报错。
  */
  assert.ok(
    !/includes\('kimi'\)\s*\?\s*'kimi-k3'/.test(src),
    '别名匹配写成了模糊包含 —— 会把显式指定的 kimi-k2.6 也换成 k3'
  );
});

test('别再有人直接把厂商名当模型名传', () => {
  /*
    别名表是兜底，但调用处写清楚更好读。
    这条只盯"传厂商名"这一种写法，不管别的。
  */
  const callers = ['services/monthlyReviewService.ts'];
  for (const f of callers) {
    const s = fs.readFileSync(path.join(root, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/generate(JSON|Text)\(\s*['"](kimi|deepseek|gemini)['"]\s*,/.test(s) || /PROVIDER_ALIAS/.test(src),
      `${f} 把厂商名当模型名传，而别名表又没兜住`
    );
  }
});
