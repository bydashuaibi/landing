/* 着陆 Landing v2 — 把焦虑变成下一步
 * 模块：今日(情绪气象+倾倒台+一件+快捷打卡) / 任务(长周期+日常+每周) / 周报(复盘看板) /
 *       日报(GitHub 热度) / 陪伴(AI) / 伙伴(养成挂件) / 我的(设置+数据管理)
 * 核心机制：先倾倒外化 → 选今天最小一步 → 打卡即算数 → 长周期里程碑鼓励 +
 *          日常循环 + 连续2天未打卡自动暂停 + 每周首次打开自动生成复盘
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
var _digestFilter = '全部';  /* 日报分类筛选（瞬态，不持久化） */

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
    weeklyTasks: [],    // 每周任务：{id,name,type('exercise'|'custom'),category,dailyGoalMin,weeklyGoalDays,enabled,records:[{date,minutes,mode,plannedMin,ts}],createdAt}
    timer: null,        // 计时器：{taskId,plannedMin,startedAt,endsAt,paused,remainMs,finished}
    memories: [],       // 记忆库：{id,at,kind,text,tags}
    pet: {},            // 伙伴（由 pet.js 负责默认值与演化）
    oneThing: null,     // 今天一件：{date,text,done,dumpId?}
    seeded: true,       // 标记：已初始化过（避免老库升级时被重新播种）
    settings: {}        // {aiBaseUrl,aiKey,aiModel,githubToken,nick}
  };
}

function load(){
  try{
    var raw = localStorage.getItem(APP_CONFIG.storageKey);
    if(raw){ STATE = JSON.parse(raw); migrate(); return; }
  }catch(e){}
  STATE = blankState();
  save();
}

/* 老版本首次启动时会往库里塞示例数据（背单词 / 跑步 / 冥想 / 倾倒 / 情绪），
   用户既没创建过也删不掉。这里做一次性清理：只在「整库恰好等于当初那批示例」时抹掉，
   有任何一条被改过、被打过卡、被删过，就认为用户已经在用了，绝不动它。 */
function stripLegacySeed(){
  var s = STATE;
  if(s.seedStripped) return;
  s.seedStripped = true;

  var ltNames = ['背完考研红宝书单词','读完《深度工作》'];
  var dtNames = ['英语背词 30 个','跑步 30 分钟','冥想 10 分钟'];
  var wkNames = ['跑步 / 健身房'];
  var ltUntouched = function(g){ return g.records.length===0 && !g._milestoneHalf && !g._milestoneDone; };
  var dtUntouched = function(d){ return d.records.length===0; };

  if(s.longTasks.length===2 && s.longTasks.every(function(g){ return ltNames.indexOf(g.name)>=0 && ltUntouched(g); })){
    s.longTasks = [];
  }
  if(s.dailyTasks.length===3 && s.dailyTasks.every(function(d){ return dtNames.indexOf(d.name)>=0 && dtUntouched(d); })){
    s.dailyTasks = [];
  }
  if(s.weeklyTasks.length===1 && s.weeklyTasks.every(function(w){ return wkNames.indexOf(w.name)>=0 && w.records.length===0; })){
    s.weeklyTasks = [];
  }
  /* 情绪气象是今天页那个选心情控件写的，但那个控件一直没做出来——
     所以这组记录只可能来自示例。用「完全等于当初那 5 条」做签名匹配：
     用户只要自己在今日页选过心情，日期或备注就会对不上，整体不碰。 */
  var seedWeather = [
    {d:-4, m:'sun',   n:'状态还行'},
    {d:-3, m:'cloud', n:''},
    {d:-2, m:'rain',  n:'有点乱'},
    {d:-1, m:'cloud', n:''},
    {d: 0, m:'rain',  n:''}
  ];
  var weatherMatches = s.weather.length === seedWeather.length
    && seedWeather.every(function(sd, i){
         var w = s.weather[i];
         return w && w.date === addDays(today(), sd.d) && w.mood === sd.m && (w.note || '') === sd.n;
       });
  if(weatherMatches) s.weather = [];
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
  s.weeklyTasks = s.weeklyTasks || [];
  s.memories = s.memories || [];
  s.timer = s.timer || null;
  if(s.timer){
    if(!s.timer.scope) s.timer.scope = 'weekly';   /* 兼容旧版：原来只有每周任务能计时 */
    if(!s.timer.mode) s.timer.mode = 'countdown';
    if(s.timer.mode==='stopwatch' && s.timer.accMs===undefined) s.timer.accMs = 0;
  }
  s.pet = s.pet || {};
  s.settings = s.settings || {};
  if(s.oneThing === undefined) s.oneThing = null;

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
  s.weeklyTasks.forEach(function(w){
    w.records = w.records || [];
    if(w.type===undefined) w.type = 'exercise';
    if(w.enabled===undefined) w.enabled = true;
    if(!w.dailyGoalMin) w.dailyGoalMin = 30;
    if(!w.weeklyGoalDays) w.weeklyGoalDays = 5;
    if(!w.category) w.category = w.type==='exercise' ? 'health' : 'edu';
  });

  stripLegacySeed();
}

/* 示例数据：只在用户主动点「载入示例数据」时用，不再自动播种 */
function seedDemo(){
  var t = today();

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

  STATE.weeklyTasks = [
    {id:uid('wk'), name:'跑步 / 健身房', type:'exercise', category:'health',
     dailyGoalMin:30, weeklyGoalDays:5, enabled:true,
     records:[
       {date:addDays(t,-4), minutes:30, mode:'timer', plannedMin:30, ts:Date.now()},
       {date:addDays(t,-2), minutes:35, mode:'timer', plannedMin:30, ts:Date.now()}
     ], createdAt:addDays(t,-14)}
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

  var dt = today();
  if(!force && STATE.digest[dt] && STATE.digest[dt].fetchedAt){
    return Promise.resolve(STATE.digest[dt]);
  }

  var results = {};
  /* 无 token 也能拉取（GitHub 未认证限速 60 次/小时，日报一天一次够用）；配了 token 限速更高更稳 */
  var headers = {'Accept':'application/vnd.github+json'};
  if(token) headers['Authorization'] = 'Bearer '+token;
  var promises = DIGEST_TOPICS.map(function(tp){
    var q = tp.q+' created:>='+addDays(dt,-3)+' stars:>50 sort:stars';
    var url = 'https://api.github.com/search/repositories?q='+encodeURIComponent(q)+'&per_page=3';
    return fetch(url,{headers:headers})
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
    /* 保存上次快照（用于计算增长） */
    var prevSnapshot = {};
    if(STATE.digest[dt] && STATE.digest[dt].categories){
      Object.keys(STATE.digest[dt].categories).forEach(function(lbl){
        (STATE.digest[dt].categories[lbl]||[]).forEach(function(r){
          prevSnapshot[r.name] = r.stars||0;
        });
      });
    }
    STATE.digest[dt] = {fetchedAt:Date.now(), categories:results, _prev:prevSnapshot};
    save();
    return STATE.digest[dt];
  });
}

function renderDigestView(){
  var dt = today();
  var dg = STATE.digest[dt];
  var h = '<div class="mod-head"><div class="kicker">Module 04 · Digest</div><div class="warp-head" data-warp><h2>日报</h2></div>'
    + '<p>每天首次打开，自动用 GitHub 搜索拉取近几天各品类开源热度项目，帮你跟上技术时代。按领域主题分类。</p></div>';

  /* 工具栏：标题 + 刷新 */
  h += '<div class="digest-toolbar"><div class="digest-toolbar-left"><h2>'+icon('trending')+' 技术日报 · '+dt+'</h2>'
    +'<span class="hint">每天自动拉取近 3 天各领域热门项目</span></div>'
    +'<button class="btn primary sm" data-act="refreshDigest">'+icon('refresh')+' 刷新</button></div>';

  if(!dg || !dg.categories){
    h += '<div class="empty">暂无数据。点「刷新」拉取（无需 Token，自动获取 GitHub 热门开源项目）。</div>';
    return h;
  }

  var catLabels = Object.keys(dg.categories);
  var activeCat = _digestFilter || '全部';

  /* 分类筛选 pill 行 */
  h += '<div class="digest-filters">';
  var allPill = (activeCat==='全部') ? 'dg-pill on' : 'dg-pill';
  h += '<button class="'+allPill+'" data-act="filterDigest" data-cat="全部">全部</button>';
  catLabels.forEach(function(lbl){
    var cls = (activeCat===lbl) ? 'dg-pill on' : 'dg-pill';
    h += '<button class="'+cls+'" data-act="filterDigest" data-cat="'+esc(lbl)+'">'+esc(lbl)+'</button>';
  });
  h += '</div>';

  /* 项目列表（按筛选条件） */
  var catsToShow = (activeCat==='全部') ? catLabels : [activeCat];
  catsToShow.forEach(function(catLabel){
    var repos = dg.categories[catLabel];
    if(!repos || !repos.length) return;

    h += '<div class="digest-section" data-dg-cat="'+esc(catLabel)+'">';
    h += '<div class="digest-section-head"><span class="dsh-title">'+icon('spark')+' '+esc(catLabel)+'</span>'
      + '<span class="dsh-trend">近 3 天热度上升</span></div>';

    repos.forEach(function(r){
      /* 增长计算：如果有上次快照则算差值 */
      var growth = '';
      var growthVal = 0;
      if(dg._prev && dg._prev[r.name]){
        growthVal = (r.stars||0) - dg._prev[r.name];
        if(growthVal > 0) growth = '<span class="dg-growth">⭐ 近3天 +' + fmtNum(growthVal) + '</span>';
        else if(growthVal < 0) growth = '<span class="dg-growth neg">⭐ 近3天 ' + fmtNum(growthVal) + '</span>';
        else growth = '<span class="dg-growth flat">⭐ 近3天 持平</span>';
      }

      h += '<div class="dg-card">'
        + '<div class="dg-card-top"><a class="dg-name" href="'+r.url+'" target="_blank">'+esc(r.name)+'</a>'
        + '<span class="dg-stars">★ '+fmtNum(r.stars||0)+'</span></div>'
        + (r.desc ? '<div class="dg-desc">'+esc(r.desc)+'</div>' : '')
        + '<div class="dg-meta">' + (growth ? growth : '<span class="muted">首次收录</span>')
        + (r.lang ? '<span class="tag do dg-lang">'+esc(r.lang)+'</span>' : '')
        + '</div></div>';
    });
    h += '</div>'; /* end digest-section */
  });

  h += '<div class="card hint" style="font-size:12px;margin-top:16px">数据来源：GitHub Search API · 缓存时间 '+new Date(dg.fetchedAt).toLocaleTimeString()+'</div>';
  return h;
}

/* 格式化数字：52.3k / 980 / 1.2k */
function fmtNum(n){
  if(n>=10000) return (n/10000).toFixed(1)+'w';
  if(n>=1000) return (n/1000).toFixed(1)+'k';
  return String(n);
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
    addMemory('milestone', '「'+g.name+'」全部完成 🎉', ['里程碑']);
  } else if(pct>=50 && !g._milestoneHalf){
    g._milestoneHalf = true;
    msgs.push('💪 「'+g.name+'」进度已到 '+pct+'%！过半了，继续！');
    addMemory('milestone', '「'+g.name+'」进度过半（'+pct+'%）', ['里程碑']);
  }
  return msgs;
}

/* 检查所有活跃长周期是否连续2天未打卡 → 自动暂停 */
function checkAutoPause(){
  var yesterday = addDays(today(),-1);
  var paused = [];
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
        paused.push(g.name);
      }
    }
  });
  return paused;   /* 调用方决定怎么温和地说，startup 时才提示一次 */
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
      ? '<button class="btn teal sm" data-act="startTimer" data-scope="long" data-id="'+g.id+'">'+icon('play')+'计时</button>'
        + (isTodayChecked
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
        + '<button class="btn teal sm" data-act="startTimer" data-scope="daily" data-id="'+dt.id+'">'+icon('play')+'再计时</button>'
      : '<button class="btn primary sm" data-act="checkinDaily" data-id="'+dt.id+'">'+icon('check')+'打卡</button>'
        + '<button class="btn teal sm" data-act="startTimer" data-scope="daily" data-id="'+dt.id+'">'+icon('play')+'计时</button>')
    +'<button class="btn ghost sm" data-act="toggleDaily" data-id="'+dt.id+'">'+(dt.enabled?'关':'开')+'</button>'
    +'<button class="btn ghost sm" data-act="editDaily" data-id="'+dt.id+'">'+icon('edit')+'</button>'
    +'<button class="btn ghost sm" data-act="delDaily" data-id="'+dt.id+'">'+icon('trash')+'</button>'
    +'</div>';
}

/* ================= 每周任务 ================= */
/* 设计：双目标——【每日时长】+【每周达标天数】，能区分「练得久」和「练得勤」。
   运动型打卡有两个入口：「已完成」直接把设定时长计入周报；「现在开始」起倒计时，
   时间到再问「已完成 / 完成部分」，完成部分由你自己填实际做了多久。
   原则延续：不催不罚，记录本身就算数。 */
var WEEKLY_TYPES = [
  {key:'exercise', label:'运动型', cat:'health', timed:true,
   hint:'设每日运动时长，打卡可立即完成，也可起倒计时跟着做'},
  {key:'custom',   label:'自定义型', cat:'edu',    timed:false,
   hint:'设每日目标与每周天数，打卡即完成，不记时长'}
];
function weeklyTypeOf(key){
  return WEEKLY_TYPES.find(function(x){return x.key===key;}) || WEEKLY_TYPES[0];
}

function weeklyTodayMinutes(w){
  var m=0;
  (w.records||[]).forEach(function(r){ if(r.date===today()) m+=(r.minutes||0); });
  return m;
}
function isWeeklyCheckedToday(w){ return weeklyTodayMinutes(w)>0; }

/* 某一自然周（周一为界）的统计 */
function weeklyTaskStats(w, wk){
  wk = wk || weekKey();
  var end = addDays(wk,7);
  var byDate={}, total=0;
  (w.records||[]).forEach(function(r){
    if(r.date<wk || r.date>=end) return;
    byDate[r.date]=(byDate[r.date]||0)+(r.minutes||0);
    total += (r.minutes||0);
  });
  var goal = w.dailyGoalMin||0;
  var actDays=0, okDays=0;
  for(var i=0;i<7;i++){
    var m = byDate[addDays(wk,i)]||0;
    if(m>0){
      actDays++;
      if(goal<=0 || m>=goal) okDays++;   /* 部分完成也算「动了」，但不算达标 */
    }
  }
  return {byDate:byDate, total:total, actDays:actDays, okDays:okDays,
          goalDays:w.weeklyGoalDays||7, dailyGoal:goal};
}

