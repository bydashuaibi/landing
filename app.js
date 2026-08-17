/* 着陆 Landing v2 — 把焦虑变成下一步
 * 六模块：今日(推送+一件+快捷打卡) / 任务(长周期+日常) / 周报(复盘看板) / 日报(GitHub热度) / AI陪伴 / 我的(设置+树洞)
 * 核心机制：长周期里程碑鼓励 + 日常循环打卡 + 连续2天未打卡自动暂停 + 每周首次打开自动生成复盘
 */
(function(){
'use strict';

/* ================= 配置 & 分类体系 ================= */
var APP_CONFIG = {
  version: '2.0.0',
  storageKey: 'landing.v2',
  repo: 'https://github.com/bydashuaibi/landing',
  communityApi: ''
};

/* 大类定义（综合量力充能+方向两套，合并去重）
 * 每个大类有：key, label, colorClass, subs(预设子类), icon
 * 充能恢复型任务的类别从 health/life 的子类中取
 */
var CATEGORIES = [
  {key:'health', label:'身心健康', cls:'health', subs:['运动','睡眠','冥想','泡澡']},
  {key:'edu',    label:'学习成长', cls:'edu',    subs:['学习','阅读','自我提升','探索']},
  {key:'create', label:'创意表达', cls:'create', subs:['音乐','创作','摄影','手工','烹饪','园艺']},
  {key:'life',   label:'生活品质', cls:'life',   subs:['美食','社交','娱乐','整理收纳']},
  {key:'nature', label:'自然户外', cls:'nature', subs:['自然','出行']}
];

/* GitHub 日报领域（按主题拉取热门开源项目） */
var DIGEST_TOPICS = [
  {topic:'AI',           label:'AI 应用',     q:'artificial-intelligence OR machine-learning OR LLM OR agent'},
  {topic:'productivity', label:'效率工具',     q:'productivity-tool OR CLI OR developer-tools'},
  {topic:'frontend',     label:'前端开发',     q:'frontend OR react OR vue OR nextjs'},
  {topic:'data-viz',     label:'数据可视化',   q:'data-visualization OR dashboard OR chart'},
  {topic:'devops',       label:'DevOps 运维',  q:'devops OR kubernetes OR docker OR CI-CD'},
  {topic:'security',     label:'安全',         q:'security OR cybersecurity OR penetration-testing'},
  {topic:'mobile',       label:'移动端',       q:'mobile OR flutter OR react-native OR iOS OR android'},
  {topic:'hardware',     label:'开源硬件/IoT',  q:'IoT OR embedded OR raspberry-pi OR arduino OR ESP32'}
];

/* ================= 工具函数 ================= */
function ymd(d){ d=d||new Date(); var z=function(n){return ('0'+n).slice(-2);}; return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }
function parseYmd(s){ var p=s.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
function today(){ return ymd(); }
function addDays(s,n){ var d=parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); }
function daysBetween(a,b){ return Math.round((parseYmd(b)-parseYmd(a))/86400000); }
function weekKey(d){ d=d||today(); var dd=parseYmd(d); var mon=dd.getDate()-dd.getDay()+(dd.getDay()===0?-6:0); var m=new Date(dd); m.setDate(mon); return ymd(m); }
function esc(s){ return (s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c];}); }
function icon(n){ return '<svg class="icon"><use href="#i-'+n+'"/></svg>'; }
function uid(p){ return (p||'id')+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function $(id){ return document.getElementById(id); }

var toastTimer;
function toast(msg){
  var t=$('toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){ t.classList.add('hidden'); },2200);
}

function catLabel(key){
  var c=CATEGORIES.find(function(x){return x.key===key;});
  return c ? '<span class="cat '+c.cls+'">'+c.label+'</span>' : '';
}
function catName(key){ var c=CATEGORIES.find(function(x){return x.key===key;}); return c ? c.label : key; }

/* ================= 数据模型 ================= */
var STATE = null;
var CUR_TAB = 'today';

function blankState(){
  return {
    version: APP_CONFIG.version,
    longTasks: [],      // 长周期：{id,name,unit,total,current,deadline,category,status,records:[],createdAt}
    dailyTasks: [],     // 日常循环：{id,name,category,subCategory,type('habit'|'recharge'),enabled,records:[],createdAt}
    reports: {},        // {weekKey:{generatedAt,summary,moodTrack,dailyCards}}
    digest: {},         // {date:{fetchedAt,categories:{label:[{name,desc,stars,url,lang}]}}}
    dumps: [],          // 倾倒台
    weather: [],        // 情绪气象 [{date,mood,note}]
    companion: {messages: []},
    community: {nick:''},
    settings: {}        // {aiBaseUrl,aiKey,aiModel,githubToken,nick}
  };
}

function load(){
  try{
    var raw = localStorage.getItem(APP_CONFIG.storageKey);
    if(raw){ STATE = JSON.parse(raw); migrate(); return; }
  }catch(e){}
  STATE = blankState();
  seed();
  save();
}

function migrate(){
  var s = STATE;
  s.version = s.version || APP_CONFIG.version;
  s.longTasks = s.longTasks || [];
  s.dailyTasks = s.dailyTasks || [];
  s.reports = s.reports || {};
  s.digest = s.digest || {};
  s.dumps = s.dumps || [];
  s.weather = s.weather || [];
  s.companion = s.companion || {messages:[]};
  s.community = s.community || {nick:''};
  s.settings = s.settings || {};

  /* 迁移旧 v1 数据中的 dumps/weather/companion/community/settings */
  if(!s.dumps.length && s.dumps_v1) s.dumps = s.dumps_v1;
  if(!s.weather.length && s.weather_v1) s.weather = s.weather_v1;

  s.longTasks.forEach(function(g){
    g.records = g.records || [];
    if(g.status===undefined) g.status = 'active';
    if(g.current===undefined) g.current = 0;
  });
  s.dailyTasks.forEach(function(d){
    d.records = d.records || [];
    if(d.enabled===undefined) d.enabled = true;
    if(d.type===undefined) d.type = 'habit';
  });
}

function seed(){
  var t = today();

  /* 示例长周期任务 */
  STATE.longTasks = [
    {id:uid('lt'), name:'背完考研红宝书单词', unit:'词', total:5500, current:1200,
     deadline:addDays(t,90), category:'edu', status:'active',
     records:[
       {date:addDays(t,-5),amount:80,minutes:25},
       {date:addDays(t,-4),amount:60,minutes:20},
       {date:addDays(t,-3),amount:100,minutes:30},
       {date:addDays(t,-1),amount:50,minutes:15}
     ], createdAt:addDays(t,-10)},
    {id:uid('lt'), name:'读完《深度工作》', unit:'页', total:320, current:85,
     deadline:addDays(t,21), category:'edu', status:'active',
     records:[
       {date:addDays(t,-3),amount:15,minutes:40},
       {date:addDays(t,-2),amount:20,minutes:45},
       {date:addDays(t,-1),amount:10,minutes:30}
     ], createdAt:addDays(t,-7)}
  ];

  /* 示例日常任务 */
  STATE.dailyTasks = [
    {id:uid('dt'), name:'英语背词 30 个', category:'edu', subCategory:'学习', type:'habit', enabled:true,
     records:[
       {date:addDays(t,-5),amount:30,minutes:10},{date:addDays(t,-4),amount:30,minutes:12},
       {date:addDays(t,-3),amount:30,minutes:11},{date:addDays(t,-1),amount:30,minutes:10}
     ], createdAt:addDays(t,-14)},
    {id:uid('dt'), name:'跑步 30 分钟', category:'health', subCategory:'运动', type:'habit', enabled:true,
     records:[
       {date:addDays(t,-4),amount:30,minutes:30},{date:addDays(t,-2),amount:30,minutes:28}
     ], createdAt:addDays(t,-14)},
    {id:uid('dt'), name:'冥想 10 分钟', category:'health', subCategory:'冥想', type:'recharge', enabled:true,
     records:[
       {date:addDays(t,-5),amount:10,minutes:10},{date:addDays(t,-3),amount:10,minutes:10},
       {date:addDays(t,-2),amount:10,minutes:10},{date:addDays(t,-1),amount:10,minutes:10}
     ], createdAt:addDays(t,-7)}
  ];

  STATE.dumps = [
    {id:uid('d'),text:'想系统学一下 RTOS，但一直没动手，资料收藏了一堆',createdAt:addDays(t,-2),kind:null,done:false,ts:Date.now()},
    {id:uid('d'),text:'担心考研方向选错，反复查资料却不动手',createdAt:addDays(t,-1),kind:null,done:false,ts:Date.now()}
  ];
  STATE.oneThing = {date:t,text:'打开 RTOS 教程看前 10 分钟',done:false};
  STATE.weather = [
    {date:addDays(t,-4),mood:'sun',note:'状态还行'},
    {date:addDays(t,-3),mood:'cloud',note:''},
    {date:addDays(t,-2),mood:'rain',note:'有点乱'},
    {date:addDays(t,-1),mood:'cloud',note:''},
    {date:t,mood:'rain',note:''}
  ];
}

function save(){
  try{ localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(STATE)); }
  catch(e){ toast('保存失败：存储可能已满'); }
}

/* ================= GitHub 日报 ================= */
function fetchDigest(force){
  force = force || false;
  var token = (STATE.settings.githubToken || '').trim();
  if(!token){ toast('先在「设置」里填写 GitHub Token'); return Promise.resolve(null); }

  var dt = today();
  if(!force && STATE.digest[dt] && STATE.digest[dt].fetchedAt){
    return Promise.resolve(STATE.digest[dt]);
  }

  var results = {};
  var promises = DIGEST_TOPICS.map(function(tp){
    var q = tp.q+' created:>='+addDays(dt,-3)+' stars:>50 sort:stars';
    var url = 'https://api.github.com/search/repositories?q='+encodeURIComponent(q)+'&per_page=3';
    return fetch(url,{headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}})
      .then(function(r){ return r.ok ? r.json() : {items:[]}; })
      .then(function(j){
        var items = (j.items||[]).map(function(item){
          return {name:item.full_name, desc:(item.description||'').slice(0,120), stars:item.stargazers_count, url:item.html_url, lang:item.language||''};
        });
        results[tp.label] = items;
      })
      .catch(function(){ results[tp.label] = []; });
  });

  return Promise.all(promises).then(function(){
    STATE.digest[dt] = {fetchedAt:Date.now(), categories:results};
    save();
    return STATE.digest[dt];
  });
}

