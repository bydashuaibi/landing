'use strict';
// Opt-in real network/model check. Uses only a public course image; never writes the user's profile.
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert/strict');
const {chromium,_electron:electron}=require('C:/Users/31701/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),release=path.resolve(root,'../着陆-发布版/着陆'),dir=path.join(__dirname,'_shots/bilibili');fs.mkdirSync(dir,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'studytrail-bilibili-live-'));
fs.mkdirSync(path.join(profile,'data'));fs.writeFileSync(path.join(profile,'data/prefs.json'),JSON.stringify({language:'zh-CN',activity:{enabled:false,ask:false,quietModeVersion:1},closeAction:'quit',desktopPet:{enabled:false}}));
const store=path.join(process.env.APPDATA,'landing/Local Storage');
if(fs.existsSync(store))fs.cpSync(store,path.join(profile,'Local Storage'),{recursive:true,filter:p=>path.basename(p)!=='LOCK'});
const runtime=path.join(profile,'runtime');fs.mkdirSync(path.join(runtime,'resources/app'),{recursive:true});
for(const e of fs.readdirSync(release,{withFileTypes:true})){if(e.isFile())fs.linkSync(path.join(release,e.name),path.join(runtime,e.name));else if(e.name==='locales')fs.symlinkSync(path.join(release,e.name),path.join(runtime,e.name),'junction');}
fs.writeFileSync(path.join(runtime,'resources/app/package.json'),JSON.stringify({name:'studytrail-bilibili-live',main:'main.cjs'}));
fs.writeFileSync(path.join(runtime,'resources/app/main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'main.js'))});`);
let browser,app;
(async()=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:path.join(runtime,'electron.exe'),env});let appPage;
for(let i=0;i<100;i++){appPage=app.windows().find(w=>w.url().endsWith('index.html'));if(appPage)break;await new Promise(r=>setTimeout(r,100));}
await appPage.waitForFunction(()=>window.Landing);
const ready=await appPage.evaluate(()=>{const s=Landing.state().settings;return !!(s.aiBaseUrl&&s.aiKey);});
if(!ready){console.log('SKIP real model: no configured main AI in the isolated copy');return;}
browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:720},locale:'zh-CN'});
await page.goto('https://www.bilibili.com/video/BV1sHU9BmEne?t=77.1&p=36',{waitUntil:'domcontentloaded',timeout:45000});
await page.waitForFunction(()=>document.title.includes('36.'));
await page.waitForTimeout(5000);
const title=await page.title(),results=[];let now=100000,aiCalls=0,lastReply=null,pending=null,snapshot=null;
const x={id:'live-course',name:'学习 Python',step:'学习核心语法和数据容器',discipline:true,paused:true,finished:false,remainMs:1500000,monitorEnabled:true,monitorHold:true,monitorVision:true,resourceUrl:page.url()};
const context={Date:{now:()=>now},URL,I18n:{t:s=>s},setInterval(){},document:{getElementById:()=>null,querySelector:()=>null},addEventListener(){},landing:{focusMonitor:{configure:async()=>true,hide(){},remind(){},sample:async capture=>({id:x.id,proc:'msedge',title,image:capture?snapshot:undefined})}}};context.window=context;
vm.runInNewContext(fs.readFileSync(path.join(root,'focus-monitor.js'),'utf8'),context);
context.FocusMonitor.init({state:()=>({timer:x}),save(){},render(){},pause(){if(x.paused){x.endsAt=now+x.remainMs;x.paused=false;}else{x.remainMs=x.endsAt-now;x.paused=true;}},callAI:async(messages,which,options)=>{aiCalls++;pending=appPage.evaluate(async({messages,which,options})=>{const r=await Landing.callAI(messages,which,options);return {content:r.content||'',failed:!!r.error};},{messages,which,options});lastReply=await pending;return lastReply;}});
for(let i=0;i<2;i++){
if(i){await page.waitForTimeout(5000);now+=180000;x.monitorSampleAt=now;}
const shot=await page.screenshot({path:path.join(dir,'real-frame-'+(i+1)+'.jpg'),type:'jpeg',quality:65});snapshot='data:image/jpeg;base64,'+shot.toString('base64');
await context.FocusMonitor.poll();if(pending)await pending;await new Promise(r=>setImmediate(r));await context.FocusMonitor.poll();await context.FocusMonitor.poll();
results.push({frame:i+1,title,reply:lastReply,paused:x.paused,status:context.FocusMonitor.status()});console.log(JSON.stringify(results.at(-1)));
assert.equal(lastReply.failed,false,'Configured model failed to process the image');assert.equal(JSON.parse(lastReply.content.replace(/^```(?:json)?\s*|\s*```$/g,'')).related,true,'The real course frame was not judged relevant');assert.equal(x.paused,false);
}
assert.equal(aiCalls,2);fs.writeFileSync(path.join(dir,'live-results.json'),JSON.stringify({title,aiCalls,results},null,2));console.log('PASS two real course screenshots through the configured AI and the production monitor logic');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(app)await app.close();if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('studytrail-bilibili-live-'))fs.rmSync(profile,{recursive:true,force:true});});