/* 所有启用的每周任务合计（喂给周报） */
function weeklyTasksSummary(wk){
  var r = {goalMin:0, doneMin:0, goalDays:0, okDays:0, totalMin:0, byCat:{}};
  STATE.weeklyTasks.forEach(function(w){
    if(!w.enabled) return;
    var st = weeklyTaskStats(w, wk);
    r.goalMin += (w.dailyGoalMin||0)*(w.weeklyGoalDays||7);
    r.doneMin += st.total;
    r.totalMin += st.total;
    r.goalDays += (w.weeklyGoalDays||7);
    r.okDays += st.okDays;
    var c = w.category||'health';
    r.byCat[c] = (r.byCat[c]||0) + st.total;
  });
  return r;
}

/* 本周 7 天格子 */
function weeklyDots(w){
  var wk = weekKey();
  var st = weeklyTaskStats(w);
  var goal = w.dailyGoalMin||0;
  var now = today();
  var html = '<div class="wk-dots">';
  for(var i=0;i<7;i++){
    var d = addDays(wk,i);
    var m = st.byDate[d]||0;
    var cls = 'wk-dot';
    if(d>now) cls += ' future';
    else if(goal<=0 ? m>0 : m>=goal) cls += ' ok';
    else if(m>0) cls += ' part';
    var ways = m>0 ? dayModeLabels(w, d) : [];
    html += '<i class="'+cls+'" title="'+d+' · '+m+' 分钟'+(ways.length?' · '+ways.join('/'):'')+'"></i>';
  }
  return html+'</div>';
}

/* 计时方式标签：正计时 / 倒计时 等 */
var MODE_LABEL = {instant:'直接完成', timer:'倒计时', partial:'完成部分', extra:'追加', tap:'打卡', stopwatch:'正计时'};
function modeLabel(m){ return MODE_LABEL[m]||'记录'; }

/* 某天用过哪些计时方式（周报格子的 title 用） */
function dayModeLabels(w, d){
  var s = [];
  (w.records||[]).forEach(function(r){
    if(r.date!==d) return;
    var l = modeLabel(r.mode);
    if(s.indexOf(l)<0) s.push(l);
  });
  return s;
}

/* 本周各任务的计时方式分解（周报用来标出正计时/倒计时） */
function weeklyModeStat(w, wk){
  wk = wk || weekKey();
  var end = addDays(wk,7);
  var g = {sw:{n:0,min:0}, cd:{n:0,min:0}, dc:{n:0,min:0}};
  (w.records||[]).forEach(function(r){
    if(r.date<wk || r.date>=end) return;
    var k = r.mode==='stopwatch' ? 'sw' : (r.mode==='timer'||r.mode==='partial') ? 'cd' : 'dc';
    g[k].n++; g[k].min += (r.minutes||0);
  });
  return g;
}

/* 周报里那一排「正计时/倒计时/直接打卡」小标签 */
function weeklyModeChips(w, wk){
  var g = weeklyModeStat(w, wk);
  if(!g.sw.n && !g.cd.n && !g.dc.n) return '';
  var h = '<div class="wk-modes">';
  if(g.sw.n) h += '<span class="mt sw">'+icon('play')+' 正计时 '+g.sw.n+' 次 · '+g.sw.min+' 分钟</span>';
  if(g.cd.n) h += '<span class="mt cd">⏱ 倒计时 '+g.cd.n+' 次 · '+g.cd.min+' 分钟</span>';
  if(g.dc.n) h += '<span class="mt dc">'+icon('check')+' 直接打卡 '+g.dc.n+' 次 · '+g.dc.min+' 分钟</span>';
  return h+'</div>';
}

function renderWeeklyTaskCard(w){
  var st = weeklyTaskStats(w);
  var tmin = weeklyTodayMinutes(w);
  var goal = w.dailyGoalMin||0;
  var tp = weeklyTypeOf(w.type);
  var dayPct = goal>0 ? Math.min(100, Math.round(tmin/goal*100)) : (tmin>0?100:0);
  var checked = tmin>0;
  var catCls = (CATEGORIES.find(function(c){return c.key===w.category;})||{}).cls || 'health';

  return '<div class="task wtask'+(w.enabled?'':' paused')+'" data-id="'+w.id+'">'
    +'<div class="tinfo">'
    +'<div class="tname">'+esc(w.name)
      +' <span class="cat '+catCls+'">'+tp.label+'</span>'
      +(w.enabled?'':'<span class="badge-pause">已关</span>')+'</div>'
    +'<div class="tmeta">每日 '+(goal||'—')+' 分钟 · 本周达标 <b>'+st.okDays+'/'+st.goalDays+'</b> 天 · 累计 '+st.total+' 分钟</div>'
    +weeklyDots(w)
    +'<div class="bar"><div style="width:'+dayPct+'%"></div></div>'
    +'</div>'
    +(checked
      ? '<span class="badge-done">✓ 今天 '+tmin+' 分钟</span>'
      : '<button class="btn primary sm" data-act="checkinWeekly" data-id="'+w.id+'">'+icon('check')+'打卡</button>')
    +'<button class="btn teal sm" data-act="startTimer" data-scope="weekly" data-id="'+w.id+'">'+icon('play')+'计时</button>'
    +'<button class="btn ghost sm" data-act="toggleWeekly" data-id="'+w.id+'">'+(w.enabled?'关':'开')+'</button>'
    +'<button class="btn ghost sm" data-act="editWeekly" data-id="'+w.id+'">'+icon('edit')+'</button>'
    +'<button class="btn ghost sm" data-act="delWeekly" data-id="'+w.id+'">'+icon('trash')+'</button>'
    +'</div>';
}

/* ---- 打卡：已完成 / 现在开始 ---- */
function openWeeklyCheckin(id){
  var w = STATE.weeklyTasks.find(function(x){return x.id===id;}); if(!w) return;
  var st = weeklyTaskStats(w);
  var tp = weeklyTypeOf(w.type);
  var tmin = weeklyTodayMinutes(w);

  if(!tp.timed){
    /* 自定义型：不记时长，直接确认 */
    openSheet('<h2>打卡：'+esc(w.name)+'</h2>'
      +'<div class="hint">'+tp.label+' · 本周达标 '+st.okDays+'/'+st.goalDays+' 天</div>'
      +'<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button>'
      +'<button class="btn primary" id="wc_ok">已完成</button></div>');
    $('wc_ok').onclick=function(){ commitWeeklyRecord(w, 0, 'tap', 0); };
    return;
  }

  if(tmin>0){
    /* 今天已经打过卡，仍允许追加一段 */
    openSheet('<h2>再来一段？</h2>'
      +'<div class="hint">「'+esc(w.name)+'」今天已记录 '+tmin+' 分钟（每日目标 '+w.dailyGoalMin+' 分钟）</div>'
      +'<div class="field"><label>本次时长（分钟）</label><input id="wc_min" type="number" value="'+w.dailyGoalMin+'" min="1"></div>'
      +'<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button>'
      +'<button class="btn teal" id="wc_sw2">'+icon('play')+'计时</button>'
      +'<button class="btn primary" id="wc_add">记下</button></div>');
    $('wc_add').onclick=function(){
      var m=parseInt($('wc_min').value,10)||w.dailyGoalMin;
      commitWeeklyRecord(w, m, 'extra', m);
    };
    $('wc_sw2').onclick=function(){
      closeSheet();
      startStopwatch('weekly', w.id);
    };
    return;
  }

  openSheet('<h2>打卡：'+esc(w.name)+'</h2>'
    +'<div class="hint">今日目标 <b>'+w.dailyGoalMin+' 分钟</b> · 本周达标 '+st.okDays+'/'+st.goalDays+' 天</div>'
    +'<div class="wk-pick">'
      +'<button class="wk-choice" id="wc_done"><b>已完成</b><span>按设定时长直接计入周报</span></button>'
      +'<button class="wk-choice" id="wc_start"><b>现在开始</b><span>按设定时长起倒计时</span></button>'
      +'<button class="wk-choice" id="wc_sw"><b>计时</b><span>正计时，做多久算多久</span></button>'
    +'</div>'
    +'<div class="field" style="margin-top:14px"><label>本次时长（分钟）</label>'
      +'<input id="wc_min" type="number" value="'+w.dailyGoalMin+'" min="1"></div>');

  $('wc_done').onclick=function(){
    var m=parseInt($('wc_min').value,10)||w.dailyGoalMin;
    commitWeeklyRecord(w, m, 'instant', m);
  };
  $('wc_start').onclick=function(){
    var m=parseInt($('wc_min').value,10)||w.dailyGoalMin;
    closeSheet();
    startWeeklyTimer(w, m);
  };
  $('wc_sw').onclick=function(){
    closeSheet();
    startStopwatch('weekly', w.id);
  };
}

/* 写入一条每周任务记录 */
function commitWeeklyRecord(w, minutes, mode, plannedMin){
  minutes = Math.max(0, minutes||0);
  w.records = w.records||[];
  w.records.push({date:today(), minutes:minutes, mode:mode||'instant', plannedMin:plannedMin||minutes, ts:Date.now()});
  if(STATE.timer && STATE.timer.taskId===w.id) STATE.timer=null;
  var f = minutes>0 ? awardFish(minutes, w.name) : 0;
  addMemory('task', '「'+w.name+'」'+minutes+' 分钟（'+(mode==='timer'?'计时完成':modeLabel(mode||'instant'))+'）', ['每周任务']);
  var st = weeklyTaskStats(w);
  save(); closeSheet(); render(); renderTimerBar();
  toast('已记录 '+minutes+' 分钟 · 本周达标 '+st.okDays+'/'+st.goalDays+' 天'+(f?' · +'+f+' 🐟':''));
}

/* ================= 专注计时器 ================= */
var _timerTick = null;
function timerRemainMs(){
  var t=STATE.timer; if(!t) return 0;
  if(t.finished) return 0;
  if(t.paused) return Math.max(0, t.remainMs||0);
  return Math.max(0, t.endsAt - Date.now());
}
function timerScope(){ var t=STATE.timer; return t ? (t.scope||'weekly') : 'weekly'; }
function timerIsStopwatch(){ return !!(STATE.timer && STATE.timer.mode==='stopwatch'); }
function timerElapsedMs(){
  var t=STATE.timer; if(!t) return 0;
  if(t.mode==='stopwatch'){
    var base = t.accMs||0;
    return t.paused ? base : base + Math.max(0, Date.now()-(t.startedAt||Date.now()));
  }
  return Math.max(0, (t.plannedMin*60000) - timerRemainMs());
}
function timerTask(){
  if(!STATE.timer) return null;
  var sc = timerScope();
  var list = sc==='daily' ? STATE.dailyTasks : (sc==='long' ? STATE.longTasks : STATE.weeklyTasks);
  return list.find(function(x){ return x.id===STATE.timer.taskId; }) || null;
}
function fmtClock(ms){
  var s=Math.max(0,Math.round(ms/1000));
  var m=Math.floor(s/60); s=s%60;
  return ('0'+m).slice(-2)+':'+('0'+s).slice(-2);
}
/* 正计时用的时钟（超过一小时显示 1:23:45） */
function fmtClockLong(ms){
  var s=Math.max(0,Math.round(ms/1000));
  var h=Math.floor(s/3600), m=Math.floor(s%3600/60); s=s%60;
  return (h>0 ? (h+':'+('0'+m).slice(-2)) : ('0'+m).slice(-2))+':'+('0'+s).slice(-2);
}
function timerBarEl(){
  var el = $('timerBar');
  if(!el){
    el = document.createElement('div');
    el.id='timerBar'; el.className='timerbar hidden';
    document.body.appendChild(el);
  }
  return el;
}
/* 后台常驻状态：把「现在在计什么」写到托盘悬停提示，
   并告诉主进程「计时中，别把我降频」（窗口藏起来后 Chromium 会把定时器降频，倒计时会晚点响）。
   只有桌面版有这个桥；网页版直接跳过。 */
var _trayHint = null, _trayActive = false;
function pushBackgroundState(){
  var t = STATE.timer, active = !!(t && !t.finished);
  if(active !== _trayActive){
    _trayActive = active;
    if(window.landing && window.landing.timerActive) window.landing.timerActive(active);
  }
  var hint = '在后台待着';
  if(active){
    var w = timerTask();
    var nm = w ? w.name : (t.name||'专注');
    if(t.mode==='stopwatch') hint = (t.paused?'已暂停 · ':'')+nm+' · 已 '+fmtClockLong(timerElapsedMs());
    else hint = (t.paused?'已暂停 · ':'')+nm+' · 剩 '+fmtClock(timerRemainMs());
  }
  if(hint !== _trayHint){
    _trayHint = hint;
    if(window.landing && window.landing.tray) window.landing.tray.setHint(hint);
  }
}