function renderDigestView(){
  var dt = today();
  var dg = STATE.digest[dt];
  var h = '<div class="card"><h2>'+icon('trending')+' 技术日报 · '+dt+'</h2>'
    +'<div class="hint">每天自动拉取近 3 天各领域 GitHub 热门开源项目。点击「刷新」手动更新。</div>'
    +'<button class="btn primary sm" data-act="refreshDigest">'+icon('refresh')+' 刷新</button></div>';

  if(!dg || !dg.categories){
    h += '<div class="empty">暂无数据。点「刷新」拉取（需在设置中配置 GitHub Token）。</div>';
    return h;
  }

  Object.keys(dg.categories).forEach(function(catLabel){
    var repos = dg.categories[catLabel];
    h += '<div class="digest-cat"><div class="ch">'+icon('spark')+' '+esc(catLabel)+' <span class="muted" style="font-weight:400;font-size:12px">'+repos.length+' 项</span></div>';
    repos.forEach(function(r){
      h += '<div class="repo">'
        +'<div class="row between"><span class="rn">'+esc(r.name)+'</span><span class="rm">★ '+r.stars+'</span></div>'
        +(r.desc?'<div class="rd">'+esc(r.desc)+'</div>':'')
        +(r.lang?'<span class="tag do" style="margin-right:6px">'+r.lang+'</span>':'')
        +' <a href="'+r.url+'" target="_blank">查看</a>'
        +'</div>';
    });
    h += '</div>';
  });

  h += '<div class="card hint" style="font-size:12px">数据来源：GitHub Search API · 缓存时间 '+new Date(dg.fetchedAt).toLocaleTimeString()+'</div>';
  return h;
}

/* ================= 长周期任务 ================= */
function longPct(g){
  if(!g.total || g.total<=0) return 0;
  return Math.min(100, Math.round((g.current||0)/g.total*100));
}

function checkLongMilestones(g){
  var pct = longPct(g);
  var msgs = [];
  if(pct>=100 && !g._milestoneDone){
    g._milestoneDone = true;
    msgs.push('🎉 「'+g.name+'」已完成！你做到了！');
  } else if(pct>=50 && !g._milestoneHalf){
    g._milestoneHalf = true;
    msgs.push('💪 「'+g.name+'」进度已到 '+pct+'%！过半了，继续！');
  }
  return msgs;
}

/* 检查所有活跃长周期是否连续2天未打卡 → 自动暂停 */
function checkAutoPause(){
  var yesterday = addDays(today(),-1);
  STATE.longTasks.forEach(function(g){
    if(g.status!=='active') return;
    var lastRec = null;
    for(var i=g.records.length-1;i>=0;i--){
      if(g.records[i].date<=yesterday){ lastRec=g.records[i]; break; }
    }
    if(lastRec && lastRec.date<yesterday){
      /* 最后一次打卡不是昨天也不是今天 → 漏了至少1天，检查是否连续漏2天 */
      var dayBefore = addDays(yesterday,-1);
      var hasDayBefore = g.records.some(function(r){return r.date===dayBefore;});
      var hasToday = g.records.some(function(r){return r.date===today();});
      if(!hasDayBefore && !hasToday){
        g.status='paused';
        g.pausedAt=today();
        toast('「'+g.name+'」已自动暂停（连续两天未打卡），回来后可继续');
      }
    }
  });
}

