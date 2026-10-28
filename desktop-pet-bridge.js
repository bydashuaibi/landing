/* The main renderer owns all learning data; the desktop window receives a small display snapshot. */
(function(){
  'use strict';
  var L,api,speech={text:'',until:0},motion=null,motionId=0,reply='',replyId=0;
  var names={today:'今日行动',weekly:'周报',digest:'技术日报',companion:'AI 陪伴',pet:'伙伴养成',shop:'商城',me:'我的与设置'};
  function answer(text){reply=String(text||'');replyId++;say(reply,10000);}
  function say(text,ms){speech={text:String(text||'').slice(0,240),until:Date.now()+(ms||6500)};publish();}
  function publish(){
    if(!L||!api)return;
    var s=L.state(),p=s.pet||{},d=s.discipline||{},learning=d.learning||{},t=s.timer&&s.timer.discipline?s.timer:null;
    var task=t&&(d.tasks||[]).find(function(x){return x.id===t.taskId;}),track=(learning.tracks||[]).find(function(x){return x.id===(task&&task.trackId||learning.selected);})||{id:'python',name:'Python'};
    var mode=t?(t.finished?'done':t.paused?'paused':'focus'):p.sleeping?'sleep':'idle';
    var n=t?Math.ceil(Math.max(0,t.finished?0:t.paused?t.remainMs:t.endsAt-Date.now())/1000):0;
    var clock=t?(t.finished?'待记录':String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')):'';
    var line=mode==='focus'?'正在学 '+track.name+'，只顾眼前这一小步。':mode==='paused'?'休息一下，准备好了再继续。':mode==='done'?'这一段做到了，记个断点，下次接着来。':track.resume&&track.resume.topic?'上次看到「'+track.resume.topic+'」。今天接着一点就好。':'把 '+track.name+' 的资料打开，先学五分钟。我陪你。';
    api.publish({name:p.name,track:track.id,course:track.name,clock:clock,mode:mode,line:speech.until>Date.now()?speech.text:line,reply:reply,replyId:replyId,gear:p.gear,studyMode:!!p.studyMode,gentle:!!p.gentleMotion,sleeping:!!p.sleeping,motion:motion,motionId:motionId});
  }
  function parse(text){
    var t=String(text||'').trim(),track=/pytorch|torch|火炬/i.test(t)?'pytorch':/python|派森/i.test(t)?'python':null;
    t=t.replace(/[！!。？?]+$/,'');
    if(/^(换皮肤|更换皮肤|打开换肤|打开Petdex)$/i.test(t))return {action:'skins'};
    if(/^(玩一会|小游戏|游乐场)$/.test(t))return {action:'playground'};
    if(/^(帮助|你能做什么|怎么用|有哪些功能|应用结构|功能菜单)$/.test(t))return {action:'help'};
    var destinations={'首页':'today','今日':'today','今日行动':'today','周报':'weekly','日报':'digest','技术日报':'digest','陪伴':'companion','AI陪伴':'companion','伙伴':'pet','宠物':'pet','养成':'pet','商城':'shop','商店':'shop','我的':'me','设置':'me'};
    var destination=t.replace(/^(?:请|帮我)?(?:打开|切换到|切到|进入|去|看看|查看|回到)/,'').replace(/\s/g,'');
    if(destinations[destination])return {action:'navigate',page:destinations[destination]};
    if(/^(?:选择|选|切换到|切到)\s*(?:python|pytorch|torch|派森)$/i.test(t))return {action:'select',track:track};
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
    if(p.action==='text'){var parsed=parse(p.text);if(!parsed){answer('可以说“打开日报”“查看周报”“选择 PyTorch”“开始学 Python”“暂停”“继续”或“记断点”。也可以点下面的页面按钮。');return;}p=Object.assign({},p,parsed);if(['open','capture','settle','chat','weekly','navigate','select'].indexOf(p.action)>=0)apiRequestOpen();}
    var id=p.track||(L.state().discipline||{}).learning.selected;
    if(p.action==='skins'){if(window.petSkins)petSkins.open();return;}
    if(p.action==='playground'){if(document.querySelector('#sheet.show')){answer('先完成或关闭着陆里的弹窗，再一起玩吧。');return;}apiRequestOpen();L.tab('pet');if(window.PetAdventure)PetAdventure.open();return;}
    if(p.action==='help'){answer('今日安排学习，周报回顾投入，日报找技术项目，陪伴可以聊天，伙伴负责养成，商城挑配饰，我的里面有设置。点页面按钮，或直接告诉我想去哪。');return;}
    if(p.action==='navigate'||p.action==='weekly'){
      var page=p.action==='weekly'?'weekly':p.page;if(!names[page])return;
      if(document.querySelector('#sheet.show')){answer('着陆里还有一个打开的弹窗，请先完成或关闭，再让我帮你切换页面。');return;}
      L.tab(page);answer('已打开'+names[page]+'。');return;
    }
    if(p.action==='select'){
      if(['python','pytorch'].indexOf(id)<0)return;
      if(document.querySelector('#sheet.show')){answer('先完成或关闭着陆里的弹窗，再选择学习方向。');return;}
      var learning=L.state().discipline.learning;learning.selected=id;L.save();L.tab('today');answer('已选择 '+(id==='python'?'Python':'PyTorch')+'。准备好后点“开始 5 分钟”，也可以先记断点。');return;
    }
    if(['study','pause','resume','capture','settle'].indexOf(p.action)>=0){answer(Discipline.desktopAction(p.action,id));return;}
    if(p.action==='open'){answer('着陆打开了。今天从一点点开始。');return;}
    if(p.action==='weekly'){L.tab('weekly');say('看看你已经走过的路。');return;}
    if(p.action==='chat'){Pet.open('panel','chat');say('我在着陆里等你说话。');return;}
    if(['pat','wave','hug'].indexOf(p.action)>=0){if(p.action==='pat')Pet.pat();else Pet.interact(p.action);motion=p.action;motionId=Date.now();publish();}
  }
  function apiRequestOpen(){api.reveal();}
  window.DesktopPetBridge={init:function(bridge){if(L)return;L=bridge;api=window.landing&&landing.desktopPet;if(!api)return;api.onCommand(command);publish();setInterval(publish,1000);},say:say,parse:parse,motion:function(name){motion=name;motionId=Date.now();publish();}};
})();
