// 合同 PDF 解析。2026-09-12 金恩来：「合同识别直接提示失败」
// 真因是 pdf.js v5 不再认 disableWorker，必须设 workerSrc。
// 这里直接走 app 自己的解析函数，不是复制一份逻辑 —— 否则测的不是生产那条路。
const { chromium } = require('@playwright/test');
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage();
  await p.goto('http://localhost:3000/#/');
  await p.waitForTimeout(2500);

  const r = await p.evaluate(async () => {
    const out = {};
    try {
      const mod = await import('/services/documentParsers.ts');
      const res = await fetch('/__sample.pdf');
      const blob = await res.blob();
      const file = new File([blob], '合同样例.pdf', { type: 'application/pdf' });
      const text = await mod.extractTextFromPdf(file);
      out.textLen = text.length;
      out.sample = text.slice(0, 80);
      out.failAfterText = mod.getLastParseFailure ? mod.getLastParseFailure() : '(没有 getLastParseFailure)';
      const imgs = await mod.renderPdfPagesAsImages(file, 2);
      out.images = imgs.length;
      out.firstImgKb = imgs[0] ? Math.round(imgs[0].length * 0.75 / 1024) : 0;
      out.failAfterImg = mod.getLastParseFailure ? mod.getLastParseFailure() : '';
    } catch (e) { out.err = String(e && e.message || e).slice(0, 300); }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  check(!r.err, '解析没有抛异常', r.err || '');
  check((r.textLen || 0) > 30, '文本层抽出来了', `${r.textLen} 字`);
  check(/合同|信义|ISO/.test(r.sample || ''), '抽到的是合同正文', r.sample || '');
  check((r.images || 0) > 0, '扫描件兜底：能渲染成图', `${r.images} 页 / 首页 ${r.firstImgKb}KB`);
  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
