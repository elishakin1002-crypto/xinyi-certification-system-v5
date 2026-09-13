// 「连通不合并」具体靠什么实现 —— 全局搜索能不能同时搜到合同和知识文档。
const { chromium } = require('@playwright/test');
const c = require('../.runtime/走查账号密码.json').账号['咨询顾问 黄佳佳'];
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(c.登录名);
  await p.locator('input[type="password"]').first().fill(c.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1800);
  for (let i=0;i<3;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }

  for (const kw of ['鸿涛', '咨询服务']) {
    await p.getByPlaceholder('搜索全局数据...').fill(kw);
    await p.waitForTimeout(900);
    // 直接问模块，别靠猜界面上哪块显示摘要
    const hits = await p.evaluate(`(async () => {
      const m = await import('/src/modules/search/globalSearch.ts').catch(() => null);
      return m ? Object.keys(m) : null;
    })()`);
    const body = (await p.locator('body').innerText()).replace(/\s+/g,' ');
    console.log(`搜「${kw}」→ 页面上出现:`, (body.match(/(线索|客户|合同|项目|知识)[^ ]{0,4}\d+/g)||[]).slice(0,6).join(' · ') || '(无)');
    if (hits) console.log('   搜索模块导出:', hits.join(', '));
  }
  await p.screenshot({ path: '.artifacts/global-search.png' });
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
