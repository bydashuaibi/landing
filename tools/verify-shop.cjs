'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const {_electron: electron} = require('C:/Users/31701/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), qa = path.join(root,'verification-shop');
fs.mkdirSync(qa,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'landing-buddy-qa-'));
fs.mkdirSync(path.join(profile,'data')); fs.writeFileSync(path.join(profile,'data','prefs.json'),JSON.stringify({activity:{enabled:false,ask:false},closeAction:'quit',desktopPet:{enabled:true}}));
const runtime=path.join(profile,'runtime');fs.mkdirSync(path.join(runtime,'resources','app'),{recursive:true});
for(const e of fs.readdirSync(path.join(root,'着陆'),{withFileTypes:true})){if(e.isFile())fs.linkSync(path.join(root,'着陆',e.name),path.join(runtime,e.name));else if(e.name==='locales')fs.symlinkSync(path.join(root,'着陆',e.name),path.join(runtime,e.name),'junction');}
const target=process.env.LANDING_QA_ASAR==='1'?path.join(root,'app.asar','main.js'):path.join(root,'_stage','main.js');
fs.writeFileSync(path.join(runtime,'resources','app','package.json'),JSON.stringify({name:'landing-buddy-qa',main:'main.cjs'}));
fs.writeFileSync(path.join(runtime,'resources','app','main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(target)});`);
let app,page,pet;const results=[],errors=[];
const get=()=>page.evaluate(()=>JSON.parse(JSON.stringify(Pet.state())));
const act=(a,id='')=>page.evaluate(([a,id])=>Pet.shopAct(a,id),[a,id]);
async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:path.join(runtime,'electron.exe'),env});
 for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().endsWith('index.html'));pet=app.windows().find(p=>p.url().endsWith('desktop-pet.html'));if(page&&pet)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(page);assert.ok(pet);[page,pet].forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
 await page.waitForFunction(()=>window.Landing&&window.Pet);await page.route('https://**/*',r=>r.abort());
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>{var p=Pet.state();p.name='初华';p.fish=3;p.widget.quiet=true;p.noHunger=true;Landing.save();Landing.tab('shop');});
 await check('23 products with useful categories and affordable filter',async()=>{
   assert.equal(await page.locator('.market-item').count(),23);await act('category','food');assert.equal(await page.locator('.market-item').count(),7);
   await act('affordable');assert.equal(await page.locator('.market-item').count(),3);await act('affordable');await act('category','gear');assert.equal(await page.locator('.market-item').count(),7);
   assert.equal(await page.locator('[data-item=ribbon] button:disabled').count(),1);
 });
 await check('unaffordable purchase and unowned use cannot change wallet or equipment',async()=>{
   const p=await get();await act('buy','crown');await act('use','crown');const q=await get();assert.equal(q.fish,p.fish);assert.deepEqual(q.gear,p.gear);assert.equal(q.owned.crown,undefined);
 });
 await check('try on gear and room without changing saved or desktop state',async()=>{
   const p=await get();await act('preview','ribbon');assert.match(await page.locator('#marketAvatar canvas').getAttribute('data-gear'),/ribbon/);
   await pet.waitForTimeout(1100);assert.doesNotMatch(await pet.locator('canvas').getAttribute('data-gear'),/ribbon/);
   await act('preview','night');assert.equal(await page.locator('#marketRoom').getAttribute('data-scene'),'night');const q=await get();assert.deepEqual(q.gear,p.gear);assert.equal(q.scene,p.scene);assert.equal(q.fish,p.fish);await act('preview');
 });
 await check('wishlist persists and tracks wallet without charging it',async()=>{
   await act('wish','ribbon');assert.equal((await get()).wishId,'ribbon');assert.match(await page.locator('.market-wish').textContent(),/还差 3 条/);assert.equal((await get()).fish,3);
   await page.reload();await page.waitForFunction(()=>window.Landing&&window.Pet);await page.evaluate(()=>Landing.tab('shop'));assert.equal((await get()).wishId,'ribbon');
 });
 await page.evaluate(()=>{Pet.state().fish=500;Landing.save();Landing.render();});
 await check('buy unique gear once, record debit, toggle and sync desktop',async()=>{
   const p=await get();await page.locator('[data-item=ribbon] [data-pact=buy]').click();assert.equal((await get()).fish,p.fish-6);assert.equal((await get()).gear.head,'ribbon');assert.equal((await get()).fishLog.at(-1).n,-6);
   await act('buy','ribbon');assert.equal((await get()).fish,p.fish-6);await pet.waitForFunction(()=>JSON.parse(document.querySelector('canvas').dataset.gear).head==='ribbon');
   await act('use','ribbon');assert.equal((await get()).gear.head,null);await act('use','ribbon');assert.equal((await get()).gear.head,'ribbon');
   assert.match(await page.locator('.market-wish').textContent(),/已经拥有/);
 });
 await check('all new accessories have visibly different pixels',async()=>{
   await page.evaluate(()=>{Pet.state().gentleMotion=true;Landing.render();});await page.waitForTimeout(180);
   await act('preview','');const base=await page.locator('#marketAvatar canvas').screenshot();
   for(const id of ['beret','headphones','starclip']){await act('preview',id);assert.notDeepEqual(await page.locator('#marketAvatar canvas').screenshot(),base);await page.locator('#marketRoom').screenshot({path:path.join(qa,'preview-'+id+'.png')});}
   await page.evaluate(()=>{Pet.state().gentleMotion=false;Landing.save();});await act('preview','');
 });
 await check('consumable stock, hunger cap and actual affection changes',async()=>{
   await page.evaluate(()=>{Pet.state().hunger=96;Pet.state().intimacy=20;Landing.save();});const p=await get();await act('buy','cookie');assert.equal((await get()).owned.cookie,1);await act('use','cookie');const q=await get();assert.equal(q.owned.cookie,0);assert.equal(q.hunger,100);assert.equal(q.intimacy,22);assert.equal(q.fish,p.fish-2);await act('use','cookie');assert.equal((await get()).intimacy,22);
 });
 await check('toys animate and share one affection cooldown across toys',async()=>{
   await act('buy','musicbox');await act('buy','camera');await act('buy','sketchbook');await act('buy','laser');
   for(const [id,motion,row] of [['musicbox','music','8'],['camera','camera','3'],['sketchbook','sketch','6'],['laser','laser','1']]){
     const before=await get();await act('use',id);assert.equal(await page.locator('#marketAvatar canvas').getAttribute('data-motion'),motion);assert.equal(await page.locator('#marketAvatar canvas').getAttribute('data-row'),row);
     if(id==='musicbox')assert.equal((await get()).intimacy,before.intimacy+1);else assert.equal((await get()).intimacy,before.intimacy);
     await pet.waitForFunction(m=>document.querySelector('canvas').dataset.motion===m,motion);
   }
 });
 await check('scene purchase applies to home, companion and preview then unequips',async()=>{
   await act('buy','night');assert.equal((await get()).scene,'night');await page.evaluate(()=>Landing.tab('today'));assert.equal(await page.locator('.buddy-scene').getAttribute('data-scene'),'night');
   await page.evaluate(()=>Landing.tab('pet'));assert.equal(await page.locator('.pg-stage').getAttribute('data-scene'),'night');assert.equal(await page.locator('[data-market-toy]').count(),4);await page.locator('[data-market-toy=musicbox]').click();assert.equal(await page.locator('#pgCat canvas').getAttribute('data-motion'),'music');
   await act('use','night');assert.equal((await get()).scene,null);await act('use','night');
 });
 await check('custom rewards validate price and redeem exactly once per click',async()=>{
   await page.evaluate(()=>Landing.tab('shop'));await act('category','reward');const count=(await get()).rewards.length;
   await page.locator('#shopRwName').fill('散步买花');await page.locator('#shopRwCost').fill('1.5');await act('addrw');assert.equal((await get()).rewards.length,count);
   await page.locator('#shopRwCost').fill('7');await page.locator('[data-pact=addrw]').click();assert.equal((await get()).rewards.length,count+1);assert.equal(await page.locator('#shopRwName').inputValue(),'');
   const r=(await get()).rewards.at(-1),before=await get();await act('redeem',r.id);const after=await get();assert.equal(after.fish,before.fish-7);assert.equal(after.todo.length,before.todo.length+1);assert.equal(after.fishLog.at(-1).n,-7);
   await act('tododone',after.todo.at(-1).id);assert.equal((await get()).todo.at(-1).done,true);await act('delrw',r.id);assert.equal((await get()).rewards.length,count);
 });
 await check('inventory filters possessions and saved equipment survives reload',async()=>{
   await act('category','owned');assert.equal(await page.locator('.market-item').count(),7);const before=await get();await page.reload();await page.waitForFunction(()=>window.Landing&&window.Pet);await page.evaluate(()=>Landing.tab('shop'));const after=await get();assert.deepEqual(after.gear,before.gear);assert.equal(after.scene,before.scene);assert.deepEqual(after.owned,before.owned);assert.equal(after.fish,before.fish);
 });
 await check('shop, rewards and companion fit narrow and desktop widths',async()=>{
   for(const width of [380,820,1280]){await page.setViewportSize({width,height:900});for(const cat of ['all','gear','reward','owned']){await act('category',cat);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
     await act('category','gear');await page.screenshot({path:path.join(qa,'shop-'+width+'.png'),fullPage:true});}
   await page.evaluate(()=>Landing.tab('pet'));await page.screenshot({path:path.join(qa,'companion.png'),fullPage:true});await pet.screenshot({path:path.join(qa,'desktop-gear.png')});
 });
 await check('manual reading pose reaches desktop without starting a timer',async()=>{
   await page.evaluate(()=>{Pet.state().sleeping=false;Pet.state().studyMode=false;Pet.interact('study');});await pet.waitForFunction(()=>document.querySelector('canvas').dataset.focus==='true');assert.equal(await page.evaluate(()=>!!Landing.state().timer),false);
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,'result.json'),JSON.stringify({status:'passed',results,errors},null,2));await app.close();console.log('Verified '+results.length+' shop workflows.');
})().catch(async e=>{console.error(e);fs.writeFileSync(path.join(qa,'result.json'),JSON.stringify({status:'failed',results,error:e.stack,errors},null,2));if(page)await page.screenshot({path:path.join(qa,'failure.png')}).catch(()=>{});if(app)await app.close().catch(()=>{});process.exitCode=1;});
