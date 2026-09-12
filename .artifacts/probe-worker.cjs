const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage();
  p.on('console', m => console.log('[console]', m.text().slice(0, 250)));
  await p.goto('http://localhost:3000/#/');
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => {
    const out = {};
    try {
      out.workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;
    } catch (e) { out.workerErr = String(e.message || e).slice(0, 250); }
    try {
      const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdfjs = mod?.default || mod;
      out.workerSrcAfter = pdfjs?.GlobalWorkerOptions?.workerSrc || '(空)';
      const res = await fetch('/__sample.pdf');
      const buf = await res.arrayBuffer();
      out.pdfBytes = buf.byteLength;
      if (out.workerUrl) pdfjs.GlobalWorkerOptions.workerSrc = out.workerUrl;
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      out.pages = doc.numPages;
      const tc = await (await doc.getPage(1)).getTextContent();
      out.textLen = (tc.items || []).map(i => i.str || '').join('').length;
    } catch (e) { out.err = String(e.message || e).slice(0, 250); }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
