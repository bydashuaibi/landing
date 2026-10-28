'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {_electron:electron}=require('C:/Users/31701/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'verification-sage');fs.mkdirSync(qa,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'landing-sage-qa-'));
fs.mkdirSync(path.join(profile,'data'));fs.writeFileSync(path.join(profile,'data/prefs.json'),JSON.stringify({activity:{enabled:false,ask:false},closeAction:'quit',desktopPet:{enabled:false}}));
const runtime=path.join(profile,'runtime');fs.mkdirSync(path.join(runtime,'resources/app'),{recursive:true});
for(const e of fs.readdirSync(path.join(root,'着陆'),{withFileTypes:true})){if(e.isFile())fs.linkSync(path.join(root,'着陆',e.name),path.join(runtime,e.name));else if(e.name==='locales')fs.symlinkSync(path.join(root,'着陆',e.name),path.join(runtime,e.name),'junction');}
const target=process.env.LANDING_QA_ASAR==='1'?path.join(root,'app.asar/main.js'):path.join(root,'_stage/main.js');
fs.writeFileSync(path.join(runtime,'resources/app/package.json'),JSON.stringify({name:'landing-sage-qa',main:'main.cjs'}));
fs.writeFileSync(path.join(runtime,'resources/app/main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(target)});`);
let app,page,pet,skins;const results=[],errors=[];
async function launch(){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:path.join(runtime,'electron.exe'),env});for(let i=0;i<80;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}assert.ok(page);page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());await page.waitForFunction(()=>window.Landing&&document.querySelector('.sage-stage'));}
async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
async function petPage(){for(let i=0;i<80;i++){pet=app.windows().find(p=>p.url().endsWith('desktop-pet.html'));if(pet)break;await page.waitForTimeout(100);}assert.ok(pet);await pet.locator('#sprite canvas').waitFor();}
async function nativePet(){return app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('desktop-pet.html'));return w&&{visible:w.isVisible(),top:w.isAlwaysOnTop(),parent:!!w.getParentWindow(),background:w.getBackgroundColor()};});}
(async()=>{
 await launch();await page.evaluate(()=>{Pet.state().widget.quiet=true;Pet.state().gentleMotion=true;Landing.save();Landing.render();});
 await check('1440×960 hero has left copy, central live pet, right metrics and no overflow',async()=>{
  await page.setViewportSize({width:1440,height:960});await page.waitForTimeout(650);
  const b=await page.evaluate(()=>{const rect=s=>{const b=document.querySelector(s).getBoundingClientRect();return {x:b.x,right:b.right,y:b.y,bottom:b.bottom,width:b.width};};return {copy:rect('.sage-stage .ds-hero'),pet:rect('.sage-stage #buddy-card'),stats:rect('.sage-stage .ds-stats'),stage:rect('.sage-stage'),scroll:document.documentElement.scrollWidth,bg:getComputedStyle(document.body).backgroundColor,shadow:getComputedStyle(document.querySelector('.sage-stage .ds-stats>div')).boxShadow};});
  assert.ok(b.copy.right<=b.pet.x);assert.ok(b.pet.right<=b.stats.x);assert.ok(b.stage.bottom<=961);assert.ok(b.scroll<=1440);assert.equal(b.bg,'rgb(203, 207, 184)');assert.equal(b.shadow,'none');
  assert.equal(await page.locator('.sage-stage .ds-stats>div').count(),3);assert.equal(await page.locator('.sage-stage #ds-pet-host canvas').count(),1);await page.screenshot({path:path.join(qa,'hero-1440.png')});
 });
 await check('wide landscape keeps its stage in frame; portrait places metrics before the pet',async()=>{
  for(const [width,height] of [[2560,1080],[1024,768],[820,900],[540,960],[380,850]]){
   await page.setViewportSize({width,height});const b=await page.evaluate(()=>{const a=document.querySelector('.ds-stats').getBoundingClientRect(),b=document.querySelector('#buddy-card').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,stats:a.y,statsBottom:a.bottom,pet:b.y};});assert.ok(!b.overflow,width+' overflow');if(height>width)assert.ok(b.statsBottom<=b.pet+1,JSON.stringify(b));
  }await page.screenshot({path:path.join(qa,'hero-380.png')});
 });
 await check('phone navigation opens, selects a real page, and closes with Escape',async()=>{
  await page.locator('#sageMenu').click();assert.equal(await page.locator('#sageMenu').getAttribute('aria-expanded'),'true');await page.evaluate(()=>Landing.render());assert.equal(await page.locator('#sageMenu').getAttribute('aria-expanded'),'true');await page.locator('#sageNavigation [data-tab=weekly]').click();assert.match(await page.locator('#viewTitle').textContent(),/周/);assert.equal(await page.locator('#sageMenu').getAttribute('aria-expanded'),'false');await page.locator('#sageMenu').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'sageMenu');assert.equal(await page.locator('#sageMenu').getAttribute('aria-expanded'),'false');await page.evaluate(()=>Landing.tab('today'));
 });
 await check('primary CTA starts the selected PyTorch track for five minutes without duplicate timers',async()=>{
  await page.setViewportSize({width:1440,height:960});await page.evaluate(()=>{Landing.state().discipline.learning.selected='pytorch';Landing.render();});await page.locator('[data-sage=begin]').click();const t=await page.evaluate(()=>{var t=Landing.state().timer;return {id:t.taskId,min:t.plannedMin,track:Landing.state().discipline.tasks.find(x=>x.id===t.taskId).trackId};});assert.equal(t.min,5);assert.equal(t.track,'pytorch');await page.locator('[data-sage=begin]').click();assert.equal(await page.evaluate(()=>Landing.state().timer.taskId),t.id);await page.evaluate(()=>{Landing.state().timer=null;Landing.render();});
 });
 await check('desktop reveal works even when a saved preference disabled the native window',async()=>{
  assert.equal((await page.evaluate(()=>landing.desktopPet.status())).enabled,false);await page.locator('.sage-hero-actions [data-sage=desktop]').click();await petPage();await pet.waitForTimeout(200);assert.deepEqual(await nativePet(),{visible:true,top:true,parent:false,background:'#000000'});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).hide());assert.equal((await nativePet()).visible,true);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html')).show());await pet.screenshot({path:path.join(qa,'desktop.png')});
 });
 await check('skin manager has a direct desktop action and applying the current skin reveals it',async()=>{
  await app.evaluate(({session})=>session.fromPartition('persist:landing-petdex').protocol.handle('https',()=>new Response('<html><body>Isolated Petdex catalog</body></html>',{headers:{'content-type':'text/html'}})));
  await page.evaluate(async()=>{await landing.desktopPet.configure({enabled:false});await petSkins.open();});for(let i=0;i<60;i++){skins=app.windows().find(p=>p.url().endsWith('pet-skins-window.html'));if(skins)break;await page.waitForTimeout(100);}assert.ok(skins);skins.on('pageerror',e=>errors.push(e.message));await skins.locator('#showDesktop').click();assert.equal((await nativePet()).visible,true);
  const before=await page.evaluate(()=>JSON.stringify([Pet.state().fish,Pet.state().gear,Pet.state().intimacy,Pet.state().adventure]));await page.evaluate(()=>landing.desktopPet.configure({enabled:false}));await skins.locator('#restore').click();assert.equal((await nativePet()).visible,true);assert.equal(await page.evaluate(()=>JSON.stringify([Pet.state().fish,Pet.state().gear,Pet.state().intimacy,Pet.state().adventure])),before);await skins.locator('#libraryTab').click();await skins.screenshot({path:path.join(qa,'skin-library.png')});await skins.close();
 });
 await check('system reduced motion skips entrance effects and all CSS transitions',async()=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.waitForFunction(()=>document.querySelector('.sage-stage'));await page.waitForTimeout(100);const motion=await page.evaluate(()=>({animations:document.getAnimations().filter(a=>a.playState==='running').length,duration:getComputedStyle(document.querySelector('.sage-hero-actions .btn')).transitionDuration,video:document.querySelectorAll('video').length}));assert.deepEqual(motion,{animations:0,duration:'0s',video:0});
 });
 await check('shop headings, product descriptions and prices have readable contrast on sage cards',async()=>{
  await page.evaluate(()=>Landing.tab('shop'));
  const contrasts=await page.evaluate(()=>{
   function rgb(s){return (s.match(/[\d.]+/g)||[]).map(Number);}
   function blend(f,b){var a=f.length>3?f[3]:1;return f.slice(0,3).map((v,i)=>v*a+b[i]*(1-a));}
   function background(el){if(!el)return [203,207,184];return blend(rgb(getComputedStyle(el).backgroundColor),background(el.parentElement));}
   function l(c){return c.map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
   return ['.market-banner h2','.market-item h3','.market-item-body p','.market-price','.market-wallet strong','.market-categories button[aria-pressed=false]'].map(s=>{var el=document.querySelector(s),a=l(rgb(getComputedStyle(el).color)),b=l(background(el));return {selector:s,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  });for(const c of contrasts)assert.ok(c.ratio>=4.5,JSON.stringify(c));await page.screenshot({path:path.join(qa,'shop-1440.png')});await page.evaluate(()=>Landing.tab('today'));
 });
 await app.close();app=null;await launch();await check('enabled desktop preference and selected learning track survive a full app restart',async()=>{await petPage();assert.equal((await page.evaluate(()=>landing.desktopPet.status())).enabled,true);assert.equal(await page.evaluate(()=>Landing.state().discipline.learning.selected),'pytorch');assert.equal((await nativePet()).visible,true);});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,'results.json'),JSON.stringify({results,errors,profile},null,2));console.log('PASS '+results.length+' Sage Studio / native desktop scenarios, zero renderer errors');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