function renderLongTaskCard(g){
  var pct = longPct(g);
  var isTodayChecked = g.records.some(function(r){return r.date===today();});
  var statusBadge = '';
  if(g.status==='done') statusBadge = '<span class="badge-done">已完成</span>';
  else if(g.status==='paused') statusBadge = '<span class="badge-pause">已暂停</span>';

  return '<div class="task '+(g.status==='paused'?'paused':'')+'" data-id="'+g.id+'">'
    +'<div class="tinfo">'
    +'<div class="tname">'+esc(g.name)+' '+statusBadge+'</div>'
    +'<div class="tmeta">'+catLabel(g.category)+' · '+g.current+'/'+g.total+' '+g.unit+' · 截止 '+g.deadline+'</div>'
    +'<div class="bar"><div style="width:'+pct+'%"></div></div>'
    +'</div>'
    +(g.status==='active'
      ? (isTodayChecked
        ? '<button class="btn ghost sm" data-act="editLong" data-id="'+g.id+'">'+icon('edit')+'编辑</button>'
        : '<button class="btn primary sm" data-act="checkinLong" data-id="'+g.id+'">'+icon('check')+'打卡</button>')
      : (g.status==='paused'
        ? '<button class="btn teal sm" data-act="resumeLong" data-id="'+g.id+'">继续</button>'
        : ''))
    +'<button class="btn ghost sm" data-act="editLong" data-id="'+g.id+'">'+icon('edit')+'</button>'
    +'<button class="btn ghost sm" data-act="delLong" data-id="'+g.id+'">'+icon('trash')+'</button>'
    +'</div>';
}

/* ================= 日常循环任务 ================= */
function isDailyCheckedToday(dt){
  return dt.records.some(function(r){return r.date===today();});
}

function dailyTodayMinutes(dt){
  var rec = dt.records.find(function(r){return r.date===today();});
  return rec ? (rec.minutes||0) : 0;
}

function weeklyDailyStats(wk){
  var stats = {}; /* {categoryKey: {minutes:0, days:0, targetDays:7}} */
  STATE.dailyTasks.forEach(function(dt){
    if(!dt.enabled) return;
    if(!stats[dt.category]) stats[dt.category]={minutes:0,days:0,targetDays:7};
    dt.records.forEach(function(r){
      if(r.date>=wk && r.date<addDays(wk,7)){
        stats[dt.category].minutes += (r.minutes||0);
        stats[dt.category].days++;
      }
    });
  });
  return stats;
}

function renderDailyTaskCard(dt){
  var checked = isDailyCheckedToday(dt);
  var typeIcon = dt.type==='recharge' ? '🔋' : '📌';
  var typeLabel = dt.type==='recharge' ? '<span class="cat recharge">充能</span>' : '';

  return '<div class="task '+(checked?'':'')+'" data-id="'+dt.id+'">'
    +'<div class="tinfo">'
    +'<div class="tname">'+esc(dt.name)+' '+typeLabel+(dt.enabled?'':'<span class="badge-pause">已关</span>')+'</div>'
    +'<div class="tmeta">'+catLabel(dt.category)+(dt.subCategory?' · '+esc(dt.subCategory):'')+'</div>'
    +'</div>'
    +(checked
      ? '<span class="badge-done">✓ 已完成 '+dailyTodayMinutes(dt)+'分钟</span>'
      : '<button class="btn primary sm" data-act="checkinDaily" data-id="'+dt.id+'">'+icon('check')+'打卡</button>')
    +'<button class="btn ghost sm" data-act="toggleDaily" data-id="'+dt.id+'">'+(dt.enabled?'关':'开')+'</button>'
    +'<button class="btn ghost sm" data-act="editDaily" data-id="'+dt.id+'">'+icon('edit')+'</button>'
    +'<button class="btn ghost sm" data-act="delDaily" data-id="'+dt.id+'">'+icon('trash')+'</button>'
    +'</div>';
}

/* ================= 视图：今日 ================= */
function viewToday(){
  var h = '';

  /* 推送区：如果有今天的日报就显示摘要 */
  var dg = STATE.digest[today()];
  if(dg && dg.categories){
    var catCount = Object.keys(dg.categories).length;
    var totalRepos = 0;
    Object.keys(dg.categories).forEach(function(k){ totalRepos+=dg.categories[k].length; });
    h+='<div class="push" data-act="goDigest">'
      +'<div class="pulse"></div><div>'
      +'<div class="ptitle">📡 今日技术日报已就绪</div>'
      +'<div class="pbody">覆盖 '+catCount+' 个领域、'+totalRepos+' 个热门项目。点击查看详情 →</div>'
      +'</div></div>';
  } else {
    h+='<div class="push" data-act="goDigest">'
      +'<div class="pulse"></div><div>'
      +'<div class="ptitle">📡 技术日报待拉取</div>'
      +'<div class="pbody">每天自动获取 GitHub 各领域热门开源项目，帮你跟上时代进度。</div>'
      +'</div></div>';
  }

  /* 今日一件 */
  var ot = STATE.oneThing;
  h += '<div class="card one-thing">';
  if(ot && ot.date===today()){
    h += '<div class="muted">今天只承诺一件事</div>'
      + '<div class="big">'+(ot.done ? '<span class="done-state">'+icon('check')+' 完成了 ✓</span>' : esc(ot.text))+'</div>'
      + (ot.done
        ? '<button class="btn ghost" data-act="changeOne">明天再来</button>'
        : '<button class="btn primary" data-act="markOne">'+icon('check')+' 我做完了</button> <button class="btn ghost" data-act="changeOne">换一件</button>');
  } else {
    h += '<div class="muted">今天还没有承诺</div>'
      + '<div class="big">挑最小的一件</div>'
      + '<button class="btn primary" data-act="newOne">'+icon('plus')+' 定一件</button>';
  }
  h += '</div>';

  /* 快捷打卡区：启用的日常任务 */
  var activeDailies = STATE.dailyTasks.filter(function(d){return d.enabled;});
  if(activeDailies.length){
    h += '<div class="card"><h2>快捷打卡</h2><div class="hint">做了就打，不催不罚。</div><div class="quick-checkin">';
    activeDailies.forEach(function(dt){
      var checked = isDailyCheckedToday(dt);
      h += '<div class="qci '+(checked?'done':'')+'" data-act="quickCheckin" data-id="'+dt.id+'">'
        + (checked ? icon('check')+' '+esc(dt.name) : esc(dt.name))
        + '</div>';
    });
    h += '</div></div>';
  }

  /* 长周期进度提醒 */
  var milestoneMsgs = [];
  STATE.longTasks.filter(function(g){return g.status==='active';}).forEach(function(g){
    var ms = checkLongMilestones(g);
    milestoneMsgs = milestoneMsgs.concat(ms);
  });
  if(milestoneMsgs.length){
    h += '<div class="card" style="background:linear-gradient(135deg,rgba(34,197,94,.08),rgba(20,184,166,.06));border-color:rgba(34,197,94,.25)">';
    h += '<h2 style="color:#16a34a">'+icon('spark')+' 进度里程碑</h2>';
    milestoneMsgs.forEach(function(m){ h += '<div style="margin:6px 0;font-size:14px">'+m+'</div>'; });
    h += '</div>';
  }

  return h;
}

