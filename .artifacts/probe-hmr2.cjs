const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  p.on('console', m => console.log('[c]', m.text().slice(0,140)));
  await p.addInitScript(() => {
    const W = window.WebSocket;
    window.__sockets = [];
    window.WebSocket = function (...a) { const ws = new W(...a); window.__sockets.push(ws); return ws; };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, W);
  });
  await p.goto('http://localhost:3000/#/');
  await p.waitForTimeout(2500);
  // 在一个真实模块里挂监听，看事件到底会不会来
  await p.evaluate(`(async () => {
    const m = await import('/components/VersionWatcher.tsx?probe=1');
    window.__hotEvents = [];
    return 'loaded';
  })()`);
  const r = await p.evaluate(`(() => {
    // 直接用 vite 客户端暴露的 hot 上下文
    return typeof window.__vite__createHotContext;
  })()`);
  console.log('createHotContext:', r);
  await p.evaluate(`(() => {
    window.__hotEvents = [];
    const ctxFn = window.__vite__createHotContext;
    if (!ctxFn) return 'no createHotContext';
    const h = ctxFn('/probe-only.js');
    h.on('vite:ws:disconnect', () => window.__hotEvents.push('disconnect'));
    h.on('vite:ws:connect', () => window.__hotEvents.push('connect'));
    return 'listeners attached';
  })()`).then(x => console.log('挂监听:', x));
  await p.evaluate(`(() => { (window.__sockets||[]).forEach(w => w.close()); return 1; })()`);
  await p.waitForTimeout(3000);
  console.log('收到的事件:', await p.evaluate('JSON.stringify(window.__hotEvents||[])'));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