function renderTimerBar(){
  var el = timerBarEl(), t = STATE.timer;
  pushBackgroundState();
  if(!t || t.finished){ el.classList.add('hidden'); el.innerHTML=''; return; }
  var w = timerTask();
  var nm = esc(w ? w.name : (t.name||'专注'));
  el.classList.remove('hidden');
  if(t.mode==='stopwatch'){
    var used = timerElapsedMs();
    el.innerHTML = '<span class="tb-ico">▶</span>'
      +'<span class="tb-time">'+fmtClockLong(used)+'</span>'
      +'<span class="tb-name">'+nm+' · 已 '+Math.floor(used/60000)+' 分钟</span>'
      +'<button class="tb-btn" data-act="timerToggle">'+(t.paused?'继续':'暂停')+'</button>'
      +'<button class="tb-btn" data-act="timerFinish">结束</button>';
    return;
  }
  el.innerHTML = '<span class="tb-ico">⏱</span>'
    +'<span class="tb-time">'+fmtClock(timerRemainMs())+'</span>'
    +'<span class="tb-name">'+nm+' · '+t.plannedMin+' 分钟</span>'
    +'<button class="tb-btn" data-act="timerToggle">'+(t.paused?'继续':'暂停')+'</button>'
    +'<button class="tb-btn" data-act="timerFinish">结束</button>';
}
function ensureTimerTick(){
  if(_timerTick){ clearInterval(_timerTick); _timerTick=null; }
  if(!STATE.timer || STATE.timer.finished) return;
  _timerTick = setInterval(function(){
    var t = STATE.timer;
    if(!t){ clearInterval(_timerTick); _timerTick=null; return; }
    if(t.mode==='stopwatch'){
      var el2 = timerElapsedMs();
      /* 忘记停的保护：单次超过 4 小时先封顶暂停，不悄悄记一整天 */
      if(el2 >= SW_MAX_MS){
        t.accMs = SW_MAX_MS; t.paused = true; save(); renderTimerBar();
        notify('⏱ 计时太久啦', '已按 4 小时封顶并暂停，记得结束一下');
        toast('计时超过 4 小时，已封顶暂停');
        return;
      }
      /* 每 60 分钟温和提醒一次，只报时、不评判 */
      if(!t.paused && el2-(t.nagMs||0) >= SW_NAG_MS){
        t.nagMs = el2; save();
        var nm2 = timerTask();
        notify('⏱ 计时还在跑', (nm2?nm2.name:'专注')+' 已 '+fmtClockLong(el2)+'，还顺利吗？');
        if(window.Pet && Pet.say) Pet.say('已经 '+Math.floor(el2/60000)+' 分钟了，喝口水也行。');
      }
      renderTimerBar();
      return;
    }
    if(!t.paused && !t.finished && timerRemainMs()<=0){
      onTimerEnd();
      return;
    }
    renderTimerBar();
  }, 500);
}
function startWeeklyTimer(w, plannedMin){
  STATE.timer = {
    scope:'weekly', mode:'countdown', name:w.name,
    taskId:w.id, plannedMin:plannedMin, startedAt:Date.now(),
    endsAt: Date.now()+plannedMin*60000, paused:false, remainMs:null, finished:false
  };
  save(); renderTimerBar(); ensureTimerTick();
  var tip = '倒计时 '+plannedMin+' 分钟开始了，去动起来。';
  toast(tip);
  if(window.Pet && Pet.say) Pet.say('我帮你盯着时间，' + plannedMin + ' 分钟后叫你。');
  addMemory('timer', '开始专注：「'+w.name+'」计划 '+plannedMin+' 分钟', ['计时']);
}
function toggleTimer(){
  var t=STATE.timer; if(!t||t.finished) return;
  if(t.mode==='stopwatch'){
    if(t.paused){ t.startedAt = Date.now(); t.paused=false; }
    else { t.accMs = timerElapsedMs(); t.paused=true; }
  }
  else if(t.paused){ t.endsAt = Date.now() + (t.remainMs||0); t.paused=false; }
  else { t.remainMs = timerRemainMs(); t.paused=true; }
  save(); renderTimerBar(); ensureTimerTick();
}
/* 时间到 */
function onTimerEnd(){
  var t=STATE.timer; if(!t) return;
  t.finished = true;
  if(_timerTick){ clearInterval(_timerTick); _timerTick=null; }
  save();
  alarmSound();
  notify('⏰ 时间到', (timerTask()?timerTask().name:'专注')+' '+t.plannedMin+' 分钟完成，来记录一下');
  if(window.Pet && Pet.say) Pet.say('时间到啦！你做了 ' + t.plannedMin + ' 分钟，去记一笔吧。');
  renderTimerBar();
  openTimerFinishSheet(false);
}
/* 结束（未到期）*/
function finishTimerEarly(){
  var t=STATE.timer; if(!t) return;
  if(t.finished){ openTimerFinishSheet(false); return; }
  openTimerFinishSheet(true);
}
/* 收尾弹窗：已完成 / 完成部分 */
function openTimerFinishSheet(early){
  var t=STATE.timer; if(!t) return;
  var w = timerTask();
  var name = w?w.name:'专注';
  var passed = Math.max(1, Math.round(timerElapsedMs()/60000));
  openSheet('<h2>'+(early?'结束本次专注？':'⏰ 时间到！')+'</h2>'
    +'<div class="hint">'+esc(name)+' · 计划 '+t.plannedMin+' 分钟'+(early?(' · 已进行 '+passed+' 分钟'):'')+'</div>'
    +'<div class="ph-actions">'
      +'<button class="btn primary block" id="tf_done" style="margin-bottom:8px">'+icon('check')+' 已完成（记 '+t.plannedMin+' 分钟）</button>'
      +'<button class="btn ghost block" id="tf_part">完成部分 · 我自己填时长</button>'
      +(early?'<button class="btn ghost block" id="tf_giveup" style="margin-top:8px">放弃这次，不记录</button>':'')
    +'</div>');

  $('tf_done').onclick=function(){
    if(w) commitWeeklyRecord(w, t.plannedMin, 'timer', t.plannedMin);
    else { STATE.timer=null; save(); closeSheet(); render(); renderTimerBar(); }
  };
  $('tf_part').onclick=function(){
    var def = Math.max(1, Math.round(timerElapsedMs()/60000));
    openSheet('<h2>完成部分</h2>'
      +'<div class="hint">'+esc(name)+' · 计划 '+t.plannedMin+' 分钟。这段实际做了多久？记多少算多少，不丢人。</div>'
      +'<div class="field"><label>实际时长（分钟）</label><input id="tf_min" type="number" value="'+def+'" min="1"></div>'
      +'<div class="sheet-actions"><button class="btn ghost" id="tf_back">返回</button>'
      +'<button class="btn primary" id="tf_save">记下</button></div>');
    $('tf_back').onclick=function(){ openTimerFinishSheet(early); };
    $('tf_save').onclick=function(){
      var m=parseInt($('tf_min').value,10);
      if(!m||m<=0){ toast('填个分钟数'); return; }
      if(w) commitWeeklyRecord(w, m, 'partial', t.plannedMin);
      else { STATE.timer=null; save(); closeSheet(); render(); }
    };
  };
  if(early && $('tf_giveup')){
    $('tf_giveup').onclick=function(){
      STATE.timer=null; save(); closeSheet(); renderTimerBar();
      toast('已放弃这次，没有记录也没关系');
      if(window.Pet && Pet.say) Pet.say('没关系，下次想动的时候我在。');
    };
  }
}

/* ================= 正计时：点一下开始，做多久算多久 =================
   和倒计时相反：不设目标、不到点响铃、不出现「未达标」字样。
   结束时按实际时长落账，时长本身就是打卡；日常任务同一天多次计时会累加进同一条记录，
   所以一天仍然只算一次打卡，但时长是累计的。
   防呆三件套：<1 分钟默认丢掉；单次超过 4 小时自动封顶暂停；每 60 分钟提醒一次还在跑。 */
var SW_MIN_MS = 60000;
var SW_MAX_MS = 4*3600*1000;
var SW_NAG_MS = 60*60*1000;

function scopeList(scope){
  if(scope==='daily') return STATE.dailyTasks;
  if(scope==='long')  return STATE.longTasks;
  return STATE.weeklyTasks;
}
function scopeName(scope){
  if(scope==='daily') return '日常任务';
  if(scope==='long')  return '长周期任务';
  return '每周任务';
}

function startStopwatch(scope, id){
  var task = (scopeList(scope)||[]).find(function(x){ return x.id===id; });
  if(!task){ toast('找不到这个任务'); return; }

  /* 同一时刻只跑一个计时：先问一声，不粗暴丢掉 */
  if(STATE.timer && !STATE.timer.finished){
    var busy = timerTask();
    openSheet('<h2>先结束正在计时的那个？</h2>'
      +'<div class="hint">「'+esc(busy?busy.name:(STATE.timer.name||'另一个任务'))+'」已经计时 '
      +fmtClockLong(timerElapsedMs())+'，先把它记下来再开始新的。</div>'
      +'<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button>'
      +'<button class="btn primary" id="sw_switch">结束并开始</button></div>');
    $('sw_switch').onclick=function(){
      var used = timerElapsedMs();
      if(used>=SW_MIN_MS) commitStopwatchRecord(Math.round(used/60000));
      else { STATE.timer=null; if(_timerTick){clearInterval(_timerTick);_timerTick=null;} save(); renderTimerBar(); }
      closeSheet();
      startStopwatch(scope, id);
    };
    return;
  }

  STATE.timer = { scope:scope, mode:'stopwatch', name:task.name, taskId:id,
    plannedMin:0, startedAt:Date.now(), accMs:0, paused:false, remainMs:0,
    finished:false, nagMs:0 };
  save(); renderTimerBar(); ensureTimerTick();
  render();   /* 让卡片/芯片立刻反映「计时中」 */
  toast('开始计时：'+task.name+'。做多久算多久，不用看表。关掉窗口也没事，会在右下角托盘继续走。');
  if(window.Pet && Pet.say) Pet.say('我帮你记着时间，你专心做就行。');
  addMemory('timer', '开始计时：「'+task.name+'」（'+scopeName(scope)+'）', ['计时']);
}

/* 把当前正计时落账：写进对应任务的记录里 */
function commitStopwatchRecord(minutes, meta){
  var t = STATE.timer; if(!t) return 0;
  var scope = t.scope||'weekly', id = t.taskId;
  var task = timerTask();
  minutes = Math.max(0, Math.round(minutes||0));
  meta = meta||{};

  /* 任务被删掉了 → 只收走计时，不落账 */
  if(!task){
    STATE.timer = null;
    if(_timerTick){ clearInterval(_timerTick); _timerTick=null; }
    save(); closeSheet(); render(); renderTimerBar();
    toast('这个任务已经不在了，这次没记');
    return 0;
  }

  var name = task.name;
  var fish = minutes>0 ? awardFish(minutes, name) : 0;

  if(scope==='daily'){
    var rec = task.records.find(function(r){ return r.date===today(); });
    if(rec){ rec.minutes = (rec.minutes||0)+minutes; rec.ts = Date.now(); }  /* 同一天累加，仍算一次打卡 */
    else { task.records.push({date:today(), amount:1, minutes:minutes, ts:Date.now()}); }
  }
  else if(scope==='long'){
    var amt = parseInt(meta.amount,10)||0;
    task.records.push({date:today(), amount:amt, minutes:minutes, ts:Date.now()});
    if(amt>0) task.current = (task.current||0)+amt;
    if(task.current>=task.total) task.status = 'done';
  }
  else{
    task.records = task.records||[];
    task.records.push({date:today(), minutes:minutes, mode:'stopwatch', plannedMin:0, ts:Date.now()});
  }

  addMemory('task', '「'+name+'」计时 '+minutes+' 分钟（正计时 · '+scopeName(scope)+'）', ['计时']);
  STATE.timer = null;
  if(_timerTick){ clearInterval(_timerTick); _timerTick=null; }
  save(); closeSheet(); render(); renderTimerBar();
  toast('记下 '+minutes+' 分钟'+(fish?(' · +'+fish+' 🐟'):'')+(scope==='daily'?'，今天已打卡 ✓':''));

  if(scope==='long' && (parseInt(meta.amount,10)||0)>0){
    var ms = checkLongMilestones(task);
    if(ms.length) setTimeout(function(){ toast(ms[0]); }, 400);
  }
  return minutes;
}

/* 结束正计时：默认按计时时长，也允许改成实际值 */
function openStopwatchFinishSheet(){
  if(!timerIsStopwatch()) return;
  var t = STATE.timer, task = timerTask();
  var name = task ? task.name : (t.name||'专注');
  var ms = timerElapsedMs();
  var mins = Math.max(1, Math.round(ms/60000));

  if(ms < SW_MIN_MS){
    openSheet('<h2>这段太短啦</h2>'
      +'<div class="hint">「'+esc(name)+'」只计了 '+Math.round(ms/1000)+' 秒（不到 1 分钟），默认不算打卡。</div>'
      +'<div class="sheet-actions"><button class="btn ghost" id="sw_min1">还是记 1 分钟</button>'
      +'<button class="btn primary" id="sw_drop0">丢掉这段</button></div>');
    $('sw_min1').onclick=function(){ commitStopwatchRecord(1); };
    $('sw_drop0').onclick=function(){ dropStopwatch(); };
    return;
  }

  var longField = (t.scope==='long')
    ? '<div class="field"><label>这次完成了多少（'+esc(task.unit||'个')+'，可以不填）</label>'
      +'<input id="sw_amt" type="number" value="" placeholder="只记时间就不填"></div>'
    : '';

  openSheet('<h2>结束计时</h2>'
    +'<div class="hint">「'+esc(name)+'」计时 <b>'+fmtClockLong(ms)+'</b>。做多久算多久，不用凑整。</div>'
    +'<div class="field"><label>实际时长（分钟）</label><input id="sw_min" type="number" value="'+mins+'" min="0"></div>'
    +longField
    +'<div class="ph-actions">'
    +'<button class="btn primary block" id="sw_ok" style="margin-bottom:8px">'+icon('check')+' 记下并打卡</button>'
    +'<button class="btn ghost block" id="sw_drop">这次不算，丢掉</button>'
    +'</div>');

  $('sw_ok').onclick=function(){
    var m = parseInt($('sw_min').value,10);
    if(isNaN(m)||m<0) m = mins;
    var amt = (t.scope==='long' && $('sw_amt')) ? (parseInt($('sw_amt').value,10)||0) : 0;
    commitStopwatchRecord(m, {amount:amt});
  };
  $('sw_drop').onclick=function(){ dropStopwatch(); };
}

function dropStopwatch(){
  STATE.timer = null;
  if(_timerTick){ clearInterval(_timerTick); _timerTick=null; }
  save(); closeSheet(); render(); renderTimerBar();
  toast('丢掉了，没记录也没关系');
  if(window.Pet && Pet.say) Pet.say('不算数就不算数，你动过就已经不一样了。');
}

/* 卡片/芯片上的「▶ 计时」：不用切页也能开正计时
   没在跑 → ▶ 开始；正在跑同一个任务 → 点击即结束并落账 */
