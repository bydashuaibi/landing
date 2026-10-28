'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const {_electron: electron} = require('C:/Users/31701/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), qa = path.join(root,'verification-ui-review');
fs.mkdirSync(qa,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'landing-buddy-qa-'));
fs.mkdirSync(path.join(profile,'data')); fs.writeFileSync(path.join(profile,'data','prefs.json'),JSON.stringify({activity:{enabled:false,ask:false},closeAction:'quit',desktopPet:{enabled:false}}));
const runtime=path.join(profile,'runtime');fs.mkdirSync(path.join(runtime,'resources','app'),{recursive:true});
for(const e of fs.readdirSync(path.join(root,'着陆'),{withFileTypes:true})){if(e.isFile())fs.linkSync(path.join(root,'着陆',e.name),path.join(runtime,e.name));else if(e.name==='locales')fs.symlinkSync(path.join(root,'着陆',e.name),path.join(runtime,e.name),'junction');}
const target=process.env.LANDING_QA_ASAR==='1'?path.join(root,'app.asar','main.js'):path.join(root,'_stage','main.js');
fs.writeFileSync(path.join(runtime,'resources','app','package.json'),JSON.stringify({name:'landing-buddy-qa',main:'main.cjs'}));
fs.writeFileSync(path.join(runtime,'resources','app','main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(target)});`);
let app,page;const errors=[],results=[];
async function test(name,fn){await fn();results.push(name);console.log('PASS '+name);}
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:path.join(runtime,'electron.exe'),env});page=await app.firstWindow();
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
 await page.waitForFunction(()=>window.Landing&&window.Pet&&window.UI);
 await test('all seven pages fit desktop, tablet and narrow windows',async()=>{
  for(const width of [1280,820,540,380]){
   await page.setViewportSize({width,height:900});
   for(const tab of ['today','weekly','digest','companion','pet','shop','me']){
    await page.evaluate(t=>Landing.tab(t),tab);await page.waitForTimeout(100);
    const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,head:document.querySelector('#viewTitle').textContent,error:document.querySelector('#view').textContent.includes('这一页没渲染出来')}));
    assert.ok(!size.error,tab);assert.ok(size.scroll<=size.viewport+1,tab+' at '+width+' overflow: '+JSON.stringify(size));
    if(width===380||width===1280)await page.screenshot({path:path.join(qa,`${tab}-${width}.png`),fullPage:true});
   }
  }
 });
 await page.setViewportSize({width:1280,height:900});
 await test('background renders preserve chat draft, caret and focus; page navigation retains draft',async()=>{
  await page.evaluate(()=>Landing.tab('companion'));await page.locator('#aiInput').fill('先学 Python 的张量，再练习一下。');await page.locator('#aiInput').focus();
  await page.evaluate(()=>{document.querySelector('#aiInput').setSelectionRange(4,7);Landing.render();});
  assert.equal(await page.locator('#aiInput').inputValue(),'先学 Python 的张量，再练习一下。');assert.deepEqual(await page.evaluate(()=>[document.activeElement.id,document.activeElement.selectionStart,document.activeElement.selectionEnd]),['aiInput',4,7]);
  await page.evaluate(()=>{Landing.tab('weekly');Landing.tab('companion');});assert.match(await page.locator('#aiInput').inputValue(),/Python/);
 });
 await test('pet settings remain expanded after keyboard toggles and refresh',async()=>{
  await page.evaluate(()=>Landing.tab('pet'));await page.locator('summary').filter({hasText:'详情设定'}).click();
  const toggle=page.getByRole('switch',{name:'不要让它饿'});const old=await toggle.getAttribute('aria-checked');await toggle.focus();await page.keyboard.press('Space');
  assert.notEqual(await toggle.getAttribute('aria-checked'),old);assert.ok(await toggle.isVisible());
 });
 await test('settings are grouped, have sticky save, and support modal focus + Escape',async()=>{
  await page.locator('#topSettings').click();assert.equal(await page.locator('[role=dialog]').count(),1);assert.ok(await page.locator('#s_autostart').isVisible());
  assert.equal(await page.locator('.settings-section').count(),5);
  await page.locator('.settings-section > summary').filter({hasText:'AI 与陪伴'}).click();await page.locator('#s_model').fill('draft-model');
  await page.evaluate(()=>Landing.render());assert.equal(await page.locator('#s_model').inputValue(),'draft-model');
  await page.locator('.sheet-close').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'s_save');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'关闭弹窗');
  await page.keyboard.press('Escape');assert.ok(await page.locator('#sheet').evaluate(e=>e.classList.contains('hidden')));assert.equal(await page.evaluate(()=>document.activeElement.id),'topSettings');
 });
 await test('quiet mode records once without any popup, toast or pet reward bubble',async()=>{
  await page.evaluate(async()=>{await landing.activity.setPref({enabled:false,ask:true,askConfirm:false,askNotify:false});Landing.state().timer=null;});
  await page.waitForTimeout(300);
  const baseline=await page.evaluate(()=>({loose:Landing.state().loose.length,fish:Landing.state().pet.fish,toast:document.querySelector('#toast').textContent}));
  await page.evaluate(()=>{window.qaCalls=[];window.qaFish=Pet.onFish;Pet.onFish=function(){qaCalls.push('fish');};var p={segmentId:'qa-one',at:Date.now(),prevProc:'code',prevMinutes:60,prevCat:'work'};Landing.appChanged(p);Landing.appChanged(p);});
  assert.equal(await page.evaluate(()=>Landing.state().loose.length),baseline.loose+1);assert.equal(await page.evaluate(()=>Landing.state().pet.fish),baseline.fish+1);
  assert.equal(await page.locator('#toast').textContent(),baseline.toast);assert.deepEqual(await page.evaluate(()=>qaCalls),[]);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>/ask\.html/.test(w.webContents.getURL())).length),0);
  await page.evaluate(()=>{Pet.onFish=qaFish;});
 });
 await test('manual focus does not get an extra automatic time entry',async()=>{
  const before=await page.evaluate(()=>Landing.state().loose.length);
  await page.evaluate(()=>{Landing.state().timer={finished:false};Landing.appChanged({segmentId:'manual-overlap',prevProc:'code',prevMinutes:5,prevCat:'work'});Landing.state().timer=null;});
  assert.equal(await page.evaluate(()=>Landing.state().loose.length),before);
 });
 await test('recording preference saves and survives reload',async()=>{
  await page.evaluate(()=>Landing.tab('me'));await page.locator('#act_mode').selectOption('silent');await page.locator('[data-act=actSave]').click();
  let prefs=await page.evaluate(()=>landing.activity.get());assert.equal(prefs.askConfirm,false);assert.equal(prefs.askNotify,false);assert.equal(prefs.ask,true);
  await page.reload();await page.waitForFunction(()=>window.Landing);prefs=await page.evaluate(()=>landing.activity.get());assert.equal(prefs.askNotify,false);assert.equal(prefs.askConfirm,false);
 });
 await test('a foreground segment arriving after manual settlement excludes already timed minutes',async()=>{
  const before=await page.evaluate(()=>Landing.state().loose.length);
  await page.evaluate(()=>{var now=Date.now();Landing.state().activityManual={open:null,closed:[{start:now-5*60000,end:now}]};Landing.appChanged({segmentId:'settled-overlap',startedAt:now-5*60000,at:now,prevProc:'code',prevMinutes:5,prevCat:'work'});});
  assert.equal(await page.evaluate(()=>Landing.state().loose.length),before);
 });
 await test('automatic records can be reviewed, renamed and recategorized without changing duration',async()=>{
  await page.evaluate(()=>Landing.tab('me'));await page.locator('[data-act=actHistory]').click();await page.locator('[data-act=actEdit]').first().click();
  await page.locator('#record-name').fill('Python 张量练习');await page.locator('#record-category').selectOption('growth');await page.locator('#record-save').click();
  assert.match(await page.locator('.activity-history').textContent(),/Python 张量练习/);
  const record=await page.evaluate(()=>Landing.state().loose.at(-1));assert.equal(record.minutes,60);assert.equal(record.category,'growth');await page.keyboard.press('Escape');
 });
 await test('narrow settings fit and all expanded fields remain reachable',async()=>{
  await page.setViewportSize({width:380,height:720});await page.locator('#topSettings').click();
  await page.evaluate(()=>document.querySelectorAll('.settings-section').forEach(e=>e.open=true));
  const overflow=await page.locator('.sheet').evaluate(e=>e.scrollWidth>e.clientWidth+1);assert.equal(overflow,false);
  await page.locator('#s_pet_model').scrollIntoViewIfNeeded();assert.ok(await page.locator('#s_pet_model').isVisible());
  await page.screenshot({path:path.join(qa,'settings-380.png')});await page.keyboard.press('Escape');
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,'ui-test-results.json'),JSON.stringify({results,errors},null,2));
 await app.close();console.log('PASS '+results.length+' UI/interaction scenarios, zero renderer errors');
})().catch(async e=>{console.error(e);if(page)await page.screenshot({path:path.join(qa,'failure.png')}).catch(()=>{});if(app)await app.close();process.exitCode=1;});
