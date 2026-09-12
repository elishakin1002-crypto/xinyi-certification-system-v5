// 合同原文 → 标准服务目录的匹配。
//
// 2026-09-12 金恩来：「目前的合同不够规范，同时识别 pdf 也常常不够准确，
// 这里还是需要，提供标准的服务项目多选会更准确，高效」。
//
// 规范化不能指望识别环节：AI 读出来的是**原文**，原文不规范，
// 读得再准也还是不规范。所以录入时从固定目录里选，
// AI 的职责变成「替人先勾好」—— 勾错了人一眼看得出来，
// 自由文本错了没人看得出来。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.runtime/serviceCatalogMatch.test.cjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/serviceCatalogMatch.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
], { stdio: 'pipe' });
const { matchCatalogItems, searchCatalog, toServiceLine } = require(out);

const names = (r) => r.matched.map((m) => m.name);

test('一份合同里写了两项服务，两项都要认出来', () => {
  /*
    这是最常见的形态：一份合同同时做 9001 和 14001。
    原来存成一个自由文本字符串，下游没法按服务拆分工作量、也没法查
    「这家做过哪些体系」。
  */
  const r = matchCatalogItems('ISO 9001 质量管理体系认证咨询、ISO 14001 环境管理体系认证咨询');
  assert.ok(names(r).some((n) => /ISO 9001/.test(n)), '没认出 ISO 9001');
  assert.ok(names(r).some((n) => /ISO 14001/.test(n)), '没认出 ISO 14001');
});

test('写法不一样也要认得出 —— 这是整件事的起点', () => {
  for (const raw of ['ISO9001', 'iso 9001 认证', 'ISO-9001质量管理体系']) {
    const r = matchCatalogItems(raw);
    assert.ok(names(r).some((n) => /ISO 9001/.test(n)), `「${raw}」没认出来`);
  }
});

test('短代码不许乱命中 —— SC/CE/KC 这种两字母的最危险', () => {
  /*
    目录里有 SC（食品生产许可）、CE、KC 这些两字母代码。
    如果裸做字符串包含，「SCAN」「CERTIFICATE」「LOCK」里都有它们，
    一份普通合同能匹配出十几项，人反而要一个个删 —— 比不匹配更糟。
  */
  const r = matchCatalogItems('本合同为管理培训服务，含现场辅导与文件编制');
  const bad = names(r).filter((n) => /^SC |^CE |^KC /.test(n));
  assert.deepEqual(bad, [], `无关文本里误命中了短代码：${bad.join('、')}`);
});

test('ISO 20000 不许被 ISO 22000 的文本带出来', () => {
  const r = matchCatalogItems('ISO 22000 食品安全管理体系认证');
  assert.ok(names(r).some((n) => /22000/.test(n)), '没认出 ISO 22000');
  assert.ok(!names(r).some((n) => /20000/.test(n)), 'ISO 20000 被误匹配了');
});

test('认不出来的片段要留着给人看，不许偷偷丢掉', () => {
  /*
    合同里写的东西认不出来，可能是目录缺了这一项，也可能写法太偏。
    两种都需要人看一眼。偷偷丢掉 = 系统自作主张改了合同内容，
    这是这个系统最不该做的事。
  */
  const r = matchCatalogItems('ISO 9001 认证咨询、厂区绿化养护服务');
  assert.ok(r.unmatched.some((u) => /绿化/.test(u)),
    `没把认不出来的片段留下来：${JSON.stringify(r.unmatched)}`);
});

test('空输入不报错也不瞎猜', () => {
  assert.deepEqual(matchCatalogItems('').matched, []);
  assert.deepEqual(matchCatalogItems(undefined).unmatched, []);
});

test('搜索：打代码、打大类、打中文都要能找到', () => {
  assert.ok(searchCatalog('iso9001').some((i) => /ISO 9001/.test(i.name)), '按代码搜不到');
  assert.ok(searchCatalog('体系认证').length > 5, '按大类搜不到');
  assert.ok(searchCatalog('食品').some((i) => /食品/.test(i.name)), '按中文搜不到');
  assert.equal(searchCatalog('').length > 100, true, '空关键词应该给全量目录');
});

test('选完之后存成标准名，顿号分隔', () => {
  const line = toServiceLine([{ name: 'ISO 9001 质量管理体系认证' }, { name: 'ISO 14001 环境管理体系认证' }], ['厂区绿化养护']);
  assert.equal(line, 'ISO 9001 质量管理体系认证、ISO 14001 环境管理体系认证、厂区绿化养护');
});