function timerMatchesTask(scope, id){
  return !!(STATE.timer && !STATE.timer.finished && STATE.timer.scope===scope && STATE.timer.taskId===id);
}
function qciTimerBtn(scope, id){
  var running = timerMatchesTask(scope, id);
  return '<button class="qci-timer'+(running?' on':'')+'"'
    + ' data-act="'+(running?'timerFinish':'startTimer')+'"'
    + ' data-scope="'+scope+'" data-id="'+id+'"'
    + ' title="'+(running?'正在计时 · 点这里结束并记下':'开始正计时，做多久算多久')+'">'
    + (running ? '计时中 ⏹' : icon('play'))
    + '</button>';
}

/* 到期提醒音（WebAudio，无音频文件依赖） */
function alarmSound(){
  try{
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    var ac = new AC();
    var now = ac.currentTime;
    for(var i=0;i<3;i++){
      var o=ac.createOscillator(), g=ac.createGain();
      o.type='sine'; o.frequency.value = i===2?1180:880;
      var t0 = now + i*0.28;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16, t0+0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t0+0.24);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0+0.26);
    }
    setTimeout(function(){ try{ ac.close(); }catch(e){} }, 1400);
  }catch(e){}
}
function notify(title, body){
  try{
    if(!window.Notification) return;
    if(Notification.permission==='granted'){ new Notification(title,{body:body}); }
    else if(Notification.permission!=='denied'){ Notification.requestPermission(); }
  }catch(e){}
}

/* ================= 小鱼干 & 记忆库 ================= */
/* 规则：单次完成 ≥60 分钟的任务 → 1~3 条（60-119:1 / 120-179:2 / ≥180:3） */
function fishForMinutes(m){
  if(!m || m<60) return 0;
  return Math.min(3, 1+Math.floor((m-60)/60));
}
function petState(){
  if(!STATE.pet) STATE.pet = {};
  if(STATE.pet.fish===undefined) STATE.pet.fish=0;
  return STATE.pet;
}
function grantFish(n, reason){
  n = Math.max(0, n|0);
  if(!n) return 0;
  var p = petState();
  p.fish += n;
  p.earned = (p.earned||0)+n;
  p.fishLog = p.fishLog||[];
  p.fishLog.push({at:Date.now(), n:n, reason:reason});
  if(p.fishLog.length>400) p.fishLog.splice(0, p.fishLog.length-400);
  addMemory('fish', '+'+n+' 条小鱼干 · '+reason, ['小鱼干']);
  if(window.Pet && Pet.onFish) Pet.onFish(n, reason);
  return n;
}
function awardFish(minutes, reason){
  return grantFish(fishForMinutes(minutes), reason+'（'+(minutes||0)+' 分钟）');
}
function addMemory(kind, text, tags){
  STATE.memories = STATE.memories||[];
  STATE.memories.push({id:uid('m'), at:Date.now(), kind:kind||'note', text:text, tags:tags||[]});
  if(STATE.memories.length>1000) STATE.memories.splice(0, STATE.memories.length-1000);
}
var MEM_KIND = {chat:'对话', feed:'投喂', pet:'抚摸', task:'任务', timer:'专注', fish:'小鱼干', milestone:'里程碑', note:'随手记', daily:'每日'};

/* ================= 赛博伙伴：活力全部来自你已经做的事 ================= */
/* 设计原则：不新增「喂猫」任务。你倾倒、打卡、完成一件，它自然长。
   你没来，它不惩罚，只是「有点想你」。底线 12 分，永远不会归零或枯萎。 */
function catLandingDays(){
  var days = {};
  STATE.dumps.forEach(function(d){
    if(d.createdAt) days[ymd(new Date(d.createdAt))] = 1;
  });
  STATE.dailyTasks.forEach(function(t){
    (t.records||[]).forEach(function(r){ if(r.date) days[r.date] = 1; });
  });
  STATE.weather.forEach(function(w){ if(w.date) days[w.date] = 1; });
  var n = 0, cur = today();
  while(days[cur]){ n++; cur = addDays(cur,-1); }
  return n;
}

function catVitality(){
  var v = 12;                                    /* 底线：它一直在 */
  var ts0 = new Date(); ts0.setHours(0,0,0,0);
  var dumped = STATE.dumps.filter(function(d){ return d.createdAt >= ts0.getTime(); }).length;
  v += Math.min(dumped*12, 24);                  /* 倾倒焦虑 */
  var checked = STATE.dailyTasks.filter(function(d){ return d.enabled && isDailyCheckedToday(d); }).length;
  v += Math.min(checked*11, 33);                 /* 日常打卡 */
  if(STATE.oneThing && STATE.oneThing.date===today() && STATE.oneThing.done) v += 20;
  v += Math.min(catLandingDays()*4, 20);         /* 连续着陆 */
  var w = STATE.weather.filter(function(x){ return x.date===today(); }).pop();
  if(w) v += ({sun:6,cloud:0,rain:-5,storm:-10})[w.mood] || 0;   /* 情绪同步 */
  return Math.max(0, Math.min(100, Math.round(v)));
}

var CAT_LINES = {
  low:  ['我在呢。','不想动也没关系。','你来了就好。','先歇会儿，我不催。'],
  mid:  ['今天的下一步是什么？','我在这儿等你。','慢慢来，一件就够。','倒出来会好受点。'],
  high: ['你今天真不错。','能量满了。','要走下一步吗？','我看好你。']
};
function catTierText(t){ return t==='low' ? '有点想你' : (t==='high' ? '精神十足' : '状态平稳'); }
function catSpeak(t){
  var arr = CAT_LINES[t] || CAT_LINES.mid;
  return arr[Math.floor(Math.random()*arr.length)];
}

/* ================= 倾倒台 & 情绪气象 ================= */
/* 倾倒台是「着陆」的第一步：把在脑子里空转的焦虑外化成字，才看得清下一步。
   它同时是伙伴活力的主要来源（catVitality 里今日倾倒 1 次 +12，上限 +24）。 */
var DUMP_KINDS = [
  {key:'do',   label:'要做的',   emoji:'🎯'},
  {key:'drop', label:'可以放掉', emoji:'🍃'},
  {key:'feel', label:'只是感受', emoji:'💭'}
];
function dumpKindOf(k){ return DUMP_KINDS.find(function(x){return x.key===k;}) || null; }

/* 今日已倾倒条数（供 UI 显示与测试） */
function todayDumpCount(){
  var ts0=new Date(); ts0.setHours(0,0,0,0);
  return STATE.dumps.filter(function(d){ return (d.createdAt||0)>=ts0.getTime(); }).length;
}

