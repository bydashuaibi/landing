'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../focus-monitor.js'),'utf8');let checks=0;
function rig(vision=false){
  let now=100000,reminders=0,aiCalls=0,samples=0,ai=async()=>({content:'{"related":true}'});
  const x={id:'task',discipline:true,paused:true,finished:false,remainMs:900000,monitorEnabled:true,monitorHold:true,monitorVision:vision,monitorKeywords:'Python',name:'Learn Python'};
  const state={timer:x,settings:{}},screen={id:'task',proc:'code',title:'Python lesson',image:'data:image/jpeg;base64,fixture'};
  const api={configure:async()=>true,hide(){},remind(){reminders++;},sample:async capture=>{samples++;return screen.none?null:{...screen,image:capture?screen.image:undefined};}};
  const context={Date:{now:()=>now},URL,I18n:{t:s=>s},setInterval(){},document:{getElementById:()=>null,querySelector:()=>null},landing:{focusMonitor:api},addEventListener(){}};context.window=context;
  vm.runInNewContext(source,context);context.FocusMonitor.init({state:()=>state,save(){},render(){},pause(){const t=state.timer;if(t.paused){t.endsAt=now+t.remainMs;t.paused=false;}else{t.remainMs=Math.max(0,t.endsAt-now);t.paused=true;}},callAI:async(...args)=>{aiCalls++;return ai(...args);}});
  return {m:context.FocusMonitor,state,x,screen,advance:n=>now+=n,setAI:f=>ai=f,stats:()=>({reminders,aiCalls,samples})};
}
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
 await check('foreground polling requires consecutive relevant titles and pauses on a switch',async()=>{const r=rig();await r.m.poll();assert.equal(r.x.paused,true);await r.m.poll();assert.equal(r.x.paused,false);r.advance(3000);r.screen.proc='msedge';r.screen.title='Funny videos';await r.m.poll();assert.equal(r.x.paused,true);assert.equal(r.x.remainMs,897000);assert.equal(r.stats().reminders,1);await r.m.poll();assert.equal(r.stats().reminders,1);r.screen.proc='code';r.screen.title='Python lesson';await r.m.poll();assert.equal(r.x.paused,true);await r.m.poll();assert.equal(r.x.paused,false);});
 await check('failed samples and locked or own windows stop counting',async()=>{for(const mode of ['none','locked','own']){const r=rig();await r.m.poll();await r.m.poll();if(mode==='none')r.screen.none=true;else if(mode==='locked')r.screen.locked=true;else r.screen.proc='StudyTrail';await r.m.poll();assert.equal(r.x.paused,true);assert.equal(r.x.monitorHold,true);}});
 await check('manual pause does not capture or resume',async()=>{const r=rig(true);r.m.manual();await r.m.poll();assert.equal(r.x.paused,true);assert.equal(r.stats().samples,0);assert.equal(r.stats().aiCalls,0);});
 await check('vision uses current-window images, respects its interval and pauses immediately on a window change',async()=>{const r=rig(true);await r.m.poll();assert.equal(r.stats().aiCalls,1);r.advance(5000);await r.m.poll();assert.equal(r.stats().aiCalls,1);r.advance(25000);await r.m.poll();assert.equal(r.x.paused,false);assert.equal(r.stats().aiCalls,2);r.advance(5000);r.screen.title='Entertainment';await r.m.poll();assert.equal(r.x.paused,true);assert.equal(r.stats().aiCalls,2);assert.equal(r.stats().reminders,1);});
 await check('unreadable images, malformed AI and service failures keep the timer paused',async()=>{for(const mode of ['missing','malformed','error']){const r=rig(true);if(mode==='missing')r.screen.image=null;else r.setAI(async()=>{if(mode==='error')throw Error('offline');return {content:'not JSON'};});await r.m.poll();assert.equal(r.x.paused,true);}});
 await check('AI responses after manual pause or task replacement cannot restart counting',async()=>{for(const mode of ['manual','replace']){const r=rig(true);let complete,entered;r.setAI(()=>new Promise(resolve=>{complete=resolve;entered=true;}));const pending=r.m.poll();while(!entered)await Promise.resolve();if(mode==='manual')r.m.manual();else r.state.timer={...r.x,id:'new-task'};complete({content:'{"related":true}'});await pending;assert.equal(r.state.timer.paused,true);}});
 await check('sampling gaps and previously running saved sessions stay paused without crediting downtime',async()=>{const r=rig();await r.m.poll();await r.m.poll();r.advance(600000);r.m.guard();assert.equal(r.x.paused,true);assert.equal(r.x.remainMs,900000);assert.equal(r.x.finished,false);});
 console.log('Verified '+checks+' foreground monitor scenarios.');
})().catch(e=>{console.error(e);process.exitCode=1;});
