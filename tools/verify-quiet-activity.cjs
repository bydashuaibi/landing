'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require('path').join(__dirname,'../_stage/main.js'),'utf8');
const segment=source.slice(source.indexOf('const PROC_SHELL ='),source.indexOf('/* ---- 桌面悬浮询问窗'));
function fixture(options={}){
 let now=Date.now(),events=[];const prefs={ask:true,askConfirm:false,askNotify:false,sampleSec:60,askCoolMin:15,...options};
 const scope={Date:{now:()=>now},Math,String,actPrefs:()=>prefs,mainWindow:{isDestroyed:()=>false,webContents:{send:(channel,p)=>events.push(p)}}};
 vm.createContext(scope);vm.runInContext(segment,scope);
 scope.classifyActivity=(proc,title)=>/video/.test(title||'')?'fun':'work';
 return {events,prefs,tick:(proc,delta=60,title='')=>{now+=delta*1000;scope.maybeAskApp(proc?{proc,title}:null);}};
}
let f=fixture();f.tick('code',0);f.tick('chrome');f.tick('code');assert.deepEqual(f.events.map(e=>e.prevMinutes),[1,1]);
console.log('PASS automatic records are not lost to prompt cooldown');
f=fixture({askConfirm:true});f.tick('code',0);f.tick('chrome');f.tick('code');assert.equal(f.events.length,1);
console.log('PASS optional confirmation mode still obeys cooldown');
f=fixture();f.tick('code',0);for(let i=0;i<5;i++)f.tick('code');assert.equal(f.events.length,1);assert.equal(f.events[0].prevMinutes,5);f.tick('chrome');assert.equal(f.events[1].prevMinutes,1);
console.log('PASS long sessions settle periodically without double counting');
f=fixture();f.tick('code',0);f.tick('code');f.tick('chrome',8*3600);assert.equal(f.events[0].prevMinutes,1);
console.log('PASS sleep gaps do not become hours of recorded usage');
f=fixture();f.tick('chrome',0,'tutorial');f.tick('chrome',60,'video');assert.equal(f.events[0].prevCat,'work');f.tick('code',60);assert.equal(f.events[1].prevCat,'fun');
console.log('PASS category changes inside the same browser create separate segments');
f=fixture();f.tick('idle',0);f.tick('code');assert.equal(f.events.length,0);f.prefs.ask=false;f.tick('chrome');assert.equal(f.events.length,0);
console.log('PASS shell time and stats-only mode do not award study time');
// Execute the actual screenshot function with a recorder; a disabled setting must never request a frame.
const shot=source.slice(source.indexOf('async function actShot() {'),source.indexOf('/* 手动学习断点：'));
let captured=0;const c={actPrefs:()=>({enabled:true,shotMin:0}),require:()=>{captured++;throw Error('must not capture');},console};vm.createContext(c);vm.runInContext(shot,c);
c.actShot().then(()=>{assert.equal(captured,0);console.log('PASS zero screenshot interval never invokes desktop capture');});