/* ================= 视图：任务 ================= */
function viewTasks(){
  var h = '';

  /* 长周期 */
  h += '<div class="card"><div class="row between"><h2>'+icon('target')+' 长周期任务</h2>'
    + '<button class="btn primary sm" data-act="newLong">'+icon('plus')+' 导入长周期</button></div>'
    + '<div class="hint">有终点有总量的目标（如背完红宝书）。必填截止日，超期温和提醒；连续两天未打卡自动暂停。</div></div>';

  var activeLts = STATE.longTasks.filter(function(g){return g.status!=='done';});
  var doneLts = STATE.longTasks.filter(function(g){return g.status==='done';});

  if(!activeLts.length && !doneLts.length){
    h += '<div class="empty">还没有长周期任务。点「导入长周期」添加一个。</div>';
  } else {
    activeLts.forEach(function(g){ h += renderLongTaskCard(g); });
    if(doneLts.length){
      h += '<div class="hint" style="margin-top:12px">✓ 已完成</div>';
      doneLts.forEach(function(g){ h += renderLongTaskCard(g); });
    }
  }

  /* 日常循环 */
  h += '<div class="card"><div class="row between"><h2>'+icon('list')+' 日常循环</h2>'
    + '<button class="btn primary sm" data-act="newDaily">'+icon('plus')+' 新建日常</button></div>'
    + '<div class="hint">每天提升自己的短周期任务（如跑步、背词、冥想）。不生成清单，做了就打卡。可自由开关。</div></div>';

  if(!STATE.dailyTasks.length){
    h += '<div class="empty">还没有日常任务。点「新建日常」添加。</div>';
  } else {
    STATE.dailyTasks.forEach(function(dt){ h += renderDailyTaskCard(dt); });
  }

  return h;
}

/* ================= 视图：周报/复盘 ================= */
function generateWeeklyReport(){
  var wk = weekKey();
  if(STATE.reports[wk]) return STATE.reports[wk];

  /* 计算本周概况 */
  var monday = wk;
  var sunday = addDays(wk,6);

  /* 长周期本周进展 */
  var ltActive = 0, ltTotal = STATE.longTasks.length;
  STATE.longTasks.forEach(function(g){
    if(g.status==='active') ltActive++;
    /* 检查本周是否有记录 */
    var hasThisWeek = g.records.some(function(r){return r.date>=monday && r.date<=sunday;});
    if(hasThisWeek && !g._weekNoted) g._weekNoted=true;
  });

  /* 日常统计 */
  var dStats = weeklyDailyStats(wk);
  var totalDailyMin = 0;
  Object.keys(dStats).forEach(function(k){ totalDailyMin+=dStats[k].minutes; });

  /* 心情轨迹 */
  var moodTrack = [];
  for(var i=0;i<7;i++){
    var d=addDays(monday,i);
    var w=STATE.weather.find(function(x){return x.date===d;});
    moodTrack.push({date:d, mood:w?w.mood:null});
  }

  /* 每日卡 */
  var dailyCards = [];
  for(var i=0;i<7;i++){
    var d=addDays(monday,i);
    if(d>today()) continue; /* 未来不生成 */

    /* 当天完成的任务数 */
    var tasksDone=0, tasksTotal=0, loadMin=0, rechargeMin=0;
    STATE.longTasks.forEach(function(g){
      if(g.records.some(function(r){return r.date===d;})) tasksDone++;
      tasksTotal++;
    });
    STATE.dailyTasks.forEach(function(dt){
      if(!dt.enabled) return;
      var rec=dt.records.find(function(r){return r.date===d;});
      if(rec){
        loadMin+=(rec.minutes||0);
        if(dt.type==='recharge') rechargeMin+=(rec.minutes||0);
      }
    });

    var wObj=STATE.weather.find(function(x){return x.date===d;});
    var rate = tasksTotal>0 ? Math.round(tasksDone/tasksTotal*100) : 0;

    /* 温柔评语 */
    var comment='';
    if(rate>=80) comment='状态很好，保持了健康的节奏';
    else if(rate>=50) comment='稳中有进，继续加油';
    else if(rate>0) comment='慢一点也行，你在往前走';
    else comment='休息也是前进的一部分';

    dailyCards.push({date:d, tasksDone:tasksDone, tasksTotal:tasksTotal, load:loadMin, recharge:rechargeMin, rate:rate, mood:wObj?wObj.mood:null, comment:comment});
  }

  var completionRate = dailyCards.length>0
    ? Math.round(dailyCards.reduce(function(a,c){return a+c.rate;},0)/dailyCards.length)
    : 0;

  var report = {
    generatedAt: Date.now(),
    summary: {
      completionRate: completionRate,
      avgLoad: dailyCards.length>0 ? Math.round(dailyCards.reduce(function(a,c){return a+c.load;},0)/dailyCards.length) : 0,
      totalDailyMin: totalDailyMin
    },
    moodTrack: moodTrack,
    dailyCards: dailyCards,
    dailyStats: dStats
  };

  STATE.reports[wk]=report;
  save();
  return report;
}

