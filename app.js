/* 着陆 Landing — 把焦虑变成下一步
 * 单文件逻辑：纯前端 + localStorage，AI 走可配置 OpenAI 兼容端点。
 * 模块：倾倒台 / 今天一件 / 方向罗盘 / 情绪气象 / AI 陪伴 / 树洞
 */
(function(){
'use strict';

var APP_CONFIG = {
  version: '1.0.0',
  storageKey: 'landing.v1',
  repo: 'https://github.com/bydashuaibi/landing',
  communityApi: '' // 留空则使用同源后端（node server.js）
};

/* ---------- 工具 ---------- */
function ymd(d){ d=d||new Date(); var z=n=>('0'+n).slice(-2); return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }
function parseYmd(s){ var p=s.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
function today(){ return ymd(); }
function addDays(s,n){ var d=parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); }
function daysBetween(a,b){ return Math.round((parseYmd(b)-parseYmd(a))/86400000); }
function esc(s){ return (s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function icon(n){ return '<svg class="icon"><use href="#i-'+n+'"/></svg>'; }
function uid(p){ return (p||'id')+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function $(id){ return document.getElementById(id); }
var toastTimer;
function toast(msg){ var t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer=setTimeout(function(){t.classList.add('hidden');},2200); }

/* ---------- 状态 ---------- */
var STATE = null;
var CUR_TAB = 'dump';

function blankState(){
  return { version:APP_CONFIG.version, dumps:[], oneThing:null, compass:[], weather:[], companion:{messages:[]}, community:{nick:''}, settings:{} };
}
function load(){
  try{ var raw=localStorage.getItem(APP_CONFIG.storageKey); if(raw){ STATE=JSON.parse(raw); migrate(); return; } }catch(e){}
  STATE=blankState(); seed(); save();
}
function migrate(){
  var s=STATE; if(!s.version) s.version=APP_CONFIG.version;
  s.dumps=s.dumps||[]; s.oneThing=s.oneThing||null; s.compass=s.compass||[];
  s.weather=s.weather||[]; s.companion=s.companion||{messages:[]}; s.community=s.community||{nick:''};
  s.settings=s.settings||{};
  s.dumps.forEach(function(d){ if(d.kind===undefined) d.kind=null; if(d.done===undefined) d.done=false; });
}
function save(){ try{ localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(STATE)); }catch(e){ toast('保存失败：存储已满？'); } }

function seed(){
  var t=today();
  STATE.dumps=[
    {id:uid('d'),text:'想系统学一下 RTOS，但一直没动手，资料收藏了一堆',createdAt:addDays(t,-2),kind:null,done:false,ts:Date.now()-2},
    {id:uid('d'),text:'担心考研方向选错，反复查资料却不动手',createdAt:addDays(t,-1),kind:null,done:false,ts:Date.now()-1},
    {id:uid('d'),text:'周末想读完那本《深度工作》',createdAt:t,kind:null,done:false,ts:Date.now()}
  ];
  STATE.oneThing={date:t,text:'打开 RTOS 教程，只看前 10 分钟',done:false,fromDumpId:null};
  STATE.weather=[
    {date:addDays(t,-4),mood:'sun',note:'状态还行'},
    {date:addDays(t,-3),mood:'cloud',note:''},
    {date:addDays(t,-2),mood:'rain',note:'有点乱'},
    {date:addDays(t,-1),mood:'cloud',note:''},
    {date:t,mood:'rain',note:''}
  ];
  STATE.compass=[
    {id:uid('c'),period:'week',think:'考研复习 60% / 科研 25% / 休息 15%',actual:'刷手机 40% / 焦虑 30% / 考研 30%',createdAt:addDays(t,-2)}
  ];
}

/* ---------- AI 调用 ---------- */
var SYSTEM_PROMPT = '你是「着陆」的陪伴者。用户是一个多线程压身（实习/考研/科研/比赛）的年轻人，常"有想法不干事"。'
  + '你的风格：温柔、不评判、不催促。先接住情绪，再用一两个问题或一句拆解，帮他把想法变成"今天能迈的最小一步"。'
  + '不要长篇说教，不要列清单式建议，像朋友坐旁边说话。每次回复控制在 120 字内。';

function callAI(messages){
  var s=STATE.settings;
  if(!s.aiBaseUrl||!s.aiKey) return Promise.resolve({error:'未配置 AI：去「设置」填写 baseUrl / key / model'});
  var url=s.aiBaseUrl.replace(/\/+$/,'')+'/chat/completions';
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.aiKey},
    body:JSON.stringify({model:s.aiModel||'gpt-4o-mini',messages:messages,temperature:0.7})})
    .then(function(r){ return r.ok? r.json() : r.text().then(function(t){return {_err:r.status+' '+t.slice(0,160)};}); })
    .then(function(j){ if(j._err) return {error:j._err}; return {content:(j.choices&&j.choices[0]&&j.choices[0].message.content)||'(空响应)'};; })
    .catch(function(e){ return {error:'调用失败：'+e.message}; });
}

/* ---------- 视图：通用 ---------- */
function kindTag(k){ if(k==='do') return '<span class="tag do">可做</span>'; if(k==='drop') return '<span class="tag drop">该放</span>'; if(k==='feel') return '<span class="tag feel">只是情绪</span>'; return '<span class="tag drop" style="opacity:.5">未分类</span>'; }

function viewDump(){
  var list=STATE.dumps.slice().sort(function(a,b){return b.createdAt.localeCompare(a.createdAt);});
  var h='<div class="card"><h2>'+icon('cloud')+' 倾倒台</h2>'
    +'<div class="hint">脑子乱的时候，把转的念头全倒出来。点「着陆」后，再给它一个去处：可做 / 该放 / 只是情绪。</div>'
    +'<button class="btn primary block" data-act="newDump">'+icon('plus')+' 倒一条出来</button></div>';
  if(!list.length){ h+='<div class="empty">还没有念头。点上面「倒一条出来」。</div>'; return h; }
  list.forEach(function(d){
    h+='<div class="card dump"><div class="row between"><div class="muted" style="font-size:12px">'+d.createdAt+'</div>'+kindTag(d.kind)+'</div>'
      +'<div class="text">'+esc(d.text)+'</div>'
      +'<div class="meta">'
      +(d.kind==='do'? (d.done?'<span class="tag do">已行动</span>':'<button class="btn ghost sm" data-act="toToday" data-id="'+d.id+'">'+icon('target')+' 设为今天一件</button>') : '')
      +'<button class="btn ghost sm" data-act="classify" data-id="'+d.id+'" data-kind="do">可做</button>'
      +'<button class="btn ghost sm" data-act="classify" data-id="'+d.id+'" data-kind="drop">该放</button>'
      +'<button class="btn ghost sm" data-act="classify" data-id="'+d.id+'" data-kind="feel">只是情绪</button>'
      +'<button class="btn ghost sm" data-act="editDump" data-id="'+d.id+'">'+icon('edit')+'</button>'
      +'<button class="btn ghost sm" data-act="delDump" data-id="'+d.id+'">'+icon('trash')+'</button>'
      +'</div></div>';
  });
  return h;
}

function viewToday(){
  var ot=STATE.oneThing;
  var h='<div class="card one-thing">';
  if(ot && ot.date===today()){
    h+='<div class="muted">今天只承诺一件</div>'
      +'<div class="big">'+(ot.done?'<span class="done-state">'+icon('check')+' 完成了</span>':esc(ot.text))+'</div>'
      +(ot.done?'<button class="btn ghost" data-act="changeToday">换个 / 明天再来</button>'
              :'<button class="btn primary" data-act="markToday">'+icon('check')+' 我做完了</button> <button class="btn ghost" data-act="changeToday">今天换一件</button>');
  } else {
    h+='<div class="muted">今天还没有承诺</div><div class="big">选一件最小的事</div>'
      +'<button class="btn primary" data-act="newToday">'+icon('plus')+' 定一件</button>';
  }
  h+='</div>';
  // 从「可做」想法里挑
  var dos=STATE.dumps.filter(function(d){return d.kind==='do'&&!d.done;});
  if(dos.length){
    h+='<div class="card"><h2>从想法里挑一件</h2><div class="hint">这些是标记为「可做」的念头。</div>';
    dos.forEach(function(d){ h+='<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><div>'+esc(d.text)+'</div><button class="btn ghost sm" data-act="toToday" data-id="'+d.id+'">设为今天</button></div>'; });
    h+='</div>';
  }
  return h;
}

function viewCompass(){
  var h='<div class="card"><h2>'+icon('compass')+' 方向罗盘</h2>'
    +'<div class="hint">定期对照「我以为重要的」和「实际投入的」，看清有没有走偏。不评判，只是看见。</div>'
    +'<button class="btn primary block" data-act="newCompass">'+icon('plus')+' 记一次对照</button></div>';
  if(!STATE.compass.length){ h+='<div class="empty">还没有对照记录。</div>'; return h; }
  STATE.compass.slice().reverse().forEach(function(c){
    h+='<div class="card"><div class="row between"><span class="tag '+(c.period==='week'?'do':'feel')+'">'+(c.period==='week'?'本周':'本月')+'</span><span class="muted" style="font-size:12px">'+c.createdAt+'</span></div>'
      +'<div class="compass-row" style="margin-top:10px"><div><div class="muted" style="font-size:12px;font-weight:700">我以为重要的</div><div class="text">'+esc(c.think)+'</div></div>'
      +'<div><div class="muted" style="font-size:12px;font-weight:700">实际投入的</div><div class="text">'+esc(c.actual)+'</div></div></div>'
      +'<div class="deviate" style="background:rgba(124,92,255,.1);color:var(--violet)">看见即改变的开始。下次对照时，看看差距有没有变小。</div>'
      +'<div class="acts" style="margin-top:10px"><button class="btn ghost sm" data-act="delCompass" data-id="'+c.id+'">'+icon('trash')+' 删除</button></div></div>';
  });
  return h;
}

function moodMeta(m){ return {sun:['晴','#fbbf24'],cloud:['阴','#94a3b8'],rain:['雨','#60a5fa'],storm:['暴','#6366f1']}[m]||['?','#ccc']; }
function viewWeather(){
  var todayW=STATE.weather.find(function(w){return w.date===today();});
  var h='<div class="card"><h2>'+icon('leaf')+' 情绪气象</h2><div class="hint">30 秒，给今天选个天气，写一句也行。不评分，只是记录。</div>';
  h+='<div class="weather-pick" id="wp">'
    +['sun','cloud','rain','storm'].map(function(m){var mm=moodMeta(m);return '<button class="wbtn '+m+(todayW&&todayW.mood===m?' on':'')+'" data-act="setWeather" data-mood="'+m+'"><span class="emo">'+mm[0]+'</span>'+mm[0]+'</button>';}).join('')
    +'</div>';
  h+='<div class="field"><textarea id="wNote" placeholder="今天一句话…">'+(todayW?esc(todayW.note):'')+'</textarea></div>';
  h+='<button class="btn primary block" data-act="saveWeather">'+icon('check')+' 记录今天</button></div>';
  // 趋势
  var last14=[]; for(var i=13;i>=0;i--){ var d=addDays(today(),-i); var w=STATE.weather.find(function(x){return x.date===d;}); last14.push({d:d,w:w}); }
  var maxV=4;
  h+='<div class="card"><h2>近 14 天</h2><div class="trend">';
  last14.forEach(function(o){ var v=o.w?({sun:4,cloud:3,rain:2,storm:1}[o.w.mood]||0):0; var col=o.w?moodMeta(o.w.mood)[1]:'#e3e6ef';
    h+='<div class="bar" style="height:'+(v/maxV*100)+'%;background:'+col+'" title="'+o.d+'"><i>'+(o.w?moodMeta(o.w.mood)[0]:'')+'</i><span>'+o.d.slice(5)+'</span></div>'; });
  h+='</div></div>';
  // 周回顾
  h+='<div class="card"><h2>温柔周回顾</h2><div class="hint">'+weeklyWarm()+'</div></div>';
  return h;
}
function weeklyWarm(){
  var wk=STATE.weather.filter(function(w){return daysBetween(w.date,today())<7;});
  if(!wk.length) return '这周还没记录情绪。记得每天 30 秒，给心情打个天气。';
  var storm=wk.filter(function(w){return w.mood==='storm'||w.mood==='rain';}).length;
  var sunny=wk.filter(function(w){return w.mood==='sun';}).length;
  if(sunny>=3) return '这周 '+sunny+' 天是晴天，你撑得不错。保持这个节奏。';
  if(storm===0) return '这周虽然阴天多，但你一次暴风雨都没有——你稳住了。';
  return '这周有 '+storm+' 天比较难熬。难熬的日子里你还在记录，这本身就是一种照顾自己。';
}

function viewCompanion(){
  var msgs=STATE.companion.messages;
  var h='<div class="card"><h2>'+icon('chat')+' AI 陪伴</h2>'
    +'<div class="hint">不评判、不催促。把闷在心里的话说出来，或者让它帮你把想法拆成第一步。'+(STATE.settings.aiKey?'':'<span style="color:var(--amber)"> 尚未配置 AI，去「设置」填写。</span>')+'</div>'
    +'<button class="btn ghost sm" data-act="followup3">'+icon('refresh')+' 近三日跟进（生成日报）</button></div>';
  h+='<div class="card"><div class="chat" id="chat">';
  if(!msgs.length) h+='<div class="empty">还没有对话。说点什么，或者点上面的「近三日跟进」。</div>';
  msgs.forEach(function(m){ h+='<div class="bubble '+(m.role==='user'?'me':'ai')+'">'+esc(m.content)+'</div>'; });
  h+='</div>';
  h+='<div class="companion-input"><textarea id="aiInput" placeholder="说点什么…"></textarea><button class="btn primary" data-act="sendAI">'+icon('send')+'</button></div></div>';
  return h;
}

function viewCommunity(){
  var h='<div class="card"><h2>'+icon('people')+' 树洞</h2>'
    +'<div class="hint">匿名说一句你今天「着陆」了什么，或还在飘着。不点赞、不评论、不评判，只是看见彼此。</div>'
    +'<div class="field"><textarea id="postBody" placeholder="今天……"></textarea></div>'
    +'<div class="row between"><button class="btn primary" data-act="postCommunity">'+icon('send')+' 匿名发布</button><button class="btn ghost sm" data-act="loadCommunity">'+icon('refresh')+' 刷新</button></div></div>';
  h+='<div id="posts"><div class="empty">加载中…</div></div>';
  return h;
}

/* ---------- 渲染 ---------- */
var TAB_TITLE={dump:'倾倒台',today:'今天一件',compass:'方向罗盘',weather:'情绪气象',companion:'AI 陪伴',community:'树洞'};
function render(){
  $('view').innerHTML = ({dump:viewDump,today:viewToday,compass:viewCompass,weather:viewWeather,companion:viewCompanion,community:viewCommunity})[CUR_TAB]();
  $('viewTitle').textContent=TAB_TITLE[CUR_TAB];
  document.querySelectorAll('.nav-item').forEach(function(b){ b.classList.toggle('active',b.dataset.tab===CUR_TAB); });
  if(CUR_TAB==='community') App.loadCommunity();
  if(CUR_TAB==='companion'){ var c=$('chat'); if(c) c.scrollTop=c.scrollHeight; }
}

/* ---------- 模态 ---------- */
function openSheet(html, after){ var s=$('sheet'); s.innerHTML='<div class="sheet">'+html+'</div>'; s.classList.remove('hidden'); s.classList.add('show'); if(after) after(); }
function closeSheet(){ var s=$('sheet'); s.classList.add('hidden'); s.classList.remove('show'); s.innerHTML=''; }

/* ---------- 业务动作 ---------- */
var App = {
  newDump:function(){ openSheet('<h2>倒一条出来</h2><div class="hint">不用整理，想到什么写什么。</div>'
    +'<div class="field"><textarea id="d_text" placeholder="比如：想学 RTOS 但一直没动手"></textarea></div>'
    +'<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="d_save">倒出来</button></div>',
    function(){ $('d_save').onclick=function(){ var v=$('d_text').value.trim(); if(!v){toast('写点什么');return;} STATE.dumps.push({id:uid('d'),text:v,createdAt:today(),kind:null,done:false,ts:Date.now()}); save(); closeSheet(); render(); toast('已倒出来'); }; });},
  editDump:function(id){ var d=STATE.dumps.find(function(x){return x.id===id;}); if(!d)return; openSheet('<h2>编辑</h2><div class="field"><textarea id="d_text">'+esc(d.text)+'</textarea></div>'
    +'<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="d_save">保存</button></div>',
    function(){ $('d_save').onclick=function(){ d.text=$('d_text').value.trim(); save(); closeSheet(); render(); toast('已保存'); }; });},
  classify:function(id,kind){ var d=STATE.dumps.find(function(x){return x.id===id;}); if(!d)return; d.kind=kind; save(); render(); toast(kind==='do'?'标为「可做」':kind==='drop'?'标为「该放」':'标为「只是情绪」'); },
  delDump:function(id){ STATE.dumps=STATE.dumps.filter(function(x){return x.id!==id;}); save(); render(); toast('已删除'); },
  toToday:function(id){ var d=STATE.dumps.find(function(x){return x.id===id;}); if(!d)return; STATE.oneThing={date:today(),text:d.text,done:false,fromDumpId:id}; save(); render(); toast('已设为今天一件'); },
  newToday:function(){ openSheet('<h2>今天只做一件</h2><div class="hint">挑最小、最不添焦虑的那件。</div><div class="field"><textarea id="t_text" placeholder="比如：打开书看 10 分钟"></textarea></div>'
    +'<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="t_save">定下</button></div>',
    function(){ $('t_save').onclick=function(){ var v=$('t_text').value.trim(); if(!v){toast('写点什么');return;} STATE.oneThing={date:today(),text:v,done:false,fromDumpId:null}; save(); closeSheet(); render(); toast('今天就这一件'); }; });},
  markToday:function(){ if(STATE.oneThing){ STATE.oneThing.done=true; save(); render(); toast('完成了，今天稳了'); } },
  changeToday:function(){ STATE.oneThing=null; save(); render(); },
  newCompass:function(){ openSheet('<h2>记一次对照</h2><div class="field"><label>周期</label><div class="row" id="c_per"><button class="btn sm primary" data-p="week">本周</button><button class="btn sm ghost" data-p="month">本月</button></div></div>'
    +'<div class="field"><label>我以为重要的</label><textarea id="c_think" placeholder="比如：考研 60% / 科研 25% / 休息 15%"></textarea></div>'
    +'<div class="field"><label>实际投入的</label><textarea id="c_actual" placeholder="比如：刷手机 40% / 焦虑 30% / 考研 30%"></textarea></div>'
    +'<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="c_save">记下</button></div>',
    function(){ var per='week'; $('c_per').querySelectorAll('[data-p]').forEach(function(b){ b.onclick=function(){ per=b.dataset.p; $('c_per').querySelectorAll('[data-p]').forEach(function(x){x.className='btn sm '+(x===b?'primary':'ghost');}); }; });
      $('c_save').onclick=function(){ var think=$('c_think').value.trim(), actual=$('c_actual').value.trim(); if(!think||!actual){toast('两项都填');return;} STATE.compass.push({id:uid('c'),period:per,think:think,actual:actual,createdAt:today()}); save(); closeSheet(); render(); toast('已记下'); }; });},
  delCompass:function(id){ STATE.compass=STATE.compass.filter(function(x){return x.id!==id;}); save(); render(); toast('已删除'); },
  setWeather:function(m){ var w=STATE.weather.find(function(x){return x.date===today();}); if(!w){ w={date:today(),mood:m,note:''}; STATE.weather.push(w); } else w.mood=m; save(); render(); },
  saveWeather:function(){ var note=$('wNote')?$('wNote').value:''; var w=STATE.weather.find(function(x){return x.date===today();}); if(!w){ w={date:today(),mood:'cloud',note:note}; STATE.weather.push(w);} else w.note=note; save(); render(); toast('已记录今天'); },
  sendAI:function(){ var inp=$('aiInput'); if(!inp)return; var v=inp.value.trim(); if(!v)return; if(!STATE.settings.aiKey){ toast('先去「设置」配置 AI'); openSettings(); return; }
    STATE.companion.messages.push({role:'user',content:v,ts:Date.now()}); inp.value=''; save(); render();
    var msgs=[{role:'system',content:SYSTEM_PROMPT}].concat(STATE.companion.messages.map(function(m){return {role:m.role,content:m.content};}));
    callAI(msgs).then(function(r){ if(r.error){ STATE.companion.messages.push({role:'assistant',content:r.error,ts:Date.now()}); } else { STATE.companion.messages.push({role:'assistant',content:r.content,ts:Date.now()}); } save(); render(); }); },
  followup3:function(){
    if(!STATE.settings.aiKey){ toast('先去「设置」配置 AI'); openSettings(); return; }
    var since=addDays(today(),-3);
    var dumps=STATE.dumps.filter(function(d){return d.createdAt>=since;}).map(function(d){return '【'+(d.kind||'未分类')+'】'+d.text;});
    var weather=STATE.weather.filter(function(w){return w.date>=since;}).map(function(w){return w.date+' '+moodMeta(w.mood)[0]+(w.note?'：'+w.note:'');});
    var ot=STATE.oneThing&&STATE.oneThing.date>=since?('今天一件：'+STATE.oneThing.text+(STATE.oneThing.done?'（已完成）':'（未完成）')):'(无)';
    var prompt='这是用户近三天的记录，请生成一份温柔的「跟进日报」：1) 一句话接住他现在的状态；2) 指出一个他已经在动的小进展；3) 给一个明天可以迈的最小一步。控制在150字内。\n倾倒台：'+(dumps.join('\n')||'（无）')+'\n情绪：'+(weather.join('\n')||'（无）')+'\n'+ot;
    STATE.companion.messages.push({role:'user',content:'【近三日跟进】请生成我的日报',ts:Date.now()});
    var msgs=[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt}];
    save(); render();
    callAI(msgs).then(function(r){ STATE.companion.messages.push({role:'assistant',content:r.error?r.error:r.content,ts:Date.now()}); save(); render(); });
  },
  loadCommunity:function(){ var box=$('posts'); if(!box)return; var api=APP_CONFIG.communityApi||''; fetch(api+'/feed').then(function(r){return r.ok?r.json():{posts:[]};}).then(function(j){
      var posts=j.posts||[]; if(!posts.length){ box.innerHTML='<div class="empty">树洞还空着，来当第一个。</div>'; return; }
      box.innerHTML=posts.slice(0,40).map(function(p){return '<div class="post"><div class="head"><span>匿名</span><span>'+esc(p.date||'')+'</span></div><div class="body">'+esc(p.body||'')+'</div></div>';}).join('');
    }).catch(function(e){ box.innerHTML='<div class="empty">树洞连接失败（需要启动后端 server.js）。'+e.message+'</div>'; }); },
  postCommunity:function(){ var ta=$('postBody'); if(!ta)return; var v=ta.value.trim(); if(!v){toast('写点什么');return;} var api=APP_CONFIG.communityApi||'';
    fetch(api+'/feed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:v,nick:STATE.community.nick||''})}).then(function(r){return r.ok?'ok':r.text();}).then(function(x){ ta.value=''; App.loadCommunity(); toast('已匿名发布'); }).catch(function(e){ toast('发布失败：'+e.message); }); },
  openSettings:openSettings
};

/* ---------- 设置 ---------- */
function openSettings(){
  var s=STATE.settings;
  openSheet('<h2>'+icon('cog')+' 设置</h2>'
    +'<div class="hint">AI 走 OpenAI 兼容接口。key 只存在你本地浏览器，不会上传。</div>'
    +'<div class="field"><label>AI 接口地址（baseUrl）</label><input id="s_base" value="'+esc(s.aiBaseUrl||'')+'" placeholder="https://api.openai.com/v1"></div>'
    +'<div class="field"><label>API Key</label><input id="s_key" type="password" value="'+esc(s.aiKey||'')+'" placeholder="sk-..."></div>'
    +'<div class="field"><label>模型名</label><input id="s_model" value="'+esc(s.aiModel||'')+'" placeholder="gpt-4o-mini"></div>'
    +'<div class="field"><label>树洞昵称（匿名，可选）</label><input id="s_nick" value="'+esc(s.nick||'')+'" placeholder="留空即匿名"></div>'
    +'<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn danger" id="s_reset">清空全部数据</button><button class="btn primary" id="s_save">保存</button></div>'
    +'<div class="ver">着陆 v'+APP_CONFIG.version+' · <a href="'+APP_CONFIG.repo+'" target="_blank">GitHub</a></div>',
    function(){
      $('s_save').onclick=function(){ STATE.settings.aiBaseUrl=$('s_base').value.trim(); STATE.settings.aiKey=$('s_key').value.trim(); STATE.settings.aiModel=$('s_model').value.trim()||'gpt-4o-mini'; STATE.community.nick=$('s_nick').value.trim(); save(); closeSheet(); toast('已保存'); };
      $('s_reset').onclick=function(){ if(confirm('确定清空全部本地数据？此操作不可恢复。')){ localStorage.removeItem(APP_CONFIG.storageKey); STATE=blankState(); save(); render(); closeSheet(); toast('已清空'); } };
    });
}

/* ---------- 事件委托 ---------- */
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-act]'); if(!el) return;
  var act=el.dataset.act, id=el.dataset.id, kind=el.dataset.kind, mood=el.dataset.mood;
  if(act==='newDump') App.newDump();
  else if(act==='editDump') App.editDump(id);
  else if(act==='classify') App.classify(id,kind);
  else if(act==='delDump') App.delDump(id);
  else if(act==='toToday') App.toToday(id);
  else if(act==='newToday') App.newToday();
  else if(act==='markToday') App.markToday();
  else if(act==='changeToday') App.changeToday();
  else if(act==='newCompass') App.newCompass();
  else if(act==='delCompass') App.delCompass(id);
  else if(act==='setWeather') App.setWeather(mood);
  else if(act==='saveWeather') App.saveWeather();
  else if(act==='sendAI') App.sendAI();
  else if(act==='followup3') App.followup3();
  else if(act==='loadCommunity') App.loadCommunity();
  else if(act==='postCommunity') App.postCommunity();
  else if(act==='openSettings') App.openSettings();
});

/* ---------- 启动 ---------- */
function init(){
  load();
  document.querySelectorAll('.nav-item').forEach(function(b){ b.addEventListener('click',function(){ CUR_TAB=b.dataset.tab; render(); }); });
  $('topNew').addEventListener('click',function(){ if(CUR_TAB==='today') App.newToday(); else App.newDump(); });
  $('fabNew').addEventListener('click',function(){ if(CUR_TAB==='today') App.newToday(); else App.newDump(); });
  $('topSettings').addEventListener('click',openSettings);
  window.closeSheet=closeSheet; window.App=App;
  render();
}
init();
})();