function renderDumpCard(){
  var list = STATE.dumps.slice().sort(function(a,b){ return (b.createdAt||0)-(a.createdAt||0); });
  var todayN = todayDumpCount();

  var h = '<div class="card dump-card" id="dumpCard">'
    + '<div class="row between"><h2>'+icon('leaf')+' 倾倒台</h2>'
    + '<span class="dump-count">'+(todayN ? ('今天倒出 '+todayN+' 条 · 小鱼干已到账') : '今天还没倒过')+'</span></div>'
    + '<div class="hint">脑子里同时在转的事，先写下来。不用分类、不用有条理——写出来它就不在脑子里空转了。'
    + '倒出来算数：每倒 1 次，小陆的活力 +12（每天最多算 2 次）。</div>'
    + '<textarea id="dumpInput" class="dump-input" placeholder="现在最占脑子的那件事是…"></textarea>'
    + '<div class="dump-tools">'
    + '<button class="btn primary sm" data-act="dumpAdd">'+icon('plus')+' 倒出来</button>'
    + '<span class="dump-tip">写完再决定它是「要做的」「可以放掉」还是「只是感受」</span>'
    + '</div>';

  if(!list.length){
    h += '<div class="empty">倾倒台是空的。上面写点什么，哪怕只有一句。</div>';
  } else {
    h += '<div class="dump-list">';
    list.slice(0,20).forEach(function(d){
      var k = dumpKindOf(d.kind);
      var when = d.createdAt ? new Date(d.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      h += '<div class="dump-item'+(d.done?' is-done':'')+'">'
        + '<div class="dump-head">'
        + '<span class="dump-chip'+(k?(' k-'+k.key):'')+'">'+(k ? k.emoji+' '+k.label : '未分类')+'</span>'
        + '<span class="dump-time">'+esc(when)+'</span>'
        + '<button class="dump-del" data-act="dumpDel" data-id="'+d.id+'" title="删掉这条">✕</button>'
        + '</div>'
        + '<div class="dump-text">'+esc(d.text)+'</div>'
        + '<div class="dump-acts">';
      DUMP_KINDS.forEach(function(kk){
        h += '<button class="dump-k'+(d.kind===kk.key?' on':'')+'" data-act="dumpKind" data-id="'+d.id+'" data-kind="'+kk.key+'">'+kk.emoji+' '+kk.label+'</button>';
      });
      h += '<button class="dump-start" data-act="dumpStart" data-id="'+d.id+'">↳ 就做这一小步</button>'
        + '</div></div>';
    });
    if(list.length>20){
      h += '<div class="dump-tip" style="margin-top:8px">只显示最近 20 条，共 '+list.length+' 条。</div>';
    }
    h += '</div>';
  }
  return h+'</div>';
}

function renderMoodCard(){
  var rec = STATE.weather.filter(function(x){ return x.date===today(); }).pop();
  var MOODS = [
    {key:'sun',   emoji:'☀️', label:'晴', note:'状态不错'},
    {key:'cloud', emoji:'⛅', label:'阴', note:'还行，有点钝'},
    {key:'rain',  emoji:'🌧️', label:'雨', note:'有点乱'},
    {key:'storm', emoji:'⛈️', label:'暴', note:'快撑不住了'}
  ];
  var h = '<div class="card mood-card">'
    + '<div class="row between"><h2>'+icon('cloud')+' 情绪气象</h2>'
    + '<span class="dump-count">'+(rec ? '今天记过了' : '还没记')+'</span></div>'
    + '<div class="hint">不用解释，选一个就行。它会影响小陆今天的状态——你下雨的时候它不会催你。</div>'
    + '<div class="mood-pick">';
  MOODS.forEach(function(m){
    var on = rec && rec.mood===m.key;
    h += '<button class="mood-btn m-'+m.key+(on?' on':'')+'" data-act="setMood" data-mood="'+m.key+'">'
      + '<span class="mood-emo">'+m.emoji+'</span><span class="mood-lb">'+m.label+'</span>'
      + '<span class="mood-note">'+m.note+'</span></button>';
  });
  h += '</div>';
  if(rec){
    h += '<div class="mood-note-line">今天：'+esc((MOODS.find(function(m){return m.key===rec.mood;})||{}).note||'已记录')+'</div>';
  }
  return h+'</div>';
}

/* ================= 视图：今日 ================= */
function viewToday(){
  var h = '';

  /* 首页主视觉（结构化蓝图：主张 + 标题） */
  h += '<div class="mod-head hero">'
    + '<div class="kicker">Module 01 · 首页</div>'
    + '<div class="warp-head" data-warp><h2>把焦虑，变成下一步。</h2></div>'
    + '<p>当多线程压得你脑子打转，先着陆，再行动。外化焦虑、看清方向、每天只做最小的一步——不催你做更多，只帮你从空转里走出来。</p>'
    + '</div>';
  /* 每周任务：今天还没动的那几个（伙伴已改为全局悬浮挂件，见右下角） */
  var weeklyTodo = STATE.weeklyTasks.filter(function(w){ return w.enabled && !isWeeklyCheckedToday(w); });
  if(weeklyTodo.length){
    h += '<div class="card"><div class="row between"><h2>🏃 今天还没动</h2>'
      + '<span class="muted" style="font-size:12px">每日目标 · 本周达标</span></div>'
      + '<div class="hint">打开这里就是胜利。打卡后选「已完成」直接记账，或选「现在开始」跟着倒计时做。</div>';
    weeklyTodo.forEach(function(w){
      var st = weeklyTaskStats(w);
      h += '<div class="wk-row">'
        + '<div class="wk-info"><div class="wk-name">'+esc(w.name)+'</div>'
        + '<div class="wk-sub">每日 '+w.dailyGoalMin+' 分钟 · 本周 <b>'+st.okDays+'/'+st.goalDays+'</b> 天</div>'
        + weeklyDots(w) + '</div>'
        + '<button class="btn primary sm" data-act="checkinWeekly" data-id="'+w.id+'">'+icon('check')+'打卡</button>'
        + '<button class="btn teal sm" data-act="startTimer" data-scope="weekly" data-id="'+w.id+'">'+icon('play')+'计时</button>'
        + '</div>';
    });
    h += '</div>';
  }

  /* 推送区：日报摘要卡片（参考 landing-prototype） */
  var dg = STATE.digest[today()];
  if(dg && dg.categories){
    var cats = Object.keys(dg.categories).filter(function(k){ return dg.categories[k].length>0; });
    var top2 = cats.slice(0,2).map(function(k){ return k.replace(' /','').replace('/IoT',''); }).join(' / ');
    var trendText = top2 ? top2 + ' · 近 3 天热度上升' : '各领域热门项目已就绪';
    h+='<div class="push">'
      +'<div class="pulse"></div><div class="push-body">'
      +'<div class="ptitle">📡 今日技术日报已送达</div>'
      +'<div class="pbody">'+esc(trendText)+'</div>'
      +'</div>'
      +'<div class="push-actions"><button class="btn ghost sm" data-act="goDigest">查看</button></div></div>';
  } else {
    h+='<div class="push">'
      +'<div class="pulse"></div><div class="push-body">'
      +'<div class="ptitle">📡 技术日报待拉取</div>'
      +'<div class="pbody">每天自动获取 GitHub 各领域热门开源项目，帮你跟上时代进度。</div>'
      +'</div>'
      +'<div class="push-actions"><button class="btn primary sm" data-act="refreshDigest">刷新</button></div></div>';
  }

  /* 情绪气象：选一个就行，影响小陆今天的状态 */
  h += renderMoodCard();

  /* 倾倒台：外化焦虑——闭环的第一步 */
  h += renderDumpCard();

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

  /* 快捷打卡区：启用的日常任务 + 每周任务 */
  var activeDailies = STATE.dailyTasks.filter(function(d){return d.enabled;});
  var activeWeeklies = STATE.weeklyTasks.filter(function(w){return w.enabled;});
  if(activeDailies.length || activeWeeklies.length){
    h += '<div class="card"><h2>快捷打卡</h2><div class="hint">做了就打，不催不罚。单次满 60 分钟赚 1~3 条小鱼干 🐟<br>▶ 是正计时：点一下就开始，做多久算多久，不用切到任务页。</div><div class="quick-checkin">';
    activeDailies.forEach(function(dt){
      var checked = isDailyCheckedToday(dt);
      h += '<div class="qci '+(checked?'done':'')+'" data-act="quickCheckin" data-id="'+dt.id+'">'
        + '<span class="qci-lb">'+(checked ? icon('check')+' '+esc(dt.name) : esc(dt.name))+'</span>'
        + qciTimerBtn('daily', dt.id)
        + '</div>';
    });
    activeWeeklies.forEach(function(w){
      var m = weeklyTodayMinutes(w);
      h += '<div class="qci '+(m>0?'done':'')+'" data-act="quickWeekly" data-id="'+w.id+'">'
        + '<span class="qci-lb">'+(m>0 ? icon('check')+' '+esc(w.name)+' · '+m+'min' : '🏃 '+esc(w.name))+'</span>'
        + qciTimerBtn('weekly', w.id)
        + '</div>';
    });
    h += '</div></div>';
  }

  return h;
}

/* ================= 视图：任务 ================= */
function viewTasks(){
  var h = '';

  /* 模块头（结构化蓝图） */
  h += '<div class="mod-head">'
    + '<div class="kicker">Module 02 · Tasks</div>'
    + '<div class="warp-head" data-warp><h2>任务</h2></div>'
    + '<p>两套并行：<b>长周期（导入型）</b>有终点有总量，到 50%/100% 自动鼓励，连续两天没打卡先暂停等你回来；<b>日常循环（提升型）</b>按类别每天做、不中断，可自由开关。</p>'
    + '</div>';

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

  /* 每周任务 */
  var wSum = weeklyTasksSummary();
  h += '<div class="card"><div class="row between"><h2>'+icon('target')+' 每周任务</h2>'
    + '<button class="btn primary sm" data-act="newWeekly">'+icon('plus')+' 新建每周任务</button></div>'
    + '<div class="hint">按「每日时长 + 每周达标天数」双目标推进，适合运动这类需要节奏的事。'
    + '打卡可选<b>已完成</b>（按设定时长直接计入周报）或<b>现在开始</b>（起倒计时，结束后再问完成多少）。</div>';
  if(wSum.goalDays){
    h += '<div class="wk-sum"><span>本周达标 <b>'+wSum.okDays+'/'+wSum.goalDays+'</b> 天</span>'
      + '<span>累计 <b>'+wSum.doneMin+'</b> 分钟</span>'
      + '<span>目标 <b style="color:var(--khaki-deep)">'+wSum.goalMin+'</b> 分钟</span></div>';
  }
  h += '</div>';

  if(!STATE.weeklyTasks.length){
    h += '<div class="empty">还没有每周任务。点「新建每周任务」加一个，比如「每天运动 30 分钟、每周至少 5 天」。</div>';
  } else {
    STATE.weeklyTasks.forEach(function(w){ h += renderWeeklyTaskCard(w); });
  }

  return h;
}

/* ================= 视图：周报/复盘 ================= */
function generateWeeklyReport(){
  var wk = weekKey();
  var cached = STATE.reports[wk];

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

  /* 日常统计（把每周任务的时长并进来，运动这类主要走每周任务） */
  var dStats = weeklyDailyStats(wk);
  var wSum = weeklyTasksSummary(wk);
  Object.keys(wSum.byCat).forEach(function(c){
    if(!dStats[c]) dStats[c] = {minutes:0, days:0, targetDays:7};
    dStats[c].minutes += wSum.byCat[c];
  });
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
    STATE.weeklyTasks.forEach(function(w){
      if(!w.enabled) return;
      (w.records||[]).forEach(function(r){ if(r.date===d) loadMin+=(r.minutes||0); });
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
    firstGeneratedAt: (cached && cached.firstGeneratedAt) || Date.now(),
    summary: {
      completionRate: completionRate,
      avgLoad: dailyCards.length>0 ? Math.round(dailyCards.reduce(function(a,c){return a+c.load;},0)/dailyCards.length) : 0,
      totalDailyMin: totalDailyMin
    },
    moodTrack: moodTrack,
    dailyCards: dailyCards,
    dailyStats: dStats,
    weekly: wSum
  };

  STATE.reports[wk]=report;
  /* 每周首次生成才落盘；之后每次实时重算，保证今天打卡立刻反映在周报里 */
  if(!cached) save();
  return report;
}

function viewWeekly(){
  var rpt = generateWeeklyReport();
  var wk = weekKey();
  var h = '<div class="mod-head"><div class="kicker">Module 03 · Weekly</div><div class="warp-head" data-warp><h2>周报</h2></div>'
    + '<p>每周首次打开自动生成。看板按<b>投入时间占比</b>展示各类日常；长周期进度告知；最后用温柔复盘接住你，而不是评判。</p></div>';
  h += '<div class="card"><h2>'+icon('chart')+' 复盘 · 本周</h2>'
    + '<div class="hint">回顾你的一周。每周首次打开自动生成。</div></div>';

  /* 本周概况三数字 */
  h += '<div class="stat-row"><div class="stat-col"><div class="stat-num" style="color:var(--amber)" data-count="'+rpt.summary.completionRate+'" data-decimals="0" data-suffix="%">0</div><div class="stat-label">完成率</div></div>'
    + '<div class="stat-col"><div class="stat-num" style="color:var(--violet)" data-count="'+rpt.summary.avgLoad+'" data-decimals="0" data-suffix="">0</div><div class="stat-label">日均投入(分钟)</div></div>'
    + '<div class="stat-col"><div class="stat-num" style="color:var(--teal)" data-count="'+rpt.summary.totalDailyMin+'" data-decimals="0" data-suffix="">0</div><div class="stat-label">本周总计(分钟)</div></div>'
    + '</div>';

  /* 每周任务：双目标达成情况 */
  if(STATE.weeklyTasks.length){
    var wl = rpt.weekly || weeklyTasksSummary(wk);
    var wkFish = (petState().fishLog||[]).filter(function(x){ return ymd(new Date(x.at||0)) >= wk; })
      .reduce(function(a,x){ return a+(x.n||0); }, 0);
    h += '<div class="card"><h2>'+icon('target')+' 每周任务</h2>'
      + '<div class="hint">本周达标 <b>'+wl.okDays+'/'+wl.goalDays+'</b> 天 · 累计投入 <b>'+wl.doneMin+'</b> 分钟 · 本周赚到 <b>'+wkFish+'</b> 条小鱼干 🐟</div>';
    STATE.weeklyTasks.forEach(function(w){
      if(!w.enabled) return;
      var st = weeklyTaskStats(w, wk);
      var okPct = Math.min(100, Math.round(st.okDays/Math.max(1,st.goalDays)*100));
      var minPct = w.dailyGoalMin ? Math.min(100, Math.round(st.total/(w.dailyGoalMin*(w.weeklyGoalDays||7))*100)) : 0;
      h += '<div class="wk-rpt">'
        + '<div class="wk-rpt-head"><b>'+esc(w.name)+'</b>'
        + '<span class="muted">达标 '+st.okDays+'/'+st.goalDays+' 天 · '+st.total+' 分钟</span></div>'
        + weeklyDots(w)
        + weeklyModeChips(w, wk)
        + '<div class="bar" title="达标天数进度"><div style="width:'+okPct+'%"></div></div>'
        + '<div class="wk-rpt-foot"><span>天数进度 '+okPct+'%</span><span>时长进度 '+minPct+'%</span></div>'
        + '</div>';
    });
    h += '</div>';
  }

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
    /* SVG 环形图：各类别投入占比 */
    var totalMin = catKeys.reduce(function(a,k){return a+ds[k].minutes;},0);
    var pieColors = {health:'#22c55e',edu:'#3b82f6',create:'#9333ea',life:'#f59e0b',nature:'#14b8a6'};
    var pieData = catKeys.map(function(k){ return {k:k, min:ds[k].minutes, pct:ds[k].minutes/totalMin, col:pieColors[k]||'#8b6dff'}; });
    var svgW=220, svgH=120, cx=60, cy=60, r=50, hole=30;
    var acc=0, arcs='';
    pieData.forEach(function(d){
      var start=acc, end=acc+d.pct;
      var x1=cx+r*Math.cos((start-.25)*Math.PI*2), y1=cy+r*Math.sin((start-.25)*Math.PI*2);
      var x2=cx+r*Math.cos((end-.25)*Math.PI*2), y2=cy+r*Math.sin((end-.25)*Math.PI*2);
      var large=d.pct>.5?1:0;
      arcs += '<path d="M'+x1+' '+y1+' A'+r+' '+r+' 0 '+large+' 1 '+x2+' '+y2+' L'+cx+' '+cy+' Z" fill="'+d.col+'" opacity=".92"/>';
      acc=end;
    });
    var legend='';
    pieData.forEach(function(d,i){
      legend += '<g transform="translate(130,'+(18+i*22)+')">'
        + '<rect width="10" height="10" rx="3" fill="'+d.col+'"/>'
        + '<text x="16" y="9" font-size="11" fill="var(--ink)" font-family="Inter,sans-serif">'+catName(d.k)+' '+Math.round(d.pct*100)+'%</text>'
        + '</g>';
    });
    h += '<div class="card"><h2>本周投入分布</h2>'
      + '<div style="display:flex;align-items:center;justify-content:center;margin-bottom:14px">'
      + '<svg width="'+svgW+'" height="'+svgH+'" viewBox="0 0 '+svgW+' '+svgH+'" style="overflow:visible">'
      + '<circle cx="'+cx+'" cy="'+cy+'" r="'+hole+'" fill="var(--bg)"/>'
      + arcs + legend
      + '</svg></div>'
      + '<div class="kanban">';
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
  var h = '<div class="mod-head"><div class="kicker">Module 05 · Companion</div><div class="warp-head" data-warp><h2>陪伴</h2></div>'
    + '<p>云端 AI 真在听你说话、接住你。可一键生成「近三日跟进」，把散落的记录变成你能看懂的方向。</p></div>';
  h += '<div class="card"><h2>'+icon('chat')+' AI 陪伴</h2>'
    + '<div class="hint">不评判、不催促。把闷在心里的话说出来。'+(STATE.settings.aiKey?'':'<span style="color:var(--amber)"> 未配置 AI → 设置</span>')+'</div>'
    + '<button class="btn ghost sm" data-act="followup3">'+icon('refresh')+' 近三日跟进</button></div>'
    + '<div class="card"><div class="chat" id="chat">';
  if(!msgs.length) h+='<div class="empty">说点什么，或者点「近三日跟进」。</div>';
  msgs.forEach(function(m){ h+='<div class="bubble '+(m.role==='user'?'me':'ai')+'">'+esc(m.content)+'</div>'; });
  h+='</div><div class="companion-input"><textarea id="aiInput" placeholder="说点什么…"></textarea><button class="btn primary" data-act="sendAI">'+icon('send')+'</button></div></div>';
  var p0 = petState();
  h += '<div class="card"><h2>'+icon('user')+' 着陆伙伴</h2>'
    + '<div class="hint">它不在页面里，它在<b>右下角那个挂件</b>里——切到哪一页都跟着你。喂食、抚摸、说话、逛商城都在那儿。</div>'
    + '<div class="pet-mini"><span>🐟 小鱼干 <b>'+(p0.fish||0)+'</b></span>'
    + '<span>🍚 饱食 <b>'+(p0.hunger==null?'—':Math.round(p0.hunger))+'</b></span>'
    + '<span>💗 亲密 <b>'+(p0.intimacy==null?'—':Math.round(p0.intimacy))+'</b></span></div>'
    + '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">'
    + '<button class="btn primary sm" data-act="petPage">🐾 伙伴详情与设定</button>'
    + '<button class="btn ghost sm" data-act="petFeed">🐟 喂它</button>'
    + '<button class="btn ghost sm" data-act="petPat">🤚 抚摸</button>'
    + '<button class="btn ghost sm" data-act="petChat">💬 说说话</button>'
    + '<button class="btn ghost sm" data-act="petShop">🛒 商城</button>'
    + '<button class="btn ghost sm" data-act="petMem">📖 记忆库</button>'
    + '</div></div>';
  return h;
}

/* ================= 视图：我的（设置+数据管理） ================= */
/* 「我的」页的按钮需要绑事件（视图每次 render 都会重建 DOM） */
function bindMeActions(){
  var ex=$('me_export'), im=$('me_import');
  if(ex) ex.onclick=App.exportData;
  if(im) im.onclick=App.importData;
  if($('posts')) App.loadCommunity();
}

/* ================= 视图：伙伴（详情与设定，内容由 pet.js 渲染） ================= */
function viewPet(){
  return '<div class="mod-head"><div class="kicker">Module 07 · Companion Pet</div>'
    + '<div class="warp-head" data-warp><h2>伙伴</h2></div>'
    + '<p>它不是待办，是你做事时顺手养起来的一只猫：<b>完成 ≥60 分钟的任务</b>换小鱼干，'
    + '小鱼干换吃的、玩具、装扮，也能换你自己定的现实奖励。右下角挂件是它的日常视角，这一页是它的全部细节。</p></div>'
    + '<div id="petPage"><div class="empty">正在唤醒…</div></div>';
}

function viewMe(){
  var h = '<div class="mod-head"><div class="kicker">Module 06 · Mine</div><div class="warp-head" data-warp><h2>我的</h2></div>'
    + '<p>设置 AI 配置（陪伴）与 GitHub Token（可选，提升日报拉取限额）；查看数据概览、导出备份。</p></div>';
  h += '<div class="card"><h2>'+icon('cog')+' 设置</h2><div class="hint">配置 AI 和 GitHub Token。所有数据只存在这台电脑上。</div>'
    + '<button class="btn primary block" data-act="openSettings">'+icon('edit')+' 打开设置面板</button></div>';

  /* 情绪气象 SVG */
  var wData = STATE.weather.slice(-7);
  var moodMap = {sun:4, cloud:3, rain:2, storm:1};
  var moodColors = {sun:'#e0a93b', cloud:'#7a8a99', rain:'#4f86c6', storm:'#7c6fd6'};
  var moodLabels = {sun:'晴', cloud:'阴', rain:'雨', storm:'暴'};
  var svgW2=600, svgH2=160, pad2=30;
  var chartW2=svgW2-pad2*2, chartH2=svgH2-pad2*2;
  var pts2='';
  if(wData.length){
    wData.forEach(function(w,i){
      var x=pad2+i*(chartW2/Math.max(wData.length-1,1));
      var y=pad2+(4-(moodMap[w.mood]||3))/3*chartH2;
      pts2 += (i?',':'') + x + ',' + y;
    });
  }
  var svgMood = '<svg width="100%" height="'+svgH2+'" viewBox="0 0 '+svgW2+' '+svgH2+'" style="margin-top:14px">'
    + '<rect width="'+svgW2+'" height="'+svgH2+'" rx="12" fill="rgba(255,255,255,.35)"/>'
    + '<line x1="'+pad2+'" y1="'+pad2+'" x2="'+pad2+'" y2="'+(pad2+chartH2)+'" stroke="var(--line)" stroke-width="1"/>'
    + '<line x1="'+pad2+'" y1="'+(pad2+chartH2)+'" x2="'+(pad2+chartW2)+'" y2="'+(pad2+chartH2)+'" stroke="var(--line)" stroke-width="1"/>'
    + (pts2?'<polyline points="'+pts2+'" fill="none" stroke="var(--terracotta)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>':'')
    + (wData.length?wData.map(function(w,i){
      var x=pad2+i*(chartW2/Math.max(wData.length-1,1));
      var y=pad2+(4-(moodMap[w.mood]||3))/3*chartH2;
      var c=moodColors[w.mood]||'#7a8a99';
      return '<circle cx="'+x+'" cy="'+y+'" r="5" fill="'+c+'" stroke="#fff" stroke-width="1.5"/>'
        + '<text x="'+x+'" y="'+(y-10)+'" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="Inter,sans-serif">'+(moodLabels[w.mood]||'?')+'</text>';
    }).join(''):'<text x="'+svgW2/2+'" y="'+svgH2/2+'" text-anchor="middle" font-size="13" fill="var(--muted)" font-family="Inter,sans-serif">暂无记录，去「今日」选心情</text>')
    + '</svg>';
  h += '<div class="card"><h2>数据概览</h2>'
    + '<div class="row" style="gap:24px;flex-wrap:wrap"><div>长周期：<b>'+(STATE.longTasks.filter(function(g){return g.status!=='done';}).length)+'</b> 进行中</div>'
    + '<div>日常：<b>'+STATE.dailyTasks.filter(function(d){return d.enabled;}).length+'</b> 启用中</div>'
    + '<div>每周：<b>'+STATE.weeklyTasks.filter(function(w){return w.enabled;}).length+'</b> 进行中</div>'
    + '<div>倾倒：<b>'+STATE.dumps.length+'</b> 条</div>'
    + '<div>情绪记录：<b>'+STATE.weather.length+'</b> 天</div>'
    + '<div>小鱼干：<b>'+petState().fish+'</b> 条</div>'
    + '<div>记忆库：<b>'+STATE.memories.length+'</b> 条</div></div>'
    + svgMood + '</div>';

  /* 记忆库（与伙伴的对话也归档到这里） */
  var mems = STATE.memories.slice(-10).reverse();
  h += '<div class="card"><div class="row between"><h2>'+icon('spark')+' 记忆库</h2>'
    + '<button class="btn ghost sm" data-act="petMem">'+icon('edit')+' 全部 '+STATE.memories.length+' 条</button></div>'
    + '<div class="hint">你做的事、和伙伴说过的话，都会归到这里。它不是待办清单，是你走过的痕迹。</div>';
  if(!mems.length){
    h += '<div class="empty">还没有记忆。去右下角的伙伴那儿说句话吧。</div>';
  } else {
    h += '<div class="mem-list">';
    mems.forEach(function(m){
      h += '<div class="mem-item"><span class="mem-kind k-'+(m.kind||'note')+'">'+(MEM_KIND[m.kind]||'记录')+'</span>'
        + '<div class="mem-body">'+esc(m.text)+'<span class="mem-time">'+new Date(m.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</span></div></div>';
    });
    h += '</div>';
  }
  h += '</div>';

  /* 数据管理：备份 / 恢复 / 重置。桌面版走系统文件对话框，网页版退回浏览器下载。 */
  var isDesk = !!(window.landing && window.landing.data);
  h += '<div class="card"><h2>'+icon('cog')+' 数据管理</h2>'
    + '<div class="hint">'+(isDesk
        ? '所有数据都存在这台电脑上，不上传任何服务器。换电脑或重装前先导出备份。'
        : '所有数据只存在这个浏览器的本地存储里。换电脑前先导出备份。')+'</div>'
    + '<div class="row" style="gap:8px;flex-wrap:wrap">'
    + '<button class="btn primary sm" id="me_export">'+icon('send')+' 导出备份</button>'
    + '<button class="btn ghost sm" id="me_import">'+icon('refresh')+' 导回备份</button>'
    + '<button class="btn ghost sm" data-act="openSettings">'+icon('cog')+' 设置面板</button>'
    + (isDesk ? '<button class="btn ghost sm" data-act="openDataDir">打开数据文件夹</button>' : '')
    + '</div>'
    + '<div class="muted" style="font-size:12px;margin-top:10px" id="meDataPath">'
    + '长周期 '+STATE.longTasks.length+' · 日常 '+STATE.dailyTasks.length+' · 每周 '+STATE.weeklyTasks.length
    + ' · 倾倒 '+STATE.dumps.length+' · 情绪 '+STATE.weather.length+' · 记忆 '+STATE.memories.length
    + '</div></div>';

  /* 树洞：只在桌面版里有（借助 preload 暴露的本地存储），
     网页里没有 window.landing 就整块不显示，而不是留一个必然报错的入口。 */
  if(window.landing && window.landing.feed){
    h += '<div class="card"><h2>'+icon('people')+' 树洞</h2>'
      + '<div class="hint">写点不敢对别人说的。它只存在<b>这台电脑</b>上，不上传、不联网、没有别人能看见——'
      + '说出来的意义在于说出来本身。</div>'
      + '<div class="field"><textarea id="postBody" placeholder="今天着陆了吗？还是还在飘着？"></textarea></div>'
      + '<div class="row between" style="flex-wrap:wrap;gap:8px">'
      + '<button class="btn primary" data-act="postCommunity">'+icon('send')+' 写进去</button>'
      + '<div class="row" style="gap:8px">'
      + '<button class="btn ghost sm" data-act="loadCommunity">'+icon('refresh')+' 刷新</button>'
      + '<button class="btn ghost sm" data-act="clearCommunity">清空</button>'
      + '</div></div>'
      + '<div id="posts" class="feed-list"><div class="empty">加载中…</div></div></div>';
  }

  return h;
}



/* ================= 渲染入口 ================= */
var TAB_TITLE = {today:'今日',tasks:'任务',weekly:'周报',digest:'日报',companion:'陪伴',pet:'伙伴',me:'我的'};

/* 出错兜底：单个视图抛异常不应该让整个应用白屏，其它模块仍然能用 */
function renderErrorView(tab, err){
  var detail = (err && (err.stack || err.message)) || String(err);
  return '<div class="mod-head"><div class="kicker">出错了</div>'
    + '<div class="warp-head" data-warp><h2>这一页没渲染出来</h2></div>'
    + '<p>其它模块还能用。你的数据都在本地，没有丢。可以先切到别的栏目，或者把下面的报错贴给我。</p></div>'
    + '<div class="card"><h2>'+icon('warn')+' 「'+esc(TAB_TITLE[tab]||tab)+'」渲染失败</h2>'
    + '<div class="hint">错误信息：</div>'
    + '<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55;background:rgba(46,36,25,.05);border:1px solid var(--line);border-radius:12px;padding:12px;overflow:auto;max-height:280px">'+esc(detail)+'</pre>'
    + '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">'
    + '<button class="btn primary sm" data-act="retryRender">重试这一页</button>'
    + '<button class="btn ghost sm" data-act="goToday">回今日</button>'
    + '</div></div>';
}

function render(){
  var views = {today:viewToday,tasks:viewTasks,weekly:viewWeekly,digest:renderDigestView,companion:viewCompanion,pet:viewPet,me:viewMe};
  if(window.WarpText) WarpText.disposeAll();

  var html;
  try{
    html = views[CUR_TAB]();
  }catch(err){
    console.error('[着陆] 渲染「'+CUR_TAB+'」失败：', err);
    html = renderErrorView(CUR_TAB, err);
  }
  $('view').innerHTML = html;
  $('viewTitle').textContent = TAB_TITLE[CUR_TAB];

  /* 伙伴页内容由 pet.js 填（要赶在入场动画之前） */
  if(CUR_TAB==='pet' && window.Pet) Pet.renderPage();

  document.querySelectorAll('.nav-item').forEach(function(b){
    b.classList.toggle('active', b.dataset.tab===CUR_TAB);
  });

  /* 卡片入场动画：staggered reveal */
  var cards = document.querySelectorAll('#view .card, #view .task, #view .dg-card, #view .stat-col, #view .mod-head');
  cards.forEach(function(el,i){
    el.classList.add('anim');
    el.style.setProperty('--d',(0.04*i+0.08)+'s');
  });

  /* 周报统计 count-up */
  if(CUR_TAB==='weekly'){ initCountUp(); }

  if(CUR_TAB==='companion'){ var c=$('chat'); if(c) c.scrollTop=c.scrollHeight; }
  if(CUR_TAB==='me'){ bindMeActions(); }

  /* 玻璃折射标题 */
  if(window.WarpText) WarpText.apply($('view'));

  /* 伙伴挂件不随视图销毁，只刷新数据 */
  if(window.Pet) Pet.refresh();
  renderTimerBar();
}

/* ================= 统计数字 count-up ================= */
function easeOutCubic(t){ return 1-Math.pow(1-t,3); }
function countUp(el){
  var target=parseFloat(el.dataset.count)||0;
  var dec=parseInt(el.dataset.decimals||'0',10);
  var suffix=el.dataset.suffix||'';
  var duration=1500;
  var start=performance.now();
  function tick(now){
    var p=Math.min((now-start)/duration,1);
    var v=target*easeOutCubic(p);
    el.textContent=v.toFixed(dec)+suffix;
    if(p<1) requestAnimationFrame(tick);
    else el.textContent=target.toFixed(dec)+suffix;
  }
  requestAnimationFrame(tick);
}
var _countUpObserver=null;
function initCountUp(){
  if(_countUpObserver) _countUpObserver.disconnect();
  _countUpObserver=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){
        countUp(e.target);
        _countUpObserver.unobserve(e.target);
      }
    });
  },{threshold:0.25});
  document.querySelectorAll('[data-count]').forEach(function(el){ _countUpObserver.observe(el); });
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
  markOne:function(){
    if(STATE.oneThing && STATE.oneThing.date===today()){
      STATE.oneThing.done=true;
      grantFish(1, '完成今天一件：'+(STATE.oneThing.text||'').slice(0,20));
      addMemory('daily', '今天一件完成：「'+(STATE.oneThing.text||'')+'」', ['今天一件']);
      /* 今天一件若是从某条倾倒缩出来的，顺手把那一条标成处理完 */
      if(STATE.oneThing.dumpId){
        var d=STATE.dumps.find(function(x){return x.id===STATE.oneThing.dumpId;});
        if(d){ d.done=true; if(!d.kind) d.kind='do'; }
      }
      save(); render(); toast('完成了，今天稳了 ✓ · +1 🐟');
    }
  },
  changeOne:function(){ STATE.oneThing=null; save(); render(); },
  newOne:function(){
    openSheet('<h2>今天只承诺一件</h2><div class="hint">挑最小、最不添焦虑的那件。</div>'
      + '<div class="field"><textarea id="o_text" placeholder="比如：打开书看 10 分钟"></textarea></div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn primary" id="o_save">定下</button></div>');
    $('o_save').addEventListener('click',function(){
      var v=$('o_text').value.trim(); if(!v){toast('写点什么');return;}
      STATE.oneThing={date:today(),text:v,done:false}; save(); closeSheet(); render(); toast('今天就这一件');
    });
  },

  /* --- 倾倒台 --- */
  dumpAdd:function(){
    var ta=$('dumpInput'); if(!ta) return;
    var v=ta.value.trim(); if(!v){ toast('写一句就行'); ta.focus(); return; }
    var before = todayDumpCount();
    STATE.dumps.push({id:uid('d'), text:v, createdAt:Date.now(), kind:null, done:false});
    /* 倾倒本身就是进展——记进痕迹，不要求分类 */
    addMemory('note', '倾倒：'+v.slice(0,60), ['倾倒台']);
    var gainFish = before<2;
    if(gainFish) grantFish(1, '倾倒焦虑：'+v.slice(0,20));
    save(); render();
    /* render 之后 DOM 被重建，焦点要重新给回去 */
    var ta2=$('dumpInput'); if(ta2) ta2.focus();
    toast(gainFish ? '倒出来了 ✓ · +1 🐟' : '倒出来了 ✓');
  },
  dumpKind:function(id, kind){
    var d=STATE.dumps.find(function(x){return x.id===id;}); if(!d) return;
    d.kind = (d.kind===kind) ? null : kind;   /* 再点一次取消，允许改主意 */
    save(); render();
  },
  dumpDone:function(id){
    var d=STATE.dumps.find(function(x){return x.id===id;}); if(!d) return;
    d.done=!d.done; save(); render();
    toast(d.done ? '这条处理完了 ✓' : '已放回待办');
  },
  dumpDel:function(id){
    STATE.dumps=STATE.dumps.filter(function(x){return x.id!==id;});
    save(); render(); toast('已删掉');
  },
  /* 从一条倾倒里挑出「今天能迈的最小一步」，写进今日一件 */
  dumpStart:function(id){
    var d=STATE.dumps.find(function(x){return x.id===id;}); if(!d) return;
    openSheet('<h2>就做这一小步</h2>'
      + '<div class="hint">从刚才倒出来的那件事里，只挑<b>今天能做完的最小一步</b>。写「打开资料看 10 分钟」比写「学完 RTOS」有用得多。</div>'
      + '<div class="dump-quote">'+esc(d.text)+'</div>'
      + '<div class="field"><label>今天这一件</label><input id="ds_text" value="" placeholder="打开 RTOS 教程看前 10 分钟"></div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button>'
      + '<button class="btn primary" id="ds_save">就它了</button></div>');
    var inp=$('ds_text'); if(inp) inp.focus();
    $('ds_save').addEventListener('click',function(){
      var v=($('ds_text').value||'').trim(); if(!v){ toast('写一件小的'); return; }
      STATE.oneThing={date:today(),text:v,done:false,dumpId:d.id};
      if(!d.kind) d.kind='do';
      addMemory('daily', '把「'+d.text.slice(0,30)+'」缩成了今天一件：「'+v+'」', ['今天一件']);
      save(); closeSheet(); render(); toast('今天就这一件');
    });
  },

  /* --- 情绪气象 --- */
  setMood:function(mood){
    if(!mood) return;
    var exist=STATE.weather.filter(function(x){return x.date===today();}).pop();
    if(exist) exist.mood=mood;
    else STATE.weather.push({date:today(),mood:mood,note:''});
    var first = !exist;
    /* 记情绪本身也算一次「着陆」，一天只算一次，避免刷 */
    if(first){
      grantFish(1, '记下今天的情绪');
      addMemory('note', '今天的情绪：'+({sun:'晴',cloud:'阴',rain:'雨',storm:'暴'}[mood]||mood), ['情绪']);
    }
    save(); render();
    toast(first ? '记下了 ✓ · +1 🐟' : '改好了');
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
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn primary" id="lt_save">'+(isEdit?'保存':'创建')+'</button></div>');

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
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn primary" id="ci_ok">确认打卡</button></div>');
    $('ci_ok').addEventListener('click',function(){
      var amt=parseInt($('ci_amt').value,10)||0;
      var mins=parseInt($('ci_min').value,10)||0;
      g.current=(g.current||0)+amt;
      g.records.push({date:today(),amount:amt,minutes:mins,ts:Date.now()});
      if(g.current>=g.total){ g.status='done'; }
      var fish = mins>0 ? awardFish(mins, g.name) : 0;
      save(); closeSheet();
      var ms=checkLongMilestones(g);
      render(); renderTimerBar();
      if(ms.length){ setTimeout(function(){toast(ms[0]);},300); }
      else{ toast('已打卡 +'+amt+' '+g.unit+(fish?(' · +'+fish+' 🐟'):'')); }
    });
  },

  resumeLong:function(id){
    var g=STATE.longTasks.find(function(x){return x.id===id;}); if(!g)return;
    g.status='active'; g.pausedAt=null; save(); render(); toast('已恢复「'+g.name+'」');
  },

  delLong:function(id){
    var g=STATE.longTasks.find(function(x){return x.id===id;}); if(!g)return;
    openSheet('<h2>删除长周期任务？</h2><div class="hint">「'+esc(g.name)+'」及其 '+g.records.length+' 条记录将被删除。</div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn danger" id="dl_yes">确认删除</button></div>');
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
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn primary" id="dn_save">'+(isEdit?'保存':'创建')+'</button></div>');

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
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn primary" id="dci_ok">确认</button></div>');
    $('dci_ok').addEventListener('click',function(){
      var mins=parseInt($('dci_min').value,10)||10;
      dt.records.push({date:today(),amount:1,minutes:mins,ts:Date.now()});
      var fish = awardFish(mins, dt.name);
      save(); closeSheet(); render();
      toast('已打卡 '+mins+' 分钟 ✓'+(fish?(' · +'+fish+' 条小鱼干 🐟'):''));
    });
  },

  quickCheckin:function(id){ App.checkinDaily(id); },

  delDaily:function(id){
    var dt=STATE.dailyTasks.find(function(x){return x.id===id;}); if(!dt)return;
    openSheet('<h2>删除日常任务？</h2><div class="hint">「'+esc(dt.name)+'」将被删除。</div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn danger" id="dd_yes">确认删除</button></div>');
    $('dd_yes').addEventListener('click',function(){
      STATE.dailyTasks=STATE.dailyTasks.filter(function(x){return x.id!==id;}); save(); closeSheet(); render(); toast('已删除');
    });
  },

  /* --- 每周任务 CRUD --- */
  newWeekly:function(){ App.openWeeklyForm(null); },
  editWeekly:function(id){ App.openWeeklyForm(id); },
  checkinWeekly:function(id){ openWeeklyCheckin(id); },
  toggleWeekly:function(id){
    var w=STATE.weeklyTasks.find(function(x){return x.id===id;}); if(!w)return;
    w.enabled=!w.enabled; save(); render(); toast(w.enabled?'已启用':'已关闭');
  },
  openWeeklyForm:function(id){
    var w = id ? STATE.weeklyTasks.find(function(x){return x.id===id;}) : null;
    var isEdit = !!w;
    openSheet('<h2>'+(isEdit?'编辑':'新建')+'每周任务</h2>'
      + '<div class="field"><label>类型</label><div class="cat-grid" id="wk_type"></div>'
      + '<div class="muted" id="wk_type_hint" style="font-size:12px;margin-top:6px;display:block"></div></div>'
      + '<div class="field"><label>名称</label><input id="wk_name" value="'+esc(w?w.name:'')+'" placeholder="如：跑步 / 健身房"></div>'
      + '<div class="row" style="gap:10px">'
      + '<div class="field" style="flex:1"><label>每日目标（分钟）</label><input id="wk_daily" type="number" value="'+(w?w.dailyGoalMin:30)+'" min="1"></div>'
      + '<div class="field" style="flex:1"><label>每周达标天数</label><input id="wk_days" type="number" value="'+(w?w.weeklyGoalDays:5)+'" min="1" max="7"></div>'
      + '</div>'
      + '<div class="field"><label>大类</label><div class="cat-grid" id="wk_cat"></div></div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button>'
      + '<button class="btn primary" id="wk_save">'+(isEdit?'保存':'创建')+'</button></div>');

    var selType = w ? w.type : 'exercise';
    var selCat  = w ? w.category : weeklyTypeOf(selType).cat;

    function paintType(){
      var html='';
      WEEKLY_TYPES.forEach(function(t){
        html += '<div class="cat-chip '+(selType===t.key?'on':'')+'" data-tk="'+t.key+'">'+t.label+'</div>';
      });
      $('wk_type').innerHTML = html;
      $('wk_type_hint').textContent = weeklyTypeOf(selType).hint;
      $('wk_type').querySelectorAll('[data-tk]').forEach(function(el){
        el.addEventListener('click',function(){
          selType = el.dataset.tk;
          selCat = weeklyTypeOf(selType).cat;
          paintType(); paintCat();
        });
      });
    }
    function paintCat(){
      var html='';
      CATEGORIES.forEach(function(c){
        html += '<div class="cat-chip '+(selCat===c.key?'on':'')+'" data-ck2="'+c.key+'">'+c.label+'</div>';
      });
      $('wk_cat').innerHTML = html;
      $('wk_cat').querySelectorAll('[data-ck2]').forEach(function(el){
        el.addEventListener('click',function(){ selCat = el.dataset.ck2; paintCat(); });
      });
    }
    paintType(); paintCat();

    $('wk_save').onclick=function(){
      var name = $('wk_name').value.trim();
      if(!name){ toast('写个名字'); return; }
      var daily = parseInt($('wk_daily').value,10)||0;
      var days = Math.min(7, Math.max(1, parseInt($('wk_days').value,10)||5));
      if(!weeklyTypeOf(selType).timed) daily = 0;
      if(w){ w.name=name; w.type=selType; w.category=selCat; w.dailyGoalMin=daily; w.weeklyGoalDays=days; }
      else{
        STATE.weeklyTasks.push({id:uid('wk'), name:name, type:selType, category:selCat,
          dailyGoalMin:daily, weeklyGoalDays:days, enabled:true, records:[], createdAt:today()});
      }
      save(); closeSheet(); render(); toast(isEdit?'已更新':'已创建每周任务');
    };
  },
  delWeekly:function(id){
    var w=STATE.weeklyTasks.find(function(x){return x.id===id;}); if(!w)return;
    openSheet('<h2>删除每周任务？</h2><div class="hint">「'+esc(w.name)+'」及其 '+w.records.length+' 条记录将被删除。</div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn danger" id="dw_yes">确认删除</button></div>');
    $('dw_yes').addEventListener('click',function(){
      STATE.weeklyTasks=STATE.weeklyTasks.filter(function(x){return x.id!==id;});
      if(STATE.timer && STATE.timer.taskId===id) STATE.timer=null;
      save(); closeSheet(); render(); renderTimerBar(); toast('已删除');
    });
  },

  /* --- 计时器 --- */
  timerToggle:function(){ toggleTimer(); },
  timerFinish:function(){ if(timerIsStopwatch()) openStopwatchFinishSheet(); else finishTimerEarly(); },
  startTimer:function(scope,id){ startStopwatch(scope,id); },

  /* --- 伙伴（实现在 pet.js） --- */
  petPage:function(){ CUR_TAB='pet'; render(); },
  petFeed:function(){ if(window.Pet) Pet.open('panel','feed'); },
  petPat:function(){ if(window.Pet) Pet.pat(); },
  petChat:function(){ if(window.Pet) Pet.open('panel','chat'); },
  petShop:function(){ if(window.Pet) Pet.open('panel','shop'); },
  petMem:function(){ if(window.Pet) Pet.open('panel','mem'); },

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
    var dumps=STATE.dumps.filter(function(d){ return ymd(new Date(d.createdAt||0))>=since; }).map(function(d){return '【'+(d.kind||'未分类')+'】'+d.text;});
    var weather=STATE.weather.filter(function(w){return w.date>=since;}).map(function(w){return w.date+' '+w.mood+(w.note?'：'+w.note:'');});
    var ot=(STATE.oneThing && STATE.oneThing.date>=since) ? ('今天一件：'+STATE.oneThing.text+(STATE.oneThing.done?'（已完成）':'（未完成）')) : '(无)';
    /* 今日一件可能来自倾倒台，把原始那条也带上，AI 才看得懂前后文 */
    var fromDump=(STATE.oneThing && STATE.oneThing.date>=since && STATE.oneThing.dumpId)
      ? (STATE.dumps.find(function(d){return d.id===STATE.oneThing.dumpId;})||{}).text : '';
    var prompt='这是用户近三天的记录，请生成一份温柔的「跟进日报」：1)一句话接住他现在的状态；2)指出一个小进展；3)给一个明天可以迈的最小一步。控制在150字内。\n倾倒台：'+(dumps.join('\n')||'（无）')+'\n情绪：'+(weather.join('\n')||'（无）')+'\n'+ot+(fromDump?('\n它来自这条倾倒：'+fromDump):'');
    /* 兼容：老库里 community 字段还在，只是不再有入口 */
    STATE.community = STATE.community || {nick:''};
    STATE.companion.messages.push({role:'user',content:'【近三日跟进】请生成我的日报',ts:Date.now()});
    var msgs=[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt}];
    save(); render();
    callAI(msgs).then(function(r){
      STATE.companion.messages.push({role:'assistant',content:r.error?r.error:r.content,ts:Date.now()});
      save(); render();
    });
  },

  /* --- 树洞（本地） --- */
  /* 只在桌面版有 window.landing.feed 时可用：数据由主进程写进 userData 下的
     feed.json，不联网、不上传。 */
  loadCommunity:function(){
    var box=$('posts'); if(!box) return;
    if(!(window.landing && window.landing.feed)){
      box.innerHTML='<div class="empty">这个版本没有树洞。</div>';
      return;
    }
    window.landing.feed.list().then(function(posts){
      posts = posts||[];
      if(!posts.length){ box.innerHTML='<div class="empty">树洞还空着。写第一句吧。</div>'; return; }
      box.innerHTML=posts.slice(0,60).map(function(p){
        var when = p.at ? new Date(p.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : (p.date||'');
        return '<div class="post"><div class="head"><span>'+esc(p.nick||'匿名')+'</span><span>'+esc(when)+'</span></div>'
          + '<div class="body">'+esc(p.body||'')+'</div></div>';
      }).join('');
    }).catch(function(){ box.innerHTML='<div class="empty">读不出来了。</div>'; });
  },

  postCommunity:function(){
    var ta=$('postBody'); if(!ta) return;
    var v=ta.value.trim(); if(!v){ toast('写点什么'); return; }
    if(!(window.landing && window.landing.feed)){ toast('这个版本没有树洞'); return; }
    window.landing.feed.post({body:v}).then(function(r){
      if(r && r.ok){
        ta.value='';
        /* 写进树洞也算一次「着陆」，记进痕迹 */
        addMemory('note', '树洞：'+v.slice(0,50), ['树洞']);
        grantFish(1, '写进树洞');
        save(); render(); toast('写进去了 ✓ · +1 🐟');
      } else {
        toast('没写成：'+((r&&r.error)||'未知原因'));
      }
    }).catch(function(e){ toast('失败：'+e.message); });
  },

  clearCommunity:function(){
    if(!(window.landing && window.landing.feed)) return;
    if(!confirm('清空树洞里的全部内容？不可恢复。')) return;
    window.landing.feed.clear().then(function(){ App.loadCommunity(); toast('已清空'); });
  },

  openDataDir:function(){
    if(window.landing && window.landing.openDataDir) window.landing.openDataDir();
  },

  /* --- 备份 --- */
  /* 桌面版交给主进程弹系统「另存为」，用户能自己选位置；
     网页版退回浏览器下载，行为一致。 */
  exportData:function(){
    var json;
    try{ json=JSON.stringify(STATE,null,2); }
    catch(err){ toast('导出失败：'+err.message); return; }

    if(window.landing && window.landing.data){
      window.landing.data.save(json).then(function(r){
        if(r && r.ok) toast('已导出到 '+r.filePath);
        else if(r && r.canceled) toast('已取消');
        else toast('导出失败：'+((r&&r.error)||'未知原因'));
      }).catch(function(e){ toast('导出失败：'+e.message); });
      return;
    }

    try{
      var blob=new Blob([json],{type:'application/json'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');
      a.href=url; a.download='着陆备份-'+today()+'.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); },4000);
      toast('已导出备份文件');
    }catch(err){ toast('导出失败：'+err.message); }
  },

  importData:function(){
    var apply=function(text){
      var obj;
      try{ obj=JSON.parse(text); }
      catch(err){ toast('导入失败：不是有效的 JSON'); return; }
      if(!obj||typeof obj!=='object'||!Array.isArray(obj.longTasks)){ toast('导入失败：不是着陆的备份文件'); return; }
      /* 必须就地改 STATE：内部所有函数都闭包引用同一个对象，
         整个替换掉会让它们继续看旧对象，导入等于没导。 */
      var keep = STATE;
      Object.keys(keep).forEach(function(k){ delete keep[k]; });
      Object.keys(obj).forEach(function(k){ keep[k] = obj[k]; });
      migrate(); save(); closeSheet(); render(); toast('已导回备份');
    };

    if(window.landing && window.landing.data){
      window.landing.data.open().then(function(r){
        if(r && r.ok) apply(r.json);
        else if(r && r.canceled) toast('已取消');
        else toast('导入失败：'+((r&&r.error)||'未知原因'));
      }).catch(function(e){ toast('导入失败：'+e.message); });
      return;
    }

    var inp=document.createElement('input');
    inp.type='file'; inp.accept='application/json,.json';
    inp.onchange=function(){
      var f=inp.files&&inp.files[0]; if(!f) return;
      var fr=new FileReader();
      fr.onload=function(){ apply(String(fr.result)); };
      fr.readAsText(f);
    };
    inp.click();
  },

  /* --- 设置 --- */
  openSettings:function(){
    var s=STATE.settings;
    openSheet('<h2>'+icon('cog')+' 设置</h2>'
      + '<div class="field"><label>GitHub Token（可选，提升日报拉取限额）</label><input id="s_gh" type="password" value="'+esc(s.githubToken||'')+'" placeholder="不填也能拉取日报"></div>'
      + '<div class="field"><label>AI 接口地址（baseUrl）</label><input id="s_base" value="'+esc(s.aiBaseUrl||'')+'" placeholder="https://api.openai.com/v1"></div>'
      + '<div class="field"><label>API Key</label><input id="s_key" type="password" value="'+esc(s.aiKey||'')+'" placeholder="sk-..."></div>'
      + '<div class="field"><label>模型名</label><input id="s_model" value="'+esc(s.aiModel||'')+'" placeholder="gpt-4o-mini"></div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn danger" id="s_reset">清空全部数据</button><button class="btn primary" id="s_save">保存</button></div>'
      + '<div class="row between" style="margin-top:14px;gap:10px;flex-wrap:wrap">'
      + '<button class="btn ghost sm" id="s_export">导出备份</button>'
      + '<button class="btn ghost sm" id="s_import">导入备份</button>'
      + '<button class="btn ghost sm" id="s_demo">载入示例数据</button>'
      + '</div>'
      + '<div class="field" style="margin-top:14px"><label>后台常驻</label>'
      +   '<div class="hint" style="margin:0 0 8px">关掉窗口只是缩到右下角托盘，程序继续跑、计时照常走（托盘悬停能看到剩余时间）。要彻底退出：右键托盘图标 → 退出着陆。</div>'
      +   '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn ghost sm" id="s_autostart">开机自动启动：读取中…</button>'
      +   '<button class="btn ghost sm" id="s_closepref">关闭窗口时：读取中…</button></div>'
      + '</div>'
      + '<div class="ver">着陆 v'+APP_CONFIG.version+' · <a href="'+APP_CONFIG.repo+'" target="_blank" rel="noreferrer">GitHub</a></div>');

    /* 开机自启：只在桌面版有桥；网页版说明一句 */
    var asBtn = $('s_autostart');
    if(asBtn){
      if(window.landing && window.landing.autoLaunch){
        window.landing.autoLaunch.get().then(function(on){
          asBtn.dataset.on = on ? '1' : '0';
          asBtn.textContent = '开机自动启动：'+(on ? '已开启' : '已关闭');
        });
        asBtn.onclick = function(){
          var next = asBtn.dataset.on !== '1';
          window.landing.autoLaunch.set(next).then(function(applied){
            asBtn.dataset.on = applied ? '1' : '0';
            asBtn.textContent = '开机自动启动：'+(applied ? '已开启' : '已关闭');
            toast(applied ? '开机自启已开（启动后待在托盘里，不弹窗）' : '开机自启已关');
          });
        };
      } else {
        asBtn.textContent = '开机自动启动：仅桌面版可用';
        asBtn.disabled = true;
      }
    }

    $('s_save').onclick=function(){
      STATE.settings.githubToken=$('s_gh').value.trim();
      STATE.settings.aiBaseUrl=$('s_base').value.trim();
      STATE.settings.aiKey=$('s_key').value.trim();
      STATE.settings.aiModel=$('s_model').value.trim()||'gpt-4o-mini';
      save(); closeSheet(); toast('已保存');
    };
    $('s_reset').onclick=function(){
      if(confirm('确定清空全部数据？任务、倾倒、情绪、伙伴和记忆都会没，不可恢复。')){
        localStorage.removeItem(APP_CONFIG.storageKey);
        STATE=blankState(); save(); render(); closeSheet(); toast('已清空，从零开始');
      }
    };
    $('s_export').onclick=App.exportData;
    $('s_import').onclick=App.importData;
    $('s_demo').onclick=function(){
      if(!confirm('载入示例数据？会覆盖当前的任务设置（倾倒、情绪、伙伴、记忆保留）。')) return;
      seedDemo(); save(); closeSheet(); render(); toast('示例数据已载入');
    };

    /* 关窗偏好：点 × 是"每次问我 / 直接缩托盘 / 直接退出" */
    var cpBtn = $('s_closepref');
    if(cpBtn){
      var cpLabel = {ask:'每次问我', tray:'缩到托盘', quit:'直接退出'};
      if(window.landing && window.landing.closePref){
        window.landing.closePref.get().then(function(v){ cpBtn.textContent = '关闭窗口时：'+(cpLabel[v]||cpLabel.ask); });
        cpBtn.onclick = function(){
          window.landing.closePref.get().then(function(v){
            /* 点一下按 问我 → 托盘 → 退出 → 问我 循环 */
            var next = v==='ask' ? 'tray' : (v==='tray' ? 'quit' : 'ask');
            return window.landing.closePref.set(next);
          }).then(function(applied){
            cpBtn.textContent = '关闭窗口时：'+(cpLabel[applied]||cpLabel.ask);
            toast('关闭窗口时：'+(cpLabel[applied]||cpLabel.ask));
          });
        };
      } else {
        cpBtn.textContent = '关闭窗口时：仅桌面版可设';
        cpBtn.disabled = true;
      }
    }
  },

  /* --- 关窗选择：桌面版点 × 时由主进程调用（弹在应用自己的界面里） --- */
  askCloseChoice:function(){
    if(!(window.landing && window.landing.closeChoice)) return;
    if(window.landing.closePromptOpened) window.landing.closePromptOpened();  /* 告诉主进程"弹层出来了，别走兜底超时" */
    var running = !!(STATE.timer && !STATE.timer.finished);
    var task = timerTask();
    openSheet('<h2>要关掉着陆吗？</h2>'
      + '<div class="hint">关掉窗口有两种方式，你说了算。</div>'
      + (running ? '<div class="hint" style="color:var(--terracotta-d)">「'+esc(task?task.name:(STATE.timer.name||'专注'))+'」正在计时 —— 选托盘就继续走，选退出会按暂停存好、下次打开接着算。</div>' : '')
      + '<div class="wk-pick">'
      +   '<button class="wk-choice" id="cc_tray"><b>最小化到托盘</b><span>计时继续跑，点右下角图标随时回来</span></button>'
      +   '<button class="wk-choice" id="cc_quit"><b>彻底退出</b><span>关掉程序，下次打开再继续</span></button>'
      + '</div>'
      + '<label class="ck-row"><input type="checkbox" id="cc_remember"> 记住我的选择，以后不再问</label>'
      + '<div class="sheet-actions"><button class="btn ghost" id="cc_cancel">再想想</button></div>');

    /* ⚠️ 必须先读勾选框再 closeSheet()：关掉弹层后 #cc_remember 就没了（踩过） */
    var ccRemember = function(){ var el = $('cc_remember'); return !!(el && el.checked); };
    $('cc_tray').onclick=function(){ var rm=ccRemember(); closeSheet(); window.landing.closeChoice({choice:'tray', remember:rm}); };
    $('cc_quit').onclick=function(){ var rm=ccRemember(); closeSheet(); window.landing.closeChoice({choice:'quit', remember:rm}); };
    $('cc_cancel').onclick=function(){ closeSheet(); window.landing.closeChoice({choice:'cancel'}); };
  },

  /* 退出前把正在跑的计时按暂停存好（否则下次打开会把这段"没在学的时间"也算进去） */
  pauseTimerForQuit:function(){
    var t = STATE.timer;
    if(!t || t.finished || t.paused) return;
    if(t.mode==='stopwatch') t.accMs = timerElapsedMs();
    else t.remainMs = timerRemainMs();
    t.paused = true;
    save();
  }
};

/* 关窗/退出时也走一遍：beforeunload 是同步的，能保证暂停状态落盘 */
window.addEventListener('beforeunload', function(){ try{ App.pauseTimerForQuit(); }catch(e){} });

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

  /* 倾倒台 / 情绪气象 */
  else if(act==='dumpAdd') App.dumpAdd();
  else if(act==='dumpKind') App.dumpKind(id, el.dataset.kind);
  else if(act==='dumpDone') App.dumpDone(id);
  else if(act==='dumpDel') App.dumpDel(id);
  else if(act==='dumpStart') App.dumpStart(id);
  else if(act==='setMood') App.setMood(el.dataset.mood);

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

  /* 每周任务 */
  else if(act==='newWeekly') App.newWeekly();
  else if(act==='editWeekly') App.editWeekly(id);
  else if(act==='checkinWeekly') App.checkinWeekly(id);
  else if(act==='quickWeekly') App.checkinWeekly(id);
  else if(act==='toggleWeekly') App.toggleWeekly(id);
  else if(act==='delWeekly') App.delWeekly(id);

  /* 计时器 */
  else if(act==='startTimer') App.startTimer(el.dataset.scope||'weekly', id);
  else if(act==='timerToggle') App.timerToggle();
  else if(act==='timerFinish') App.timerFinish();

  /* 伙伴 */
  else if(act==='petPage') App.petPage();
  else if(act==='petFeed') App.petFeed();
  else if(act==='petPat') App.petPat();
  else if(act==='petChat') App.petChat();
  else if(act==='petShop') App.petShop();
  else if(act==='petMem') App.petMem();

  /* 日报 */
  else if(act==='goDigest') App.goDigest();
  else if(act==='refreshDigest') App.refreshDigest();
  else if(act==='filterDigest'){ var cat=el.dataset.cat||'全部'; _digestFilter=cat; render(); }

  /* AI */
  else if(act==='sendAI') App.sendAI();
  else if(act==='followup3') App.followup3();

  /* 树洞 / 数据管理 */
  else if(act==='loadCommunity') App.loadCommunity();
  else if(act==='postCommunity') App.postCommunity();
  else if(act==='clearCommunity') App.clearCommunity();
  else if(act==='openDataDir') App.openDataDir();

  /* 设置 */
  else if(act==='openSettings') App.openSettings();

  /* 关闭弹层。以前这里用内联 onclick="closeSheet()"，
     但外壳加了 CSP（script-src 'self'）之后内联事件处理器会被拦掉，
     所有「取消」按钮就都点不动了。改走全局委托，和别的按钮一致的路径。 */
  else if(act==='closeSheet') closeSheet();

  /* 错误兜底 */
  else if(act==='retryRender') render();
  else if(act==='goToday'){ CUR_TAB='today'; render(); }
});