function viewWeekly(){
  var rpt = generateWeeklyReport();
  var wk = weekKey();
  var h = '<div class="card"><h2>'+icon('chart')+' 复盘 · 本周</h2>'
    + '<div class="hint">回顾你的一周。每周首次打开自动生成。</div></div>';

  /* 本周概况三数字 */
  h += '<div class="stat-row"><div class="stat-col"><div class="stat-num" style="color:var(--amber)">'+rpt.summary.completionRate+'%</div><div class="stat-label">完成率</div></div>'
    + '<div class="stat-col"><div class="stat-num" style="color:var(--violet)">'+rpt.summary.avgLoad+'</div><div class="stat-label">日均投入(分钟)</div></div>'
    + '<div class="stat-num" style="color:var(--teal);font-size:28px;font-weight:900;display:block">'+rpt.summary.totalDailyMin+'</div><div class="stat-label" style="text-align:center">本周总计(分钟)</div>'
    + '</div>';

  /* 心情轨迹 */
  h += '<div class="card"><h2>心情轨迹</h2><div class="row" style="gap:16px;justify-content:center;margin-top:10px">';
  var moodEmoji={sun:'😊',cloud:'🙂',rain:'☁️',storm:'😫'};
  rpt.moodTrack.forEach(function(m){
    h += '<div style="text-align:center"><div style="font-size:22px">'+(moodEmoji[m.mood]||'·')+'</div><div class="muted" style="font-size:11px;margin-top:2px">'+m.date.slice(5)+'</div></div>';
  });
  h += '</div></div>';

  /* 看板：各类日常投入时间占比 */
  var ds = rpt.dailyStats;
  var catKeys = Object.keys(ds);
  if(catKeys.length){
    h += '<div class="card"><h2>本周投入分布</h2><div class="kanban">';
    var maxMin = 1;
    catKeys.forEach(function(k){ if(ds[k].minutes>maxMin) maxMin=ds[k].minutes; });

    catKeys.forEach(function(k){
      var pct = Math.round(ds[k].minutes/maxMin*100);
      var colors = {health:'#22c55e',edu:'#3b82f6',create:'#9333ea',life:'#f59e0b',nature:'#14b8a6'};
      var col = colors[k]||'var(--violet)';
      h += '<div class="kb-row"><div class="kl">'+catName(k)+'</div>'
        + '<div class="kt"><div style="width:'+pct+'%;background:'+col+'"></div></div>'
        + '<div class="kv">'+ds[k].minutes+'min</div></div>';
    });
    h += '</div></div>';
  }

  /* 每日卡片 */
  h += '<div class="card"><h2>每日回顾</h2>';
  rpt.dailyCards.forEach(function(dc){
    var barColor = dc.rate>=80 ? 'var(--green)' : dc.rate>=50 ? 'var(--amber)' : 'var(--red)';
    var moodE={sun:'😊',cloud:'🙂',rain:'☁️',storm:'😫'};
    h += '<div class="day-card">'
      + '<div class="dc-head"><strong>'+dc.date.slice(5)+'</strong> <span class="muted">'+dc.tasksDone+'/'+dc.tasksTotal+' 任务</span>'
      + '<span style="margin-left:auto;font-size:18px">'+(moodE[dc.mood]||'')+'</span>'
      + '<span style="color:'+(dc.rate>=80?'var(--green)':dc.rate>=50?'var(--amber)':'var(--red)')+';font-weight:800;margin-left:8px">'+dc.rate+'%</span></div>'
      + '<div class="dc-stats"><span>负荷 '+dc.load+'min</span><span>充能 '+dc.recharge+'min</span></div>'
      + '<div class="dc-bar"><div style="width:'+dc.rate+'%;background:'+barColor+'"></div></div>'
      + '<div class="dc-comment">'+dc.comment+'</div>'
      + '</div>';
  });
  h += '</div>';

  return h;
}

/* ================= 视图：陪伴（保持不变） ================= */
var SYSTEM_PROMPT = '你是「着陆」的陪伴者。用户是一个多线程压身（实习/考研/科研/比赛）的年轻人，常"有想法不干事"。你的风格：温柔、不评判、不催促。先接住情绪，再用一两个问题或一句拆解，帮他把想法变成"今天能迈的最小一步"。不要长篇说教，每次回复控制在 120 字内。';

function callAI(messages){
  var s = STATE.settings;
  if(!s.aiBaseUrl || !s.aiKey){ return Promise.resolve({error:'未配置 AI：去「我的→设置」填写'}); }
  var url = s.aiBaseUrl.replace(/\/+$/,'')+'/chat/completions';
  return fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.aiKey},
    body:JSON.stringify({model:s.aiModel||'gpt-4o-mini',messages:messages,temperature:0.7})
  }).then(function(r){ return r.ok?r.json():r.text().then(function(t){return {_err:r.status+' '+t.slice(0,160)};}); })
    .then(function(j){ if(j._err)return{error:j._err}; return{content:(j.choices&&j.choices[0]&&j.choices[0].message.content)||'(空)'}; })
    .catch(function(e){ return{error:'调用失败：'+e.message}; });
}

function viewCompanion(){
  var msgs = STATE.companion.messages;
  var h = '<div class="card"><h2>'+icon('chat')+' AI 陪伴</h2>'
    + '<div class="hint">不评判、不催促。把闷在心里的话说出来。'+(STATE.settings.aiKey?'':'<span style="color:var(--amber)"> 未配置 AI → 设置</span>')+'</div>'
    + '<button class="btn ghost sm" data-act="followup3">'+icon('refresh')+' 近三日跟进</button></div>'
    + '<div class="card"><div class="chat" id="chat">';
  if(!msgs.length) h+='<div class="empty">说点什么，或者点「近三日跟进」。</div>';
  msgs.forEach(function(m){ h+='<div class="bubble '+(m.role==='user'?'me':'ai')+'">'+esc(m.content)+'</div>'; });
  h+='</div><div class="companion-input"><textarea id="aiInput" placeholder="说点什么…"></textarea><button class="btn primary" data-act="sendAI">'+icon('send')+'</button></div></div>';
  return h;
}

/* ================= 视图：我的（设置+树洞） ================= */
function viewMe(){
  var h = '<div class="card"><h2>'+icon('cog')+' 设置</h2><div class="hint">配置 AI 和 GitHub Token。所有数据只存本地浏览器。</div>'
    + '<button class="btn primary block" data-act="openSettings">'+icon('edit')+' 打开设置面板</button></div>';

  /* 数据概览 */
  h += '<div class="card"><h2>数据概览</h2>'
    + '<div class="row" style="gap:24px;flex-wrap:wrap"><div>长周期：<b>'+(STATE.longTasks.filter(function(g){return g.status!=='done';}).length)+'</b> 进行中</div>'
    + '<div>日常：<b>'+STATE.dailyTasks.filter(function(d){return d.enabled;}).length+'</b> 启用中</div>'
    + '<div>倾倒：<b>'+STATE.dumps.length+'</b> 条</div>'
    + '<div>情绪记录：<b>'+STATE.weather.length+'</b> 天</div></div></div>';

  /* 树洞 */
  h += '<div class="card"><h2>'+icon('people')+' 匿名树洞</h2>'
    + '<div class="field"><textarea id="postBody" placeholder="今天着陆了吗？还是还在飘着？"></textarea></div>'
    + '<div class="row between"><button class="btn primary" data-act="postCommunity">'+icon('send')+' 匿名发布</button>'
    + '<button class="btn ghost sm" data-act="loadCommunity">'+icon('refresh')+' 刷新</button></div></div>'
    + '<div id="posts"><div class="empty">加载中…</div></div>';

  return h;
}

