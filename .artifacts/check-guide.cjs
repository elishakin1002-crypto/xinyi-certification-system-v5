const {chromium,expect}=require('@playwright/test');
const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome'});
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3100');
  const tour=page.getByRole('dialog',{name:'认识我的工作台'});
  await expect(tour).toBeVisible();
  for(let i=0;i<=6;i++){
   await page.getByLabel('选择工作台讲解内容').selectOption(String(i));
   await page.waitForTimeout(350);
   const box=await tour.boundingBox();if(box.x<0||box.y<0||box.x+box.width>width+1||box.y+box.height>(width===390?844:900)+1)throw Error('tour overflow '+width+' step '+i);
  }
  await tour.getByText('返回帮助选择',{exact:true}).click();
  await page.goto('http://127.0.0.1:3100/#/dashboard');
  await page.reload();
  await page.getByRole('button',{name:'帮助',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'新手引导',exact:true});
  await expect(menu).toBeVisible();
  await page.screenshot({path:`.artifacts/guide-menu-${width}.png`});
  await menu.getByRole('button',{name:'了解当前模块',exact:false}).click();
  const module=page.getByRole('dialog',{name:'了解当前模块',exact:true});
  await expect(module).toBeVisible();
  const count=await page.getByLabel('选择模块讲解内容').locator('option').count();
  for(let i=0;i<count;i++){
   await page.getByLabel('选择模块讲解内容').selectOption(String(i));
   await expect(module.getByText(`第 ${i+1} 步 / 共 ${count} 步`,{exact:false})).toBeVisible();
   const box=await module.boundingBox();if(box.x<0||box.y<0||box.x+box.width>width+1||box.y+box.height>(width===390?844:900)+1)throw Error('module overflow '+width);
  }
  await page.getByLabel('选择模块讲解内容').selectOption('1');
  await page.screenshot({path:`.artifacts/guide-module-${width}.png`});
  await module.getByRole('button',{name:'解释这一项',exact:true}).click();
  const url=page.url();
  await page.getByRole('button',{name:'查看全部项目',exact:true}).click();
  await expect(page.locator('[data-help-ui]').getByText('查看全部项目',{exact:true})).toBeVisible();
  if(page.url()!==url)throw Error('inspect navigated');
  await page.screenshot({path:`.artifacts/guide-inspect-${width}.png`});
  await page.getByRole('button',{name:'退出讲解'}).click();
  await menu.getByRole('button',{name:'认识我的工作台',exact:false}).click();
  await expect(tour).toBeVisible();
  await tour.getByRole('button',{name:'跳过'}).click();
  await page.reload();await page.waitForTimeout(500);
  await expect(tour).toHaveCount(0);
  if(errors.length)throw Error(errors.join('\n'));
  console.log(width+': 三层入口、跳选、全部步骤边界、单项解释不执行、重看与已读通过');
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
