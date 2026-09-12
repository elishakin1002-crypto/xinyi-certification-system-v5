// 四个「建」接口都不许建出没名字的空记录。
//
// 2026-09-12 金恩来：「创建项目页面的关联合同下面都是 0¥ 怎么回事？」
//
// 本机 52 份合同里 40 份标题为空、金额为 0 ——
// 建项目时「关联合同」下拉变成一排「（¥0）」，一条都认不出来。
//
// 来源是我的越权巡检脚本给每个非 GET 接口发 `{}`。
// **发空 body 是对的**（那个脚本要验的是 403 和非 403），
// 错的是 POST /api/contracts 空 body 也返回 201：
// projects / customers / leads 三个早就 400 了，唯独合同没加。
//
// 这就是这个项目的老毛病：同一件事做了三处、漏一处。
// 所以这条测试**把四个一起扫**，而不是只钉合同那一个。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/*
  ⚠️ 校验要加在**真正跑的那一处**。

  我第一次把合同的校验加在 server/app.js 的 app.post('/api/contracts') 上，
  接口照样返回 201 —— 因为真正处理它的是 server/routes/batch3.js
  （batch 路由先挂载），app.js 那个处理器根本跑不到。

  所以这条测试直接扫 routes/ 目录，而不是扫 app.js。
*/
const routeSrc = fs.readdirSync(path.join(root, 'server/routes'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ file: f, src: read(`server/routes/${f}`) }));

/** 找出某个 POST 路由的处理器正文 */
const handlerOf = (url) => {
  for (const { file, src } of routeSrc) {
    const i = src.indexOf(`router.post('${url}'`);
    if (i === -1) continue;
    // 到下一个 router.xxx( 为止
    const next = src.slice(i + 10).search(/\n\s*router\.(get|post|patch|put|delete)\(/);
    return { file, body: next === -1 ? src.slice(i) : src.slice(i, i + 10 + next) };
  }
  return null;
};

const CREATES = [
  ['/api/contracts', /title/, '合同'],
  ['/api/projects', /name/, '项目'],
  ['/api/customers', /name/, '客户'],
  ['/api/leads', /name|companyName|contactPerson/, '线索'],
];

for (const [url, field, label] of CREATES) {
  test(`${label}：${url} 必须拒绝没名字的请求`, () => {
    const h = handlerOf(url);
    assert.ok(h, `routes/ 里找不到 POST ${url} —— 它是不是搬走了？搬走了这条测试就白守了`);

    const has400 = /PARAM_ERROR[\s\S]{0,200}?400|400\s*\)/.test(h.body);
    assert.ok(has400,
      `${h.file} 里的 POST ${url} 没有 400 校验 —— 空 body 会建出一条没名字的记录。\n` +
      `合同就是这么漏的：库里攒了 40 条空合同，下拉框变成一排「（¥0）」。`);

    assert.ok(field.test(h.body),
      `${h.file} 里的 POST ${url} 的校验没检查名字字段`);
  });
}

test('拦住的同时要说清后果，不能只说「不行」', () => {
  /*
    项目约定：给用户的文案要说清后果。
    「合同名称不能为空」只说了规则，
    「建项目时下拉里会是一行空白（¥0），谁也认不出是哪一份」才让人知道为什么。
  */
  const h = handlerOf('/api/contracts');
  assert.match(h.body, /关联合同|下拉|认不出/,
    '合同的报错只说了不行，没说会造成什么后果');
});
