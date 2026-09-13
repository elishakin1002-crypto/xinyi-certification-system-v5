// 「12 份合同原件怎么重传」—— 走一遍给他看，别让他猜。
// 关键：**不是新建合同**（那会撞查重），而是在已有合同里补附件。
const { chromium } = require('@playwright/test');
const { execSync } = require('child_process');
const path = require('path');
const c = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok, l, e='') => { if(!ok) bad++; console.log(`${ok?'✅':'❌'} ${l}${e?' —— '+e:''}`); };
(async () => {
  const f = path.resolve(__dirname, '../.runtime/重传样例.pdf');
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  let dlg = '';
  p.on('dialog', async d => { dlg = d.message(); await d.accept(); });
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

  // 第 1 步：展开一份已有合同
  const row = p.locator('tbody tr').first();
  await row.click();
  await p.waitForTimeout(1500);
  check(await p.getByText('电子档案柜').count() > 0, '第1步：点开合同 → 看到「电子档案柜」');

  // 第 2 步：点「添加」
  const add = p.getByRole('button', { name: /^添加$/ }).first();
  check(await add.count() > 0, '第2步：电子档案柜右上角有「添加」');

  const before = execSync(`docker exec xinyi-dev-db psql -U xinyi -d xinyi -t -c "select jsonb_array_length(coalesce(attachments::jsonb,'[]'::jsonb)) from contracts order by created_at desc limit 1;"`, {encoding:'utf8'}).trim();
  const [chooser] = await Promise.all([ p.waitForEvent('filechooser'), add.click() ]);
  await chooser.setFiles(f);
  await p.waitForTimeout(3500);

  const after = execSync(`docker exec xinyi-dev-db psql -U xinyi -d xinyi -t -c "select coalesce((attachments::jsonb->-1->>'url'),'(无)') from contracts where attachments::text like '%重传样例%' order by updated_at desc limit 1;"`, {encoding:'utf8'}).trim();
  check(after.startsWith('/api/files/'), '第3步：选完文件就存好了，存的是服务器真实路径', after);

  // 旧的死链附件还在不在（重传不该把旧记录弄没）
  console.log('   （重传是"加一份新的"，旧那条坏记录还留着，人自己删）');
  await p.screenshot({ path: '.artifacts/reupload-flow.png' });
  await b.close();
  console.log(bad===0?'\n全部通过':`\n${bad} 项不通过`);
  process.exit(bad===0?0:1);
})().catch(e => { console.error(e.message); process.exit(1); });
