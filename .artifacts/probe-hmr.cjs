const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  p.on('console', m => { if (/HMR|hot|ws|vite/i.test(m.text())) console.log('[console]', m.text().slice(0,150)); });
  await p.goto('http://localhost:3000/#/');
  await p.waitForTimeout(2500);
  const r = await p.evaluate("({ hasHot: typeof window.__vite_plugin_react_preamble_installed__ !== 'undefined', wsCount: performance.getEntriesByType('resource').filter(e=>/vite/.test(e.name)).length })");
  console.log('页面侧:', JSON.stringify(r));
  // 直接问模块：import.meta.hot 在不在
  const hot = await p.evaluate(`(async () => {
    const m = await import('/components/VersionWatcher.tsx');
    return typeof m.VersionWatcher;
  })()`);
  console.log('VersionWatcher 导出:', hot);
  console.log('--- 切断网络 8 秒 ---');
  await ctx.setOffline(true);
  await p.waitForTimeout(8000);
  const t1 = await p.evaluate("document.body.innerText.includes('不是最新') || document.body.innerText.includes('系统已更新')");
  console.log('断网 8s 后有提示吗:', t1);
  await ctx.setOffline(false);
  await p.waitForTimeout(6000);
  const t2 = await p.evaluate("document.body.innerText.includes('不是最新') || document.body.innerText.includes('系统已更新')");
  console.log('恢复 6s 后有提示吗:', t2);
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
