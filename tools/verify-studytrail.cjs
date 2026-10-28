'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {_electron:electron}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/31701/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),release=process.env.STUDYTRAIL_RUNTIME||path.resolve(root,'../着陆-发布版/着陆');
const qa=path.join(root,'tools/_shots/studytrail');fs.mkdirSync(qa,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'studytrail-release-qa-'));fs.mkdirSync(path.join(profile,'data'));
fs.writeFileSync(path.join(profile,'data/prefs.json'),JSON.stringify({language:'zh-CN',activity:{enabled:false,ask:false},closeAction:'quit',desktopPet:{enabled:true}}));
const runtime=path.join(profile,'runtime');fs.mkdirSync(path.join(runtime,'resources/app'),{recursive:true});
for(const e of fs.readdirSync(release,{withFileTypes:true})){if(e.isFile())fs.linkSync(path.join(release,e.name),path.join(runtime,e.name));else if(e.name==='locales')fs.symlinkSync(path.join(release,e.name),path.join(runtime,e.name),'junction');}
const target=process.env.STUDYTRAIL_ASAR||path.join(root,'main.js');
fs.writeFileSync(path.join(runtime,'resources/app/package.json'),JSON.stringify({name:'studytrail-test',main:'main.cjs'}));
fs.writeFileSync(path.join(runtime,'resources/app/main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(target)});`);
let app,page,pet,settings;const results=[],errors=[];
async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
async function launch(){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:path.join(runtime,'electron.exe'),env});
  for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));pet=app.windows().find(p=>p.url().endsWith('desktop-pet.html'));if(page&&pet)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(page);assert.ok(pet);[page,pet].forEach(w=>w.on('pageerror',e=>errors.push(e.message)));await page.route('https://**/*',r=>r.abort());await page.waitForFunction(()=>window.TrailShop&&window.Landing&&document.getElementById('appLanguage'));
}
const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(Pet.state())));
const shop=(act,id)=>page.evaluate(([act,id])=>Pet.shopAct(act,id),[act,id]);
const click=(action,id)=>page.locator('[data-trail="'+action+'"]'+(id==null?'':'[data-id="'+id+'"]')).click();
async function solve(id){await page.evaluate(id=>TrailShop.openTool(id),id);
  if(id==='field_lens'){const answer=await page.locator('.trail-leaves button').evaluateAll(es=>{const paths=es.map(e=>e.querySelectorAll('path')[1].getAttribute('d'));return paths.findIndex(p=>paths.filter(x=>x===p).length===1);});await click('answer',answer);}
  if(id==='watercolors'){await page.locator('[data-trail=pigment]').nth(0).click();await page.locator('[data-trail=pigment]').nth(2).click();await click('mix');}
  if(id==='brass_compass'){for(const n of [1,5,4,8,12,13,14,10,11,15])await click('step',n);}
  if(id==='sky_atlas'){const seq=await page.locator('.trail-moons span').allTextContents();const answer=seq[0]==='🌑'?'🌓':seq[0]==='🌕'?'🌗':'🌒';await click('answer',answer);}
  if(id==='travel_journal'){const preferred=await page.locator('.trail-story b').textContent();await page.locator('[data-trail=answer]').filter({hasText:preferred}).click();}
  if(id==='cloud_thermos'){await page.locator('[data-trail=restDone]').waitFor({timeout:35000});await click('restDone');}
  await page.locator('.trail-result').waitFor();await page.evaluate(()=>Landing.closeSheet());
}
(async()=>{
 await check('catalogue preserves machine values, translates fragments and uses locale dates',async()=>{
  const core=require('../i18n-core.js'),data=require('../locales.js');for(const locale of ['zh-CN','en','ja']){const i=core.create(data,locale);assert.equal(i.weekdays().length,7);assert.equal(i.weekdays(true).length,7);assert.ok(i.date(new Date()));assert.ok(i.html('<option value="今日" data-id="保存">保存</option>').includes('value="今日" data-id="保存"'));}
  assert.equal(core.create(data,'en').original('学迹'),'着陆');
 });
 await launch();await page.setViewportSize({width:1440,height:960});
 await check('existing profile identifiers remain compatible and all 29 items have pixel illustrations',async()=>{
  assert.equal(await page.evaluate(()=>!!localStorage.getItem('landing.v2')),true);const items=await page.evaluate(()=>Pet.catalog());assert.equal(items.length,29);assert.equal(items.filter(i=>i.kind==='tool').length,6);assert.equal(new Set(items.map(i=>i.id)).size,29);
  await page.evaluate(()=>{Pet.state().fish=200;Pet.state().gear.head='ribbon';Pet.state().gentleMotion=true;Landing.save();Landing.tab('shop');});assert.equal(await page.locator('.market-item-art svg').count(),29);await page.locator('[data-pact=category][data-id=tool]').click();assert.equal(await page.locator('.market-item').count(),6);assert.equal(await page.locator('.market-item').first().getAttribute('data-dimension'),'好奇心');
  await page.screenshot({path:path.join(qa,'shop-zh.png'),fullPage:true});
 });
 await check('tool preview is free; unknown IDs and repeat permanent purchases never debit money',async()=>{
  const before=await state();await shop('preview','field_lens');assert.equal((await state()).fish,before.fish);await page.evaluate(()=>Landing.closeSheet());await shop('buy','not-real');assert.equal((await state()).fish,before.fish);
  await shop('buy','field_lens');assert.equal((await state()).fish,before.fish-14);await shop('buy','field_lens');assert.equal((await state()).fish,before.fish-14);assert.equal((await state()).owned.field_lens,1);
  for(const id of ['watercolors','brass_compass','sky_atlas','travel_journal','cloud_thermos'])await shop('buy',id);
  assert.equal((await state()).fish,before.fish-92);
 });
 await check('unowned tools and locked postal routes cannot be used',async()=>{
  await page.evaluate(()=>{delete Pet.state().owned.field_lens;TrailShop.openTool('field_lens');});assert.equal(await page.locator('.trail-leaves').count(),0);await page.evaluate(()=>TrailShop.travel('forest'));assert.equal((await state()).trailWorkshop.journey,undefined);await page.evaluate(()=>{Pet.state().owned.field_lens=1;Landing.closeSheet();});
 });
 await check('active study blocks tools and journeys without changing the timer or awarding minutes',async()=>{
  await page.evaluate(()=>{Discipline.desktopAction('study','python');});const before=await page.evaluate(()=>JSON.stringify(Landing.state().timer));await page.evaluate(()=>{TrailShop.openTool('field_lens');TrailShop.travel('garden');});assert.equal(await page.locator('.trail-leaves').count(),0);assert.equal(await page.evaluate(()=>JSON.stringify(Landing.state().timer)),before);await page.evaluate(()=>{Landing.state().timer=null;Landing.save();Landing.render();});
 });
 await check('five different activities grow their corresponding attributes and save the custom stamp',async()=>{
  await page.evaluate(()=>{var p=Pet.state(),g=PetAdventure.state();p.trailWorkshop={};g.inspiration=9;g.daily.plays=0;g.rounds=[];});const before=await state();
  for(const id of ['field_lens','watercolors','brass_compass','sky_atlas','travel_journal'])await solve(id);
  const after=await state();for(const k of ['curiosity','creativity','courage','wits','rapport'])assert.equal(after[k],before[k]+3,k);assert.equal(after.adventure.daily.plays,5);assert.equal(after.adventure.inspiration,4);assert.equal(after.trailWorkshop.stampColors.length,2);assert.equal(after.fish,before.fish);
 });
 await check('nonadjacent maze steps are harmless; daily rewards cannot be repeated',async()=>{
  const before=await state();await solve('field_lens');assert.equal((await state()).curiosity,before.curiosity);await page.evaluate(()=>TrailShop.openTool('brass_compass'));await click('step',15);assert.equal(await page.locator('[data-trail=step][data-id="0"]').textContent(),'♟');await page.evaluate(()=>Landing.closeSheet());assert.equal((await state()).courage,before.courage);
 });
 await check('quiet rest uses real elapsed time and shares the six-growth cap',async()=>{
  const before=await state();await solve('cloud_thermos');const after=await state();assert.ok(after.energy>=Math.min(100,before.energy+6)-.05);assert.equal(after.adventure.daily.plays,6);const total=await page.evaluate(()=>Landing.state().discipline.sessions.length);await solve('sky_atlas');assert.equal((await state()).adventure.inspiration,after.adventure.inspiration);assert.deepEqual((await state()).adventure.rounds,after.adventure.rounds);assert.equal(await page.evaluate(()=>Landing.state().discipline.sessions.length),total);
 });
 await check('journey choices persist between openings; completed cards are collected without fake learning or fish',async()=>{
  const before=await state(),minutes=await page.evaluate(()=>Landing.state().discipline.sessions.length);await page.evaluate(()=>TrailShop.travel('forest'));await click('travelChoice',0);assert.equal((await state()).trailWorkshop.journey.step,1);await page.evaluate(()=>{Landing.closeSheet();TrailShop.travel();});await click('travelChoice',1);await click('travelChoice',2);const after=await state();assert.equal(after.trailWorkshop.journey,null);assert.equal(after.trailWorkshop.postcards.length,1);assert.equal(after.adventure.daily.plays,6);assert.equal(after.fish,before.fish);assert.equal(await page.evaluate(()=>Landing.state().discipline.sessions.length),minutes);await page.screenshot({path:path.join(qa,'postcard-zh.png')});await page.evaluate(()=>Landing.closeSheet());
 });
 await check('a tool can grow after replenishing inspiration; six opportunities remain the shared hard limit',async()=>{
  await page.evaluate(()=>{var p=Pet.state(),g=PetAdventure.state();g.daily.plays=0;g.inspiration=0;p.trailWorkshop.daily.tools=[];g.rounds=[];});const before=await state();await solve('field_lens');assert.equal((await state()).curiosity,before.curiosity);await page.evaluate(()=>{PetAdventure.state().inspiration=3;});await solve('field_lens');assert.equal((await state()).curiosity,before.curiosity+3);
 });
 await check('three-language switching updates the desktop, main window and native menus while retaining user text',async()=>{
  await page.evaluate(()=>{var p=Pet.state();p.name='今日·保存·伙伴';p.rewards.push({id:'qa-user-text',name:'不要翻译今日与保存',cost:2});Landing.save();landing.desktopPet.settings();});await page.waitForTimeout(400);settings=app.windows().find(w=>w.url().endsWith('desktop-pet-settings.html'));assert.ok(settings);settings.on('pageerror',e=>errors.push(e.message));
  for(const language of ['en','ja','zh-CN']){
   await page.locator('#appLanguage').selectOption(language);await page.waitForFunction(l=>document.documentElement.lang===l&&document.querySelector('#appLanguage'),language);await pet.waitForFunction(l=>document.documentElement.lang===l,language);await settings.waitForFunction(l=>document.documentElement.lang===l,language);
   assert.equal((await state()).name,'今日·保存·伙伴');assert.equal((await state()).rewards.find(r=>r.id==='qa-user-text').name,'不要翻译今日与保存');
   for(const tab of ['today','weekly','digest','companion','pet','shop','me']){await page.evaluate(t=>Landing.tab(t),tab);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),tab+' '+language);if(['today','shop','pet'].includes(tab))await page.screenshot({path:path.join(qa,language+'-'+tab+'.png')});}
   await page.evaluate(()=>{const s=Landing.state();s.digestPrefs={provider:'github',interests:['ai'],keywords:['我的关键词'],auto:false,mode:'active',language:''};s.digest={[Landing.today()]:{fetchedAt:Date.now(),categories:{'AI 与机器学习':[{name:'qa/tensor',url:'https://github.com/qa/tensor',desc:'用户自己的中文简介',stars:42,lang:'Python'}],'我的关键词':[{name:'qa/custom',url:'https://github.com/qa/custom',desc:'Keep user text',stars:3,lang:'JavaScript'}]}}};Landing.tab('digest');});
   assert.equal(await page.locator('.digest-project').count(),2);await page.locator('[data-cat="AI 与机器学习"]').click();assert.equal(await page.locator('.digest-project').count(),1);await page.locator('[data-cat=all]').click();assert.equal(await page.locator('.digest-project').count(),2);assert.equal(await page.locator('[data-cat="我的关键词"]').textContent(),'我的关键词');assert.ok((await page.locator('.digest-description').allTextContents()).includes('用户自己的中文简介'));
   await page.evaluate(()=>App.openSettings());await page.locator('.settings-section').evaluateAll(es=>es.forEach(e=>e.open=true));await page.screenshot({path:path.join(qa,language+'-settings.png'),fullPage:true});await page.evaluate(()=>Landing.closeSheet());
  }
 });
 await check('English and Japanese desktop commands use the same explicit action allowlist',async()=>{
  const commands={'open shop':{action:'navigate',page:'shop'},'設定を開く':{action:'navigate',page:'me'},'start Python':{action:'study',track:'python'},'PyTorchを学ぶ':{action:'study',track:'pytorch'},'pause':{action:'pause'},'再開':{action:'resume'},'checkpoint':{action:'capture'},'スキン変更':{action:'skins'}};
  for(const [input,expected]of Object.entries(commands))assert.deepEqual(await page.evaluate(s=>DesktopPetBridge.parse(s),input),expected);assert.equal(await page.evaluate(()=>DesktopPetBridge.parse('maybe we should start Python tomorrow')),null);
 });
 await check('narrow layouts remain within the viewport and retain the full toolkit',async()=>{
  for(const width of [820,540,390]){await page.setViewportSize({width,height:844});for(const tab of ['today','pet','shop','me']){await page.evaluate(t=>Landing.tab(t),tab);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),tab+' '+width);}await page.evaluate(()=>TrailShop.openTool('watercolors'));assert.equal(await page.locator('.sheet').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.evaluate(()=>Landing.closeSheet());}await page.screenshot({path:path.join(qa,'phone-width.png')});
 });
 await check('wallet, tool ownership, postcard collection, name and language survive a full restart',async()=>{
  await page.evaluate(()=>Landing.save());const before=await state();await app.close();page=null;pet=null;await launch();const after=await state();assert.equal(after.fish,before.fish);assert.deepEqual(after.owned,before.owned);assert.deepEqual(after.trailWorkshop,before.trailWorkshop);assert.equal(after.name,before.name);assert.equal(await page.evaluate(()=>I18n.locale()),'zh-CN');
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,'results.json'),JSON.stringify({status:'passed',results,errors},null,2));console.log('Verified '+results.length+' StudyTrail workflows.');
})().catch(async error=>{console.error(error);fs.writeFileSync(path.join(qa,'results.json'),JSON.stringify({status:'failed',results,error:error.stack,errors},null,2));if(page)await page.screenshot({path:path.join(qa,'failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
