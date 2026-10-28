'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const {_electron: electron} = require('C:/Users/31701/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), qa = path.join(root,'verification-petdex');
fs.mkdirSync(qa,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'landing-buddy-qa-'));
fs.mkdirSync(path.join(profile,'data')); fs.writeFileSync(path.join(profile,'data','prefs.json'),JSON.stringify({activity:{enabled:false,ask:false},closeAction:'quit',desktopPet:{enabled:true}}));
const runtime=path.join(profile,'runtime');fs.mkdirSync(path.join(runtime,'resources','app'),{recursive:true});
for(const e of fs.readdirSync(path.join(root,'着陆'),{withFileTypes:true})){if(e.isFile())fs.linkSync(path.join(root,'着陆',e.name),path.join(runtime,e.name));else if(e.name==='locales')fs.symlinkSync(path.join(root,'着陆',e.name),path.join(runtime,e.name),'junction');}
const target=process.env.LANDING_QA_ASAR==='1'?path.join(root,'app.asar','main.js'):path.join(root,'_stage','main.js');
fs.writeFileSync(path.join(runtime,'resources','app','package.json'),JSON.stringify({name:'landing-buddy-qa',main:'main.cjs'}));
fs.writeFileSync(path.join(runtime,'resources','app','main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(target)});`);
const results=[],errors=[];let app,page,pet;
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('landing.v2')));
async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
async function run(){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:path.join(runtime,'electron.exe'),args:['--hidden'],env});
 for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));pet=app.windows().find(p=>p.url().endsWith('desktop-pet.html'));if(page&&pet)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(page);assert.ok(pet);[page,pet].forEach(w=>w.on('pageerror',e=>errors.push(e.message)));
 await page.waitForFunction(()=>window.Landing&&window.Pet);await pet.waitForFunction(()=>document.querySelector('canvas').dataset.rig==='petdex-atlas');
 await check('independent transparent Uika window plays native frames',async()=>{
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('desktop-pet.html')).isAlwaysOnTop()),true);
  const a=await pet.locator('canvas').screenshot();await pet.waitForTimeout(400);assert.notDeepEqual(a,await pet.locator('canvas').screenshot());await pet.screenshot({path:path.join(qa,'desktop-pet.png')});
 });
 await check('desktop starts actual five-minute timer with hidden main window',async()=>{
  if(!await pet.locator('#controls').isVisible())await pet.locator('#avatar').click();
  await pet.locator('#start').click();await page.waitForFunction(()=>Landing.state().timer&&Landing.state().timer.discipline);assert.equal((await state()).timer.plannedMin,5);assert.equal((await state()).discipline.tasks[0].trackId,'python');await pet.waitForFunction(()=>document.querySelector('#start').textContent==='暂停一下');await pet.screenshot({path:path.join(qa,'desktop-focus.png')});
 });
 await check('pause freezes shared countdown; resume retains timer identity',async()=>{
  const id=(await state()).timer.id;await pet.locator('#start').click();await page.waitForFunction(()=>Landing.state().timer.paused);await pet.waitForTimeout(1100);const c=await pet.locator('#clock').textContent();await pet.waitForTimeout(1200);assert.equal(await pet.locator('#clock').textContent(),c);await pet.locator('#start').click();await page.waitForFunction(()=>!Landing.state().timer.paused);assert.equal((await state()).timer.id,id);
 });
 await check('finish requires confirmation and never invents learning time',async()=>{
  await pet.locator('#settle').click();await page.locator('[data-ds="confirm"]').waitFor();assert.equal((await state()).discipline.sessions.length,0);assert.equal((await state()).discipline.tasks[0].done,false);await page.locator('[data-ds="confirm"]').click();assert.equal((await state()).timer,null);
 });
 await check('text starts PyTorch and rejects unrecognized commands',async()=>{
  await pet.locator('#text').fill('开始学 PyTorch');await pet.locator('#command button').click();await page.waitForFunction(()=>Landing.state().timer&&Landing.state().timer.name.includes('PyTorch'));const id=(await state()).timer.id;await pet.locator('#text').fill('<img onerror=alert(1)> 删除全部数据');await pet.locator('#command button').click();await pet.waitForTimeout(1100);assert.equal((await state()).timer.id,id);assert.match(await pet.locator('#messages').textContent(),/可以说/);
 });
 await check('capture hides main and pet, then returns two editable frames',async()=>{
  await pet.locator('#capture').click();await pet.waitForTimeout(250);const visible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>/\/(index|desktop-pet)\.html/.test(w.webContents.getURL())).map(w=>w.isVisible()));assert.deepEqual(visible,[false,false]);await page.locator('#lc-form').waitFor({timeout:15000});assert.equal(await page.locator('[data-lc="frame"]').count(),2);await page.locator('#lc-title').fill('PyTorch 张量');await page.locator('#lc-next').fill('继续练习 reshape');await page.locator('#lc-form button[type="submit"]').click();assert.match((await state()).discipline.learning.tracks[1].checkpoint,/reshape/);
 });
 await check('native wave, reduced motion, and bounded movement work',async()=>{
  await pet.evaluate(()=>petdesk.command({action:'wave'}));await pet.waitForTimeout(150);assert.equal(await pet.locator('canvas').getAttribute('data-row'),'3');await page.evaluate(()=>{Landing.state().pet.gentleMotion=true;Landing.save();Pet.refresh();});await pet.waitForFunction(()=>document.querySelector('canvas').dataset.gentle==='true');const a=await pet.locator('canvas').screenshot();await pet.waitForTimeout(300);assert.deepEqual(a,await pet.locator('canvas').screenshot());await pet.evaluate(()=>petdesk.move({x:999999,y:999999}));await pet.waitForTimeout(300);assert.equal(await app.evaluate(({BrowserWindow,screen})=>{const b=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('desktop-pet.html')).getBounds(),a=screen.getDisplayMatching(b).workArea;return b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;}),true);
 });
 await check('hide and restore retain learning state and possessions',async()=>{
  const before=await state();await pet.evaluate(()=>petdesk.hide());await pet.waitForTimeout(100);assert.equal((await page.evaluate(()=>landing.desktopPet.status())).enabled,false);await page.evaluate(()=>landing.desktopPet.configure({enabled:true}));await pet.waitForTimeout(350);assert.equal((await page.evaluate(()=>landing.desktopPet.status())).visible,true);assert.deepEqual((await state()).pet,before.pet);assert.equal((await state()).timer.id,before.timer.id);await page.evaluate(()=>Landing.tab('today'));await page.locator('#buddy-card').screenshot({path:path.join(qa,'uika-home.png')});assert.deepEqual(errors,[]);
 });
 await check('dialogue commands navigate pages and preserve user text as text',async()=>{
  for(const [text,selector] of [['打开日报','[data-digest="settings"]'],['查看周报',null],['打开伙伴','#petPage']]){
   await pet.locator('#text').fill(text);await pet.locator('#command button').click();await pet.waitForFunction(()=>document.querySelector('#messages').lastElementChild.textContent.startsWith('已打开'));await pet.waitForTimeout(200);
   assert.equal(await page.locator('#viewTitle').textContent(),text==='打开日报'?'日报':text==='查看周报'?'周报':'伙伴');if(selector&&text==='打开伙伴')await page.locator(selector).waitFor();
  }
  const timer=(await state()).timer.id;
  await pet.locator('#text').fill('选择 Python');await pet.locator('#command button').click();await page.waitForFunction(()=>Landing.state().discipline.learning.selected==='python');assert.equal((await state()).timer.id,timer);
  await pet.locator('[data-page="today"]').click();await pet.waitForTimeout(200);await page.locator('[data-buddy="settings"]').click();
  await pet.locator('[data-page="weekly"]').click();await pet.waitForTimeout(300);assert.equal(await page.locator('#buddy-settings-form').count(),1);assert.match(await pet.locator('#messages').textContent(),/先完成或关闭/);await page.evaluate(()=>Landing.closeSheet());
  await pet.locator('#collapse').click();assert.equal(await pet.locator('#controls').isVisible(),false);await pet.locator('#avatar').click();await pet.locator('#controls').waitFor();await pet.locator('#help').click();await pet.waitForTimeout(200);assert.match(await pet.locator('#messages').textContent(),/周报回顾/);
  await pet.screenshot({path:path.join(qa,'desktop-dialogue.png')});
 });
}
run().then(async()=>{fs.writeFileSync(path.join(qa,'result.json'),JSON.stringify({status:'passed',checks:results,errors},null,2));await app.close();console.log('Verified '+results.length+' workflows.');}).catch(async e=>{console.error(e);fs.writeFileSync(path.join(qa,'result.json'),JSON.stringify({status:'failed',checks:results,error:e.stack,errors},null,2));if(pet)await pet.screenshot({path:path.join(qa,'failure.png')}).catch(()=>{});if(app)await app.close().catch(()=>{});process.exitCode=1;});