/* ================= 启动 ================= */
function init(){
  load();
  var pausedNames = checkAutoPause();

  /* 渲染期间不产生副作用：里程碑在这里统一结算一次 */
  var milestoneMsgs = [];
  STATE.longTasks.forEach(function(g){
    if(g.status!=='active' && g.status!=='done') return;
    milestoneMsgs = milestoneMsgs.concat(checkLongMilestones(g));
  });
  if(pausedNames.length) save();
  if(milestoneMsgs.length){
    setTimeout(function(){ toast(milestoneMsgs[0]); }, 900);
  }
  if(pausedNames.length){
    setTimeout(function(){
      toast('「'+pausedNames[0]+'」停了两天，先歇着——想继续随时点「继续」');
    }, pausedNames.length && milestoneMsgs.length ? 3200 : 900);
  }
  /* 深链：#tab=tasks 之类的锚点可以直接打开对应模块 */
  try{
    (location.hash||'').replace(/^#/,'').split('&').forEach(function(kv){
      var p = kv.split('=');
      if(p[0]==='tab' && TAB_TITLE[p[1]]) CUR_TAB = p[1];
    });
  }catch(e){}

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

  /* 给 pet.js 用的桥（保持 app.js 单例状态，不重复造轮子） */
  window.Landing = {
    state:function(){ return STATE; },
    save:save, render:render, toast:toast,
    openSheet:openSheet, closeSheet:closeSheet,
    callAI:callAI,
    addMemory:addMemory, grantFish:grantFish, petState:petState,
    vitality:catVitality, landingDays:catLandingDays, tierText:catTierText,
    tierOf:function(v){ return window.CyberCat ? CyberCat.tierOf(v) : (v<40?'low':(v>70?'high':'mid')); },
    fishForMinutes:fishForMinutes,
    renderTimerBar:renderTimerBar,
    today:today, ymd:ymd, addDays:addDays, esc:esc, icon:icon, uid:uid,
    MEM_KIND:MEM_KIND, CATEGORIES:CATEGORIES,
    tab:function(t){ CUR_TAB=t; render(); }
  };

  /* 计时恢复：应用没开着的这段时间里到期了 → 补一个结算入口 */
  var tr = STATE.timer;
  render();
  if(tr && !tr.finished && tr.endsAt <= Date.now()){
    tr.finished = true;
    save();
    setTimeout(function(){
      toast('你没开应用这会儿，计时已经结束了');
      openTimerFinishSheet(false);
    }, 700);
  } else if(tr && !tr.finished){
    ensureTimerTick();
  }

  /* 自动拉取日报（今天还没拉过就静默拉取；无 token 也能拉，未认证限速 60 次/小时足够日报用） */
  if(!STATE.digest[today()]){
    fetchDigest(false).then(function(){ /* 静默拉取，不弹提示 */ });
  }
}
init();
})();