/* ================= 渲染入口 ================= */
var TAB_TITLE = {today:'今日',tasks:'任务',weekly:'周报',digest:'日报',companion:'陪伴',me:'我的'};
function render(){
  var views = {today:viewToday,tasks:viewTasks,weekly:viewWeekly,digest:renderDigestView,companion:viewCompanion,me:viewMe};
  $('view').innerHTML = views[CUR_TAB]();
  $('viewTitle').textContent = TAB_TITLE[CUR_TAB];

  document.querySelectorAll('.nav-item').forEach(function(b){
    b.classList.toggle('active', b.dataset.tab===CUR_TAB);
  });

  if(CUR_TAB==='me'){ App.loadCommunity(); }
  if(CUR_TAB==='companion'){ var c=$('chat'); if(c) c.scrollTop=c.scrollHeight; }
}

/* ================= 模态框 ================= */
function openSheet(html){
  var s=$('sheet');
  s.innerHTML='<div class="sheet">'+html+'</div>';
  s.classList.remove('hidden');
  s.classList.add('show');
}
function closeSheet(){
  var s=$('sheet');
  s.classList.add('hidden');
  s.classList.remove('show');
  s.innerHTML='';
}

/* ================= 业务动作 ================= */
var App = {

  /* --- 今日 --- */
  markOne:function(){ if(STATE.oneThing && STATE.oneThing.date===today()){ STATE.oneThing.done=true; save(); render(); toast('完成了，今天稳了 ✓'); } },
  changeOne:function(){ STATE.oneThing=null; save(); render(); },
  newOne:function(){
    openSheet('<h2>今天只承诺一件</h2><div class="hint">挑最小、最不添焦虑的那件。</div>'
      + '<div class="field"><textarea id="o_text" placeholder="比如：打开书看 10 分钟"></textarea></div>'
      + '<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="o_save">定下</button></div>');
    $('o_save').addEventListener('click',function(){
      var v=$('o_text').value.trim(); if(!v){toast('写点什么');return;}
      STATE.oneThing={date:today(),text:v,done:false}; save(); closeSheet(); render(); toast('今天就这一件');
    });
  },

  /* --- 长周期 CRUD --- */
  newLong:function(){ App.openLongForm(null); },
  editLong:function(id){ App.openLongForm(id); },
  openLongForm:function(id){
    var g=id ? STATE.longTasks.find(function(x){return x.id===id;}) : null;
    var isEdit=!!g;
    openSheet('<h2>'+(isEdit?'编辑':'导入')+'长周期任务</h2>'
      + '<div class="field"><label>名称</label><input id="lt_name" value="'+esc(g?g.name:'')+'" placeholder="如：背完考研红宝书单词"></div>'
      + '<div class="field"><label>单位</label><input id="lt_unit" value="'+esc(g?g.unit:'个')+'" placeholder="个/页/词/节"></div>'
      + '<div class="row" style="gap:10px"><div class="field" style="flex:1"><label>总量</label><input id="lt_total" type="number" value="'+(g?g.total:'')+'" placeholder="5500"></div>'
      + '<div class="field" style="flex:1"><label>当前进度</label><input id="lt_cur" type="number" value="'+(g?g.current:'0')+'" placeholder="0"></div></div>'
      + '<div class="field"><label>截止日期</label><input id="lt_dl" type="date" value="'+(g?g.deadline:'')+'"></div>'
      + '<div class="field"><label>类别</label><div class="cat-grid" id="lt_cat"></div></div>'
      + '<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="lt_save">'+(isEdit?'保存':'创建')+'</button></div>');

    /* 渲染类别选择 */
    var catHtml='';
    CATEGORIES.forEach(function(c){
      catHtml+='<div class="cat-chip '+(g&&g.category===c.key?'on':'')+'" data-ck="'+c.key+'">'+c.label+'</div>';
    });
    $('lt_cat').innerHTML=catHtml;
    var selCat=g?g.category:CATEGORIES[0].key;
    $('lt_cat').querySelectorAll('[data-ck]').forEach(function(el){
      el.addEventListener('click',function(){
        $('lt_cat').querySelectorAll('[data-ck]').forEach(function(x){x.classList.remove('on');});
        el.classList.add('on'); selCat=el.dataset.ck;
      });
    });

    $('lt_save').addEventListener('click',function(){
      var name=$('lt_name').value.trim(), unit=$('lt_unit').value.trim()||'个';
      var total=parseInt($('lt_total').value,10), cur=parseInt($('lt_cur').value,10)||0;
      var dl=$('lt_dl').value;
      if(!name||!total||!dl){toast('名称、总量、截止日必填');return;}
      if(g){ g.name=name;g.unit=unit;g.total=total;g.current=cur;g.deadline=dl;g.category=selCat; }
      else{ STATE.longTasks.push({id:uid('lt'),name:name,unit:unit,total:total,current:cur,deadline:dl,category:selCat,status:'active',records:[],createdAt:today()}); }
      save(); closeSheet(); render(); toast(isEdit?'已更新':'已导入长周期任务');
    });
  },

  checkinLong:function(id){
    var g=STATE.longTasks.find(function(x){return x.id===id;}); if(!g)return;
    openSheet('<h2>打卡：'+esc(g.name)+'</h2>'
      + '<div class="muted">当前 '+g.current+'/'+g.total+' '+g.unit+' ('+longPct(g)+'%)</div>'
      + '<div class="field"><label>本次完成量（'+g.unit+'）</label><input id="ci_amt" type="number" value="1" min="0"></div>'
      + '<div class="field"><label>花费时间（分钟，可选）</label><input id="ci_min" type="number" value="" placeholder="可选"></div>'
      + '<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="ci_ok">确认打卡</button></div>');
    $('ci_ok').addEventListener('click',function(){
      var amt=parseInt($('ci_amt').value,10)||0;
      var mins=parseInt($('ci_min').value,10)||0;
      g.current=(g.current||0)+amt;
      g.records.push({date:today(),amount:amt,minutes:mins,ts:Date.now()});
      if(g.current>=g.total){ g.status='done'; }
      save(); closeSheet();
      var ms=checkLongMilestones(g);
      render();
      if(ms.length){ setTimeout(function(){toast(ms[0]);},300); }
      else{ toast('已打卡 +'+amt+' '+g.unit); }
    });
  },

  resumeLong:function(id){
    var g=STATE.longTasks.find(function(x){return x.id===id;}); if(!g)return;
    g.status='active'; g.pausedAt=null; save(); render(); toast('已恢复「'+g.name+'」');
  },

  delLong:function(id){
    var g=STATE.longTasks.find(function(x){return x.id===id;}); if(!g)return;
    openSheet('<h2>删除长周期任务？</h2><div class="hint">「'+esc(g.name)+'」及其 '+g.records.length+' 条记录将被删除。</div>'
      + '<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn danger" id="dl_yes">确认删除</button></div>');
    $('dl_yes').addEventListener('click',function(){
      STATE.longTasks=STATE.longTasks.filter(function(x){return x.id!==id;}); save(); closeSheet(); render(); toast('已删除');
    });
  },

  /* --- 日常 CRUD --- */
  newDaily:function(){ App.openDailyForm(null); },
  editDaily:function(id){ App.openDailyForm(id); },
  toggleDaily:function(id){
    var dt=STATE.dailyTasks.find(function(x){return x.id===id;}); if(!dt)return;
    dt.enabled=!dt.enabled; save(); render(); toast(dt.enabled?'已启用':'已关闭');
  },
  openDailyForm:function(id){
    var dt=id?STATE.dailyTasks.find(function(x){return x.id===id;}):null;
    var isEdit=!!dt;
    openSheet('<h2>'+(isEdit?'编辑':'新建')+'日常任务</h2>'
      + '<div class="field"><label>名称</label><input id="dn_name" value="'+esc(dt?dt.name:'')+'" placeholder="如：跑步 30 分钟"></div>'
      + '<div class="field"><label>类型</label><div class="seg" id="dn_type">'
      + '<button class="btn '+(dt&&dt.type==='habit'?'primary':'ghost')+'" data-dt="habit">习惯提升</button>'
      + '<button class="btn '+(dt&&dt.type==='recharge'?'primary':'ghost')+'" data-dt="recharge">充能恢复</button>'
      + '</div></div>'
      + '<div class="field"><label>大类</label><div class="cat-grid" id="dn_cat"></div></div>'
      + '<div class="field"><label>子类（可选）</label><input id="dn_sub" value="'+esc(dt?dt.subCategory:'')+'" placeholder="如：运动 / 冥想 / 阅读"></div>'
      + '<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="dn_save">'+(isEdit?'保存':'创建')+'</button></div>');

    var selType=dt?dt.type:'habit';
    $('dn_type').querySelectorAll('[data-dt]').forEach(function(b){
      b.addEventListener('click',function(){
        selType=b.dataset.dt;
        $('dn_type').querySelectorAll('[data-dt]').forEach(function(x){
          x.className='btn '+(x===b?'primary':'ghost');
        });
      });
    });

    var catHtml='';
    CATEGORIES.forEach(function(c){
      catHtml+='<div class="cat-chip '+(dt&&dt.category===c.key?'on':'')+'" data-dk="'+c.key+'">'+c.label+'</div>';
    });
    $('dn_cat').innerHTML=catHtml;
    var selCat=dt?dt.category:CATEGORIES[0].key;
    $('dn_cat').querySelectorAll('[data-dk]').forEach(function(el){
      el.addEventListener('click',function(){
        $('dn_cat').querySelectorAll('[data-dk]').forEach(function(x){x.classList.remove('on');});
        el.classList.add('on'); selCat=el.dataset.dk;
      });
    });

    $('dn_save').addEventListener('click',function(){
      var name=$('dn_name').value.trim(), sub=$('dn_sub').value.trim();
      if(!name){toast('写个名字');return;}
      if(dt){ dt.name=name;dt.category=selCat;dt.subCategory=sub;dt.type=selType; }
      else{ STATE.dailyTasks.push({id:uid('dt'),name:name,category:selCat,subCategory:sub,type:selType,enabled:true,records:[],createdAt:today()}); }
      save(); closeSheet(); render(); toast(isEdit?'已更新':'已创建日常任务');
    });
  },

  checkinDaily:function(id){
    var dt=STATE.dailyTasks.find(function(x){return x.id===id;}); if(!dt)return;
    if(isDailyCheckedToday(dt)){ toast('今天已经打过卡了'); return; }
    openSheet('<h2>打卡：'+esc(dt.name)+'</h2>'
      + '<div class="field"><label>花费时间（分钟）</label><input id="dci_min" type="number" value="10" min="1"></div>'
      + '<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn primary" id="dci_ok">确认</button></div>');
    $('dci_ok').addEventListener('click',function(){
      var mins=parseInt($('dci_min').value,10)||10;
      dt.records.push({date:today(),amount:1,minutes:mins,ts:Date.now()});
      save(); closeSheet(); render(); toast('已打卡 '+mins+' 分钟 ✓');
    });
  },

  quickCheckin:function(id){ App.checkinDaily(id); },

  delDaily:function(id){
    var dt=STATE.dailyTasks.find(function(x){return x.id===id;}); if(!dt)return;
    openSheet('<h2>删除日常任务？</h2><div class="hint">「'+esc(dt.name)+'」将被删除。</div>'
      + '<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn danger" id="dd_yes">确认删除</button></div>');
    $('dd_yes').addEventListener('click',function(){
      STATE.dailyTasks=STATE.dailyTasks.filter(function(x){return x.id!==id;}); save(); closeSheet(); render(); toast('已删除');
    });
  },

  /* --- 日报 --- */
  goDigest:function(){ CUR_TAB='digest'; render(); },
  refreshDigest:function(){
    toast('正在拉取最新数据…');
    fetchDigest(true).then(function(){
      render();
      toast('日报已更新');
    });
  },

  /* --- AI 陪伴 --- */
  sendAI:function(){
    var inp=$('aiInput'); if(!inp) return;
    var v=inp.value.trim(); if(!v) return;
    if(!STATE.settings.aiKey){ toast('先配置 AI'); CUR_TAB='me'; render(); App.openSettings(); return; }
    STATE.companion.messages.push({role:'user',content:v,ts:Date.now()});
    inp.value=''; save(); render();
    var msgs=[{role:'system',content:SYSTEM_PROMPT}].concat(
      STATE.companion.messages.map(function(m){return{role:m.role,content:m.content};})
    );
    callAI(msgs).then(function(r){
      STATE.companion.messages.push({role:'assistant',content:r.error?r.error:r.content,ts:Date.now()});
      save(); render();
    });
  },

  followup3:function(){
    if(!STATE.settings.aiKey){ toast('先配置 AI'); CUR_TAB='me'; render(); App.openSettings(); return; }
    var since=addDays(today(),-3);
    var dumps=STATE.dumps.filter(function(d){return d.createdAt>=since;}).map(function(d){return '【'+(d.kind||'未分类')+'】'+d.text;});
    var weather=STATE.weather.filter(function(w){return w.date>=since;}).map(function(w){return w.date+' '+w.mood+(w.note?'：'+w.note:'');});
    var ot=STATE.oneThing&&STATE.oneThing.date>=since?('今天一件：'+STATE.oneThing.text+(STATE.oneThing.done?'（已完成）':'（未完成）')):'(无)';
    var prompt='这是用户近三天的记录，请生成一份温柔的「跟进日报」：1)一句话接住他现在的状态；2)指出一个小进展；3)给一个明天可以迈的最小一步。控制在150字内。\n倾倒台：'+(dumps.join('\n')||'（无）')+'\n情绪：'+(weather.join('\n')||'（无）')+'\n'+ot;
    STATE.companion.messages.push({role:'user',content:'【近三日跟进】请生成我的日报',ts:Date.now()});
    var msgs=[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt}];
    save(); render();
    callAI(msgs).then(function(r){
      STATE.companion.messages.push({role:'assistant',content:r.error?r.error:r.content,ts:Date.now()});
      save(); render();
    });
  },

  /* --- 树洞 --- */
  loadCommunity:function(){
    var box=$('posts'); if(!box) return;
    var api=APP_CONFIG.communityApi||'';
    fetch(api+'/feed').then(function(r){return r.ok?r.json():{posts:[]};}).then(function(j){
      var posts=j.posts||[];
      if(!posts.length){ box.innerHTML='<div class="empty">树洞还空着。</div>'; return; }
      box.innerHTML=posts.slice(0,40).map(function(p){
        return '<div class="post"><div class="head"><span>匿名</span><span>'+esc(p.date||'')+'</span></div><div class="body">'+esc(p.body||'')+'</div></div>';
      }).join('');
    }).catch(function(e){ box.innerHTML='<div class="empty">连接失败（需要启动后端 server.js）</div>'; });
  },

  postCommunity:function(){
    var ta=$('postBody'); if(!ta) return;
    var v=ta.value.trim(); if(!v){toast('写点什么');return;}
    var api=APP_CONFIG.communityApi||'';
    fetch(api+'/feed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:v,nick:STATE.community.nick||''})})
      .then(function(r){return r.ok?'ok':r.text();}).then(function(){
        ta.value=''; App.loadCommunity(); toast('已匿名发布');
      }).catch(function(e){ toast('失败：'+e.message); });
  },

  /* --- 设置 --- */
  openSettings:function(){
    var s=STATE.settings;
    openSheet('<h2>'+icon('cog')+' 设置</h2>'
      + '<div class="field"><label>GitHub Token（用于拉取日报）</label><input id="s_gh" type="password" value="'+esc(s.githubToken||'')+'" placeholder="ghp_... 或 PAT"></div>'
      + '<div class="field"><label>AI 接口地址（baseUrl）</label><input id="s_base" value="'+esc(s.aiBaseUrl||'')+'" placeholder="https://api.openai.com/v1"></div>'
      + '<div class="field"><label>API Key</label><input id="s_key" type="password" value="'+esc(s.aiKey||'')+'" placeholder="sk-..."></div>'
      + '<div class="field"><label>模型名</label><input id="s_model" value="'+esc(s.aiModel||'')+'" placeholder="gpt-4o-mini"></div>'
      + '<div class="field"><label>树洞昵称（匿名，可选）</label><input id="s_nick" value="'+esc(s.community?STATE.community.nick:'')+'" placeholder="留空即匿名"></div>'
      + '<div class="sheet-actions"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn danger" id="s_reset">清空全部数据</button><button class="btn primary" id="s_save">保存</button></div>'
      + '<div class="ver">着陆 v'+APP_CONFIG.version+' · <a href="'+APP_CONFIG.repo+'" target="_blank">GitHub</a></div>');

    $('s_save').onclick=function(){
      STATE.settings.githubToken=$('s_gh').value.trim();
      STATE.settings.aiBaseUrl=$('s_base').value.trim();
      STATE.settings.aiKey=$('s_key').value.trim();
      STATE.settings.aiModel=$('s_model').value.trim()||'gpt-4o-mini';
      STATE.community.nick=$('s_nick').value.trim();
      save(); closeSheet(); toast('已保存');
    };
    $('s_reset').onclick=function(){
      if(confirm('确定清空全部本地数据？不可恢复。')){
        localStorage.removeItem(APP_CONFIG.storageKey);
        STATE=blankState(); seed(); save(); render(); closeSheet(); toast('已清空');
      }
    };
  }
};

