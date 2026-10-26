/* The main renderer owns all learning data; the desktop window receives a small display snapshot. */
(function(){
  'use strict';
  var L,api,speech={text:'',until:0},motion=null,motionId=0;
  function say(text,ms){speech={text:String(text||'').slice(0,240),until:Date.now()+(ms||6500)};publish();}
  function publish(){
    if(!L||!api)return;
    var s=L.state(),p=s.pet||{},d=s.discipline||{},learning=d.learning||{},t=s.timer&&s.timer.discipline?s.timer:null;
    var task=t&&(d.tasks||[]).find(function(x){return x.id===t.taskId;}),track=(learning.tracks||[]).find(function(x){return x.id===(task&&task.trackId||learning.selected);})||{id:'python',name:'Python'};
    var mode=t?(t.finished?'done':t.paused?'paused':'focus'):p.sleeping?'sleep':'idle';
    var n=t?Math.ceil(Math.max(0,t.finished?0:t.paused?t.remainMs:t.endsAt-Date.now())/1000):0;
    var clock=t?(t.finished?'待记录':String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')):'';
    var line=mode==='focus'?'正在学 '+track.name+'，只顾眼前这一小步。':mode==='paused'?'休息一下，准备好了再继续。':mode==='done'?'这一段做到了，记个断点，下次接着来。':track.resume&&track.resume.topic?'上次看到「'+track.resume.topic+'」。今天接着一点就好。':'把 '+track.name+' 的资料打开，先学五分钟。我陪你。';
    api.publish({name:p.name,track:track.id,course:track.name,clock:clock,mode:mode,line:speech.until>Date.now()?speech.text:line,gentle:!!p.gentleMotion,sleeping:!!p.sleeping,motion:motion,motionId:motionId});
  }
  function parse(text){
    var t=String(text||'').trim(),track=/pytorch|torch|火炬/i.test(t)?'pytorch':/python|派森/i.test(t)?'python':null;
    if(/^(?:请|帮我)?(?:开始学(?:习)?|开始|接着学|学)(?:一下|一点|习)?\s*(?:python|pytorch|torch|派森)?(?:\s*5\s*分钟)?[！!。]?$/i.test(t))return {action:'study',track:track};
    if(/^(暂停|暂停学习|休息一下)[。!！]?$/.test(t))return {action:'pause'};
    if(/^(继续|继续学习|恢复计时)[。!！]?$/.test(t))return {action:'resume'};
    if(/^(记断点|截图|截屏|截屏记断点|记录断点)[。!！]?$/.test(t))return {action:'capture',track:track};
    if(/^(结束|结束学习|结束记录)[。!！]?$/.test(t))return {action:'settle'};
    if(/^(打开|打开着陆|回到着陆)[。!！]?$/.test(t))return {action:'open'};
    if(/^(挥手|挥挥手)$/.test(t))return {action:'wave'};
    if(/^(抱抱|抱一下)$/.test(t))return {action:'hug'};
    return null;
  }
  function command(p){
    if(!L)return;
    if(p.action==='text'){var parsed=parse(p.text);if(!parsed){say('我认识：开始学 Python、开始学 PyTorch、暂停、继续、记断点、打开着陆。');return;}p=Object.assign({},p,parsed);if(['open','capture','settle','chat','weekly'].indexOf(p.action)>=0)apiRequestOpen();}
    var id=p.track||(L.state().discipline||{}).learning.selected;
    if(['study','pause','resume','capture','settle'].indexOf(p.action)>=0){say(Discipline.desktopAction(p.action,id));return;}
    if(p.action==='open'){say('着陆打开了。今天从一点点开始。');return;}
    if(p.action==='weekly'){L.tab('weekly');say('看看你已经走过的路。');return;}
    if(p.action==='chat'){Pet.open('panel','chat');say('我在着陆里等你说话。');return;}
    if(['pat','wave','hug'].indexOf(p.action)>=0){if(p.action==='pat')Pet.pat();else Pet.interact(p.action);motion=p.action;motionId=Date.now();publish();}
  }
  function apiRequestOpen(){api.reveal();}
  window.DesktopPetBridge={init:function(bridge){if(L)return;L=bridge;api=window.landing&&landing.desktopPet;if(!api)return;api.onCommand(command);publish();setInterval(publish,1000);},say:say,parse:parse,motion:function(name){motion=name;motionId=Date.now();publish();}};
})();
