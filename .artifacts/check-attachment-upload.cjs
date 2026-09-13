// 合同附件要真的存到服务器上，不是 blob 临时地址。
// 2026-09-13：生产 12 份有附件的合同，url 全是 blob —— 原件一份都没存下来。
const { chromium } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const c = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };

(async () => {
  const pdf = path.resolve(__dirname, '../.runtime/测试合同.pdf');
  if (!fs.existsSync(pdf)) { console.error('缺测试 PDF:', pdf); process.exit(2); }
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(c.登录名);
  await p.locator('input[type="password"]').first().fill(c.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1800);
  for (let i=0;i<3;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }
  await p.goto('http://localhost:3000/#/contracts');
  await p.waitForTimeout(1600);
  for (let i=0;i<2;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }

  // 展开第一份合同 → 电子档案柜 → 添加
  await p.locator('tbody tr').first().click();
  await p.waitForTimeout(1500);
  const add = p.getByRole('button', { name: /^添加$/ }).first();
  check(await add.count() > 0, '找得到「添加」附件的入口');

  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    add.click(),
  ]);
  await chooser.setFiles(pdf);
  await p.waitForTimeout(3500);

  // 直接问库：新附件的 url 长什么样
  const { execSync } = require('child_process');
  const out = execSync(`docker exec xinyi-dev-db psql -U xinyi -d xinyi -t -c "select coalesce((attachments::jsonb->-1->>'url'),'(无)') from contracts where attachments::text like '%测试合同%' order by updated_at desc limit 1;"`, { encoding: 'utf8' }).trim();
  console.log('   刚存进去的 url：', out || '(没查到)');
  check(out.startsWith('/api/files/'), '存的是服务器上的真实路径，不是 blob', out);
  check(!out.includes('blob:'), '没有再产生 blob 临时地址');

  // 这个 URL 真的取得到文件吗
  if (out.startsWith('/api/files/')) {
    const r = await p.evaluate(`fetch(${JSON.stringify(out)}, {credentials:'include'}).then(r => r.status)`);
    check(r === 200, '这个地址真的能取到文件', `HTTP ${r}`);
  }
  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