/* ================= 事件委托 ================= */
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-act]');
  if(!el) return;
  var act=el.dataset.act, id=el.dataset.id;

  /* 今日 */
  if(act==='markOne') App.markOne();
  else if(act==='changeOne') App.changeOne();
  else if(act==='newOne') App.newOne();
  else if(act==='quickCheckin') App.quickCheckin(id);

  /* 长周期 */
  else if(act==='newLong') App.newLong();
  else if(act==='editLong') App.editLong(id);
  else if(act==='checkinLong') App.checkinLong(id);
  else if(act==='resumeLong') App.resumeLong(id);
  else if(act==='delLong') App.delLong(id);

  /* 日常 */
  else if(act==='newDaily') App.newDaily();
  else if(act==='editDaily') App.editDaily(id);
  else if(act==='checkinDaily') App.checkinDaily(id);
  else if(act==='toggleDaily') App.toggleDaily(id);
  else if(act==='delDaily') App.delDaily(id);

  /* 日报 */
  else if(act==='goDigest') App.goDigest();
  else if(act==='refreshDigest') App.refreshDigest();

  /* AI */
  else if(act==='sendAI') App.sendAI();
  else if(act==='followup3') App.followup3();

  /* 树洞 */
  else if(act==='loadCommunity') App.loadCommunity();
  else if(act==='postCommunity') App.postCommunity();

  /* 设置 */
  else if(act==='openSettings') App.openSettings();
});

/* ================= 启动 ================= */
function init(){
  load();
  checkAutoPause();

  document.querySelectorAll('.nav-item').forEach(function(b){
    b.addEventListener('click',function(){ CUR_TAB=b.dataset.tab; render(); });
  });

  $('topNew').addEventListener('click',function(){
    if(CUR_TAB==='tasks'){ App.newLong(); }
    else if(CUR_TAB==='today'){ App.newOne(); }
    else{ App.newLong(); }
  });
  $('fabNew').addEventListener('click',function(){
    if(CUR_TAB==='tasks'){ App.newLong(); }
    else{ App.newOne(); }
  });
  $('topSettings').addEventListener('click',function(){ App.openSettings(); });

  window.closeSheet=closeSheet;
  window.App=App;
  render();

  /* 自动拉取日报（如果配了 token 且今天还没拉过） */
  if(STATE.settings.githubToken && (!STATE.digest[today()])){
    fetchDigest(false).then(function(){ /* 静默拉取，不弹提示 */ });
  }
}
init();
})();
