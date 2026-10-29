'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {_electron:electron}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/31701/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),release=path.resolve(root,'../着陆-发布版/着陆'),qa=path.join(root,'tools/_shots/page-review');fs.mkdirSync(qa,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'studytrail-page-review-'));fs.mkdirSync(path.join(profile,'data'));fs.writeFileSync(path.join(profile,'data/prefs.json'),JSON.stringify({language:'zh-CN',activity:{enabled:false,ask:false},closeAction:'quit',desktopPet:{enabled:true}}));
const runtime=path.join(profile,'runtime');fs.mkdirSync(path.join(runtime,'resources/app'),{recursive:true});
for(const e of fs.readdirSync(release,{withFileTypes:true})){if(e.isFile())fs.linkSync(path.join(release,e.name),path.join(runtime,e.name));else if(e.name==='locales')fs.symlinkSync(path.join(release,e.name),path.join(runtime,e.name),'junction');}
fs.writeFileSync(path.join(runtime,'resources/app/package.json'),JSON.stringify({name:'studytrail-page-review',main:'main.cjs'}));
fs.writeFileSync(path.join(runtime,'resources/app/main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(process.env.STUDYTRAIL_ASAR||path.join(root,'main.js'))});`);
let app,page;const errors=[],audit=[],checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
(async()=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:path.join(runtime,'electron.exe'),env});
 for(let i=0;i<100;i++){page=app.windows().find(w=>w.url().endsWith('index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 app.on('window',w=>w.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(_d,cb)=>cb({cancel:true}))); await page.route('https://**/*',r=>r.abort());await page.waitForFunction(()=>window.Landing&&document.querySelector('#appLanguage'));await page.evaluate(()=>{Pet.state().widget.quiet=true;Landing.save();});
 for(const language of ['zh-CN','en','ja']){
  if(await page.evaluate(()=>I18n.locale())!==language){await page.locator('#appLanguage').selectOption(language);await page.waitForFunction(l=>document.documentElement.lang===l&&window.Landing,language);}
  for(const width of [1440,820,390]){
   await page.setViewportSize({width,height:960});
   for(const tab of ['today','weekly','digest','companion','pet','shop','ledger','me']){
    await page.evaluate(t=>Landing.tab(t),tab);await page.waitForTimeout(180);
    const issues=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,failed:document.querySelector('#view').innerText.includes('这一页没渲染出来'),clipped:[...document.querySelectorAll('#view button,.topbar button,.brand .name')].filter(e=>e.getBoundingClientRect().width&&e.scrollWidth>e.clientWidth+3).map(e=>({text:e.innerText,class:e.className})),clickFx:!!document.querySelector('.click-fx')}));
    if(issues.overflow)issues.outside=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{var r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1);}).slice(-35).map(e=>({tag:e.tagName,id:e.id,class:e.className,text:e.innerText?.slice(0,60),right:e.getBoundingClientRect().right})));
    audit.push({language,width,tab,...issues});
    await page.screenshot({path:path.join(qa,`${language}-${tab}-${width}.png`),fullPage:true});
   }
   await page.evaluate(()=>App.openSettings());await page.locator('.settings-section').evaluateAll(es=>es.forEach(e=>e.open=true));await page.screenshot({path:path.join(qa,`${language}-settings-${width}.png`),fullPage:true});await page.evaluate(()=>Landing.closeSheet());
  }
 }
 await page.locator('#appLanguage').selectOption('zh-CN');await page.waitForFunction(()=>document.documentElement.lang==='zh-CN'&&window.Landing);await page.setViewportSize({width:1440,height:960});
 await check('click ripples are visible with gentle pet motion, then completely clear',async()=>{
  await page.evaluate(()=>{Pet.state().gentleMotion=true;Landing.tab('me');});
  await page.mouse.move(900,240);await page.mouse.down();await page.waitForTimeout(90);
  assert.equal(await page.locator('.click-fx').count(),1);
  assert.ok(await page.locator('.click-fx').evaluate(e=>e.getContext('2d').getImageData(0,0,e.width,e.height).data.some((v,i)=>i%4===3&&v>0)));
  await page.screenshot({path:path.join(qa,'click-ripple.png')});await page.mouse.up();await page.waitForTimeout(800);
  assert.equal(await page.locator('.click-fx').getAttribute('data-active'),'false');
  assert.ok(await page.locator('.click-fx').evaluate(e=>e.getContext('2d').getImageData(0,0,e.width,e.height).data.every((v,i)=>i%4!==3||v===0)));
 });
 await check('click overlay preserves buttons and inputs; OS reduced motion and right click suppress ripples',async()=>{
  await page.locator('#topSettings').click();await page.locator('#s_model').evaluate(e=>e.closest('details').open=true);await page.locator('#s_model').fill('keep-my-draft');
  await page.locator('#s_model').evaluate(e=>e.addEventListener('pointerdown',e=>e.stopPropagation(),{once:true}));await page.locator('#s_model').click();
  assert.equal(await page.locator('.click-fx').getAttribute('data-active'),'true');assert.equal(await page.locator('#s_model').inputValue(),'keep-my-draft');await page.evaluate(()=>Landing.closeSheet());
  await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.click(900,240);assert.equal(await page.locator('.click-fx').getAttribute('data-active'),'false');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.click(900,240,{button:'right'});assert.equal(await page.locator('.click-fx').getAttribute('data-active'),'false');
 });
 await check('desktop pet visibility hides only the duplicate floating widget',async()=>{
  await page.evaluate(()=>Landing.tab('companion'));await page.waitForFunction(()=>document.body.dataset.desktopPetVisible==='true');assert.equal(await page.locator('#petWidget').isVisible(),false);
  await page.evaluate(()=>landing.desktopPet.configure({enabled:false}));await page.waitForFunction(()=>document.body.dataset.desktopPetVisible==='false');assert.equal(await page.locator('#petWidget').isVisible(),true);
  await page.evaluate(()=>landing.desktopPet.configure({enabled:true}));await page.waitForFunction(()=>document.body.dataset.desktopPetVisible==='true');await page.evaluate(()=>Landing.tab('today'));assert.equal(await page.locator('#ds-pet-host canvas').count(),1);
 });
 await check('AI setup prompt opens settings and keeps the close path usable',async()=>{
  await page.evaluate(()=>Landing.tab('companion'));await page.locator('.companion-config').click();assert.equal(await page.locator('[role=dialog]').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('[role=dialog]').count(),0);
 });
 await check('empty weekly data produces a neutral verdict',async()=>{
  await page.evaluate(()=>Landing.tab('weekly'));assert.equal(await page.locator('.sum-verdict').innerText(),'记录不足');assert.match(await page.locator('.sum-body').innerText(),/暂不判断/);assert.equal(await page.locator('.stat-num').first().innerText(),'—');
 });
 await check('a populated weekly report and long checkpoint remain readable',async()=>{
  await page.evaluate(()=>{var s=Landing.state(),now=new Date(),d=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
   s.loose.push({id:'qa-study',date:d,name:'Python 张量与自动求导练习',minutes:45,category:'growth',at:Date.now()});s.weather.push({date:d,mood:'cloud',note:'下课后先学一点，再休息'});
   s.discipline.learning.tracks[0].resume={topic:'PyTorch autograd · 长标题断点示例：张量、梯度与反向传播',note:'从 backward() 的计算图继续，先跑通一个最小例子。'};Landing.save();Landing.tab('weekly');});
  assert.equal(await page.locator('.sum-verdict.v-empty').count(),0);await page.screenshot({path:path.join(qa,'populated-weekly.png'),fullPage:true});
  await page.evaluate(()=>Landing.tab('today'));await page.screenshot({path:path.join(qa,'populated-today.png'),fullPage:true});
 });
 await check('partner speech stays inside its stage',async()=>{
  await page.evaluate(()=>{Landing.tab('pet');Pet.say('今天也一起慢慢来。先学五分钟，下一次从这里继续。',6000);});await page.locator('#pgBub.on').waitFor();const r=await page.evaluate(()=>{var b=document.querySelector('#pgBub').getBoundingClientRect(),s=document.querySelector('.pg-stage').getBoundingClientRect();return {inside:b.left>=s.left&&b.right<=s.right&&b.top>=s.top&&b.bottom<=s.bottom};});assert.equal(r.inside,true);await page.screenshot({path:path.join(qa,'partner-speech.png')});
 });
 await check('daily plans contribute to weekly completion without duplicating focus minutes',async()=>{
  await page.evaluate(()=>{var s=Landing.state(),d=s.loose.find(r=>r.id==='qa-study').date;s.discipline.tasks.push({id:'qa-plan',date:d,name:'读一节 PyTorch',done:true,minutes:25});s.discipline.sessions.push({id:'qa-session',date:d,name:'Python 张量与自动求导练习',minutes:45});Landing.save();Landing.tab('weekly');});
  await page.waitForFunction(()=>document.querySelector('.stat-num').textContent==='100%');const values=await page.locator('.stat-num').allInnerTexts();assert.equal(values[0],'100%');assert.equal(values[2],'45');await page.screenshot({path:path.join(qa,'populated-weekly.png'),fullPage:true});
 });
 await check('narrow navigation appears below the header and closes with Escape',async()=>{
  await page.setViewportSize({width:390,height:960});await page.locator('#sageMenu').click();const b=await page.evaluate(()=>({nav:document.querySelector('.tabbar').getBoundingClientRect().top,header:document.querySelector('.topbar').getBoundingClientRect().bottom}));assert.ok(b.nav>b.header);await page.screenshot({path:path.join(qa,'navigation-390.png')});await page.keyboard.press('Escape');assert.equal(await page.locator('#sageMenu').getAttribute('aria-expanded'),'false');await page.setViewportSize({width:1440,height:960});
 });
 await page.evaluate(()=>landing.desktopPet.settings());await page.waitForTimeout(300);const settings=app.windows().find(w=>w.url().endsWith('desktop-pet-settings.html'));
 for(const section of ['appearance','interaction','startup','guide']){await settings.locator(`[data-section=${section}]`).click();await settings.screenshot({path:path.join(qa,`pet-settings-${section}.png`)});}
 await page.evaluate(()=>petSkins.open());await page.waitForTimeout(300);const skins=app.windows().find(w=>w.url().endsWith('pet-skins-window.html'));if(skins)await skins.screenshot({path:path.join(qa,'skins.png')});
 for(const language of ['en','ja']){await settings.locator('#appLanguage').selectOption(language);await settings.waitForFunction(l=>document.documentElement.lang===l,language);await settings.screenshot({path:path.join(qa,`pet-settings-${language}.png`)});await skins.waitForFunction(l=>document.documentElement.lang===l,language);await skins.screenshot({path:path.join(qa,`skins-${language}.png`)});}
 const pet=app.windows().find(w=>w.url().endsWith('desktop-pet.html'));await pet.evaluate(()=>petdesk.panel(true));await pet.waitForTimeout(200);await pet.screenshot({path:path.join(qa,'desktop-dialog.png')});
 await check('desktop controls keep the primary study button in view',async()=>{const r=await pet.locator('#start').boundingBox(),c=await pet.locator('#controls').boundingBox();assert.ok(r.y>=c.y&&r.y+r.height<=c.y+c.height+1);});
 fs.writeFileSync(path.join(qa,'audit.json'),JSON.stringify({errors,checks,audit},null,2));console.log(JSON.stringify({screenshots:fs.readdirSync(qa).filter(x=>x.endsWith('.png')).length,errors,issues:audit.filter(x=>x.overflow||x.failed||x.clipped.length)},null,2));assert.deepEqual(errors,[]);assert.equal(audit.filter(x=>x.overflow||x.failed||x.clipped.length||!x.clickFx).length,0,'All pages should fit, render and load click feedback');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
