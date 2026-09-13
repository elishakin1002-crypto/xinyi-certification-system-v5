// 知识中心上传要真的存盘。2026-09-13：40 篇里 7 篇是 blob 死链。
const { chromium } = require('@playwright/test');
const { execSync } = require('child_process');
const path = require('path'); const fs = require('fs');
const c = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok, l, e='') => { if(!ok) bad++; console.log(`${ok?'✅':'❌'} ${l}${e?' —— '+e:''}`); };
(async () => {
  const f = path.resolve(__dirname, '../.runtime/知识测试.pdf');
  if (!fs.existsSync(f)) { console.error('缺测试文件'); process.exit(2); }
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(c.登录名);
  await p.locator('input[type="password"]').first().fill(c.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1800);
  for (let i=0;i<3;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }
  await p.goto('http://localhost:3000/#/knowledge');
  await p.waitForTimeout(1800);
  for (let i=0;i<2;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }

  // 标签不再自相矛盾
  const body = (await p.locator('body').innerText()).replace(/\s+/g,' ');
  check(!/机密模式/.test(body), '页面上不再出现「机密模式」');
  check(/AI 不可读/.test(body), '改成了直说 AI 的说法');

  // 传一份，看存的是什么地址
  await p.getByText(/知识入库|上传/).first().click();
  await p.waitForTimeout(900);
  const [chooser] = await Promise.all([ p.waitForEvent('filechooser'), p.locator('input[type=file]').first().click({force:true}).catch(()=>p.getByText(/选择文件|点击上传/).first().click()) ]);
  await chooser.setFiles(f);
  await p.waitForTimeout(2000);
  const title = `知识存盘验证-${Date.now()%10000}`;
  const ti = p.getByPlaceholder(/标题|名称/).first();
  if (await ti.count()) await ti.fill(title);
  const save = p.getByRole('button', { name: /确认|上传|保存|入库/ }).last();
  await save.click().catch(()=>{});
  await p.waitForTimeout(3000);

  const out = execSync(`docker exec xinyi-dev-db psql -U xinyi -d xinyi -t -c "select coalesce(source_url,'(无)') from knowledge_docs order by created_at desc limit 1;"`, {encoding:'utf8'}).trim();
  console.log('   最新一篇的地址：', out);
  check(out.startsWith('/api/files/'), '存的是服务器真实路径', out);
  check(!out.startsWith('blob:'), '没有再产生 blob 死链');
  await b.close();
  console.log(bad===0?'\n全部通过':`\n${bad} 项不通过`);
  process.exit(bad===0?0:1);
})().catch(e => { console.error(e.message); process.exit(1); });
