/* 着陆 Landing v2 — 把焦虑变成下一步
 * 模块（2026-10-13 起 7 个）：今日(情绪气象+倾倒台+一件+每日必做+今天的池子) / 周报(复盘看板) /
 *       日报(GitHub 热度) / 陪伴(AI) / 伙伴(养成挂件) / 商城 / 我的(设置+数据管理)
 *       ⚠️ 「任务」模块已删（master 选的 A 档）：长周期 / 日常循环 / 每周任务全没了，
 *          只留「每日必做」并挪到今日页；时间投入统一走松散计时（含换应用自动计时）。
 * 核心机制：先倾倒外化 → 选今天最小一步 → 打卡即算数 → 换个应用自动开始计时 →
 *          每日必做清空累计连续天数 → 每周首次打开自动生成复盘
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
  {key:'fun',    label:'休闲娱乐', cls:'fun',    subs:['游戏','看番','追剧','音乐','社交','出门玩']},
  {key:'work',   label:'工作学习', cls:'work',   subs:['课程','项目','刷题','英语','论文','实习']},
  {key:'life',   label:'生活品质', cls:'life',   subs:['作息','运动','整理','饮食','健康','出行']},
  {key:'growth', label:'素养提高', cls:'growth', subs:['阅读','冥想','写作','技能','艺术','视野']}
];

/* 旧分类 key → 新四类。
   用途①：**历史周报里存的还是旧 key**（dailyStats 按 key 汇总），翻旧周报要靠它显示成中文；
   用途②：没被一次性迁移覆盖到的老数据（例如导回来的旧备份）。 */
var CAT_ALIAS_KEY = {health:'life', edu:'work', create:'growth', life:'life', nature:'life'};

/* 任务名 → 新分类。**只给一次性迁移用**（见 migrate 里的 catMigrated）。
   ⚠️ 为什么按名字判、而不是按旧 key 映射：老数据里的分类是随手选的 ——
   master 的「ML学习」「c++学习」「卡拉比丘」全被放在 health 里，纯 key 映射会全错。 */
var CAT_NAME_RULES = [
  [/游戏|卡拉比丘|杀戮尖塔|鸣潮|战双|原神|星穹|看番|追剧|番剧|电影|听歌|唱歌|K歌|麻将|打牌|出去玩|刷视频|短视频/, 'fun'],
  [/学习|刷题|开发|项目|论文|课程|上课|考试|实习|面试|编程|代码|作业|实验|python|c\+\+|\bml\b|ue|unity/i, 'work'],
  [/跑步|锻炼|健身|早睡|早起|作息|整理|打扫|收纳|做饭|饮食|刷牙|喝水|健康|体检|散步|出门/, 'life'],
  [/冥想|阅读|读书|背单词|红宝书|英语|写作|练字|乐器|画画|书法|摄影|素养|视野/, 'growth']
];
function guessCategory(name, oldKey){
  var n = String(name || '');
  for(var i = 0; i < CAT_NAME_RULES.length; i++){
    if(CAT_NAME_RULES[i][0].test(n)) return CAT_NAME_RULES[i][1];
  }
  if(CAT_ALIAS_KEY[oldKey]) return CAT_ALIAS_KEY[oldKey];
  return CATEGORIES.some(function(c){ return c.key === oldKey; }) ? oldKey : 'work';
}

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
/* 本周的周一（周报窗口 / 每周任务达标 / 七天格子的起点）
   🔴 原来写的是 `getDate() - getDay() + (getDay()===0 ? -6 : 0)` —— 那是**周日=0**的口径，
   对**周一到周六**都会算成"上一个周日"（只有周日输入是对的）。实测：
   2026-09-21(周一) → 旧返回 09-20(周日)，整整差一天。
   后果：周报窗口变成"周日~周六"，把**上一个教学周的周日**算进来、把本周周日漏掉。
   2026-09-21 加"上课时间"时被它坑到 —— 周一生成的周报显示 16 节/720 分钟（多算了周日 8 节）。
   现在统一走 mondayOf()（周一为一周之始，跟课表的周一~周日一致）。 */
function weekKey(d){ d = d || today(); return ymd(mondayOf(parseYmd(d))); }
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
/* 带「撤销」的 toast（休息日这种不可逆动作用）。
   ⚠️ `.toast` 本身是 pointer-events:none（不然会吞掉底部按钮的点击，踩过），
   所以按钮必须自己把它打开 —— 见 index.html 的 .toast-act。 */
function toastAction(msg, label, fn, ms){
  var t = $('toast');
  t.innerHTML = esc(msg) + ' <button class="toast-act" type="button">'+esc(label)+'</button>';
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  var btn = t.querySelector('.toast-act');
  if(btn) btn.onclick = function(){
    try{ fn(); }catch(e){}
    t.classList.add('hidden'); t.textContent = '';
  };
  toastTimer = setTimeout(function(){ t.classList.add('hidden'); t.textContent = ''; }, ms || 6000);
}

function catLabel(key){
  var c=CATEGORIES.find(function(x){return x.key===(CAT_ALIAS_KEY[key]||key);});
  return c ? '<span class="cat '+c.cls+'">'+c.label+'</span>' : '';
}
/* ⚠️ 一定要走 CAT_ALIAS_KEY：历史周报/老数据里存的是旧 key（health/edu/…），
   不兜底就会在界面上显示成英文 key */
function catName(key){
  var c=CATEGORIES.find(function(x){return x.key===(CAT_ALIAS_KEY[key]||key);});
  return c ? c.label : key;
}
/* 四类的**唯一**色源（2026-10-13）：必须和 index.html 里 `.cat.<cls>` 那套标签色一模一样，
   别在别处再写一张 map —— 之前周报就自己写了两张按**旧 key** 取色的表，
   结果现在的 fun/work/life/growth 全掉到紫色兜底（"工作学习"显示成紫的）。 */
var CAT_COLOR = {fun:'#e5768e', work:'#5b93d6', life:'#e0a93b', growth:'#8f74ff'};

/* 分类 key 归一化 → data-cat / 取色用。认不出来返回空串（调用方别写 data-cat，会渲染成灰线）。 */
function catKeyOf(key){
  var k = CAT_ALIAS_KEY[key] || key;
  return CATEGORIES.some(function(x){return x.key===k;}) ? k : '';
}
function catAttr(key){
  var k = catKeyOf(key);
  return k ? ' data-cat="'+k+'"' : '';
}
function catColor(key){
  return CAT_COLOR[catKeyOf(key)] || 'rgba(255,255,255,.35)';
}

/* ================= 数据模型 ================= */
var STATE = null;
var CUR_TAB = 'today';
var _digestFilter = '全部';  /* 日报分类筛选（瞬态，不持久化） */

function blankState(){
  return {
    version: APP_CONFIG.version,
    mustDos: [],        // 每日必做：{id,name,enabled,records:[{date,ts}],createdAt}（ts = 首次打卡时刻）
    reports: {},        // {weekKey:{generatedAt,summary,moodTrack,dailyCards}}
    digest: {},         // {date:{fetchedAt,categories:{label:[{name,desc,stars,url,lang}]}}}
    dumps: [],          // 倾倒台
    loose: [],          // 松散时长：不属于任何任务的一笔（「玩一会杀戮尖塔 45 分钟」）
                        // —— 宠物「直接记一笔」用，进今天的池子 + 周报投入
    fun: [],            // 娱乐/放纵记录：[{id,date,kind:'fun'|'spree',text,ts}]
                        // fun=娱乐（放松心神）/ spree=放纵（明知道有点过）；不发鱼也不扣鱼
    weather: [],        // 情绪气象 [{date,mood,note}]（⚠️ 与下面的 wx 无关，别混）
    wx: null,           // 今日天气快照（IP 定位 + Open-Meteo，由主进程代取）
    schedule: null,     // 本学期课表快照 {at,termCode,items:[{name,weekday,periods,weeks,room,teacher}]}
    termStart: '',      // 教学周起点（第 1 周的周一，'YYYY-MM-DD'）；空 = 用常量 TERM_START
                        // ⚠️ 故意**不放**在 schedule 里 —— 那个快照每次同步都被整体替换，会被冲掉
    companion: {messages: []},
    community: {nick:''},
    timer: null,        // 计时器：{taskId,plannedMin,startedAt,endsAt,paused,remainMs,finished}
                        //   自动计时起的会多两个字段：auto:true + autoProc:'code.exe'
    appNames: {},       // 应用 → 他给这件事起的名字：{'code.exe':'写代码'}（2026-10-13 自动计时用）
    memories: [],       // 记忆库：{id,at,kind,text,tags}
    pet: {},            // 伙伴（由 pet.js 负责默认值与演化）
    oneThing: null,     // 今天一件：{date,text,done,dumpId?}
    restDays: [],       // 休息日：['YYYY-MM-DD',...] 手动记账，只能往回补不能往未来
    softLandOff: '',    // 回归日他点过「看全部待办」的日期（当天不再收起待办）
    fishPool: {date:'', minutes:0},   // 今日小鱼干时间池：攒满 60 分钟发 1 条，零头当天清零
    classFish: {date:'', minutes:0},  // 今日已把多少「上课分钟」结算进池子（幂等用，防重复发鱼）
    seeded: true,       // 标记：已初始化过（避免老库升级时被重新播种）
    settings: {}        // {aiBaseUrl,aiKey,aiModel,githubToken,nick,
                        //  petAiBaseUrl,petAiKey,petAiModel ← 伙伴单独那套，三个都空=回退主 AI}
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
  s.mustDos = s.mustDos || [];         /* 每日必做，老存档必须补默认值 */
  s.reports = s.reports || {};
  s.digest = s.digest || {};
  s.dumps = s.dumps || [];
  s.loose = s.loose || [];   /* 松散时长（宠物「直接记一笔」用的） */
  s.appNames = s.appNames || {};   /* 应用 → 他起的名字（自动计时用，2026-10-13） */
  s.fun = s.fun || [];                     /* 娱乐/放纵记录（2026-09-23 加） */
  s.weather = s.weather || [];
  if(s.wx === undefined) s.wx = null;      /* 今日天气快照，老存档必须补默认值 */
  if(s.schedule === undefined) s.schedule = null;   /* 本学期课表快照 */
  /* 教学周起点。老存档从没有过这个字段 → 原来 currentWeek() 恒等于 3（见 termStart 注释）。
     顺手把可能被写进 schedule 快照里的那份也认下来，避免丢掉他手改的值。 */
  if(!s.termStart) s.termStart = (s.schedule && s.schedule.termStart) || '2026-08-31';
  s.companion = s.companion || {messages:[]};
  s.community = s.community || {nick:''};
  s.memories = s.memories || [];
  /* 一次性：清掉历史里所有「对话流水」记忆（master 要求：不要有你问我答的记录）。
     用 flag 保证只跑一次；新的对话本来就不再写进来了（pet.js 的 chat() 已去掉 addMemory）。
     它「记得」的部分仍在 pet 的 p.chat 里（喂 AI 上下文），只是不再显化到记忆库。 */
  if(!s.chatMemPurged){
    s.chatMemPurged = true;
    s.memories = s.memories.filter(function(m){ return m && m.kind !== 'chat'; });
  }
  /* 一次性：任务分类体系换代（旧五类 → 新四类 休闲娱乐/工作学习/生活品质/素养提高）。
     ⚠️ 按**名字**重判而不是按旧 key 映射（老数据分类是随手选的，见 CAT_NAME_RULES 注释）；
     ⚠️ 必须用 flag 挡住 —— 否则每次启动都会把他手动改过的分类冲回去。 */
  if(!s.catMigrated){
    s.catMigrated = true;
    (s.mustDos||[])
      .forEach(function(t){ t.category = guessCategory(t.name, t.category); });
  }
  s.timer = s.timer || null;
  if(s.timer){
    if(!s.timer.scope) s.timer.scope = 'loose';   /* 任务模块已删，只剩松散计时（2026-10-13） */
    if(!s.timer.mode) s.timer.mode = 'countdown';
    if(s.timer.mode==='stopwatch' && s.timer.accMs===undefined) s.timer.accMs = 0;
  }
  s.pet = s.pet || {};
  s.settings = s.settings || {};
  if(s.oneThing === undefined) s.oneThing = null;
  s.restDays = s.restDays || [];        /* 老存档读出来没有这个字段，必须补上 */
  if(s.softLandOff === undefined) s.softLandOff = '';
  if(!s.fishPool || typeof s.fishPool !== 'object') s.fishPool = {date:'', minutes:0};
  if(!s.classFish || typeof s.classFish !== 'object') s.classFish = {date:'', minutes:0};

  /* 迁移旧 v1 数据中的 dumps/weather/companion/community/settings */
  if(!s.dumps.length && s.dumps_v1) s.dumps = s.dumps_v1;
  if(!s.weather.length && s.weather_v1) s.weather = s.weather_v1;

  s.mustDos.forEach(function(m){
    m.records = m.records || [];
    if(m.enabled===undefined) m.enabled = true;
    if(!m.createdAt) m.createdAt = today();   /* 连续天数的追溯下限靠它，缺了会把历史天数算丢 */
  });

  stripLegacySeed();
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

function weeklyDailyStats(wk){
  var stats = {}; /* {categoryKey: {minutes:0, days:0, targetDays:7}} */
  /* 松散时长（不挂任何任务的那些，如「玩一会杀戮尖塔」）也算投入 ——
     master 2026-10-09：「直接记入时间积累池和周报总结中」。放这里而不是放调用方，
     是为了让所有读投入的地方（周报、宠物上下文）自动都算上。 */
  (STATE.loose||[]).forEach(function(r){
    if(r.date>=wk && r.date<addDays(wk,7)){
      var k = r.category || 'life';
      if(!stats[k]) stats[k] = {minutes:0, days:0, targetDays:7};
      stats[k].minutes += (r.minutes||0);
      stats[k].days++;
    }
  });
  return stats;
}

/* ================= 每日必做 =================
   跟「日常循环」的区别：日常是"想做就做"，必做是"每天都要交代一下"。
   所以它有两样日常没有的东西：
     · 打卡时间 —— 记的是**完成的那一刻**（不是"完成了"，是好几点完成的）
     · 全清连续天数 —— 一天里所有必做都清掉才算一天，这才叫"必做"
   基调照旧：不催不罚。没做完不写"失败"，只写"还差 N 件"；今天还没开始不算断链。
   一天只记一次（防止手滑连点刷时间）；再点一下就是撤销。 */

function mustActive(){
  return (STATE.mustDos||[]).filter(function(m){ return m.enabled; });
}

/* 某天的打卡记录（一天至多一条） */
function mustRecOn(m, d){
  return (m.records||[]).find(function(r){ return r.date===d; }) || null;
}
function isMustDoneToday(m){ return !!mustRecOn(m, today()); }

/* 打卡时刻 → HH:MM。记的是时刻不是时长，所以不显示"X 分钟" */
function clockOf(ts){
  var d = new Date(ts||0);
  var z = function(n){ return ('0'+n).slice(-2); };
  return z(d.getHours())+':'+z(d.getMinutes());
}

/* 单条必做的连续打卡天数。
   休息日照旧"链条继续走但不计入"（跟 catLandingDays 同一套规矩：算进去是自欺，断掉是惩罚休息）。
   今天还没打不算断 —— 否则每天早上打开都是 0，这个数字就没意义了。 */
function mustStreak(m){
  var n = 0, cur = today(), guard = 0;
  if(!mustRecOn(m, cur)) cur = addDays(cur,-1);
  while(guard++ < 4000){
    if(isRestDay(cur)){ cur = addDays(cur,-1); continue; }
    if(!mustRecOn(m, cur)) break;
    n++; cur = addDays(cur,-1);
  }
  return n;
}

/* 全部清掉的连续天数（这才是「必做」真正的反馈）
   ⚠️ 后加的必做不能追溯倒算：某天之前还不存在的项不参与那天的判定。
      否则新加一条，过去所有天数当场作废，这个数字天天归零，等于废掉。 */
function mustAllStreak(){
  var ms = mustActive();
  if(!ms.length) return 0;
  var earliest = ms.reduce(function(a,m){
    var c = m.createdAt || '';
    return (c && c < a) ? c : a;
  }, today());
  var doneAll = function(d){
    return ms.every(function(m){
      if((m.createdAt||'') > d) return true;    /* 那天它还没出生 */
      return !!mustRecOn(m, d);
    });
  };
  var n = 0, cur = today(), guard = 0;
  if(!doneAll(cur)) cur = addDays(cur,-1);      /* 今天还没开始不算断 */
  while(guard++ < 4000 && cur >= earliest){
    if(isRestDay(cur)){ cur = addDays(cur,-1); continue; }
    if(!doneAll(cur)) break;
    n++; cur = addDays(cur,-1);
  }
  return n;
}

function mustTodayStats(){
  var ms = mustActive();
  var done = ms.filter(isMustDoneToday);
  return {total:ms.length, done:done.length, items:ms};
}

/* 今日页那张卡：一行一条，点一下打勾并记下时间 */
function renderMustCard(){
  var ms = mustActive();
  /* ⚠️ 一条都没有时**也必须渲染**（空态 = 一行说明 + 加一条）。
     这里曾经 `return ''`，结果「还没建过必做项」的人在整个今日页看不到任何入口，
     只能碰巧逛到任务页才发现有这功能 —— 功能等于不存在。（2026-09-20 master 实测踩到）
     调性跟「今天一件」的空态 `定一件` 一致：给出口，不施压。 */
  if(!ms.length){
    /* 分两种空：从没设过 / 全都关掉了。后者再劝他"加一条"是错的，该说的是怎么打开 */
    var allOff = (STATE.mustDos||[]).length > 0;
    return '<div class="card must-card must-empty">'
      + '<div class="row between"><h2>'+icon('check')+' 每日必做</h2>'
      + '<span class="must-count">0 / 0</span></div>'
      + '<div class="hint">'+(allOff
          ? '必做项都被你关掉了。点「管理」可以把它们重新打开。'
          : '还没设必做项。每天都要交代的那几件（吃药、记账、背词…）放这儿 —— '
            + '点一下打勾，软件记下<b>完成时刻</b>，全部清掉还会累计连续天数。')+'</div>'
      + '<div class="must-foot">'
      +   '<button class="btn primary sm" data-act="newMust">'+icon('plus')+' 加一条</button>'
      +   (allOff ? '<button class="btn ghost sm" data-act="mustManage">管理</button>' : '')
      + '</div>'
      + '</div>';
  }

  var st = mustTodayStats();
  var allDone = st.done === st.total && st.total > 0;
  var firstTs = null, lastTs = null;
  ms.forEach(function(m){
    var r = mustRecOn(m, today());
    if(!r || !r.ts) return;
    if(firstTs===null || r.ts < firstTs) firstTs = r.ts;
    if(lastTs===null || r.ts > lastTs) lastTs = r.ts;
  });
  var streak = mustAllStreak();

  var h = '<div class="card must-card">'
    + '<div class="row between"><h2>'+icon('check')+' 每日必做</h2>'
    + '<span class="must-count'+(allDone?' all':'')+'">'+st.done+' / '+st.total+'</span></div>';

  if(allDone){
    h += '<div class="hint">今天全部清掉了 ✓'
      + (firstTs!==null
          ? '　打卡时间 <b class="must-ok">'+clockOf(firstTs)+'</b>'
            + (lastTs!==firstTs ? ' ~ <b class="must-ok">'+clockOf(lastTs)+'</b>' : '')
          : '')
      + (streak>1 ? '　·　已连续全清 <b>'+streak+'</b> 天' : '') + '</div>';
  } else {
    h += '<div class="hint">点一下就打勾，软件记下时间。还差 <b>'+(st.total-st.done)+'</b> 件'
      + (streak>1 ? '　·　已连续全清 <b>'+streak+'</b> 天' : '') + '</div>';
  }

  h += '<div class="must-list">';
  ms.forEach(function(m){
    var r = mustRecOn(m, today());
    h += '<div class="must-row'+(r?' done':'')+'" data-act="mustToggle" data-id="'+m.id+'" title="'+(r?'再点一下取消今天这次打卡':'打卡')+'">'
      + '<span class="must-box">'+(r ? icon('check') : '')+'</span>'
      + '<span class="must-name">'+esc(m.name)+'</span>'
      + (r
          ? '<span class="must-time">'+clockOf(r.ts)+'</span>'
          : '<span class="must-time blank">未打卡</span>')
      + '</div>';
  });
  h += '</div>'
    + '<div class="must-foot"><button class="btn ghost sm" data-act="newMust">'+icon('plus')+' 加一条</button>'
    + '<button class="btn ghost sm" data-act="mustManage">管理</button></div>'
    + '</div>';
  return h;
}

/* 必做项的管理卡（2026-10-13 起挂在今日页的「管理」弹层里，不再是任务页）：
   只有这里能改名字、开关、看最近 7 天。 */
function renderMustItemCard(m){
  var r = mustRecOn(m, today());
  var st = mustStreak(m);

  var dots = '';
  for(var i=6;i>=0;i--){
    var d = addDays(today(),-i);
    var cls = mustRecOn(m,d) ? 'on' : (isRestDay(d) ? 'rest' : '');
    dots += '<span class="mdot '+cls+'" title="'+d+(mustRecOn(m,d)?' 已打卡':'')+'"></span>';
  }

  return '<div class="task">'
    + '<div class="tinfo">'
    + '<div class="tname">'+esc(m.name)+(m.enabled?'':'<span class="badge-pause">已关</span>')+'</div>'
    + '<div class="tmeta">'
    + (r
        ? '<span class="must-ok">✓ 今天 '+clockOf(r.ts)+' 已打卡</span>'
        : '<span class="muted">今天还没打</span>')
    + (st>1 ? ' · 连续 '+st+' 天' : '')
    + '</div>'
    + '<div class="mdots">'+dots+'<span class="mdot-hint">近 7 天</span></div>'
    + '</div>'
    + '<button class="btn '+(r?'ghost':'primary')+' sm" data-act="mustToggle" data-id="'+m.id+'">'
    + icon(r?'refresh':'check')+(r?'撤销':'打卡')+'</button>'
    + '<button class="btn ghost sm" data-act="toggleMust" data-id="'+m.id+'">'+(m.enabled?'关':'开')+'</button>'
    + '<button class="btn ghost sm" data-act="editMust" data-id="'+m.id+'">'+icon('edit')+'</button>'
    + '<button class="btn ghost sm" data-act="delMust" data-id="'+m.id+'">'+icon('trash')+'</button>'
    + '</div>';
}

/* 没发鱼的时候也告诉他池子攒到哪了 —— 否则"做了却没鱼"会被当成功能没生效
   （上一轮「没看见」就是同一类问题：机制不显化 = 不存在）。 */
function poolTail(awarded){
  if(awarded) return '';
  var p = poolState();
  return p.minutes > 0 ? ' · 池子已攒 '+Math.round(p.minutes)+'/'+POOL_MIN+' 分钟' : '';
}

/* ================= 专注计时器 ================= */
var _timerTick = null;
function timerRemainMs(){
  var t=STATE.timer; if(!t) return 0;
  if(t.finished) return 0;
  if(t.paused) return Math.max(0, t.remainMs||0);
  return Math.max(0, t.endsAt - Date.now());
}
/* 任务模块删掉后只剩 loose 一条路（2026-10-13）。这里的兜底**必须是 loose** ——
   写成别的，commitStopwatchRecord 会走「无任务 → 只收走计时、不落账」那条路，
   他这段时长就静默没了。 */
function timerScope(){ var t=STATE.timer; return (t && t.scope) || 'loose'; }
function timerIsStopwatch(){ return !!(STATE.timer && STATE.timer.mode==='stopwatch'); }
function timerElapsedMs(){
  var t=STATE.timer; if(!t) return 0;
  if(t.mode==='stopwatch'){
    var base = t.accMs||0;
    return t.paused ? base : base + Math.max(0, Date.now()-(t.startedAt||Date.now()));
  }
  return Math.max(0, (t.plannedMin*60000) - timerRemainMs());
}
/* 任务模块删了之后，计时只剩「松散（临时记一笔）」一条路 —— 自动计时也走它。 */
function timerTask(){ return null; }

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

/* 后台弹窗提醒：窗口藏进托盘 / 被最小化之后，每满 30 分钟把它叫回来一次。
   为什么要这个：计时是"开着窗口静悄悄走"，但他多半会顺手把窗口收了去做别的事。
   到点只在系统通知里露一行字很容易被淹掉（全屏游戏里更是根本看不见）。
   规则：
     · 只在窗口真的看不见时才弹 —— 他正盯着界面的时候绝不抢焦点
     · 从"窗口藏起来"那一刻开始算；每弹回来一次就重新计 30 分钟
     · 暂停中不弹（暂停了就不该打扰）
   网页版没有这个桥，直接跳过，不报错。 */
var _hiddenSince = 0;
/* 窗口可见性 —— **以主进程为准，不要用 document.hidden**。
   🔴 计时期间主进程会对窗口 setBackgroundThrottling(false)，副作用是：
      窗口藏进托盘后渲染进程的 document.hidden **仍然报 false**（rAF 也照跑）。
      2026-10-02 实测：不设节流时 hide 后 hidden=true / rAF 停；设了之后 hidden=false / rAF 仍有帧。
      所以下面那个 30 分钟判断要是读 document.hidden，就**永远不成立** ——
      表现就是 master 说的「每半个小时的弹窗好像没实现」。 */
var _winVisible = true;
function initWinVisibility(){
  if(!window.landing) return;                       /* 网页版没有这个桥，直接跳过 */
  if(window.landing.winVisGet){ try{ _winVisible = !!window.landing.winVisGet(); }catch(e){} }
  if(window.landing.onWinVis){
    window.landing.onWinVis(function(v){ _winVisible = !!v; if(v) _hiddenSince = 0; });
  }
}
function timerWantsNudge(t){
  if(!t || t.finished || t.paused) return false;
  if(!window.landing || !window.landing.nudge) return false;
  if(_winVisible){ _hiddenSince = 0; return false; }   /* 他正看着界面，绝不抢焦点 */
  if(!_hiddenSince){ _hiddenSince = Date.now(); return false; }   /* 刚藏起来，先记基准 */
  if(Date.now() - _hiddenSince < SW_NUDGE_MS) return false;
  _hiddenSince = Date.now();
  return true;
}
function nudgeWindowBack(t){
  var nm = timerTask();
  var label = nm ? nm.name : (t.name || '专注');
  window.landing.nudge();
  armRetract();
  notify('⏱ 还在计时', label + ' 已经 ' + fmtClockLong(timerElapsedMs()) + ' 了，回来瞄一眼？');
  if(window.Pet && Pet.say) Pet.say('我一直看着呢，已经 '+Math.floor(timerElapsedMs()/60000)+' 分钟了。');
}

/* 自动收回：被叫回来的窗口如果没人理，20 秒后自己缩回托盘。
   为什么放在渲染进程算：只有这里知道"他到底动手了没有"。
   手势（点/按/滚）一律视为他在用它 —— 那就别收，留给他。
   他自己手动关掉了也不重复收（document.hidden 已经是 true）。 */
var _retractTimer = null;
function _retractCleanup(){
  if(_retractTimer){ clearTimeout(_retractTimer); _retractTimer = null; }
  ['pointerdown','keydown','wheel'].forEach(function(ev){
    window.removeEventListener(ev, _cancelRetract, true);
  });
}
function _cancelRetract(){ _retractCleanup(); }
function _fireRetract(){
  _retractCleanup();
  if(document.hidden) return;
  if(window.landing && window.landing.retract) window.landing.retract();
}
function armRetract(){
  _retractCleanup();
  ['pointerdown','keydown','wheel'].forEach(function(ev){
    window.addEventListener(ev, _cancelRetract, true);
  });
  _retractTimer = setTimeout(_fireRetract, SW_RETRACT_MS);
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
      +'<span class="tb-name">'+(t.auto?'<i class="tb-auto">自动</i>':'')+nm+' · 已 '+Math.floor(used/60000)+' 分钟</span>'
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
    /* 藏在后台的计时，每 30 分钟把窗口叫回来一次（正计时/倒计时都算） */
    if(timerWantsNudge(t)) nudgeWindowBack(t);
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
  var name = '专注';   /* 任务模块删掉后（2026-10-13）倒计时只剩这一种 */
  var passed = Math.max(1, Math.round(timerElapsedMs()/60000));
  openSheet('<h2>'+(early?'结束本次专注？':'⏰ 时间到！')+'</h2>'
    +'<div class="hint">'+esc(name)+' · 计划 '+t.plannedMin+' 分钟'+(early?(' · 已进行 '+passed+' 分钟'):'')+'</div>'
    +'<div class="ph-actions">'
      +'<button class="btn primary block" id="tf_done" style="margin-bottom:8px">'+icon('check')+' 已完成（记 '+t.plannedMin+' 分钟）</button>'
      +'<button class="btn ghost block" id="tf_part">完成部分 · 我自己填时长</button>'
      +(early?'<button class="btn ghost block" id="tf_giveup" style="margin-top:8px">放弃这次，不记录</button>':'')
    +'</div>');

  $('tf_done').onclick=function(){
    STATE.timer=null; save(); closeSheet(); render(); renderTimerBar();
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
      STATE.timer=null; save(); closeSheet(); render();
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
   防呆三件套：<1 分钟默认丢掉；单次超过 4 小时自动封顶暂停；每 60 分钟提醒一次还在跑。
   另外：窗口躲进托盘之后，每 30 分钟把窗口弹回来一次（见 SW_NUDGE_MS）。 */
var SW_MIN_MS = 60000;
var SW_MAX_MS = 4*3600*1000;
var SW_NAG_MS = 60*60*1000;
var SW_NUDGE_MS = 30*60*1000;
var SW_RETRACT_MS = 20*1000;      /* 弹出来后没人理，20 秒自己收回去 */

/* 任务模块已删 —— 只剩 loose 一条路。 */
function scopeList(){ return []; }
function scopeName(){ return "临时记一笔"; }

function startStopwatch(scope, id, opts){
  opts = opts || {};
  var task = null;
  if(scope === 'loose'){
    if(!opts.name){ toast('没说要做什么'); return; }
  } else {
    task = (scopeList(scope)||[]).find(function(x){ return x.id===id; });
    if(!task){ toast('找不到这个任务'); return; }
  }

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
      startStopwatch(scope, id, opts);
    };
    return;
  }

  var tname = task ? task.name : opts.name;
  STATE.timer = { scope:scope, mode:'stopwatch', name:tname, taskId: task ? id : null,
    category: task ? (task.category||'life') : (opts.category||'life'),
    plannedMin:0, startedAt:Date.now(), accMs:0, paused:false, remainMs:0,
    finished:false, nagMs:0 };
  save(); renderTimerBar(); ensureTimerTick();
  render();   /* 让卡片/芯片立刻反映「计时中」 */
  toast('开始计时：'+tname+'。做多久算多久，不用看表。关掉窗口也没事，会在右下角托盘继续走。');
  if(window.Pet && Pet.say) Pet.say('我帮你记着时间，你专心做就行。');
  addMemory('timer', '开始计时：「'+tname+'」（'+(task ? scopeName(scope) : '临时记一笔')+'）', ['计时']);
}

/* 把当前正计时落账：写进对应任务的记录里 */
function commitStopwatchRecord(minutes, meta){
  var t = STATE.timer; if(!t) return 0;
  var scope = t.scope || 'loose', id = t.taskId;
  var task = timerTask();
  minutes = Math.max(0, Math.round(minutes||0));
  meta = meta||{};

  /* 松散计时（没挂任务，如「玩一会杀戮尖塔」）：记进 STATE.loose + 今天的池子 */
  if(!task && scope === 'loose'){
    var ln = t.name || '一段专注';
    var lmin = Math.max(0, Math.round(minutes||0));
    STATE.timer = null;
    if(_timerTick){ clearInterval(_timerTick); _timerTick = null; }
    if(lmin > 0){
      looseRecord(ln, lmin, t.category || 'life');
      toast('记下了：'+ln+' '+lmin+' 分钟，已进今天的池子');
    } else {
      save();
      toast('这段是 0 分钟，没记');
    }
    closeSheet(); render(); renderTimerBar();
    return lmin;
  }

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
  /* 长周期走计时也要给「推进量」那条鱼 —— 否则同样是推进了，走打卡给、走计时不给 */
  if(scope==='long'){
    var amtL = parseInt(meta.amount,10)||0;
    fish += awardLongProgress(task, amtL);
  }
  save(); closeSheet(); render(); renderTimerBar();
  toast('记下 '+minutes+' 分钟'+(fish?(' · +'+fish+' 🐟'):poolTail(0))+(scope==='daily'?'，今天已打卡 ✓':''));

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

/* ================= 娱乐 / 放纵 =================
   master：「加上娱乐事件和放纵事件的分类，休闲娱乐，放松心神。例如熬夜看番，吃一次肯德基，
   玩一场游戏的分类」—— 看番、肯德基、打一场游戏这类「我没在进步，但我在活着」的事，单独记一笔。
   两类的区别**由他自己定**：
     · fun   娱乐：放松心神（打一场游戏）
     · spree  放纵：明知道有点过（熬夜看番、一顿肯德基）
   ⚠️ **不发鱼也不扣鱼**（他选的）：记录是如实记一笔，不是"做事"；这 app 也不惩罚。
   ⚠️ 它的价值不在当天，而在**周报**里 —— 有它才能看出这周是偏松还是偏紧（见 weekBalance）。 */
var FUN_KINDS = {
  fun:   {label:'娱乐', emoji:'🎈', hint:'放松心神'},
  spree: {label:'放纵', emoji:'🍟', hint:'明知道有点过'}
};
/* 头一次用的时候给三个例子（照 master 自己举的），之后就换成他自己记过的 */
var FUN_SEED = [
  {text:'熬夜看番',     kind:'spree'},
  {text:'吃一次肯德基', kind:'spree'},
  {text:'玩一场游戏',   kind:'fun'}
];
function funToday(){
  var d = today();
  return (STATE.fun || []).filter(function(r){ return r.date === d; });
}
function funInWeek(wk){
  var end = addDays(wk, 7);
  return (STATE.fun || []).filter(function(r){ return r.date >= wk && r.date < end; });
}
/* 一周的娱乐/放纵统计（喂周报） */
function funStats(wk){
  var r = {fun:0, spree:0, total:0, items:[], byKind:{fun:[], spree:[]}};
  funInWeek(wk).forEach(function(x){
    var k = (x.kind === 'spree') ? 'spree' : 'fun';
    r[k]++; r.total++;
    r.byKind[k].push(x.text);
    r.items.push({kind:k, text:x.text, date:x.date});
  });
  return r;
}
/* 最近记过的几件事（去重、按时间倒序）→ 给「放开一下」卡当快捷按钮。
   这样第二次记「熬夜看番」只要点一下，不用再打字。 */
function funRecent(n){
  var seen = {}, out = [];
  (STATE.fun || []).slice().reverse().forEach(function(r){
    if(!r || !r.text || seen[r.text]) return;
    seen[r.text] = 1;
    out.push({text:r.text, kind: (r.kind === 'spree') ? 'spree' : 'fun'});
  });
  return out.slice(0, n || 4);
}

/* 今日页那张「放开一下」小卡 */
/* ================= 活动感知（主进程采集，这里只负责显示）=================
   「今天在干什么」：主进程每 sampleSec 秒采一次前台窗口，按 main.js 里的规则表归类，
   推快照过来。这里不采、不判类，只画 —— 规则要改去 main.js 的 ACT_RULES。 */
var ACT = null;
/* 各周的自动采集汇总：{ 'YYYY-MM-DD'(周一) : {byCatMin, funMin, funTop, totalMin, days, at} }
   —— 周报的松紧判断要读它（2026-10-09 master 决定：自动采到的娱乐时长**直接参与**判断） */
var ACT_WEEKS = {};
var ACT_WEEK_TTL = 10 * 60000;

var ACT_LABEL = { fun:'休闲娱乐', work:'工作学习', study:'学习充电', social:'社交沟通', other:'其他' };
var ACT_COLOR = { fun:'#d6627a', work:'#3b6fb0', study:'#8b6dff', social:'#bf8a16', other:'#9a8f80' };
var ACT_ORDER = ['fun', 'work', 'study', 'social', 'other'];

/* 进程名 → 他看得懂的名字。手机上是"微信/抖音"，这边原来直接甩 `Code.exe`。
   认不出来的就去掉 .exe 原样显示（不硬编） */
var APP_NAMES = {
  chrome:'Chrome', msedge:'Edge', firefox:'Firefox', brave:'Brave', opera:'Opera',
  code:'VS Code', devenv:'Visual Studio', idea64:'IntelliJ IDEA', pycharm64:'PyCharm',
  clion64:'CLion', goland64:'GoLand', webstorm64:'WebStorm', rider64:'Rider',
  cursor:'Cursor', ue4editor:'UE 编辑器', unrealeditor:'UE 编辑器', unity:'Unity',
  blender:'Blender', photoshop:'Photoshop', illustrator:'Illustrator',
  matlab:'MATLAB', keil:'Keil', stm32cubemx:'STM32CubeMX', origin:'Origin',
  winword:'Word', excel:'Excel', powerpnt:'PowerPoint', wps:'WPS',
  notepad:'记事本', notepadpp:'Notepad++', typora:'Typora', obsidian:'Obsidian',
  explorer:'文件管理器', applicationframehost:'（系统窗口）', systemsettings:'Windows 设置',
  windowsterminal:'Windows 终端', cmd:'命令提示符', conhost:'控制台',
  douyin:'抖音', bilibili:'哔哩哔哩', cloudmusic:'网易云音乐', qqmusic:'QQ 音乐',
  wechat:'微信', weixin:'微信', qq:'QQ', dingtalk:'钉钉', feishu:'飞书', lark:'飞书',
  telegram:'Telegram', discord:'Discord', steam:'Steam', steamwebhelper:'Steam',
  epicgameslauncher:'Epic', 'plain craft launcher 2':'PCL 启动器', java:'Java 程序',
  landing:'着陆', electron:'Electron 应用', wutheringwaves:'鸣潮', 'client-win64-shipping':'游戏',
  potplayermini64:'PotPlayer', potplayer:'PotPlayer', vlc:'VLC',
  acrobat:'Acrobat', 'acrord32':'Acrobat', sumatrapdf:'SumatraPDF',
  teamviewer:'TeamViewer', everything:'Everything', snipaste:'Snipaste'
};
/* 这些是"壳"进程，不是他在用的应用（跟手机的"主屏幕"一个性质） */
var APP_SHELL = /^(applicationframehost|textinputhost|shellexperiencehost|startmenuexperiencehost|searchhost|runtimebroker|widgets|widgetservice|lockapp|sihost|dwm|taskhostw|securityhealthsystray|gamebar|gamebarftserver|xboxgamebarwidgets|phoneexperiencehost|backgroundtaskhost|windowsterminal)$/i;

function appLabel(proc){
  var p = String(proc || '').trim();
  if(!p || /^idle$/i.test(p)) return '（没在用程序）';
  var k = p.replace(/\.exe$/i, '');
  return APP_NAMES[k.toLowerCase()] || APP_NAMES[k] || k;
}
/* 今天的应用排行：[{name, minutes, cat, shell}]，已按分钟降序 */
function appRanking(){
  if(!ACT || !ACT.byApp) return [];
  return ACT.byApp.map(function(x){
    var pr = String(x.proc || '');
    return { name: appLabel(pr), proc: pr, cat: x.cat || 'other',
             minutes: Math.round((x.ms || 0) / 60000),
             /* shell = 系统壳进程；idle = 压根没有前台窗口（人不在 / 只有桌面）。
                这两种都**不是他在用的应用**，不进 Top5，去"另有"那一行 */
             shell: APP_SHELL.test(pr), idle: /^idle$/i.test(pr) };
  }).filter(function(x){ return x.minutes >= 1; });
}

/* 拉某一周的自动采集汇总（周报要用）。
   ⚠️ 有 `_loading` 在就不会重复发；TTL 10 分钟。拿到数据后再 render 一次即止 —— 
      调用点里有一处在 render 里（viewWeekly），所以必须保证"有了就不再拉"，否则会转圈。 */
function ensureActWeek(wk){
  if(!window.landing || !window.landing.activity || !window.landing.activity.week) return;
  var cur = ACT_WEEKS[wk];
  if(cur && (cur._loading || (cur.at && Date.now() - cur.at < ACT_WEEK_TTL))) return;
  ACT_WEEKS[wk] = { _loading: true };
  window.landing.activity.week(wk, today()).then(function(s){
    s = s || {};
    s.at = Date.now();
    ACT_WEEKS[wk] = s;
    if(CUR_TAB === 'weekly') render();
  }).catch(function(){ ACT_WEEKS[wk] = { at: Date.now() }; });
}
function actWeekOf(wk){
  var w = ACT_WEEKS[wk];
  return (w && !w._loading) ? w : null;
}

function initActivity(){
  if(!window.landing || !window.landing.activity) return;   /* 网页版没有这套 */
  window.landing.activity.get().then(function(s){ ACT = s; render(); }).catch(function(){});
  if(window.landing.activity.onUpdate){
    window.landing.activity.onUpdate(function(s){ ACT = s; render(); });
  }
  /* 本周 + 上周都要：宠物回答「我上周干了什么」时也算上周的松紧 */
  ensureActWeek(weekKey());
  ensureActWeek(addDays(weekKey(), -7));
  /* 换应用 → 右下角问一句「这是在做什么」（2026-10-13 自动计时） */
  if(window.landing.activity.onAppChanged) window.landing.activity.onAppChanged(onAppChanged);
}

/* ================= 换应用 → 问一句 + 自动计时（2026-10-13）=================
   master 原话：「每次点计时有点麻烦……发现打开了不同的应用，
   右下角弹窗问『这是在做什么』，然后自动进行计时。」

   ⚠️ 判定"换了应用"用的是主进程的**前台窗口采样**（每 sampleSec 秒一次），**不是截图本身** ——
      截图默认 5 分钟一张，拿它判太粗；截图那条线照旧只负责存图。
   ⚠️ 自动计时**不新建数据模型**：直接走已有的「松散计时」（scope:'loose'），
      收尾时 commitStopwatchRecord 会把它写进 STATE.loose + 今天的鱼干池 + 周报投入。
      这也是它能跟「删掉任务模块」解耦的原因 —— 全程不碰任何任务。
   ⚠️ 只在他**没有手动计时**的时候才问：手动计时中 = 他自己知道在做什么，别插嘴。
   ⚠️ 主进程在切到桌面/没窗口时会推一条 `{idle:true}` —— 这就是"自动停"的信号，
      否则他去吃个饭，那段计时会一直跑。 */

var ASK = null;          /* 有值 = 右下角正显示询问卡 {proc,title,cat,name,known} */
var ASK_TIMER = null;    /* 没人理就自己收起来 */
var ASK_MUTE = {};       /* proc → 静音到什么时候（他点过「这次不用」） */

/* 应用 → 建议的「事情名」。只是**第一次问**时的默认值，避免弹出来一个空框；
   他改过/确认过之后就存进 STATE.appNames，以后直接用他的叫法。 */
var ACT_SUGGEST = {
  code:'写代码', cursor:'写代码', devenv:'写代码', idea64:'写代码', pycharm64:'写代码',
  clion64:'写代码', goland64:'写代码', webstorm64:'写代码', rider64:'写代码',
  ue4editor:'做游戏', unrealeditor:'做游戏', unity:'做游戏', blender:'做模型',
  keil:'调单片机', stm32cubemx:'调单片机', matlab:'跑仿真', origin:'画图',
  winword:'写文档', excel:'做表格', powerpnt:'做 PPT', wps:'写文档',
  typora:'写东西', obsidian:'整理笔记', notion:'整理笔记', notepad:'记东西',
  chrome:'查资料', msedge:'查资料', firefox:'查资料', brave:'查资料',
  bilibili:'看视频', douyin:'刷视频', cloudmusic:'听歌', qqmusic:'听歌',
  steam:'打游戏', wutheringwaves:'打游戏', 'client-win64-shipping':'打游戏',
  potplayer:'看视频', vlc:'看视频',
  wechat:'聊天', weixin:'聊天', qq:'聊天', dingtalk:'聊天', feishu:'聊天', discord:'聊天',
  explorer:'找文件'
};
/* 活动分类 → 宠物分类（loose 记录要一个 category，走 PET_CATS 那套） */
function actCatToPet(c){ return c==='work' ? 'work' : (c==='study' ? 'growth' : (c==='fun' ? 'fun' : 'life')); }

function autoNameOf(proc, cat){
  var raw = String(proc||'').trim();
  var key = raw.replace(/\.exe$/i, '').toLowerCase();
  var map = STATE.appNames || {};
  if(map[raw]) return map[raw];
  if(map[key]) return map[key];
  if(ACT_SUGGEST[key]) return ACT_SUGGEST[key];
  return ({work:'工作', study:'学习', fun:'玩', social:'聊天'})[cat] || appLabel(proc) || '这件事';
}

function askHostEl(){
  var el = $('askCard');
  if(!el){ el = document.createElement('div'); el.id='askCard'; el.className='askcard hidden'; document.body.appendChild(el); }
  return el;
}
function renderAsk(){
  var el = askHostEl();
  if(!ASK){ el.className = 'askcard hidden'; el.innerHTML = ''; return; }
  el.className = 'askcard';
  el.innerHTML =
    '<div class="ask-hd">👀 你在用 <b>' + esc(appLabel(ASK.proc)) + '</b></div>'
    + '<div class="ask-q">这件事记作什么？</div>'
    + '<input id="askName" type="text" maxlength="20" value="' + esc(ASK.name) + '" placeholder="例如：写代码">'
    + '<div class="ask-hint">' + (ASK.known ? '按你上次的叫法填好了，改一下也行' : '确认一次就记住，下次直接开始') + '</div>'
    + '<div class="ask-btns">'
    +   '<button class="btn primary sm" data-act="askGo">开始计时</button>'
    +   '<button class="btn ghost sm" data-act="askSkip">这次不用</button>'
    + '</div>';
  var inp = $('askName');
  if(inp){
    inp.onkeydown = function(e){ if(e.key === 'Enter'){ e.preventDefault(); App.askGo(); } };
    /* 只在窗口本来就是焦点的时候才自动聚焦 —— 他在别处打字时绝不抢光标 */
    if(document.hasFocus()){ try{ inp.focus(); inp.select(); }catch(e){} }
  }
}
/* 把正在跑的「自动计时」落账。只处理 auto 那一段，手动计时绝不碰。 */
function autoCommit(){
  var t = STATE.timer;
  if(!t || !t.auto || t.finished) return;
  var used = timerElapsedMs();
  if(used >= SW_MIN_MS) commitStopwatchRecord(Math.round(used/60000));
  else {
    STATE.timer = null;
    if(_timerTick){ clearInterval(_timerTick); _timerTick = null; }
    save(); renderTimerBar();
  }
}
function onAppChanged(inf){
  if(!inf) return;
  /* 1) 切到桌面/没窗口 → 这段自动计时收尾（"自动停"） */
  if(inf.idle){
    autoCommit();
    ASK = null; if(ASK_TIMER){ clearTimeout(ASK_TIMER); ASK_TIMER = null; }
    renderAsk();
    return;
  }
  /* 2) 换到别的应用 → 上一段自动计时收尾，再问新的 */
  if(STATE.timer && STATE.timer.auto && STATE.timer.autoProc !== inf.proc) autoCommit();

  /* 3) 手动计时中 / 关掉了询问 / 这个应用刚被拒绝过 → 不打扰 */
  if(STATE.timer && !STATE.timer.finished && !STATE.timer.auto) return;
  if(ACT && ACT.ask === false) return;
  if(ASK_MUTE[inf.proc] && Date.now() < ASK_MUTE[inf.proc]) return;

  ASK = { proc:inf.proc, title:inf.title||'', cat:inf.cat||'other',
          name:autoNameOf(inf.proc, inf.cat), known:!!((STATE.appNames||{})[inf.proc]) };
  renderAsk();
  if(ASK_TIMER) clearTimeout(ASK_TIMER);
}
function askClose(extra){
  if(ASK_TIMER){ clearTimeout(ASK_TIMER); ASK_TIMER = null; }
  ASK = null;
  renderAsk();
  if(extra) extra();
}
/* 采样条数 → 分钟（每条代表 sampleSec 秒） */
function actMinutes(){
  var m = {};
  if(!ACT) return m;
  /* 优先用主进程算好的**真实时长**（2026-10-09 加）；老快照没有这个字段时
     退回"条数 × 采样间隔"那套估算，免得版本不匹配时白屏 */
  if(ACT.byCatMin){
    return ACT.byCatMin;
  }
  Object.keys(ACT.byCat || {}).forEach(function(k){
    m[k] = Math.round((ACT.byCat[k] || 0) * (ACT.sampleSec || 60) / 60);
  });
  return m;
}
function fmtMin(m){
  m = Math.round(m || 0);
  if(m < 60) return m + ' 分钟';
  return Math.floor(m / 60) + ' 小时' + (m % 60 ? (m % 60) + ' 分' : '');
}
/* 没有活动窗口时进程名是 Idle —— 直接写出来他看不懂 */
function actProcLabel(p){
  return /^idle$/i.test(p || '') ? '（没有活动窗口）' : (p || '');
}
function fmtBytes(b){
  b = b || 0;
  if(b < 1024) return b + ' B';
  if(b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/* 今日页那张卡 */
function renderActivityCard(){
  if(!ACT) return '';
  var h = '<div class="card act-card"><div class="row between"><h2>👀 今天在干什么</h2>'
    + '<span class="muted" style="font-size:12px">' + (ACT.enabled ? '正在记录' : '已暂停') + '</span></div>';
  if(!ACT.enabled){
    h += '<div class="hint">已暂停。要开回来去「我的 → 活动记录」。</div></div>';
    return h;
  }
  if(!ACT.count){
    h += '<div class="hint">刚开起来，还没采到数据 —— 一分钟内就会出现。</div></div>';
    return h;
  }
  var mins = actMinutes();
  h += '<div class="act-bars">';
  var shown = 0;
  ACT_ORDER.forEach(function(k){
    if(!mins[k] || mins[k] < 1) return;
    shown++;
    h += '<div class="act-bar" style="--c:' + ACT_COLOR[k] + '"><b>' + fmtMin(mins[k]) + '</b><span>' + ACT_LABEL[k] + '</span></div>';
  });
  if(!shown) h += '<div class="hint">今天还没采到有效活动。</div>';
  h += '</div>';

  /* 按应用排行（手机那种"应用使用时间"）—— 只列真在前台用过的，壳进程不算 */
  var rk = appRanking().filter(function(x){ return !x.shell && !x.idle; });
  var totalMin = ACT.totalMin || 0;
  if(rk.length){
    var top = rk.slice(0, 5), maxMin = top[0].minutes || 1;
    h += '<div class="app-head"><span>今天记录 <b>' + fmtMin(totalMin) + '</b></span>'
      + (rk.length > 5 ? '<button class="btn ghost sm" data-act="actRank">看完整排行（' + rk.length + '）</button>' : '')
      + '</div><div class="app-rank">';
    top.forEach(function(x){
      h += '<div class="app-row"><span class="app-nm" title="' + esc(x.proc) + '">'
        + '<i style="background:' + (ACT_COLOR[x.cat] || ACT_COLOR.other) + '"></i>' + esc(x.name) + '</span>'
        + '<span class="app-tm">' + fmtMin(x.minutes) + '</span>'
        + '<span class="app-track"><b style="width:' + Math.max(3, Math.round(x.minutes / maxMin * 100)) + '%;background:'
        + (ACT_COLOR[x.cat] || ACT_COLOR.other) + '"></b></span></div>';
    });
    h += '</div>';
  } else if(totalMin >= 1){
    h += '<div class="hint">今天记录 ' + fmtMin(totalMin) + '，但都在系统窗口/桌面里。</div>';
  }
  if(ACT.last){
    h += '<div class="hint" style="margin-top:11px">刚才在：<b>' + esc(actProcLabel(ACT.last.proc)) + '</b>'
      + (ACT.last.title ? ' · ' + esc(String(ACT.last.title).slice(0, 44)) : '')
      + ' <span class="cat ' + (ACT.last.cat || 'other') + '">' + (ACT_LABEL[ACT.last.cat] || '其他') + '</span></div>';
  }
  /* 截图状态：**必须一路显化** —— 这是会碰到隐私的功能，藏起来就是错的 */
  h += '<div class="act-shot">'
    + '<span>📷 每 ' + ACT.shotMin + ' 分钟截一张：已 <b>' + (ACT.shots || 0) + '</b> 张 · ' + fmtBytes(ACT.bytes) + '</span>'
    + '<span>保留 ' + ACT.keepDays + ' 天 · 只存本机</span>'
    + '<button class="btn ghost sm" data-act="actFolder">打开文件夹</button>'
    + '<button class="btn ghost sm" data-act="actToggle">暂停记录</button>'
    + '</div></div>';
  return h;
}

/* 「我的」里的详细设置 */
function renderActivitySettings(){
  if(!ACT) return '';
  var h = '<div class="card"><div class="row between"><h2>👀 活动记录</h2>'
    + '<span class="muted" style="font-size:12px">' + (ACT.enabled ? '正在记录' : '已暂停') + '</span></div>'
    + '<div class="hint">看我此刻在用哪个程序（抓前台窗口的进程名和标题），并按规则归类。'
    + '全部在<b>本机</b>算、不上云；规则表在 <code>main.js</code> 的 <code>ACT_RULES</code>，想改分类改那里。</div>'
    + '<div class="field" style="margin-top:10px"><label>采样间隔（秒）</label>'
    + '<input id="act_sample" type="number" min="10" max="600" value="' + ACT.sampleSec + '"></div>'
    + '<div class="field"><label>截屏间隔（分钟，0 = 不截屏）</label>'
    + '<input id="act_shot" type="number" min="0" max="120" value="' + ACT.shotMin + '"></div>'
    + '<div class="field"><label>截图保留（天）</label>'
    + '<input id="act_keep" type="number" min="1" max="365" value="' + ACT.keepDays + '">'
    + '<div class="hint" style="margin-top:6px">过期的整天目录会自动删掉（每 6 小时扫一次，不用你管）。</div></div>'
    /* 换应用自动计时（2026-10-13）—— 这是「不用手点计时」的那条路，得在这儿显化 */
    + '<div class="hint" style="margin-top:10px">换应用自动计时：<b>' + (ACT.ask ? '开着' : '关了') + '</b>'
    + ' —— 发现你换了个程序，右下角问一句「这件事记作什么」，确认后自动开始；'
    + '切走或回到桌面就自动收尾，按「临时记一笔」进今天的池子和周报。<b>不碰任何任务。</b></div>'
    + '<div class="field" style="margin-top:10px"><label>问过之后的最短静默（分钟）</label>'
    + '<input id="act_cool" type="number" min="3" max="240" value="' + (ACT.askCoolMin || 15) + '">'
    + '<div class="hint" style="margin-top:6px">刚问过又换应用，这段时间内不再问，免得烦。同一个应用被你点过「这次不用」也静默一小时。</div></div>'
    + '<div class="act-shot" style="margin-top:4px">'
    + '<span>已 <b>' + (ACT.shots || 0) + '</b> 张 · ' + fmtBytes(ACT.bytes) + ' · 目录 ' + esc(ACT.dir || '') + '</span>'
    + '<button class="btn ghost sm" data-act="actFolder">打开文件夹</button>'
    + '<button class="btn ghost sm" data-act="actClearShots">清空截图</button>'
    + '</div>'
    + '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">'
    + '<button class="btn primary sm" data-act="actSave">保存设置</button>'
    + '<button class="btn ghost sm" data-act="actToggle">' + (ACT.enabled ? '暂停记录' : '开始记录') + '</button>'
    + '<button class="btn ghost sm" data-act="actAskToggle">' + (ACT.ask ? '关掉自动询问' : '打开自动询问') + '</button>'
    + '</div></div>';
  return h;
}

function renderFunCard(){
  var todays = funToday();
  var recent = funRecent(4);
  var quick = recent.length ? recent : FUN_SEED;
  var h = '<div class="card fun-card"><div class="row between"><h2>🎈 放开一下</h2>'
    + '<span class="muted" style="font-size:12px">今天 '+todays.length+' 笔</span></div>'
    + '<div class="hint">看番、肯德基、打一场游戏都算。<b>记下来不是认罪</b> —— '
    + '是为了让周报看出你这周偏松还是偏紧。不发小鱼干，也不扣。</div>'
    + '<div class="fun-quick">';
  quick.forEach(function(q){
    var k = FUN_KINDS[q.kind] ? q.kind : 'fun';
    h += '<button class="fun-q k-'+k+'" data-act="funQuick" data-text="'+esc(q.text)+'" data-kind="'+k+'">'
      + FUN_KINDS[k].emoji + ' ' + esc(q.text) + '</button>';
  });
  h += '</div>'
    + '<div class="fun-inrow"><input id="funIn" maxlength="24" placeholder="刚干了什么…">'
    + '<button class="btn ghost sm" data-act="funAdd" data-kind="fun">🎈 娱乐</button>'
    + '<button class="btn ghost sm" data-act="funAdd" data-kind="spree">🍟 放纵</button>'
    + '</div>';
  if(todays.length){
    h += '<div class="fun-list">';
    todays.forEach(function(r){
      var k = (r.kind === 'spree') ? 'spree' : 'fun';
      h += '<span class="fun-tag k-'+k+'">'+esc(r.text)
        + '<button class="fun-x" data-act="funDel" data-id="'+r.id+'" title="删掉">×</button></span>';
    });
    h += '</div>';
  }
  return h + '</div>';
}

/* ================= 小鱼干 & 记忆库 =================
   🔴 规则（2026-09-20 master 重定，别再按"单次满 60 分钟"写）：
   老规则是「单次完成 ≥60 分钟 → 1~3 条」，结果**短任务永远拿不到鱼** ——
   跑步 30 分钟、背词 15 分钟结算下来都是 0，每周任务和长周期任务形同不发。
   现在改成**全局累计池**：
     · 每次记录的任务时长都倒进同一个池子（三类任务共用一个池）
     · 每满 60 分钟发 1 条，满一次给一次（120 分钟 = 2 条）
     · 不足 60 分钟的零头**当天清零**，不往明天滚
   所以「跑步 30 + 背词 20 + 长周期 10」也能凑出 1 条 —— 攒得起来才有反馈。
   另外两条（master 明确要的）：
     · 长周期任务的**推进量**（个/页/词）也算：每推进一次额外 +1 条（"别的计数单位一次一给"）
     · 长周期的「过半 / 完成」里程碑：+2 / +5 条（一次性，靠 `_milestoneHalf/_milestoneDone` 挡重复） */
var POOL_MIN = 60;

/* 今天的池子。跨天第一次调用就倒掉 —— 这就是"每天清除积累的时间" */
function poolState(){
  if(!STATE.fishPool || typeof STATE.fishPool !== 'object') STATE.fishPool = {date:'', minutes:0};
  var p = STATE.fishPool;
  if(p.date !== today()){ p.date = today(); p.minutes = 0; }
  if(typeof p.minutes !== 'number' || p.minutes < 0) p.minutes = 0;
  return p;
}
/* 今天池子里的进度（给界面显示用，不产生副作用）
   ⚠️ `classMin` 是**今天课表那部分**的分钟数 —— 它早就整块倒进池子并结算掉了，
   所以池子里的"零头"看起来会偏小（上满 8 节 = 360 分钟，正好被扣成 0）。
   界面上必须把它显示出来，否则他会以为"我上了 8 节课怎么池子是 0"。 */
function poolProgress(){
  var p = poolState();
  return {minutes:Math.round(p.minutes), need:POOL_MIN,
          classMin:classMinutesOn(new Date()), classPeriods:classPeriodsOn(new Date())};
}
/* ================= 松散时长（不挂任务的一笔）=================
   master 2026-10-09：「从 0 到有直接记入一个任务但不创建，直接记入时间积累池和周报总结中」。
   所以「我想玩一会杀戮尖塔」= 记时间，**不是**建任务；只有他明确说「建个任务」才真建。 */
function looseToday(){
  return (STATE.loose||[]).filter(function(r){ return r.date === today(); });
}
function looseRecord(name, minutes, category){
  name = String(name||'').trim().slice(0, 30);
  var m = Math.max(0, Math.round(Number(minutes)||0));
  if(!name || m <= 0) return null;
  var rec = {id:uid('ls'), date:today(), name:name, minutes:m,
             category:(PET_CATS.indexOf(category)>=0 ? category : 'life'), ts:Date.now()};
  STATE.loose = STATE.loose || [];
  STATE.loose.push(rec);
  awardFish(m, rec.name);        /* 进今天的池子，满了发鱼（跟正常打卡同一条路） */
  addMemory('loose', '记了 '+m+' 分钟：'+rec.name, [catName(rec.category)]);
  save();
  return rec;
}
function looseDel(id){
  var r = (STATE.loose||[]).find(function(x){ return x.id===id; });
  STATE.loose = (STATE.loose||[]).filter(function(x){ return x.id!==id; });
  save(); render();
  if(r) toast('删掉了「'+r.name+'」那 '+r.minutes+' 分钟（池子里的鱼不回收）');
}

/* 把这次花的时间倒进池子；满了就发鱼。返回发了多少条 */
function feedFishPool(minutes, reason){
  var m = Math.round(Number(minutes)||0);
  if(m <= 0) return 0;
  var p = poolState();
  p.minutes += m;
  var n = 0;
  while(p.minutes >= POOL_MIN){ p.minutes -= POOL_MIN; n++; }
  if(!n) return 0;
  return grantFish(n, (reason ? reason+' · ' : '')+'累计满 '+POOL_MIN+' 分钟'+(n>1?('×'+n):''));
}
function petState(){
  if(!STATE.pet) STATE.pet = {};
  if(STATE.pet.fish===undefined) STATE.pet.fish=0;
  return STATE.pet;
}
/* 🔴 调宠物侧回调时必须包一层（2026-09-20 血案）：
   `init()` 开头的里程碑结算会走到 grantFish → Pet.onFish → Pet.ensure()，
   而那时 pet.js 还没 boot（它的 `L` 是 null）→ 抛错 → **整个 init() 中断**，
   而 `window.App` / `window.Landing` 的赋值在 init() 末尾 → 双双 undefined，
   结果就是**白屏**（#view 空的、挂件不存在）。触发条件只是"长周期任务已过半"。
   宠物是"顺带长"的旁路，它没就绪绝不该影响核心流程 —— 所有 Pet 回调一律走这里。 */
function petNotify(fn, a, b){
  try{
    if(window.Pet && typeof Pet[fn] === 'function') return Pet[fn](a, b);
  }catch(e){
    try{ console.warn('[app] 宠物侧回调 '+fn+' 失败（已忽略）', e); }catch(_){}
  }
  return undefined;
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
  petNotify('onFish', n, reason);
  return n;
}
function awardFish(minutes, reason){
  petNotify('onRecord', minutes);
  return feedFishPool(minutes, reason);
}
/* 长周期任务的推进量（个/页/词）单独算一条鱼：每推进一次 +1（"别的计数单位一次一给"）。
   ⚠️ **必须设单日上限**：推进量是他自己填的，没有时长的天然约束 ——
      不封顶的话连点"确认打卡"就能刷鱼，那就不是奖励是漏洞了。
      3 次覆盖得住真实的分段学习（早/午/晚各一段）。
   ⚠️ 调用点必须**先 push 记录再调**（按今天的推进次数判上限）。 */
var LONG_PROGRESS_CAP = 3;
function awardLongProgress(g, amt){
  var n = Math.round(Number(amt)||0);
  if(!g || n<=0) return 0;
  var cnt = (g.records||[]).filter(function(r){
    return r.date===today() && (Number(r.amount)||0)>0;
  }).length;
  if(cnt > LONG_PROGRESS_CAP) return 0;
  return grantFish(1, g.name+' · 推进 '+n);
}
/* 自定义型每周任务（不记时长）的"完成"没有量可言，一天点几次都只是重复标记
   → 同一天只算一次完成，只给 1 条。同样要求先 push 再调。 */
function awardWeeklyTap(w){
  if(!w) return 0;
  var cnt = (w.records||[]).filter(function(r){ return r.date===today(); }).length;
  if(cnt > 1) return 0;
  return grantFish(1, w.name+' · 完成打卡');
}
function addMemory(kind, text, tags){
  STATE.memories = STATE.memories||[];
  STATE.memories.push({id:uid('m'), at:Date.now(), kind:kind||'note', text:text, tags:tags||[]});
  if(STATE.memories.length>1000) STATE.memories.splice(0, STATE.memories.length-1000);
}
var MEM_KIND = {chat:'对话', feed:'投喂', pet:'抚摸', task:'任务', timer:'专注', fish:'小鱼干', milestone:'里程碑', note:'随手记', daily:'每日', rest:'休息', fun:'放开', loose:'临时'};
/* 宠物用工具能碰的东西（白名单）。'loose' 是「直接记一笔时长」—— 不建任务 */
var PET_CATS = ['fun', 'work', 'life', 'growth'];

/* ================= 赛博伙伴：活力全部来自你已经做的事 ================= */
/* 设计原则：不新增「喂猫」任务。你倾倒、打卡、完成一件，它自然长。
   你没来，它不惩罚，只是「有点想你」。底线 12 分，永远不会归零或枯萎。 */
function catLandingDays(){
  var days = {};
  STATE.dumps.forEach(function(d){
    if(d.createdAt) days[ymd(new Date(d.createdAt))] = 1;
  });
  STATE.weather.forEach(function(w){ if(w.date) days[w.date] = 1; });
  var n = 0, cur = today(), guard = 0;
  /* 今天正在休息 → 从昨天接着数。
     否则休息当天会显示成 0，那就成了"休息 = 连续天数归零"，跟这个功能的初衷正好相反。 */
  while(isRestDay(cur) && guard++ < 4000) cur = addDays(cur,-1);
  /* 夹在中间的休息日：链条照旧往下走，但**不计入**。
     算成打卡 → 数字虚高，自己知道是假的，这数字就废了；
     直接断掉 → 等于惩罚休息。冻结是唯一诚实的做法。 */
  while((days[cur] || isRestDay(cur)) && guard++ < 4000){
    if(days[cur]) n++;
    cur = addDays(cur,-1);
  }
  return n;
}

/* ================= 休息日 =================
   为什么要有这个：连续着陆天数、长周期自动暂停、日常未打卡、宠物心情衰减
   这四处都会因为你休息一天而"惩罚"你。四个都得堵上，缺一个这功能就是假的。

   但休息不能变成"跳过" —— 一按所有红色消失，按第七次这个 app 就没说服力了。
   所以它是"记账"：
     · 一个自然日只能记一次，写进 restDays，并写一条记忆留痕
     · 没有撤销入口（有代价的行为才有信息量）
     · 连续天数"冻结"：不减，也不算成打卡（不算成打卡是为了不自欺、不吹牛）
     · 休息日给宠物回点精力/心情（休息本来就该恢复）
     · 连续休息递减，免得变成刷数值的手段
   补记只能往回（最多 7 天），绝不往未来标 —— "下周三我要休息"只会变成提前找退路。 */
function isRestDay(d){ return (STATE.restDays||[]).indexOf(d) >= 0; }
function isRestToday(){ return isRestDay(today()); }
function restTotal(){ return (STATE.restDays||[]).length; }

function takeRestDay(d){
  d = d || today();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if(d > today()) return false;              /* 不许往未来标 */
  STATE.restDays = STATE.restDays || [];
  if(STATE.restDays.indexOf(d) >= 0) return false;   /* 一天只能记一次 */
  STATE.restDays.push(d);
  STATE.restDays.sort();
  addMemory('rest', '给这天记了休息：'+d+(d===today()?'（今天）':'（补记）'), ['休息']);
  save();
  petNotify('onRestDay', d);   /* 休息了就该回点血（失败也不能拦着记休息） */
  return true;
}

/* ================= 软着陆：休息之后的回归日 =================
   真正让人放弃的瞬间，不是休息那天，是**休完第二天早上打开 app 那一刻**。
   迎面一句"你有 5 项待办、3 个未达标"，昨天那一天就白休了。

   所以回归日做两件事：
     1. 顶部换成一句话 + 一个按钮，直接指向「今天一件事」（不铺开待办）
     2. 把「今天还没动」那块收起来 —— 它是纯粹的待办压力源
   其余功能照常（快捷打卡、倾倒台、情绪气象都还在）：不是把 app 伪装成坏掉的样子，
   只是换个入口。他点「看全部待办」就（本次会话内）恢复原样，选择权留给他。
   只影响这一天：判断条件是"昨天是休息日"，过了零点自然消失。 */
/* 他点了「看全部待办」就把今天标记掉 —— 存进 STATE 而不是内存变量，
   否则刷新/重开 app 那张卡又冒出来，等于没听他的。 */

/* 昨天往前连着休息了几天（不含今天） */
function restStreakBeforeToday(){
  var n = 0, cur = addDays(today(),-1);
  while(isRestDay(cur) && n < 60){ n++; cur = addDays(cur,-1); }
  return n;
}
/* 今天是回归日吗：昨天在休息、今天不是（今天还休就没必要"回来"），且他没点过"看全部" */
function isSoftLanding(){
  return STATE.softLandOff !== today() && !isRestToday() && restStreakBeforeToday() > 0;
}
function softLandingCard(){
  var d = restStreakBeforeToday();
  return '<div class="card"><h2>🌤 回来了</h2>'
    + '<div class="hint">' + (d === 1 ? '昨天休息得怎么样？' : ('你歇了 ' + d + ' 天，欢迎回来。')) + '</div>'
    + '<div class="hint">不用补昨天的，也不用追进度。今天挑一件最小的开始就行 —— 做了算数，不做也算数。</div>'
    + '<div class="row" style="align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px">'
    + '<button class="btn primary sm" data-act="softLandOne">挑今天的一件事</button>'
    + '<button class="btn ghost sm" data-act="softLandShowAll">看全部待办</button>'
    + '</div></div>';
}

/* 补记入口：最近 7 天里还没记过的、最多显示 3 个，别把界面塞满 */
function pastRestChips(){
  var out = [];
  for(var i=1;i<=7 && out.length<3;i++){
    var d = addDays(today(),-i);
    if(isRestDay(d)) continue;
    out.push('<button class="btn ghost sm" data-act="restPast" data-date="'+d+'">'+d.slice(5)+'</button>');
  }
  if(!out.length) return '';
  return '<span style="margin-left:7px">补前几天：</span>' + out.join(' ');
}

function catVitality(){
  var v = 12;                                    /* 底线：它一直在 */
  var ts0 = new Date(); ts0.setHours(0,0,0,0);
  var dumped = STATE.dumps.filter(function(d){ return d.createdAt >= ts0.getTime(); }).length;
  v += Math.min(dumped*12, 24);                  /* 倾倒焦虑 */
  var checked = mustTodayStats().done;
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

/* ================= 今日天气 ================= */
/* 数据由主进程代取（见 main.js 的 weather:get）：ip-api 定位 → Open-Meteo 取天气。
   缓存放在 STATE.wx，30 分钟内不重复请求；取不到就静默降级，不弹窗打扰。
   ⚠️ 字段叫 wx 不叫 weather —— STATE.weather 已经被「情绪气象」占用了。 */
var WX_TTL = 30 * 60 * 1000;
var _wxBusy = false;

/* WMO 天气码 → [图标, 中文]（Open-Meteo 用的就是这套码） */
var WX_CODES = {
  0:['☀️','晴'], 1:['🌤️','基本晴'], 2:['⛅','局部多云'], 3:['☁️','阴'],
  45:['🌫️','雾'], 48:['🌫️','雾凇'],
  51:['🌦️','毛毛雨'], 53:['🌦️','毛毛雨'], 55:['🌦️','毛毛雨'],
  56:['🌧️','冻毛毛雨'], 57:['🌧️','冻毛毛雨'],
  61:['🌦️','小雨'], 63:['🌧️','中雨'], 65:['🌧️','大雨'],
  66:['🌧️','冻雨'], 67:['🌧️','冻雨'],
  71:['🌨️','小雪'], 73:['🌨️','中雪'], 75:['❄️','大雪'], 77:['🌨️','米雪'],
  80:['🌦️','阵雨'], 81:['🌧️','阵雨'], 82:['⛈️','强阵雨'],
  85:['🌨️','阵雪'], 86:['❄️','阵雪'],
  95:['⛈️','雷阵雨'], 96:['⛈️','雷暴冰雹'], 99:['⛈️','雷暴冰雹']
};
function wxInfo(code){ return WX_CODES[code] || ['🌡️','—']; }
function wxNum(v, suf){
  return (v===null || v===undefined || isNaN(v)) ? '' : (Math.round(v) + (suf||''));
}
function wxFresh(){
  var w = STATE.wx;
  return !!(w && w.ok && w.at && (Date.now() - w.at) < WX_TTL);
}
function ensureWx(force){
  if(_wxBusy) return;
  if(!force && wxFresh()) return;
  if(!window.landing || !window.landing.weather) return;   /* 网页版没有这个桥：静默跳过 */
  _wxBusy = true;
  window.landing.weather.get().then(function(res){
    _wxBusy = false;
    if(!res) return;
    var prev = STATE.wx || {};
    var pc = prev.current || {}, rc = res.current || {};
    STATE.wx = res;
    save();
    /* 数据真的变了才重绘，别打断他正在做的事 */
    var changed = prev.ok !== res.ok
      || Math.round(pc.temperature_2m) !== Math.round(rc.temperature_2m)
      || pc.weather_code !== rc.weather_code;
    if(changed && CUR_TAB === 'today') render();
  }).catch(function(){ _wxBusy = false; });
}
function renderWxBar(){
  var w = STATE.wx;
  if(!w) return '';
  if(!w.ok){
    return '<div class="wxbar"><span class="wx-emoji">🌡️</span>'
      + '<span class="wx-desc">天气没取到</span>'
      + '<button class="wx-retry" data-act="wxRetry">重试</button></div>';
  }
  var cur = w.current || {}, d = w.daily || {};
  var info = wxInfo(cur.weather_code);
  var hi = (d.temperature_2m_max || [])[0], lo = (d.temperature_2m_min || [])[0];
  var range = (wxNum(hi) && wxNum(lo)) ? (wxNum(hi) + '° / ' + wxNum(lo) + '°') : '';
  return '<div class="wxbar">'
    + '<span class="wx-emoji">' + info[0] + '</span>'
    + '<span class="wx-temp">' + wxNum(cur.temperature_2m) + '°</span>'
    + '<span class="wx-desc">' + info[1] + '</span>'
    + '<span class="wx-city">' + esc(w.city || '') + '</span>'
    + (range ? '<span class="wx-range">' + range + '</span>' : '')
    + '</div>';
}

/* ================= 教务系统课表 ================= */
/* 数据由主进程代取（见 main.js 的 jwgl:* IPC）—— 教务系统是 http 站点，渲染进程被 CSP 挡着。
   学校开着验证码，所以第一次要在设置里填一次；之后主进程存着会话，重启也不用重来。
   这里只负责：缓存 → 渲染 → 驱动登录表单。 */
var SCHED_TTL = 30 * 60 * 1000;
var _schedBusy = false;
var _jwglNeedLogin = false;   /* 确认过「没连过 / 会话过期」，今日页才给入口 */
var _jwglCaptcha = '';        /* 登录表单当前用的验证码图（data URL） */
var _jwglBusy = false;
var _jwglStatus = {};         /* 主进程返回的教务系统状态快照 */

function hasJwglBridge(){
  return !!(window.landing && window.landing.jwgl);
}
function refreshJwglStatus(){
  if(!hasJwglBridge()) return Promise.resolve(_jwglStatus);
  return window.landing.jwgl.status().then(function(st){
    _jwglStatus = st || {};
    return _jwglStatus;
  }).catch(function(){ return _jwglStatus; });
}
function dayOfWeek(d){
  var t = d ? new Date(d) : new Date();
  return t.getDay() === 0 ? 7 : t.getDay();     /* 1=周一 … 7=周日 */
}
function schedFresh(){
  var s = STATE.schedule;
  return !!(s && s.at && (Date.now() - s.at) < SCHED_TTL);
}
function ensureSchedule(force){
  if(_schedBusy) return;
  if(!force && schedFresh()) return;
  if(!hasJwglBridge()) return;
  _schedBusy = true;
  window.landing.jwgl.schedule(!!force).then(function(res){
    _schedBusy = false;
    if(!res) return;
    if(res.ok){
      STATE.schedule = {
        at: Date.now(),
        termCode: res.termCode || '',
        source: res.source || '',
        items: res.items || []
      };
      _jwglNeedLogin = false;
      save();
      /* 刚同步到的课表也要立刻算进今天的投入/小鱼干（幂等，只倒增量） */
      try{ settleClassFish(); }catch(e){ try{ console.warn('[app] 上课时间结算失败（已跳过）', e); }catch(_){} }
      if(CUR_TAB === 'today') render();
    } else if(res.needLogin){
      _jwglNeedLogin = true;
      if(CUR_TAB === 'today') render();
    }
  }).catch(function(){ _schedBusy = false; });
}
/* --- 教学周：算出「这周是第几周」，并按周次表达式判断这周上不上 --- */
/* 🔴 学期起点必须是**固定日期**，绝不能相对"今天"反推（2026-09-21 血案，master 亲自问到）：
   原来 termStart() 每次都用「今天所在的那个周一 − (DEFAULT_WEEK−1) 周」重算，
   于是 currentWeek() = (周一(今天) − 周一(起点)) / 7 + 1 **恒等于 DEFAULT_WEEK** ——
   周数在数学上永远停在 3 涨不上去。原话：「今天已经星期一了，为什么课表没有迭代到第四周」。
   现在：起点是下面这个绝对日期，落在 STATE.termStart，之后每周自然 +1。
   锚点依据：master 两次确认 —— 09-18（周五）是第 3 周、09-21（周一）是第 4 周，两条都指向 08-31。
   ⚠️ 教务接口**不返回学期起始日期**（响应里 rqazcList 是空数组、dateDigit 只是查询当天、
      oldzc 是周次位掩码），所以只能本地锚。万一不准，去「我的 → 设置 → 教学周起点」改。
   ⚠️ 别把它塞进 STATE.schedule —— 那个快照每次同步都被整体替换，会被冲掉。 */
var TERM_START = '2026-08-31';   /* 第 1 周的周一 */
function mondayOf(d){
  var t = new Date(d); t.setHours(0,0,0,0);
  var wd = t.getDay() === 0 ? 7 : t.getDay();
  t.setDate(t.getDate() - (wd - 1));
  return t;
}
/* 第 1 周的周一 */
function termStart(){
  var d = parseYmd(STATE.termStart || TERM_START);
  if(isNaN(d.getTime())) d = parseYmd(TERM_START);
  if(isNaN(d.getTime())) d = new Date();
  return mondayOf(d);
}
function currentWeek(){
  var d0 = mondayOf(termStart()), d1 = mondayOf(new Date());
  return Math.floor((d1 - d0) / 604800000) + 1;
}

/* ================= 课表时间 = 学习时间 =================
   master：「把课表占的时间也算学习时间」。
   课表接口**只给节次不给时间**（1~12 节），所以按「一节 45 分钟」折算（他确认的口径）。
   这块是**唯一不需要他手动记录**的投入来源 —— 课表本身就推得出来。
   ⚠️ 口径是「**占用时间**」：当天的课不管上没上完都算（他明确选了"全算"）。
   ⚠️ 先按**节次去重**再折算，别把同一天重叠的课重复计（万一教务数据里有撞课）。 */
var CLASS_MIN_PER_PERIOD = 45;
function weekOfDate(d){                     /* 某个日期属第几教学周 */
  var d0 = mondayOf(termStart()), d1 = mondayOf(d || new Date());
  return Math.floor((d1 - d0) / 604800000) + 1;
}
/* 某天的课（按该天的教学周过滤）；todayCourses() 是它的特例 */
function coursesOn(d){
  var s = STATE.schedule;
  if(!s || !s.items) return [];
  var wd = dayOfWeek(d), w = weekOfDate(d);
  return s.items.filter(function(c){
    return c.weekday === wd && weekHit(c.weeks, w);
  }).sort(function(a, b){ return periodNum(a.periods) - periodNum(b.periods); });
}
/* 一批课占掉多少**节**（按节次去重）。wd 传了就只看那一天。
   🔴 注意「课的门数」≠「节数」：他每门课都占 2 课时（"1-2"、"3-4"），
      4 门课 = 8 节。以前卡片上写"4 节"就是把门数当节数了（2026-09-21 master 指出）。 */
function classPeriodsOf(items, wd){
  var set = {}, re = /(\d+)\s*[-~－]\s*(\d+)/, re1 = /(\d+)/;
  (items || []).forEach(function(c){
    if(wd && c.weekday !== wd) return;
    var s = String(c.periods || ''), m = re.exec(s);
    if(m){ for(var k = +m[1]; k <= +m[2]; k++) set[k] = 1; }
    else { var n = re1.exec(s); if(n) set[+n[1]] = 1; }
  });
  return Object.keys(set).length;
}
function classPeriodsOn(d){
  return classPeriodsOf(coursesOn(d));
}
/* 某一整周占掉多少节（按「星期几 + 节次」去重，别把同一天重叠加起来） */
function classPeriodsInWeek(w){
  var items = weekCourses(w), n = 0;
  for(var d = 1; d <= 7; d++) n += classPeriodsOf(items, d);
  return n;
}
function classMinutesOn(d){
  return classPeriodsOn(d) * CLASS_MIN_PER_PERIOD;
}
/* 上课时间发鱼（master 确认要发）。当天的课表分钟数是固定值，所以必须**幂等**：
   记下今天已经结算过多少分钟，只把增量倒进池子。
   ⚠️ 故意不走 awardFish —— 那条会给宠物加元气，上课天天自动来一大笔，宠物就没养头了。
      鱼照发、统计照进，只是不额外加元气。 */
function settleClassFish(){
  var d = today();
  if(!STATE.classFish || typeof STATE.classFish !== 'object') STATE.classFish = {date:'', minutes:0};
  var st = STATE.classFish;
  if(st.date !== d){ st.date = d; st.minutes = 0; }
  var total = classMinutesOn(d);
  var delta = total - (st.minutes || 0);
  if(delta <= 0) return 0;
  st.minutes = total;
  return feedFishPool(delta, '上课');
}
/* 周次表达式 → 这周上不上。见过的格式：1-16周 / 1-16周(单) / 1-8周,10-16周 / 第3周
   ⚠️ 认不出来时**一律返回 true**（宁可多显示一节，也别把要上的课藏了） */
function weekHit(weeks, w){
  var s = String(weeks || '');
  if(!s) return true;
  if(/单/.test(s) && w % 2 !== 1) return false;
  if(/双/.test(s) && w % 2 !== 0) return false;
  var hit = false, any = false, m;
  var re = /(\d+)\s*[-~－]\s*(\d+)/g;
  while((m = re.exec(s))){ any = true; if(w >= +m[1] && w <= +m[2]) hit = true; }
  var rest = s.replace(/\d+\s*[-~－]\s*\d+/g, ' ');
  var re2 = /(\d+)/g;
  while((m = re2.exec(rest))){ any = true; if(+m[1] === w) hit = true; }
  return any ? hit : true;
}
function periodNum(p){
  var m = /(\d+)/.exec(String(p || ''));
  return m ? +m[1] : 99;
}
/* 课程色：按名字取一个稳定色相 —— 同一门课永远是同一个颜色，今天明天看起来都认识 */
var SCHED_HUES = [210, 12, 145, 42, 268, 190, 330, 96];
function courseHue(name){
  var h = 0, s = String(name || '');
  for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
  return SCHED_HUES[h % SCHED_HUES.length];
}
function todayCourses(){
  return coursesOn(new Date());
}
/* ============ 各周课表 ============
   今日页那张卡只给「今天 + 本周要上的」，保持不变；想知道任意一周长什么样，
   从课表卡右上角的「各周课表」进来。 */
var _schedWeek = 0;                       /* 0 = 没选过，打开时默认跳到本周 */
var WEEK_NAMES = ['一','二','三','四','五','六','日'];
/* 周数上限：优先信课表里写的最大周次，但不少于 16 也不少于当前周（别把后面的周切没了） */
function schedMaxWeek(){
  var items = (STATE.schedule && STATE.schedule.items) || [];
  var mx = 0, m, re = /(\d+)/g;
  items.forEach(function(c){
    var t = String(c.weeks || ''); re.lastIndex = 0;
    while((m = re.exec(t))){ var n = +m[1]; if(n > mx && n <= 30) mx = n; }
  });
  mx = Math.max(mx, currentWeek(), 16);
  return Math.min(mx, 24);
}
/* 第 w 周的周一 */
function weekMonday(w){
  var d = mondayOf(termStart());
  d.setDate(d.getDate() + (w - 1) * 7);
  return d;
}
function mdShort(d){ return (d.getMonth() + 1) + '/' + d.getDate(); }
/* 第 w 周要上的课（不按天分，全周） */
function weekCourses(w){
  var s = STATE.schedule;
  if(!s || !s.items) return [];
  return s.items.filter(function(c){ return weekHit(c.weeks, w); });
}
/* 节次行：取本学期出现过的所有节次，去重排序。
   ⚠️ 用**全部**课而不是某周的课 —— 不然换一周网格行数会跳来跳去，看着像坏了 */
/* 节次区间：'1-4' → [1,4]；'9' → [9,9]；认不出来 → null */
function periodRange(s){
  s = String(s || '');
  var m = /(\d+)\s*[-~－]\s*(\d+)/.exec(s);
  if(m) return [+m[1], +m[2]];
  var n = /(\d+)/.exec(s);
  return n ? [+n[1], +n[1]] : null;
}
function rangesOverlap(a, b){ return !!(a && b && a[0] <= b[1] && b[0] <= a[1]); }
/* 「各周课表」网格的行 = **固定的 2 节一行**（1-2 / 3-4 / 5-6 / 7-8 / 9-10 …）。
   🔴 以前是"把课表里出现过的 periods 字符串直接当行"，于是左边那列会混进
      「1-4 节」「1-8 节」「5-8 节」这种**假行**（2026-09-21 master 截图指出：
      "这个节数很奇怪，按道理只有从 1 到 8 节，加上偶尔晚上的课最多 1-10 节"）。
   行数按本学期出现过的**最大节次**决定，所以换周不会跳来跳去。 */
function schedPeriodRows(){
  var items = (STATE.schedule && STATE.schedule.items) || [];
  var maxP = 0;
  items.forEach(function(c){
    var r = periodRange(c.periods);
    if(r) maxP = Math.max(maxP, r[1]);
  });
  if(maxP <= 0) maxP = 8;
  var rows = [];
  for(var a = 1; a <= maxP; a += 2) rows.push(a + '-' + (a + 1));
  return rows;
}
function schedWeekHTML(w){
  var cur = currentWeek(), maxW = schedMaxWeek();
  var list = weekCourses(w), rows = schedPeriodRows();
  var mon = weekMonday(w);
  var h = '<h2>📅 第 ' + w + ' 周课表'
    + (w === cur ? ' <span class="wk-cur">本周</span>' : '') + '</h2>'
    + '<div class="hint" style="margin:0 0 12px">' + mdShort(mon) + ' – '
    + mdShort(new Date(mon.getTime() + 6 * 86400000))
    + ' · 这周 ' + classPeriodsInWeek(w) + ' 节 · 约 ' + (classPeriodsInWeek(w) * CLASS_MIN_PER_PERIOD) + ' 分钟</div>';

  /* 周选择条：有课的周实心，没课的周淡化 —— 一眼看出哪几周是空的 */
  h += '<div class="wk-bar">';
  for(var i = 1; i <= maxW; i++){
    var n = weekCourses(i).length;
    h += '<button class="wk-chip' + (i === w ? ' on' : '') + (n ? '' : ' off')
      + '" data-act="schedWeeks" data-w="' + i + '">' + i + '</button>';
  }
  h += '</div>';

  if(!list.length){
    h += '<div class="hint">第 ' + w + ' 周整周都没课。</div>';
  } else {
    var maxP = periodRange(rows[rows.length - 1])[1];
    h += '<div class="wk-scroll"><div class="wk-table">';
    /* ⚠️ 必须**显式**写 grid-column / grid-row：下面有跨行的课块，
       一旦依赖自动排布，被跨行块跳过的格子会让同一行后面的列整体左移（列和星期就错位了） */
    h += '<div class="wk-c" style="grid-column:1;grid-row:1"></div>';
    for(var d = 0; d < 7; d++){
      var dd = new Date(mon.getTime() + d * 86400000);
      h += '<div class="wk-th' + (ymd(dd) === today() ? ' today' : '') + '" style="grid-column:' + (d + 2) + ';grid-row:1">周'
        + WEEK_NAMES[d] + '<span>' + mdShort(dd) + '</span></div>';
    }
    var covered = {};   /* "行:星期" → 已被上面的跨行块占掉 */
    rows.forEach(function(p, ri){
      var gr = ri + 2, pr = periodRange(p);
      h += '<div class="wk-tp" style="grid-column:1;grid-row:' + gr + '">' + esc(p) + ' 节</div>';
      for(var wd = 1; wd <= 7; wd++){
        if(covered[ri + ':' + wd]) continue;          /* 被跨行块覆盖了，不再补空格 */
        /* 按**跨度重叠**取课：'1-4' 的课会落在 1-2 和 3-4 两行里 */
        var cs = list.filter(function(c){
          return c.weekday === wd && rangesOverlap(periodRange(c.periods), pr);
        });
        if(!cs.length){
          h += '<div class="wk-cell" style="grid-column:' + (wd + 1) + ';grid-row:' + gr + '"></div>';
          continue;
        }
        /* 这个格子往下占几行：取本格里跨度最长的那门课 */
        var spanRows = 1;
        cs.forEach(function(c){
          var r = periodRange(c.periods);
          if(!r) return;
          var endRow = Math.ceil(Math.min(r[1], maxP) / 2);     /* 覆盖到第几个「2 节行」（从 1 数） */
          spanRows = Math.max(spanRows, endRow - ri);
        });
        spanRows = Math.max(1, Math.min(spanRows, rows.length - ri));
        for(var k = 1; k < spanRows; k++) covered[(ri + k) + ':' + wd] = 1;
        h += '<div class="wk-cell has" style="grid-column:' + (wd + 1) + ';grid-row:' + gr + ' / span ' + spanRows + '">';
        cs.forEach(function(c){
          var hue = courseHue(c.name), r = periodRange(c.periods);
          var n = r ? (r[1] - r[0] + 1) : 0;
          h += '<div class="wk-blk" style="--bc:hsl(' + hue + ',62%,52%);'
            + '--bc-soft:hsla(' + hue + ',62%,52%,.13)">'
            + '<b>' + esc(c.name) + '</b>'
            /* 超过一行的课（4 节/8 节的实践课）标出共几节 —— 跨行的样子已经说明占了哪些节，
               这里只补一个数字（写全「第 1-8 节 · 共 8 节」在窄列里会被截成「共 …」，反而看不懂） */
            + (n > 2 ? '<i class="wk-n">共 ' + n + ' 节</i>' : '')
            + (c.room ? '<i>' + esc(c.room) + '</i>' : '')
            + (c.teacher ? '<i>' + esc(c.teacher) + '</i>' : '')
            + '</div>';
        });
        h += '</div>';
      }
    });
    h += '</div></div>';
  }
  h += '<div class="sheet-actions">'
    + '<button class="btn ghost" data-act="schedWeeks" data-w="' + cur + '">回到本周</button>'
    + '<button class="btn" data-act="closeSheet">关掉</button>'
    + '</div>';
  return h;
}
function renderTodayCourses(){
  if(!hasJwglBridge()) return '';
  var s = STATE.schedule;
  if(!s || !s.items || !s.items.length){
    if(!_jwglNeedLogin) return '';
    return '<div class="card sched-card"><div class="row between"><h2>📚 今天的课</h2>'
      + '<button class="btn ghost sm" data-act="openSettings">去连接</button></div>'
      + '<div class="hint">连上教务系统后，这里会显示今天的课。学号密码用系统加密存在本机，不上传、不进代码。</div></div>';
  }
  var w = currentWeek();
  var wMon = weekMonday(w), wSun = weekMonday(w); wSun.setDate(wSun.getDate() + 6);
  var list = todayCourses();
  /* 🔴 这里以前写的是 `list.length + ' 节'` —— 那是**门数**不是**节数**！
     他每门课都占 2 课时（"1-2"、"3-4"），所以 4 门课 = 8 节，卡片上却显示"4 节"。
     2026-09-21 master 指出："我们课都是占两个课时"。统一改成按**节次去重**计数。 */
  var pCnt = classPeriodsOn(new Date());
  var cMin = pCnt * CLASS_MIN_PER_PERIOD;
  /* 同一天里被周次过滤掉的有几节 —— 说一声，别让他以为课丢了。
     算法：今天全部课的节数 − 今天要上的节数（两边都已按节次去重），**不能拿门数相减** */
  var allP = classPeriodsOf((s.items || []).filter(function(c){ return c.weekday === dayOfWeek(); }));
  var offCnt = Math.max(0, allP - pCnt);
  var h = '<div class="card sched-card"><div class="row between"><h2>📚 今天的课</h2>'
    + '<div class="row" style="gap:9px;align-items:center">'
    + '<span class="muted" style="font-size:12px">第 ' + w + ' 周 · ' + mdShort(wMon) + '–' + mdShort(wSun) + ' · ' + pCnt + ' 节 · 约 ' + cMin + ' 分钟</span>'
    + '<button class="btn ghost sm" data-act="schedWeeks" title="看任意一周的完整课表">各周课表</button>'
    + '</div></div>';
  if(!list.length){
    h += '<div class="hint">今天没课'
      + (offCnt ? '（第 ' + w + ' 周不上的 ' + offCnt + ' 节已收起）' : '')
      + ' —— 那时间就都是你自己的。</div>';
  } else {
    h += '<div class="sched-grid">';
    list.forEach(function(c){
      var hue = courseHue(c.name);
      h += '<div class="sched-block" style="--bc:hsl(' + hue + ',62%,52%);'
        + '--bc-soft:hsla(' + hue + ',62%,52%,.13)">'
        + '<div class="sb-per">第 ' + esc(c.periods) + ' 节</div>'
        + '<div class="sb-name">' + esc(c.name) + '</div>'
        + (c.room ? '<div class="sb-room">📍 ' + esc(c.room) + '</div>' : '')
        + (c.teacher ? '<div class="sb-tea">👤 ' + esc(c.teacher) + '</div>' : '')
        + '</div>';
    });
    h += '</div>';
    if(offCnt) h += '<div class="hint" style="margin-top:9px">本周（第 ' + w + ' 周）不上的 '
      + offCnt + ' 节已收起 —— 只留今天真要去的。上课时间已算进今天的投入。</div>';
  }
  return h + '</div>';
}

/* --- 设置面板里的「教务系统」块 --- */
function jwglPanelHTML(status){
  status = status || {};
  var head = '<div class="field" style="margin-top:16px"><label>教务系统（查课表）</label>';
  if(_jwglCaptcha){
    return head
      + '<div class="hint" style="margin:0 0 8px">学校要求验证码，填一次就行，之后应用会记住。'
      + '学号密码用 Windows 系统加密存在本机，不走网络、不进代码。</div>'
      + '<div class="jwgl-form">'
      + '<input id="jw_u" placeholder="学号" value="' + esc(status.username || '') + '">'
      + '<input id="jw_p" type="password" placeholder="密码">'
      + '<div class="jwgl-cap">'
      +   '<input id="jw_c" placeholder="验证码" maxlength="6" autocomplete="off">'
      +   '<img id="jw_img" src="' + _jwglCaptcha + '" title="点一下换一张" data-act="jwglRefreshCaptcha">'
      + '</div></div>'
      + '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">'
      + '<button class="btn primary sm" data-act="jwglLogin">' + (_jwglBusy ? '登录中…' : '登录') + '</button>'
      + '<button class="btn ghost sm" data-act="jwglCancel">取消</button>'
      + '</div></div>';
  }
  if(status.hasCred){
    return head
      + '<div class="hint" style="margin:0 0 8px">已保存账号 <b>' + esc(status.username || '') + '</b>'
      + (status.loggedIn ? '，当前已连接。' : '，当前未连接（取课表时会自动重连，只有会话过期才需要重新登录）。')
      + '</div>'
      + '<div class="row" style="gap:8px;flex-wrap:wrap">'
      + '<button class="btn ghost sm" data-act="jwglStartLogin">重新登录</button>'
      + '<button class="btn ghost sm" data-act="jwglSync">立即同步课表</button>'
      + '<button class="btn danger sm" data-act="jwglLogout">断开并删除凭据</button>'
      + '</div></div>';
  }
  return head
    + '<div class="hint" style="margin:0 0 8px">连上以后，今日页会显示今天的课。'
    + '学号密码用 Windows 系统加密存在本机，不走网络、不进代码。</div>'
    + '<button class="btn primary sm" data-act="jwglStartLogin">连接教务系统</button></div>';
}

/* ================= 视图：今日 ================= */
function viewToday(){
  var h = '';

  /* 首页主视觉（结构化蓝图：主张 + 标题） */
  h += '<div class="mod-head hero">'
    + '<div class="kicker">Module 01 · 首页</div>'
    /* 两段式标题（2026-10-13）：前半「粗体无衬线陈述」交给 warp 渲染，
       后半「衬线斜体升华」必须是真实 DOM —— warp-text 只认 textContent + 单一字体，没法混排。
       两层共用同一个 font-size，视觉上才是同一行标题断成两句。 */
    + '<div class="hero-line">'
    +   '<div class="warp-head" data-warp><h2>把焦虑，</h2></div>'
    +   '<div class="hero-serif">变成下一步。</div>'
    + '</div>'
    + '<p>当多线程压得你脑子打转，先着陆，再行动。外化焦虑、看清方向、每天只做最小的一步——不催你做更多，只帮你从空转里走出来。</p>'
    + '</div>';
  /* 天气条：一行轻环境信息，夹在 hero 和下面内容之间 */
  h += renderWxBar();

  /* 每日必做：今天要交代的那几件 + 打卡时间。排在课表前面 —— 它是对一天最直接的交代。
     ⚠️ 跟课表同一个例外规则：今天休息 / 刚休息回来时**让位给情绪卡**（排到它们后面再出现），
        但不像课表那样干脆不显示 —— 休息日想动一动也随时能打卡。 */
  var mustCard = renderMustCard();

  /* 课表置顶：今天真有课，就该第一眼看到。
     ⚠️ 例外：今天休息 / 刚休息回来 —— 那两张情绪卡比课表更该先被看到，课表让位排到它们后面。
        （这个应用的重点是「别被压垮」，课表再急也不能把「撑不住」埋了） */
  var schedCard = renderTodayCourses();
  var emotionFirst = isRestToday() || isSoftLanding();
  if(!emotionFirst) h += mustCard + schedCard;

  /* 顶部第一块：休息中 / 休息完刚回来 —— 两者互斥，撑不住和刚缓过来要看到的东西不一样。
     ⚠️ 必须排在最前面：它比"今天还没动"更该被先看到。 */
  if(isRestToday()){
    h += '<div class="card"><h2>🛋 今天休息</h2>'
      + '<div class="hint">已经在账上了。今天不打卡也<b>不会断</b>连续天数，宠物也不掉心情。</div>'
      + '<div class="hint">想动一动不用忍着 —— 打卡随时可以，多记一笔不亏。</div></div>';
  } else if(isSoftLanding()){
    h += softLandingCard();
  } else {
    /* ⚠️ 按钮放左边：右下角是悬浮的宠物挂件，卡片底部的右侧按钮会被它盖住（真踩过） */
    h += '<div class="card"><div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">'
      + '<button class="btn ghost sm" data-act="restToday">今天休息</button>'
      + '<span class="muted" style="font-size:12px"><b>今天撑不住？</b>记一天休息：连续天数冻结，宠物回点精力。</span>'
      + '</div>'
      + '<div class="hint" style="margin-top:8px">休息是记账、不是跳过：一天只能记一次，记了不能撤。'
      + pastRestChips() + '</div></div>';
  }

  /* 「🏃 今天还没动」（每周任务）随任务模块一起删了（2026-10-13 master 选的 A）。
     下面两个还得留着 —— 池子那段文案要用。 */
  var pp = poolProgress();
  var lt = looseToday();
  /* 今天的课 / 每日必做：非情绪优先时已经插在天气条下面了，这里补上让位的情况
     （课表连了教务系统才出现；没连 / 今天没课就不打扰他） */
  if(emotionFirst) h += mustCard + schedCard;

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

  /* 今天的池子（2026-10-13 任务模块删掉后重做）。
     原来这张卡叫「快捷打卡」，挂的是日常/每周任务的打卡 + 正计时按钮 —— 任务没了，那些都得摘。
     但**池子必须留下并且显化**：「做了却没看见鱼」是这个项目最忌讳的失败模式。
     卡里只剩两块：今天攒到哪了、以及「临时记的」那几笔（可删）。 */
  h += '<div class="card"><h2>今天的池子</h2><div class="hint">'
    + '花的每一分钟都会攒进今天的池子，<b>每满 60 分钟换 1 条小鱼干</b> 🐟'
    + '（零头当天清零）—— 今天已攒 <b class="pool-now">'+pp.minutes+'</b>/60 分钟'
    + (pp.classMin ? '，另外<b>今天上课 '+pp.classPeriods+' 节（'+pp.classMin+' 分钟）</b>也已经算进去了' : '')
    + '。'
    + (lt.length ? '<br>⏱ <b>临时记的</b>：' + lt.map(function(r){
          return esc(r.name)+' '+r.minutes+' 分钟'
            + '<button class="act-mini" data-act="looseDel" data-id="'+r.id+'" title="删掉这一笔">✕</button>';
        }).join('　') : '')
    + '<br>换应用时右下角会问你一句「这件事记作什么」，确认后自动开始计时 —— 不用手动点。</div></div>';

  /* 放开一下：娱乐 / 放纵。放在「做了什么」之后、「想说什么」之前 */
  h += renderFunCard();
  h += renderActivityCard();

  return h;
}

/* ================= 周报/复盘 ================= */
/* 情绪 → 分数（越差越低），给"偏松/偏紧"用 */
var MOOD_SCORE = {sun:4, cloud:3, rain:2, storm:1};

/* 「偏松 / 偏紧」的规则判断。master 选了「规则打底 + AI 润色」，所以这里必须**可解释**：
   每条结论都说清是按什么算出来的 —— 他能自己核对，阈值也好调。
   ⚠️ 这是**提醒**不是**评判**：只描述事实 + 给一个可选的下一步，绝不指责。
   ⚠️ 阈值是经验值（日均投入 300/360 分钟、放纵 ≥4 笔…），觉得不合适直接改这里。 */
function weekBalance(o){
  var days = Math.max(1, o.days || 1);
  var avg = Math.round((o.loadMin || 0) / days);
  var funN = o.fun || 0, spreeN = o.spree || 0, funTotal = funN + spreeN;
  var moodAvg = (o.moodAvg === null || o.moodAvg === undefined) ? null : o.moodAvg;
  var reasons = [], verdict = 'ok', headline = '';

  if(funTotal === 0 && avg >= 300){                       /* 偏紧：一次口子都没留 */
    verdict = 'tight';
    reasons.push('这周一次娱乐或放纵都没记，日均投入却有 ' + avg + ' 分钟');
  } else if(moodAvg !== null && moodAvg <= 2.2 && avg >= 300){
    verdict = 'tight';
    reasons.push('情绪大多落在阴/雨（均值 ' + moodAvg.toFixed(1) + '/4），日均投入还到 ' + avg + ' 分钟');
  } else if((o.restDays || 0) === 0 && avg >= 360){
    verdict = 'tight';
    reasons.push('日均投入 ' + avg + ' 分钟，但这周一天休息都没记');
  }
  else if(funTotal >= 5 && avg <= 180){                   /* 偏松：松的比紧的多 */
    verdict = 'loose';
    reasons.push('娱乐+放纵记了 ' + funTotal + ' 笔，日均投入只有 ' + avg + ' 分钟');
  } else if(spreeN >= 4){
    verdict = 'loose';
    reasons.push('单是"放纵"就记了 ' + spreeN + ' 笔');
  }
  /* 自动采集也能判"偏松"（2026-10-09 master 选的"直接接进判断"）：
     不用他手动记 —— 采到一周娱乐 ≥5 小时、且**娱乐时长是投入的 2 倍以上**才算。
     用"倍数"而不是绝对阈值：5 小时游戏 + 3 小时学习不算松，5 小时游戏 + 0 投入才算。 */
  else if(o.autoFunMin >= 300 && o.autoFunMin >= 2 * (o.loadMin || 0)){
    var _hm = function(m){ m = Math.round(m || 0); return m >= 60 ? (Math.round(m / 6) / 10) + ' 小时' : m + ' 分钟'; };
    verdict = 'loose';
    reasons.push('自动记录到的休闲娱乐就有 ' + _hm(o.autoFunMin) + '，而本周投入只有 ' + _hm(o.loadMin || 0));
  }

  var tips = [];
  if(verdict === 'tight'){
    headline = '这周绷得有点紧';
    tips = ['给下周排一件纯娱乐的事，写进任务里才算数（不然会被"忙"挤掉）',
            '把每天的最小动作降到 15 分钟 —— 先别停，比做满更重要'];
  } else if(verdict === 'loose'){
    headline = '这周放得有点开';
    tips = ['挑一件最小的事，只定 15 分钟，今天就能做完',
            '放纵不用戒，给它定个上限（比如一周两次），有边界反而更容易守住'];
  } else {
    headline = '这周的松紧挺平衡';
    tips = ['保持这个节奏就行，不用额外加码'];
  }
  return {verdict:verdict, headline:headline, avg:avg, reasons:reasons, tips:tips,
          funN:funN, spreeN:spreeN, funTotal:funTotal, moodAvg:moodAvg};
}

/* 规则生成的周报正文（AI 润色失败/没配 Key 时就用它） */
function buildWeekSummary(o){
  var L = [];
  var hm = function(min){ min = Math.round(min||0); return min >= 60 ? (Math.round(min/6)/10)+' 小时' : min+' 分钟'; };
  var cats = Object.keys(o.dStats || {}).map(function(k){ return {k:k, m:o.dStats[k].minutes||0}; })
    .filter(function(x){ return x.m > 0; }).sort(function(a,b){ return b.m - a.m; });
  L.push('本周（'+mdShort(parseYmd(o.wk))+' 起，已过 '+o.days+' 天）总投入 '+hm(o.totalDailyMin)
    + (o.classMin ? '，其中上课 '+hm(o.classMin) : '')+'。');
  if(cats.length){
    L.push('花时间最多的是「'+(catName(cats[0].k)||cats[0].k)+'」（'+hm(cats[0].m)+'）'
      + (cats[1] ? '，其次是「'+(catName(cats[1].k)||cats[1].k)+'」（'+hm(cats[1].m)+'）' : '')+'。');
  }
  L.push('娱乐 '+(o.funS?o.funS.fun:0)+' 笔、放纵 '+(o.funS?o.funS.spree:0)+' 笔'
    + (o.funS && o.funS.total ? '（'+o.funS.items.slice(0,3).map(function(x){return x.text;}).join('、')+'）' : '')
    + '。');
  if(o.autoFunMin > 0){
    L.push('屏幕时间上，自动记录到休闲娱乐 ' + hm(o.autoFunMin)
      + (o.autoTop && o.autoTop.length
          ? '（' + o.autoTop.map(function(x){ return appLabel(x.proc) + ' ' + hm(x.ms / 60000); }).join('、') + '）'
          : '')
      + '。');
  }
  L.push(o.bal.headline + (o.bal.reasons.length ? ' —— ' + o.bal.reasons.join('；') + '。' : '。'));
  /* 两条建议合成一行（分成两行"可以试试"读起来很啰嗦） */
  if(o.bal.tips.length){
    var marks = ['①', '②', '③'];
    L.push('可以试试：' + o.bal.tips.map(function(t, i){ return marks[i] + t; }).join('　'));
  }
  return L;
}

/* wkArg 不传 = 本周。宠物要回答「我上周干了什么」，就得能算**任意一周**（2026-09-23 加）。 */
function generateWeeklyReport(wkArg){
  var wk = wkArg || weekKey();
  var cached = STATE.reports[wk];

  /* 计算本周概况 */
  var monday = wk;
  var sunday = addDays(wk,6);

  /* 投入统计（2026-10-13 任务模块删掉后重定口径）：**松散时长 + 上课**。
     来源是 weeklyDailyStats（它内部已改成只读 STATE.loose，见 master 选的方案）。 */
  var dStats = weeklyDailyStats(wk);
  /* 课表时间也算进「学习成长」—— master：「把课表占的时间也算学习时间」。
     按天累加（每天的课不一样），只算**周一~今天**：周报是复盘，不是预报，未来几天不算。 */
  var classMin = 0, classPeriodCnt = 0;
  for(var ci = 0; ci < 7; ci++){
    var cd = addDays(monday, ci);
    if(cd > today()) break;
    var cm = classMinutesOn(cd);
    if(cm > 0){ classMin += cm; classPeriodCnt += classPeriodsOn(cd); }
  }
  if(classMin > 0){
    if(!dStats.edu) dStats.edu = {minutes:0, days:0, targetDays:7};
    dStats.edu.minutes += classMin;
  }

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

    /* 当天完成情况（2026-10-13 改口径）：必做清了几件 + 投入分钟（松散时长 + 上课）。
       任务模块删掉后 longTasks/dailyTasks/weeklyTasks 三个统计源都没了，别再往这儿加回来。 */
    var _musts = mustActive();
    var tasksDone=0, tasksTotal=_musts.length, loadMin=0, rechargeMin=0;
    _musts.forEach(function(m){
      if((m.records||[]).some(function(r){return r.date===d;})) tasksDone++;
    });
    (STATE.loose||[]).forEach(function(r){ if(r.date===d) loadMin += (r.minutes||0); });
    /* 上课也进当天的「投入」—— 否则日均投入只统计他手动记的那部分，跟总计对不上 */
    var classMinD = classMinutesOn(d);
    loadMin += classMinD;

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

  /* ---- 娱乐/放纵 + 「偏松/偏紧」的综合性总结（2026-09-23 加）---- */
  var funS = funStats(wk);
  var daysSoFar = dailyCards.length || 1;          /* 已过的天数（未来不生成，所以就是它） */
  var restInWeek = (STATE.restDays || []).filter(function(d){ return d >= monday && d <= sunday; }).length;
  var moodScores = moodTrack.filter(function(m){ return m.mood; }).map(function(m){ return MOOD_SCORE[m.mood] || 3; });
  /* 自动采集（主进程按天读日志算出来）—— 没拉到就是 {}，规则自然不会触发 */
  var aw = actWeekOf(wk) || {};
  var bal = weekBalance({
    days: daysSoFar,
    loadMin: totalDailyMin,
    autoFunMin: aw.funMin || 0,
    fun: funS.fun, spree: funS.spree,
    moodAvg: moodScores.length ? (moodScores.reduce(function(a,b){return a+b;},0) / moodScores.length) : null,
    restDays: restInWeek
  });
  var summaryLines = buildWeekSummary({wk:wk, days:daysSoFar, totalDailyMin:totalDailyMin,
    classMin:classMin, dStats:dStats, funS:funS, bal:bal,
    autoFunMin:aw.funMin || 0, autoTop:aw.funTop || [], autoDays:(aw.days || [])});

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
    /* 本周（周一~今天）上课占的时间 —— 已经并进 dailyStats.edu 和日均投入，
       这里单独留一份给界面标注，免得他以为"我明明在上课，投入怎么这么点" */
    classMin: classMin,
    classPeriods: classPeriodCnt,
    /* 娱乐/放纵 + 松紧结论 + 规则正文。⚠️ aiText 要**从缓存里带过来**，
       否则每次实时重算都会把 AI 润色过的那份冲掉，等于白花钱调了一次 */
    fun: funS,
    /* 自动采集那一份（周报正文与卡片要显化它，不然"凭啥说偏松"说不清） */
    autoFun: { min: aw.funMin || 0, top: aw.funTop || [] },
    balance: bal,
    summaryLines: summaryLines,
    days: daysSoFar,
    restDays: restInWeek,
    aiText: (cached && cached.aiText) || '',
    aiTried: (cached && cached.aiTried) || false
  };

  STATE.reports[wk]=report;
  /* 每周首次生成才落盘；之后每次实时重算，保证今天打卡立刻反映在周报里 */
  if(!cached) save();
  return report;
}

/* ================= 给宠物用的「一周速览」 =================
   master：「用户问宠物的时候，宠物可以回答，你上周干了什么，过于放松还是过于紧张，
   有什么需要补充的提出方案，我来进行决策」——
   所以宠物得先**知道**这些。喂给它的就是周报那套事实 + 规则结论（不额外花他的 AI 额度再算一遍）。 */
function weekHasData(wk){
  var end = addDays(wk, 7);
  var inW = function(d){ return !!d && d >= wk && d < end; };
  if(STATE.reports[wk]) return true;
  if((STATE.dumps||[]).some(function(x){ return inW(ymd(new Date(x.createdAt||0))); })) return true;
  if((STATE.weather||[]).some(function(x){ return inW(x.date); })) return true;
  if((STATE.fun||[]).some(function(x){ return inW(x.date); })) return true;
  if((STATE.restDays||[]).some(function(d){ return inW(d); })) return true;
  if((STATE.mustDos||[]).some(function(m){ return (m.records||[]).some(function(r){ return inW(r.date); }); })) return true;
}
/* 一周压缩成一句话。⚠️ 顺带把这一周的周报**落盘** —— 这正是 master 说的「周报要记录下来」：
   他问宠物"上周干了什么"的时候，那一周的周报就被固定下来了，以后翻得到。 */
function weekDigestLine(wk, label){
  var rpt = STATE.reports[wk] || generateWeeklyReport(wk);
  var f = rpt.fun || {fun:0, spree:0, items:[]};
  var hm = function(m){ m = Math.round(m||0); return m >= 60 ? (Math.round(m/6)/10)+'小时' : m+'分钟'; };
  var cats = Object.keys(rpt.dailyStats||{}).map(function(k){ return {k:k, m:(rpt.dailyStats[k].minutes||0)}; })
    .filter(function(x){ return x.m > 0; }).sort(function(a,b){ return b.m - a.m; });
  return '【'+label+'】投入 '+hm(rpt.summary.totalDailyMin)
    + (rpt.classMin ? '（含上课 '+hm(rpt.classMin)+'）' : '')
    + '，日均 '+rpt.summary.avgLoad+' 分钟'
    + (cats.length ? '；最花时间的是「'+(catName(cats[0].k)||cats[0].k)+'」'+hm(cats[0].m) : '')
    + '；娱乐 '+f.fun+' 笔、放纵 '+f.spree+' 笔'
    + ((rpt.autoFun && rpt.autoFun.min > 0) ? '（自动测得娱乐 '+hm(rpt.autoFun.min)+'）' : '')
    + (f.items && f.items.length ? '（'+f.items.slice(0,4).map(function(x){ return x.text; }).join('、')+'）' : '')
    + '；结论：'+((rpt.balance && rpt.balance.headline) || '—')
    + ((rpt.balance && rpt.balance.tips && rpt.balance.tips.length) ? '；可以试：'+rpt.balance.tips[0] : '');
}
/* 宠物能看到的全部「周」信息：上周 + 本周至今
   ⚠️ 这里**必须自己兜住异常**：它在 pet.js 的 aiReply() 里被同步调用，
      一抛错整个 aiReply 就中断 —— 表现是气泡永远停在「它正在想…」然后消失，
      也就是「伙伴一句话都不回」。2026-09-28 真踩到（mdShort 收了字符串）。
      宁可少两句上下文，也不能让宠物变哑巴。 */
function petWeekContext(){
  try{
    var cur = weekKey(), last = addDays(cur, -7);
    var out = [];
    if(weekHasData(last)){
      /* ⚠️ mdShort 要的是 Date，而 addDays 返回的是 'YYYY-MM-DD' 字符串 —— 必须 parseYmd 一下 */
      out.push(weekDigestLine(last, '上周（'+mdShort(parseYmd(last))+'–'+mdShort(parseYmd(addDays(last,6)))+'）'));
    } else {
      out.push('【上周】没有记录 —— 那周基本没打开过这个 app，别硬编内容。');
    }
    out.push(weekDigestLine(cur, '本周至今（'+mdShort(parseYmd(cur))+' 起）'));
    return out.join('\n');
  }catch(e){
    console.warn('[pet] 周上下文生成失败，这次不带它：', e);
    return '';
  }
}

/* ---- 周报的 AI 润色（规则打底 + AI 润色；没配 Key 就只用规则正文）----
   ⚠️ **一周只自动跑一次**：`_weeklyAiBusy` 挡并发，`aiTried` 挡重复；失败也置 aiTried，
      否则每次打开周报都白调一遍 —— 他的 Key 是要花钱的。
   ⚠️ 结果写回 `STATE.reports[wk].aiText`，而 generateWeeklyReport 每次实时重算，
      所以那里必须把 aiText 从缓存带过来（已处理），不然刚生成就被冲掉。 */
var _weeklyAiBusy = false;
function aiWeeklySummary(force){
  var wk = weekKey();
  var rpt = STATE.reports[wk] || generateWeeklyReport(wk);
  if(_weeklyAiBusy) return;
  if(!STATE.settings.aiKey){ if(force) toast('先配 AI（我在「我的 → 设置」里）'); return; }
  var f = rpt.fun || {fun:0, spree:0, items:[]};
  var facts = '本周（已过 ' + (rpt.days||0) + ' 天）\n'
    + '总投入 ' + rpt.summary.totalDailyMin + ' 分钟，其中上课 ' + (rpt.classMin||0) + ' 分钟\n'
    + '日均投入 ' + rpt.summary.avgLoad + ' 分钟 · 完成率 ' + rpt.summary.completionRate + '%\n'
    + '娱乐 ' + f.fun + ' 笔、放纵 ' + f.spree + ' 笔'
    + (f.items && f.items.length ? '（' + f.items.map(function(x){return x.text;}).join('、') + '）' : '') + '\n'
    + '规则给出的结论：' + (rpt.balance ? rpt.balance.headline : '') + '\n'
    + (rpt.summaryLines || []).join('\n');
  _weeklyAiBusy = true;
  var prompt = '这是一个大学生这周的自助记录。请写一段「周报点评」：'
    + '1) 先说事实（投入与娱乐/放纵的松紧）；2) 指出一个他可能没注意到的点；'
    + '3) 给一条下周可以试的具体建议。语气像朋友，不评判、不喊口号、不列长清单，120 字以内。\n\n' + facts;
  callAI([{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt}]).then(function(r){
    _weeklyAiBusy = false;
    var rr = STATE.reports[wk] || generateWeeklyReport(wk);
    rr.aiTried = true;
    var txt = (r && !r.error && r.content) ? String(r.content).slice(0, 400) : '';
    if(!txt) console.warn('[app] 周报 AI 润色失败：', (r && r.error) || '空回复');
    rr.aiText = txt;
    save();
    if(CUR_TAB === 'weekly') render();
  }).catch(function(e){
    _weeklyAiBusy = false;
    var rr = STATE.reports[wk] || generateWeeklyReport(wk);
    rr.aiTried = true; save();
    console.warn('[app] 周报 AI 润色异常：', e);
  });
}

function viewWeekly(){
  var wk = weekKey();
  /* ⚠️ 必须在 generateWeeklyReport() **之前**拉一次：它要读 ACT_WEEKS[wk] 算松紧。
     有了就不重复拉（ensureActWeek 内部判 TTL / _loading），所以不会转圈。 */
  ensureActWeek(wk);
  var rpt = generateWeeklyReport();
  var h = '<div class="mod-head"><div class="kicker">Module 03 · Weekly</div><div class="warp-head" data-warp><h2>周报</h2></div>'
    + '<p>每周首次打开自动生成。看板按<b>投入时间占比</b>展示各类日常；最后用温柔复盘接住你，而不是评判。</p></div>';
  h += '<div class="card"><h2>'+icon('chart')+' 复盘 · 本周</h2>'
    + '<div class="hint">回顾你的一周。每周首次打开自动生成。</div></div>';

  /* 本周概况三数字 */
  h += '<div class="stat-row"><div class="stat-col"><div class="stat-num" style="color:var(--amber)" data-count="'+rpt.summary.completionRate+'" data-decimals="0" data-suffix="%">0</div><div class="stat-label">完成率</div></div>'
    + '<div class="stat-col"><div class="stat-num" style="color:var(--violet)" data-count="'+rpt.summary.avgLoad+'" data-decimals="0" data-suffix="">0</div><div class="stat-label">日均投入(分钟)</div></div>'
    + '<div class="stat-col"><div class="stat-num" style="color:var(--teal)" data-count="'+rpt.summary.totalDailyMin+'" data-decimals="0" data-suffix="">0</div><div class="stat-label">本周总计(分钟)</div></div>'
    + '</div>';
  /* 课表占的时间也算进去了，得说出来 —— 不然「完成率」没动而「投入」变高，他会以为哪里算错了 */
  if(rpt.classMin > 0){
    h += '<div class="hint" style="text-align:center;margin:-4px 0 14px">其中<b>上课 '+rpt.classPeriods+' 节 · '+rpt.classMin+' 分钟</b>'
      + '（周一到今天，按课表占用计 45 分钟/节）—— 已归进「学习成长」。</div>';
  }

  /* ---- 综合总结：这周偏松还是偏紧 + 娱乐放纵明细 + 下一步（2026-09-23 加）----
     master 的要求：每周做综合性总结、周报要记录下来、给出「有什么需要补充」的方案，他自己决策。
     所以这里只**提方案**，绝不自动改他的任务。 */
  var bal = rpt.balance || {verdict:'ok', headline:'', tips:[], reasons:[]};
  var vClass = bal.verdict === 'tight' ? 'tight' : (bal.verdict === 'loose' ? 'loose' : 'ok');
  var vLabel = bal.verdict === 'tight' ? '偏紧' : (bal.verdict === 'loose' ? '偏松' : '平衡');
  h += '<div class="card sum-card"><div class="row between"><h2>🧭 综合总结</h2>'
    + '<span class="sum-verdict v-'+vClass+'">'+vLabel+'</span></div>';
  h += '<div class="sum-body">';
  (rpt.summaryLines || []).forEach(function(line, i){
    h += '<p'+(i === 0 ? ' class="lead"' : '')+'>'+esc(line)+'</p>';
  });
  h += '</div>';
  /* 娱乐 / 放纵明细 */
  var fs = rpt.fun || {fun:0, spree:0, total:0, items:[]};
  var af = rpt.autoFun || {min:0, top:[]};
  h += '<div class="sum-fun"><span class="sum-fl k-fun">🎈 娱乐 '+fs.fun+' 笔</span>'
    + '<span class="sum-fl k-spree">🍟 放纵 '+fs.spree+' 笔</span>'
    + (af.min > 0 ? '<span class="sum-fl k-auto" title="按前台窗口采样自动算的，不用你记">🖥 自动测得娱乐 '
        + (af.min >= 60 ? (Math.round(af.min/6)/10)+' 小时' : af.min+' 分钟') + '</span>' : '')
    + (fs.items.length ? '<span class="sum-fi">'+fs.items.slice(0,6).map(function(x){return esc(x.text)+'('+mdShort(parseYmd(x.date))+')';}).join('、')+'</span>'
       : '<span class="sum-fi">这周没记过 —— 是没发生，还是忘了记？</span>')
    + '</div>';
  /* AI 润色：没配 Key 就完全依赖上面的规则正文 */
  if(rpt.aiText){
    h += '<div class="sum-ai"><span class="sum-ai-tag">AI 读了一遍</span>'+esc(rpt.aiText)+'</div>';
  } else if(STATE.settings.aiKey){
    h += '<div class="sum-ai pending" id="sumAiBox">让 AI 把这段总结说得更像人话…</div>';
  }
  h += '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:11px">'
    + '<button class="btn ghost sm" data-act="aiSummary">'+(rpt.aiText ? '换 AI 重说一遍' : '让 AI 说两句')+'</button>'
    + '<span class="muted" style="font-size:11.5px;align-self:center">建议只是建议，加不加进任务你定。</span>'
    + '</div></div>';

  /* 「每周任务」那张双目标卡随任务模块删掉了（2026-10-13）。
     但「本周赚到多少鱼」值得留着 —— 它是这个项目里最直接的显化。 */
  var wkFish = (petState().fishLog||[]).filter(function(x){ return ymd(new Date(x.at||0)) >= wk; })
    .reduce(function(a,x){ return a+(x.n||0); }, 0);
  if(wkFish > 0){
    h += '<div class="card"><h2>🐟 本周小鱼干</h2><div class="hint">这周一共赚到 <b>'+wkFish+'</b> 条。'
      + '每满 60 分钟投入换 1 条，零头当天清零 —— 攒着可以换玩具、装扮，或者兑换你给自己定的现实奖励。</div></div>';
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
    var pieData = catKeys.map(function(k){ return {k:k, min:ds[k].minutes, pct:ds[k].minutes/totalMin, col:catColor(k)}; });
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
      var col = catColor(k);
      h += '<div class="kb-row"'+catAttr(k)+'><div class="kl">'+catName(k)+'</div>'
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
      + '<div class="dc-head"><strong>'+dc.date.slice(5)+'</strong> <span class="muted">必做 '+dc.tasksDone+'/'+dc.tasksTotal+'</span>'
      + '<span style="margin-left:auto;font-size:18px">'+(moodE[dc.mood]||'')+'</span>'
      + '<span style="color:'+(dc.rate>=80?'var(--green)':dc.rate>=50?'var(--amber)':'var(--red)')+';font-weight:800;margin-left:8px">'+dc.rate+'%</span></div>'
      + '<div class="dc-stats"><span>投入 '+dc.load+'min</span></div>'
      + '<div class="dc-bar"><div style="width:'+dc.rate+'%;background:'+barColor+'"></div></div>'
      + '<div class="dc-comment">'+dc.comment+'</div>'
      + '</div>';
  });
  h += '</div>';

  return h;
}

/* ================= 视图：陪伴（保持不变） ================= */
var SYSTEM_PROMPT = '你是「着陆」的陪伴者。用户是一个多线程压身（实习/考研/科研/比赛）的年轻人，常"有想法不干事"。你的风格：温柔、不评判、不催促。先接住情绪，再用一两个问题或一句拆解，帮他把想法变成"今天能迈的最小一步"。不要长篇说教，每次回复控制在 120 字内。';

/* --- AI 调用：地址/Key/模型支持**两套** ---
   which='main'（默认）→ 全局那套：陪伴页、周报点评、近三日跟进
   which='pet'        → 伙伴（宠物）自己那套；**没填就回退全局**，所以旧存档行为不变
   拆开的原因：让宠物走本地 Ollama（不花额度、不占显存），而周报点评仍走云端大模型。
   ⚠️ 本地 Ollama 是 http://127.0.0.1:11434/v1 —— Electron 的 CSP 默认只放 https，
     必须放行环回地址，否则报"瞬间 Failed to fetch"（见 main.js 的 CSP 注释）。 */
function aiConfig(which){
  var s = STATE.settings;
  if(which === 'pet'){
    var b = (s.petAiBaseUrl||'').trim(), k = (s.petAiKey||'').trim(), m = (s.petAiModel||'').trim();
    if(b && k) return {baseUrl:b, key:k, model:m || s.aiModel || 'gpt-4o-mini'};
  }
  return {baseUrl:(s.aiBaseUrl||'').trim(), key:(s.aiKey||'').trim(), model:s.aiModel||'gpt-4o-mini'};
}
function aiReady(which){ var c = aiConfig(which); return !!(c.baseUrl && c.key); }
/* 是不是本地（环回）地址 —— 界面据此显示「本地模型模式」，失败提示也不同 */
function isLocalUrl(u){
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(String(u||''));
}
/* 出错时把「模型 @ 主机」带上 —— 否则只剩一句 Failed to fetch，根本不知道它在调谁 */
function aiWhere(c){
  var host = String(c.baseUrl||'').replace(/^https?:\/\//,'').replace(/\/.*$/,'');
  return (c.model||'?') + ' @ ' + host;
}

/* opts.tools = OpenAI 兼容的工具表（function calling）。
   返回体多两个字段：toolCalls（模型想调什么）和 finish。
   ⚠️ 有 tool_calls 时 content 可能是空的 —— 别再把空串兜成 '(空)'，那是给纯聊天用的。 */
function callAI(messages, which, opts){
  opts = opts || {};
  var c = aiConfig(which);
  if(!c.baseUrl || !c.key){ return Promise.resolve({error:'未配置 AI：去「我的→设置」填写'}); }
  var local = isLocalUrl(c.baseUrl);
  var url = c.baseUrl.replace(/\/+$/,'')+'/chat/completions';
  var payload = {
    /* stream:false 要显式写：有些 OpenAI 兼容层（如 Ollama 的 /v1）不写就按流式回 SSE，
       而这里收的是 r.json()，解不了 SSE、只会变成"调用失败" */
    model:c.model||'gpt-4o-mini', messages:messages,
    /* 选工具那一轮用低温（0.4）：实测温度越低，模型「该动手就动手」越稳；
       说人话那一轮仍是 0.7，别把它的性子也烤干了 */
    temperature:(typeof opts.temperature === 'number') ? opts.temperature : 0.7,
    stream:false
  };
  if(opts.tools && opts.tools.length){
    payload.tools = opts.tools;
    payload.tool_choice = opts.tool_choice || 'auto';
  }
  /* 本地小模型经常"自言自语停不下来"（1.5B 尤其），给输出封顶，
     顺便把最坏耗时钉住。云端不封顶（周报点评要写几百字）。 */
  if(local) payload.max_tokens = 220;
  /* 🔴 超时必须自己设：fetch 默认无限等。对方接了连接却不回话（Ollama 的 runner 崩了、
     云端卡住）时，没超时就会**永远停在「它正在想…」** —— 2026-09-24 他遇到的就是这个。 */
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var ms = local ? 120000 : 60000;
  var timer = ctrl ? setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, ms) : 0;
  var opt = {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+c.key},
    body:JSON.stringify(payload)
  };
  if(ctrl) opt.signal = ctrl.signal;
  return fetch(url, opt).then(function(r){
    if(timer) clearTimeout(timer);
    return r.ok ? r.json() : r.text().then(function(t){ return {_err:r.status+' '+String(t).slice(0,140)}; });
  }).then(function(j){
    if(j._err) return {error:j._err + '（' + aiWhere(c) + '）'};
    var ch = (j.choices&&j.choices[0])||{};
    var msg = ch.message||{};
    var txt = msg.content||'';
    return { content: txt || (msg.tool_calls && msg.tool_calls.length ? '' : '(空)'),
             toolCalls: msg.tool_calls || null,
             finish: ch.finish_reason || '' };
  }).catch(function(e){
    if(timer) clearTimeout(timer);
    var to = e && (e.name === 'AbortError' || /abort/i.test(String(e.message||'')));
    return {error:(to ? '等太久了（超过 ' + Math.round(ms/1000) + ' 秒没回话）'
                      : '调用失败：' + (e && e.message))
                   + '（' + aiWhere(c) + '）'};
  });
}

/* ================= 宠物的「手」：function calling =================
   master 2026-10-09 定的边界：
   - 「我想玩一会XX」这类 → **只记时间，不建任务**（进今天的池子 + 周报投入）
   - 任务模块已删（2026-10-13）→ `create_task` 一并摘掉，他的"手"只剩：记时间 / 起计时 / 记休息日
   - 删除类、清空数据、教务登录、改设置 —— **一律不给**
   - 休息日不可逆 → 执行后给 5 秒撤销（他选的「直接做 + 5 秒可撤销」）
   ⚠️ 只有**名字在这张表里**的动作会被执行（runPetTool 白名单），模型编出来的名字当没听见。 */
var PET_TOOLS = [
  { type:'function', function:{
    name:'start_timer',
    description:'开始给某事计时。只有他表达「现在就要开始做某事 / 想玩一会X」时才用；只是聊到某个游戏、问建议、陈述过去，都不要用。',
    parameters:{ type:'object', properties:{
      name:{type:'string', description:'要计时的事，用他原话，如「玩一会杀戮尖塔」'},
      category:{type:'string', enum:PET_CATS, description:'归到哪一类：休闲娱乐 fun / 工作学习 work / 生活品质 life / 素养提高 growth'}
    }, required:['name'] } } },
  { type:'function', function:{
    name:'record_time',
    description:'记一笔**已经花掉**的时间（他没在计时，事后跟你说）。只有他说了自己花了多久时才用；他没说时长就别猜、用 no_action 问他一句。',
    parameters:{ type:'object', properties:{
      name:{type:'string', description:'做什么花掉的时间，如「打了两小时游戏」'},
      minutes:{type:'number', description:'分钟数，必须换算成分钟'},
      category:{type:'string', enum:PET_CATS, description:'归类'}
    }, required:['name','minutes'] } } },
  { type:'function', function:{
    name:'stop_timer',
    description:'结束当前正在跑的计时。只有他明确说「玩完了 / 停了吧 / 不做了 / 结束」时才用。',
    parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{
    name:'rest_today',
    description:'把今天记成休息日（连续天数冻结）。**只有他明确要求记休息日时才用**（如「今天想休息一天」「帮我记成休息日」「今天不干了」）。只是感叹累、心情不好、想吐槽时**不要**用，那种情况用 no_action。',
    parameters:{ type:'object', properties:{
      reason:{type:'string', description:'他的理由，直接引用原话，可空'}
    }, required:[] } } },
  { type:'function', function:{
    name:'query_today',
    description:'查今天的情况：有什么课、今天攒了多少时间、刚才在用什么程序。他问今天怎么样、今天有课吗时用。',
    parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{
    name:'query_week',
    description:'查这一周和上周的投入、娱乐放纵笔数、松紧结论。他问最近怎么样、上周干了什么、是不是太松了时用。',
    parameters:{ type:'object', properties:{} } } },
  { type:'function', function:{
    name:'no_action',
    description:'这次不需要动手时用它：闲聊、提问、感叹、安慰、聊到某件事但没让他做事。拿不准但没有任何明确的「现在开始 / 记一笔 / 结束 / 记休息日」意图时，用这个。',
    parameters:{ type:'object', properties:{} } } }
];

function runPetTool(name, args){
  args = args || {};
  /* no_action 是「这次不用动手」的显式选项 —— 因为 tool_choice 用了 required，
     模型必须二选一，这样它就没法「嘴上说做了、其实没调」。 */
  if(name === 'no_action') return {ok:true, noop:true, say:'（这次不用动手，正常回话就好）'};
  var cat = (PET_CATS.indexOf(args.category) >= 0) ? args.category : 'life';
  try{
    switch(name){
      case 'start_timer': {
        var n1 = String(args.name||'').trim().slice(0,30);
        if(!n1) return {ok:false, say:'他没说清要计时做什么，问他一句。'};
        var c1 = (PET_CATS.indexOf(args.category) >= 0) ? args.category : 'life';
        if(STATE.timer && !STATE.timer.finished){
          return {ok:false, say:'现在已经有一条计时在跑（'+(STATE.timer.name||'另一件事')+'）。先问他要不要结束那条，别自己停。'};
        }
        startStopwatch('loose', null, {name:n1, category:c1});
        return {ok:true, say:'已经开始计时：'+n1+'（'+catName(c1)+'）。结束的时候按「结束」就按实际时长记下，进今天的池子和周报。'};
      }
      case 'record_time': {
        var n2 = String(args.name||'').trim().slice(0,30);
        var m2 = Math.max(1, Math.min(1440, Math.round(Number(args.minutes)||0)));
        if(!n2 || !m2) return {ok:false, say:'缺名字或时长，没记。问他一句到底做了多久。'};
        var c2 = (PET_CATS.indexOf(args.category) >= 0) ? args.category : 'life';
        looseRecord(n2, m2, c2);
        toast('记下了：'+n2+' '+m2+' 分钟');
        return {ok:true, say:'记下了：'+n2+' '+m2+' 分钟（'+catName(c2)+'），已经进今天的池子和周报。'};
      }
      case 'stop_timer': {
        if(!STATE.timer || STATE.timer.finished) return {ok:false, say:'现在没有在跑的计时，跟他说一声就行。'};
        if(!timerIsStopwatch()) return {ok:false, say:'在跑的是倒计时，他没让停就别动。'};
        var ms0 = timerElapsedMs();
        var tn = STATE.timer.name || '一段专注';
        if(ms0 < SW_MIN_MS){ dropStopwatch(); return {ok:true, say:'才不到 1 分钟，这段没记。'}; }
        var used = Math.round(ms0/60000);
        commitStopwatchRecord(used);
        return {ok:true, say:'结束了「'+tn+'」，记下 '+used+' 分钟。'};
      }
      case 'query_today': {
        var out = [];
        var wk = currentWeek();
        var cs = todayCourses();
        out.push(cs.length
          ? ('今天第 '+wk+' 周有 '+cs.length+' 节课：' + cs.map(function(c){
              return c.name+'（第'+c.periods+'节'+(c.room?(' '+c.room):'')+'）'; }).join('；'))
          : ('今天第 '+wk+' 周没课'));
        out.push('今天的时间池子攒了 '+poolProgress().minutes+' 分钟');
        if(typeof ACT !== 'undefined' && ACT && ACT.last && ACT.last.proc){
          out.push('刚才在用的程序：'+ACT.last.proc+(ACT.last.title?('（'+String(ACT.last.title).slice(0,40)+'）'):''));
        }
        return {ok:true, say: out.join('。')+'。'};
      }
      case 'query_week': {
        return {ok:true, say: petWeekContext()};
      }
    }
    return {ok:false, say:'这个动作不在允许清单里，什么都别做，就当没听懂。'};
  }catch(e){
    return {ok:false, say:'执行出错了：'+(e && e.message)+'。什么都别改，如实跟他说。'};
  }
}

/* ================= 陪伴页的气泡 =================
   master 的口径：**不留问答记录**，输入即走、它回一句就行。
   所以这里没有消息列表，只有一个气泡位。
   ⚠️ render() 会重建整个 #view，气泡会被冲掉 —— 而"正在等 AI 回复"是最不该消失的状态，
      所以用 `_cmpSay` 记着，render 之后调 `cmpRestore()` 补回来（跟宠物的 restoreSay 同一个套路）。
   `STATE.companion.messages` 仍然保留 —— 那是喂 AI 的上下文（还有「近三日跟进」要用），只是不显化。 */
var _cmpSay = null;
function cmpSay(text, typing){
  _cmpSay = text ? {text:text, typing:!!typing} : null;
  cmpRestore();
}
function cmpRestore(){
  var el = $('cmpBub');
  if(!el) return;
  if(!_cmpSay){ el.classList.remove('on'); el.classList.remove('typing'); el.textContent=''; return; }
  el.textContent = _cmpSay.text;
  el.classList.add('on');
  el.classList.toggle('typing', !!_cmpSay.typing);
}

function viewCompanion(){
  var h = '<div class="mod-head"><div class="kicker">Module 05 · Companion</div><div class="warp-head" data-warp><h2>陪伴</h2></div>'
    + '<p>云端 AI 真在听你说话、接住你。可一键生成「近三日跟进」，把散落的记录变成你能看懂的方向。</p></div>';
  h += '<div class="card"><h2>'+icon('chat')+' AI 陪伴</h2>'
    + '<div class="hint">不评判、不催促。把闷在心里的话说出来 —— 说了就走，<b>不留记录</b>。'
    + (STATE.settings.aiKey?'':'<span style="color:var(--amber)"> 未配置 AI → 设置</span>')+'</div>'
    + '<button class="btn ghost sm" data-act="followup3">'+icon('refresh')+' 近三日跟进</button></div>'
    + '<div class="card"><div class="cmp-bub" id="cmpBub"></div>'
    + '<div class="companion-input"><textarea id="aiInput" placeholder="说点什么…"></textarea>'
    + '<button class="btn primary" data-act="sendAI">'+icon('send')+'</button></div></div>';
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
    + '<p>它不是待办，是你做事时顺手养起来的一只猫：<b>花的每一分钟都攒进池子，每满 60 分钟换 1 条小鱼干</b>，'
    + '小鱼干换吃的、玩具、装扮，也能换你自己定的现实奖励。'
    + '右下角挂件是它的日常视角，这一页是它的全部细节。</p></div>'
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
  var _ppNow = poolProgress();
  h += renderActivitySettings();
  h += '<div class="card"><h2>数据概览</h2>'
    + '<div class="row" style="gap:24px;flex-wrap:wrap"><div>必做：<b>'+mustTodayStats().done+'/'+mustActive().length+'</b> 今天</div>'
    + '<div>倾倒：<b>'+STATE.dumps.length+'</b> 条</div>'
    + '<div>情绪记录：<b>'+STATE.weather.length+'</b> 天</div>'
    + '<div>休息日：<b>'+restTotal()+'</b> 天</div>'
    + '<div>小鱼干：<b>'+petState().fish+'</b> 条</div>'
    + '<div>今日攒时：<b>'+_ppNow.minutes+'/60</b> 分钟'
      + (_ppNow.classMin ? '（含上课 '+_ppNow.classMin+'）' : '') + '</div>'
    + '<div>记忆库：<b>'+STATE.memories.length+'</b> 条</div></div>'
    + svgMood + '</div>';

  /* 宠物数值总览：精力 / 心情 / 灵性 三维度 + 已解锁的小动作（B 档养成反馈） */
  if(window.Pet && Pet.statsHTML){ var _ps = Pet.statsHTML(); if(_ps) h += _ps; }

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
    + '松散时长 '+(STATE.loose||[]).length+' 笔 · 倾倒 '+STATE.dumps.length
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
var TAB_TITLE = {today:'今日',weekly:'周报',digest:'日报',companion:'陪伴',pet:'伙伴',shop:'商城',me:'我的'};

/* 出错兜底：单个视图抛异常不应该让整个应用白屏，其它模块仍然能用 */
function renderErrorView(tab, err){
  var detail = (err && (err.stack || err.message)) || String(err);
  return '<div class="mod-head"><div class="kicker">出错了</div>'
    + '<div class="warp-head" data-warp><h2>这一页没渲染出来</h2></div>'
    + '<p>其它模块还能用。你的数据都在本地，没有丢。可以先切到别的栏目，或者把下面的报错贴给我。</p></div>'
    + '<div class="card"><h2>'+icon('warn')+' 「'+esc(TAB_TITLE[tab]||tab)+'」渲染失败</h2>'
    + '<div class="hint">错误信息：</div>'
    + '<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55;background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:12px;padding:12px;overflow:auto;max-height:280px">'+esc(detail)+'</pre>'
    + '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">'
    + '<button class="btn primary sm" data-act="retryRender">重试这一页</button>'
    + '<button class="btn ghost sm" data-act="goToday">回今日</button>'
    + '</div></div>';
}

/* ================= 商城（独立页） =================
   原来商城只是宠物浮窗里的一个 tab，藏在右下角挂件后面，想逛得先找到那只猫。
   现在它自己占一栏。内容仍由 pet.js 提供 —— 买卖、兑换、加奖励的逻辑只有一份，
   这里只负责把它撑成一整页，并把点击转回去。 */
var _shopRetry = 0;
function viewShop(){
  var body = null;
  try{
    body = (window.Pet && Pet.shopHTML) ? Pet.shopHTML() : null;
  }catch(err){
    console.error('[着陆] 商城渲染失败：', err);
  }
  if(body === null){
    body = '<div class="hint">商城还在装货，稍等一下…</div>';
    if(_shopRetry < 10){
      _shopRetry++;
      setTimeout(function(){ if(CUR_TAB==='shop') render(); }, 300);
    }
  }else{
    _shopRetry = 0;
  }
  return '<div class="mod-head"><div class="kicker">小鱼干换来的</div>'
    + '<div class="warp-head" data-warp><h2>商城</h2></div>'
    + '<p>做事的每一分钟都攒进池子，<b>每满 60 分钟换 1 条小鱼干</b> 🐟（零头当天清零）；'
    + '换吃的、换装扮，也能换你自己定的现实奖励 —— '
    + '奖励不是"努力的理由"，是"努力过之后的证据"。</p></div>'
    + '<div class="card" id="shopPage">' + body + '</div>';
}
/* 独立页用的是挂件那套 data-pact，但挂件的事件是绑在它自己面板上的（够不到这里），
   所以在页面这一层再挂一次，把点击转给 Pet.shopAct。 */
function bindShopActions(){
  var box = $('shopPage');
  if(!box) return;
  box.addEventListener('click', function(e){
    var el = e.target.closest('[data-pact]');
    if(!el) return;
    e.preventDefault();
    if(window.Pet && Pet.shopAct) Pet.shopAct(el.dataset.pact, el.dataset.id);
  });
}

function render(){
  var views = {today:viewToday,weekly:viewWeekly,digest:renderDigestView,companion:viewCompanion,pet:viewPet,shop:viewShop,me:viewMe};
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
  /* 陪伴页的气泡也得补回来 —— render 会重建 DOM，
     而「它正在想…」恰恰是每次发完话最该看见的状态（跟宠物那边同一个道理） */
  if(CUR_TAB==='companion') cmpRestore();

  /* 周报的 AI 润色：配了 Key 就自动跑一次（一周一次，aiTried 挡重复） */
  if(CUR_TAB==='weekly'){
    var _rpt = STATE.reports[weekKey()];
    if(_rpt && !_rpt.aiText && !_rpt.aiTried && STATE.settings.aiKey) aiWeeklySummary();
  }

  document.querySelectorAll('.nav-item').forEach(function(b){
    b.classList.toggle('active', b.dataset.tab===CUR_TAB);
  });
  /* 「一束光」：把当前栏目写到 body 上 —— CSS 只给 body[data-tab="today"] 在顶部打那束赭石暖光 */
  document.body.setAttribute('data-tab', CUR_TAB);

  /* 卡片入场动画：staggered reveal */
  var cards = document.querySelectorAll('#view .card, #view .task, #view .dg-card, #view .stat-col, #view .mod-head');
  cards.forEach(function(el,i){
    el.classList.add('anim');
    el.style.setProperty('--d',(0.04*i+0.08)+'s');
  });

  /* 周报统计 count-up */
  if(CUR_TAB==='weekly'){ initCountUp(); }

  /* 陪伴页原来要滚到底部看新消息 —— 现在没有消息列表了，不用滚 */
  if(CUR_TAB==='shop'){ bindShopActions(); }
  if(CUR_TAB==='me'){ bindMeActions(); }

  /* 玻璃折射标题 */
  if(window.WarpText) WarpText.apply($('view'));

  /* 伙伴挂件不随视图销毁，只刷新数据 */
  if(window.Pet) Pet.refresh();
  renderTimerBar();
  renderAsk();
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
function openSheet(html, cls){
  var s=$('sheet');
  s.innerHTML='<div class="sheet'+(cls?' '+cls:'')+'">'+html+'</div>';
  s.classList.remove('hidden');
  s.classList.add('show');
}
function closeSheet(){
  var s=$('sheet');
  s.classList.add('hidden');
  s.classList.remove('show');
  s.innerHTML='';
}

/* 管理弹层开着的时候，改完数据要把它自己重画一遍 ——
   否则点了「关」弹层还停在旧状态，看着像没生效。 */
function mustSheetRefresh(){
  var s = $('sheet');
  if(s && s.classList.contains('show') && /必做 · 管理/.test(s.innerHTML)) App.mustManageRender();
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

  /* --- 娱乐 / 放纵 --- */
  funAdd:function(kind){
    var inp = $('funIn');
    var v = inp ? (inp.value || '').trim() : '';
    if(!v){ toast('写一句就行，比如「熬夜看番」'); if(inp) inp.focus(); return; }
    App._funPush(v, kind);
  },
  funQuick:function(text, kind){
    App._funPush(text, kind);
  },
  /* 记一笔。⚠️ 不发鱼也不扣鱼（master 选的口径），只写记忆库 + 重绘 */
  _funPush:function(text, kind){
    var k = (kind === 'spree') ? 'spree' : 'fun';
    text = String(text || '').trim().slice(0, 24);
    if(!text) return;
    STATE.fun = STATE.fun || [];
    STATE.fun.push({id:uid('f'), date:today(), kind:k, text:text, ts:Date.now()});
    if(STATE.fun.length > 800) STATE.fun.splice(0, STATE.fun.length - 800);
    addMemory('fun', FUN_KINDS[k].label + '：' + text, ['放开一下']);
    var inp = $('funIn'); if(inp) inp.value = '';
    save(); render();
    var inp2 = $('funIn'); if(inp2) inp2.focus();
    toast(FUN_KINDS[k].emoji + ' 记下了：' + text);
  },
  funDel:function(id){
    STATE.fun = (STATE.fun || []).filter(function(r){ return r.id !== id; });
    save(); render();
  },
  aiSummary:function(){
    if(!STATE.settings.aiKey){ toast('先配 AI（我在「我的 → 设置」里）'); return; }
    var r = STATE.reports[weekKey()];
    if(r){ r.aiTried = false; }        /* 手动要一次就允许重跑 */
    toast('让 AI 读一遍…');
    aiWeeklySummary(true);
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

  /* --- 每日必做 --- */
  /* 管理弹层（2026-10-13 新增）：任务页删掉后，「必做」的改名/开关/删除/近 7 天就没有别的入口了。
     光能"加一条"不算"保留每日必做"。这里复用原来任务页那张 renderMustItemCard，不另写一套。 */
  mustManage:function(){ App.mustManageRender(); },
  mustManageRender:function(){
    var all = STATE.mustDos||[];
    if(!all.length){ toast('还没有必做项，先加一条'); return; }
    openSheet('<h2>每日必做 · 管理</h2>'
      + '<div class="hint">改名、开关、删除，还有最近 7 天。被关掉的项也在下面。</div>'
      + all.map(renderMustItemCard).join('')
      + '<div class="sheet-actions"><button class="btn primary" data-act="newMustManage">'+icon('plus')+' 加一条</button>'
      + '<button class="btn ghost" data-act="closeSheet">关闭</button></div>');
  },
  newMustManage:function(){ App.openMustForm(null, true); },
  /* 点一下打勾并写 ts（打卡时刻）；已打过 → 再点就是撤销。
     一天只保留一条记录：不是"限制"，是为了让那个时间真的是「第一次打完的时刻」。 */
  mustToggle:function(id){
    var m = STATE.mustDos.find(function(x){return x.id===id;}); if(!m) return;
    var d = today(), idx = -1;
    (m.records||[]).forEach(function(r,k){ if(r.date===d) idx = k; });

    if(idx >= 0){
      m.records.splice(idx,1);
      save(); render(); mustSheetRefresh(); toast('已撤销今天的打卡');
      return;
    }
    var ts = Date.now();
    m.records = m.records || [];
    m.records.push({date:d, ts:ts});
    m.records.sort(function(a,b){ return a.date<b.date ? -1 : 1; });
    save(); render(); mustSheetRefresh();
    var st = mustTodayStats();
    toast('已打卡 '+clockOf(ts)+' ✓'+(st.done===st.total ? ' · 今天全清了' : ' · 还差 '+(st.total-st.done)+' 件'));
  },

  newMust:function(){ App.openMustForm(null); },
  editMust:function(id){ App.openMustForm(id); },

  toggleMust:function(id){
    var m = STATE.mustDos.find(function(x){return x.id===id;}); if(!m) return;
    m.enabled = !m.enabled; save(); render(); mustSheetRefresh(); toast(m.enabled?'已启用':'已关闭');
  },

  openMustForm:function(id, fromManage){
    var m = id ? STATE.mustDos.find(function(x){return x.id===id;}) : null;
    var isEdit = !!m;
    openSheet('<h2>'+(isEdit?'编辑':'新建')+'必做</h2>'
      + '<div class="hint">每天都要做的那一件，短一点、具体一点。建议总共不超过 3 条。</div>'
      + '<div class="field"><label>名称</label><input id="mu_name" value="'+esc(m?m.name:'')+'" placeholder="如：吃维生素 / 记账 / 背 30 个词"></div>'
      + '<div class="hint">打卡时会自动记下<b>完成时刻</b>（几点几分），不用你填。</div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button>'
      + '<button class="btn primary" id="mu_save">'+(isEdit?'保存':'创建')+'</button></div>');
    $('mu_save').addEventListener('click',function(){
      var name = $('mu_name').value.trim();
      if(!name){ toast('写个名字'); return; }
      if(m){ m.name = name; }
      else{ STATE.mustDos.push({id:uid('mu'), name:name, enabled:true, records:[], createdAt:today()}); }
      save(); render();
      if(fromManage) App.mustManageRender(); else closeSheet();   /* 从管理弹层进来的 → 存完回管理弹层 */
      toast(isEdit?'已更新':'已加入必做');
    });
  },

  delMust:function(id){
    var m = STATE.mustDos.find(function(x){return x.id===id;}); if(!m) return;
    openSheet('<h2>删除必做？</h2><div class="hint">「'+esc(m.name)+'」及其 '+m.records.length+' 次打卡记录将被删除。</div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button>'
      + '<button class="btn danger" id="mu_del">确认删除</button></div>');
    $('mu_del').addEventListener('click',function(){
      STATE.mustDos = STATE.mustDos.filter(function(x){return x.id!==id;});
      save(); render();
      if((STATE.mustDos||[]).length){ App.mustManageRender(); toast('已删除'); }
      else { closeSheet(); toast('已删除，必做项清空了'); }
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

  /* --- 活动记录（实现在主进程）--- */
  /* 完整排行 —— 手机上的"应用使用时间"那一页。按应用列今天所有用过的，
     系统壳进程单独折叠在最后（写出来但不计入"真在用"） */
  actRank:function(){
    if(!ACT){ return; }
    var all = appRanking();
    var real = all.filter(function(x){ return !x.shell && !x.idle; });
    var shell = all.filter(function(x){ return x.shell; });
    var idle = all.filter(function(x){ return x.idle; });
    var total = ACT.totalMin || 0;
    var top = real.length ? real[0].minutes : 1;
    var h = '<h2>今天各用了多久</h2>'
      + '<div class="hint">按 <b>前台窗口</b>采样算的（每 ' + (ACT.sampleSec || 60) + ' 秒一次）——'
      + '只算"你正在用的那个"，后台挂着的不算，跟手机的口径一致。'
      + '共记录 <b>' + fmtMin(total) + '</b>。</div>';
    if(!real.length){
      h += '<div class="hint">今天还没有可统计的应用（' + (total > 0 ? '只有桌面/系统窗口' : '还没采到数据') + '）。</div>';
    } else {
      h += '<div class="app-rank">';
      real.forEach(function(x){
        h += '<div class="app-row"><span class="app-nm" title="' + esc(x.proc) + '">'
          + '<i style="background:' + (ACT_COLOR[x.cat] || ACT_COLOR.other) + '"></i>' + esc(x.name) + '</span>'
          + '<span class="app-tm">' + fmtMin(x.minutes) + '</span>'
          + '<span class="app-track"><b style="width:' + Math.max(2, Math.round(x.minutes / top * 100))
          + '%;background:' + (ACT_COLOR[x.cat] || ACT_COLOR.other) + '"></b></span></div>';
      });
      h += '</div>';
    }
    if(shell.length || idle.length){
      var other = [];
      if(shell.length) other.push('系统窗口/桌面 ' + shell.reduce(function(a, x){ return a + x.minutes; }, 0) + ' 分');
      if(idle.length) other.push('没在用程序 ' + idle.reduce(function(a, x){ return a + x.minutes; }, 0) + ' 分');
      h += '<div class="hint" style="margin-top:10px">另有 <b>'
        + (shell.concat(idle).reduce(function(a, x){ return a + x.minutes; }, 0))
        + ' 分钟</b>不是"在用某个软件"：' + other.join(' · ') + '（开着机但没在操作）</div>';
    }
    h += '<div class="hint" style="margin-top:8px">⚠️ 采样是每 ' + (ACT.sampleSec || 60)
      + ' 秒一次，来回切窗口切得快时会少算一点（想要更准可以在「我的 → 活动记录」把采样间隔调小）。</div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">关闭</button></div>';
    openSheet(h);
  },

  actToggle:function(){
    if(!ACT || !window.landing || !window.landing.activity) return;
    window.landing.activity.setPref({ enabled: !ACT.enabled }).then(function(s){
      ACT = s; render(); toast(s.enabled ? '开始记录活动' : '已暂停活动记录');
    });
  },
  actAskToggle:function(){
    if(!ACT || !window.landing || !window.landing.activity) return;
    window.landing.activity.setPref({ ask: !ACT.ask }).then(function(s){
      ACT = s; render(); toast(s.ask ? '换应用时会问你一句' : '不再自动询问');
    });
  },
  actFolder:function(){
    if(window.landing && window.landing.activity) window.landing.activity.openFolder();
  },
  actClearShots:function(){
    if(!window.landing || !window.landing.activity) return;
    window.landing.activity.clearShots().then(function(r){
      toast('清空了 ' + (r.files || 0) + ' 张截图，收回 ' + fmtBytes(r.freed || 0));
      return window.landing.activity.get();
    }).then(function(s){ ACT = s; render(); });
  },
  actSave:function(){
    if(!window.landing || !window.landing.activity) return;
    var num = function(id, dflt, min, max){
      var v = parseInt(($(id) || {}).value, 10);
      if(isNaN(v)) return dflt;
      return Math.max(min, Math.min(max, v));
    };
    window.landing.activity.setPref({
      sampleSec: num('act_sample', 60, 10, 600),
      shotMin:   num('act_shot',   5,  0, 120),
      keepDays:  num('act_keep',  14,  1, 365),
      askCoolMin:num('act_cool',  15,  3, 240)
    }).then(function(s){ ACT = s; render(); toast('活动记录设置已保存'); });
  },
  /* --- 换应用自动计时（2026-10-13）--- */
  askGo:function(){
    if(!ASK) return;
    var inp = $('askName');
    var nm = String((inp && inp.value) || ASK.name || '').trim().slice(0, 20);
    if(!nm){ toast('给它起个名字再开始'); if(inp) inp.focus(); return; }
    var inf = ASK;
    STATE.appNames = STATE.appNames || {};
    STATE.appNames[inf.proc] = nm;      /* 记住他的叫法，下次直接用 */
    save();
    autoCommit();                        /* 保险：上一段自动计时先落账 */
    askClose(function(){
      startStopwatch('loose', null, { name:nm, category:actCatToPet(inf.cat) });
      if(STATE.timer){ STATE.timer.auto = true; STATE.timer.autoProc = inf.proc; save(); renderTimerBar(); }
      addMemory('timer', '自动开始计时：「'+nm+'」（检测到在用 '+appLabel(inf.proc)+'）', ['计时']);
    });
  },
  askSkip:function(){
    if(!ASK) return;
    ASK_MUTE[ASK.proc] = Date.now() + 60*60000;   /* 同一个应用一小时内不再问 */
    askClose(function(){ toast('好，这次不记'); });
  },
  /* 休息日：没有取消入口 —— 这是刻意的，有代价的行为才有信息量 */
  restToday:function(){
    if(takeRestDay(today())){
      /* 2026-10-09 起给 5 秒撤销（原本刻意没入口，但宠物也能记这一条之后，
         一次误判就会白冻一天连击 —— 有撤销才敢让它动手） */
      toastAction('今天记成休息日了。连续天数冻结，宠物也回点血。', '撤销', function(){
        STATE.restDays = (STATE.restDays||[]).filter(function(x){ return x !== today(); });
        save(); render(); toast('撤掉了，今天不算休息日');
      }, 6000);
    }
    else toast('今天已经记过了');
    render();
  },
  looseDel:function(id){ looseDel(id); },
  restPast:function(d){ if(takeRestDay(d)){ toast('已把 '+d+' 记成休息日'); render(); } },
  /* 软着陆：只把他往「最小的一步」上引，不铺开待办 */
  softLandOne:function(){
    var ot = STATE.oneThing;
    if(ot && ot.date===today() && !ot.done){
      CUR_TAB='today'; render();
      var el = document.querySelector('.one-thing');
      if(el) el.scrollIntoView({block:'center', behavior:'smooth'});
      toast('今天的一件事已经定好了，去做它就行');
      return;
    }
    App.newOne();
  },
  softLandShowAll:function(){ STATE.softLandOff = today(); save(); render(); },
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
    inp.value=''; save();
    cmpSay('它正在想…', true);     /* 先给个交代，再去 render —— render 末尾会把它补回来 */
    render();
    var msgs=[{role:'system',content:SYSTEM_PROMPT}].concat(
      STATE.companion.messages.map(function(m){return{role:m.role,content:m.content};})
    );
    callAI(msgs).then(function(r){
      var txt = r.error ? r.error : r.content;
      STATE.companion.messages.push({role:'assistant',content:txt,ts:Date.now()});
      save();
      cmpSay(txt, false);
      render();
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
    save();
    cmpSay('它正在想…', true);
    render();
    callAI(msgs).then(function(r){
      var txt = r.error ? r.error : r.content;
      STATE.companion.messages.push({role:'assistant',content:txt,ts:Date.now()});
      save();
      cmpSay(txt, false);
      render();
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
      /* 任务模块删掉后不能再拿 longTasks 当"是不是着陆备份"的凭据了 ——
         换成"保留字段里命中任意一个就算数"，这样**旧备份也还能导回来**。 */
      if(!obj||typeof obj!=='object'||!(obj.mustDos||obj.loose||obj.weather||obj.dumps||obj.timer||obj.longTasks)){ toast('导入失败：不是着陆的备份文件'); return; }
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

  /* --- 教务系统（登录要输一次验证码，之后靠会话） --- */
  jwglStartLogin:function(){
    if(!hasJwglBridge()){ toast('这个功能要在桌面版里用'); return; }
    _jwglBusy = true;
    App.openSettings();                       /* 先把面板开出来，占个位 */
    window.landing.jwgl.captcha().then(function(res){
      _jwglBusy = false;
      if(!res || !res.ok){
        toast('验证码没取到：' + ((res && res.error) || '未知错误'));
        App.openSettings();
        return;
      }
      _jwglCaptcha = res.captcha;
      App.openSettings();
      setTimeout(function(){ var el = $('jw_u'); if(el) el.focus(); }, 60);
    }).catch(function(e){
      _jwglBusy = false;
      toast('验证码没取到：' + ((e && e.message) || e));
      App.openSettings();
    });
  },
  jwglRefreshCaptcha:function(){
    if(!hasJwglBridge()) return;
    window.landing.jwgl.captcha().then(function(res){
      if(res && res.ok){ _jwglCaptcha = res.captcha; App.openSettings(); }
      else toast('换验证码失败');
    });
  },
  jwglLogin:function(){
    var u = (($('jw_u') && $('jw_u').value) || '').trim();
    var p = (($('jw_p') && $('jw_p').value) || '');
    var c = (($('jw_c') && $('jw_c').value) || '').trim();
    if(!u || !p){ toast('学号和密码都要填'); return; }
    if(!c){ toast('还要填验证码'); return; }

    _jwglBusy = true;
    App.openSettings();
    window.landing.jwgl.login({ username:u, password:p, captcha:c }).then(function(res){
      _jwglBusy = false;
      if(!res || !res.ok){
        _jwglCaptcha = (res && res.captcha) || '';
        toast((res && res.error) || '登录失败');
        App.openSettings();
        return;
      }
      _jwglCaptcha = '';
      toast('连上了 · ' + (res.username || ''));
      refreshJwglStatus();
      ensureSchedule(true);
      App.openSettings();
    }).catch(function(e){
      _jwglBusy = false;
      toast('登录出错：' + ((e && e.message) || e));
      App.openSettings();
    });
  },
  jwglCancel:function(){
    _jwglCaptcha = '';
    _jwglBusy = false;
    App.openSettings();
  },
  jwglLogout:function(){
    if(!hasJwglBridge()) return;
    window.landing.jwgl.logout().then(function(){
      _jwglCaptcha = '';
      STATE.schedule = null;
      _jwglNeedLogin = false;
      save();
      refreshJwglStatus();
      toast('已断开，凭据已删除');
      if(CUR_TAB === 'today') render();
      App.openSettings();
    });
  },
  jwglSync:function(){
    if(!hasJwglBridge()) return;
    toast('正在同步课表…');
    ensureSchedule(true);
  },
  /* 各周课表：今日页课表卡右上角进来。带 w 就跳那一周，不带就沿用上次看的（没有则本周） */
  schedWeeks:function(w){
    var s = STATE.schedule;
    if(!s || !s.items || !s.items.length){
      toast('课表还没拉到 —— 先去设置里连一下教务系统');
      return;
    }
    w = (+w) || _schedWeek || currentWeek();
    w = Math.max(1, Math.min(w, schedMaxWeek()));
    _schedWeek = w;
    openSheet(schedWeekHTML(w), 'wide');
  },

  /* --- 设置 --- */
  openSettings:function(){
    var s=STATE.settings;
    openSheet('<h2>'+icon('cog')+' 设置</h2>'
      + '<div class="field"><label>GitHub Token（可选，提升日报拉取限额）</label><input id="s_gh" type="password" value="'+esc(s.githubToken||'')+'" placeholder="不填也能拉取日报"></div>'
      + '<div class="field"><label>教学周起点（第 1 周的周一）</label>'
      +   '<div class="hint" style="margin:0 0 8px">用来算「今天是第几周」，直接决定课表按周次怎么过滤。'
      +   '按现在这个起点，本周是第 <b>'+currentWeek()+'</b> 周（'+mdShort(weekMonday(currentWeek()))+' 起）。'
      +   '跟开学周对不上就改这里。</div>'
      +   '<input id="s_term" type="date" value="'+esc(ymd(termStart()))+'">'
      + '</div>'
      + '<div class="field"><label>AI 接口（陪伴、周报点评、近三日跟进）</label>'
      +   '<div class="hint" style="margin:0 0 8px">现在接的是 <b>DeepSeek</b>：点一下按钮自动填地址和模型，'
      +   '只粘 Key 就行。填完记得点「测试连接」，能省掉后面一堆莫名其妙的报错。</div>'
      +   '<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">'
      +     '<button class="btn ghost sm" id="s_ai_ds">用 DeepSeek</button>'
      +     '<button class="btn ghost sm" id="s_ai_oai">用 OpenAI</button>'
      +   '</div>'
      +   '<input id="s_base" value="'+esc(s.aiBaseUrl||'')+'" placeholder="https://api.deepseek.com/v1">'
      +   '<input id="s_key" type="password" value="'+esc(s.aiKey||'')+'" placeholder="sk-…（API Key）" style="margin-top:8px">'
      +   '<input id="s_model" value="'+esc(s.aiModel||'')+'" placeholder="deepseek-chat" style="margin-top:8px">'
      +   '<div class="row" style="gap:8px;align-items:center;margin-top:9px;flex-wrap:wrap">'
      +     '<button class="btn ghost sm" id="s_ai_test">测试连接</button>'
      +     '<span id="s_ai_tip" class="muted" style="font-size:12px"></span>'
      +   '</div>'
      +   '<div class="hint" style="margin-top:6px">Key 存在本机浏览器存储里（明文）。'
      +   '它是你自己的机器、自己的 key，但导出的备份文件别随手发给别人。</div>'
      + '</div>'
      /* --- 伙伴单独一套：让它走本地 Ollama，云端那份留给周报点评 --- */
      + '<div class="field"><label>伙伴单独用哪套 AI（可留空）</label>'
      +   '<div class="hint" style="margin:0 0 8px">留空 = 跟上面那套共用（<b>推荐</b>）。填了就<b>只有宠物聊天</b>用它 —— '
      +   '原本是为了让宠物跑在<b>本地 Ollama</b> 上（不花额度、断网也能说话、纯 CPU 不占显存），'
      +   '而需要"读懂一周数据再给建议"的周报点评仍留给云端大模型。'
      +   '<br>⚠️ <b>本地模型这条路现在不要用</b>：本机实测 Ollama 的 runner '
      +   '每次"重新加载模型"都会崩（只有服务刚起后的第一次加载能成），模型文件也已删除。'
      +   '要再试请先读 <b>landing/tools/pet-cpu.Modelfile</b> 的注释（里面记了全部踩坑与解法）。</div>'
      +   '<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">'
      +     '<button class="btn ghost sm" id="s_pet_ollama">用本地 Ollama</button>'
      +     '<button class="btn ghost sm" id="s_pet_clear">跟上面共用</button>'
      +   '</div>'
      +   '<input id="s_pet_base" value="'+esc(s.petAiBaseUrl||'')+'" placeholder="http://127.0.0.1:11434/v1">'
      +   '<input id="s_pet_key" type="password" value="'+esc(s.petAiKey||'')+'" placeholder="ollama（它不校验，随便填个非空的）" style="margin-top:8px">'
      +   '<input id="s_pet_model" value="'+esc(s.petAiModel||'')+'" placeholder="pet-cpu:1.5b（或 ollama list 里的任意名字）" style="margin-top:8px">'
      +   '<div class="row" style="gap:8px;align-items:center;margin-top:9px;flex-wrap:wrap">'
      +     '<button class="btn ghost sm" id="s_pet_test">测试伙伴 AI</button>'
      +     '<span id="s_pet_tip" class="muted" style="font-size:12px"></span>'
      +   '</div>'
      + '</div>'
      + '<div class="sheet-actions"><button class="btn ghost" data-act="closeSheet">取消</button><button class="btn danger" id="s_reset">清空全部数据</button><button class="btn primary" id="s_save">保存</button></div>'
      + '<div class="row between" style="margin-top:14px;gap:10px;flex-wrap:wrap">'
      + '<button class="btn ghost sm" id="s_export">导出备份</button>'
      + '<button class="btn ghost sm" id="s_import">导入备份</button>'
      + '</div>'
      + '<div class="field" style="margin-top:14px"><label>后台常驻</label>'
      +   '<div class="hint" style="margin:0 0 8px">关掉窗口只是缩到右下角托盘，程序继续跑、计时照常走（托盘悬停能看到剩余时间）。要彻底退出：右键托盘图标 → 退出着陆。</div>'
      +   '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn ghost sm" id="s_autostart">开机自动启动：读取中…</button>'
      +   '<button class="btn ghost sm" id="s_closepref">关闭窗口时：读取中…</button></div>'
      + '</div>'
      + jwglPanelHTML(_jwglStatus)
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

    /* --- AI 配置：一键填 DeepSeek / OpenAI / 本地 Ollama + 测试连接 --- */
    function mkTip(id){ return function(t){ var e = $(id); if(e) e.textContent = t || ''; }; }
    var aiTip = mkTip('s_ai_tip'), petTip = mkTip('s_pet_tip');
    var dsBtn = $('s_ai_ds'), oaiBtn = $('s_ai_oai'), testBtn = $('s_ai_test');
    var olBtn = $('s_pet_ollama'), petClearBtn = $('s_pet_clear'), petTestBtn = $('s_pet_test');
    if(dsBtn) dsBtn.onclick = function(){
      $('s_base').value = 'https://api.deepseek.com/v1';
      $('s_model').value = 'deepseek-chat';
      aiTip('已填 DeepSeek —— 粘上 Key 点「测试连接」');
      $('s_key').focus();
    };
    if(oaiBtn) oaiBtn.onclick = function(){
      $('s_base').value = 'https://api.openai.com/v1';
      $('s_model').value = 'gpt-4o-mini';
      aiTip('已填 OpenAI —— 粘上 Key 点「测试连接」');
      $('s_key').focus();
    };
    /* 本地 Ollama：地址固定走环回，Key 随便填（它不校验，但本 app 要求非空） */
    if(olBtn) olBtn.onclick = function(){
      $('s_pet_base').value = 'http://127.0.0.1:11434/v1';
      $('s_pet_key').value = $('s_pet_key').value.trim() || 'ollama';
      $('s_pet_model').value = $('s_pet_model').value.trim() || 'pet-cpu:1.5b';
      petTip('已填本地 Ollama —— 点「测试伙伴 AI」（要先装好 Ollama 并 pull 过模型）');
    };
    if(petClearBtn) petClearBtn.onclick = function(){
      ['s_pet_base','s_pet_key','s_pet_model'].forEach(function(id){ var e = $(id); if(e) e.value = ''; });
      petTip('已清空 —— 伙伴改回跟上面那套共用');
    };
    /* 连接测试：两套共用一段逻辑，只是读的输入框和提示位置不同。
       ⚠️ 也要设超时，否则对方"接了不回"会让按钮永远停在「连接中…」（2026-09-24 加）。 */
    function testConn(btn, base, key, model, tip, dfltModel){
      if(!base || !key){ tip('先把地址和 Key 填上'); return; }
      btn.disabled = true; tip('连接中…');
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, 60000) : 0;
      var opt = {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({model:model || dfltModel, messages:[{role:'user',content:'只回复一个字：在'}],
          max_tokens:8, temperature:0, stream:false})
      };
      if(ctrl) opt.signal = ctrl.signal;
      fetch(base.replace(/\/+$/, '') + '/chat/completions', opt).then(function(r){
        if(timer) clearTimeout(timer);
        return r.ok ? r.json()
                    : r.text().then(function(t){ return {_err:r.status, _t:String(t).slice(0,200)}; });
      }).then(function(j){
        btn.disabled = false;
        if(j._err){
          var why = j._err === 401 ? 'Key 不对（401）'
                  : j._err === 404 ? '地址或模型名不对（404）—— 本地模型要看 ollama list 里的名字'
                  : j._err === 402 ? '余额不足（402）'
                  : ('HTTP ' + j._err);
          tip('✗ ' + why + ' —— ' + (j._t || '').slice(0, 80));
        } else {
          var c = j.choices && j.choices[0] && j.choices[0].message.content;
          tip('✓ 通了。模型回：' + String(c || '').slice(0, 24));
        }
      }).catch(function(e){
        if(timer) clearTimeout(timer);
        btn.disabled = false;
        var to = e && (e.name === 'AbortError' || /abort/i.test(String(e.message||'')));
        tip(to ? '✗ 60 秒没回话：本地模型可能在加载或已崩，退出 Ollama 再打开一次试试'
               : '✗ 连不上：' + (e && e.message) + '（本地模型没启动 / 断网 / 地址写错都这样）');
      });
    }
    if(testBtn) testBtn.onclick = function(){
      testConn(testBtn, $('s_base').value.trim(), $('s_key').value.trim(),
               $('s_model').value.trim(), aiTip, 'deepseek-chat');
    };
    if(petTestBtn) petTestBtn.onclick = function(){
      /* 留空 = 共用主 AI，那就测主 AI */
      var b = $('s_pet_base').value.trim();
      if(!b){ petTip('留空即共用上面那套，直接测「测试连接」就行'); return; }
      testConn(petTestBtn, b, $('s_pet_key').value.trim(),
               $('s_pet_model').value.trim(), petTip, 'pet-cpu:1.5b');
    };

    $('s_save').onclick=function(){
      STATE.settings.githubToken=$('s_gh').value.trim();
      STATE.settings.aiBaseUrl=$('s_base').value.trim();
      STATE.settings.aiKey=$('s_key').value.trim();
      STATE.settings.aiModel=$('s_model').value.trim()||'deepseek-chat';
      /* 伙伴那一套：三个都留空 = 回退主 AI（旧存档就是这状态） */
      if($('s_pet_base')) STATE.settings.petAiBaseUrl=$('s_pet_base').value.trim();
      if($('s_pet_key'))  STATE.settings.petAiKey=$('s_pet_key').value.trim();
      if($('s_pet_model'))STATE.settings.petAiModel=$('s_pet_model').value.trim();
      /* 教学周起点：改了要**按周一归位**再存，不然他填个周三会把整周算歪 */
      var tv=($('s_term')||{}).value;
      if(tv){ var td=parseYmd(tv); if(!isNaN(td.getTime())) STATE.termStart=ymd(mondayOf(td)); }
      save(); closeSheet();
      toast('已保存 · 现在是第 '+currentWeek()+' 周');
      render();
    };
    $('s_reset').onclick=function(){
      if(confirm('确定清空全部数据？任务、倾倒、情绪、伙伴和记忆都会没，不可恢复。')){
        localStorage.removeItem(APP_CONFIG.storageKey);
        STATE=blankState(); save(); render(); closeSheet(); toast('已清空，从零开始');
      }
    };
    $('s_export').onclick=App.exportData;
    $('s_import').onclick=App.importData;

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

/* 「放开一下」那个输入框：回车 = 按「娱乐」记一笔（默认最轻的那类，不逼他先选分类） */
document.addEventListener('keydown', function(e){
  if(e.key !== 'Enter') return;
  var t = e.target;
  if(!t || t.id !== 'funIn') return;
  e.preventDefault();
  App.funAdd('fun');
});

/* ================= 事件委托 ================= */
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-act]');
  if(!el) return;
  var act=el.dataset.act, id=el.dataset.id;

  /* 今日 */
  if(act==='markOne') App.markOne();
  else if(act==='changeOne') App.changeOne();
  else if(act==='newOne') App.newOne();
  else if(act==='restToday') App.restToday();
  else if(act==='restPast') App.restPast(el.dataset.date);
  else if(act==='looseDel') App.looseDel(el.dataset.id);
  else if(act==='softLandOne') App.softLandOne();
  else if(act==='softLandShowAll') App.softLandShowAll();

  /* 倾倒台 / 情绪气象 */
  else if(act==='dumpAdd') App.dumpAdd();
  /* 娱乐 / 放纵 */
  else if(act==='funAdd') App.funAdd(el.dataset.kind);
  else if(act==='funQuick') App.funQuick(el.dataset.text, el.dataset.kind);
  else if(act==='funDel') App.funDel(el.dataset.id);
  /* 周报：让 AI 润色一遍（一周自动一次，这里是他手动再要一次） */
  else if(act==='aiSummary') App.aiSummary();
  else if(act==='dumpKind') App.dumpKind(id, el.dataset.kind);
  else if(act==='dumpDone') App.dumpDone(id);
  else if(act==='dumpDel') App.dumpDel(id);
  else if(act==='dumpStart') App.dumpStart(id);
  else if(act==='setMood') App.setMood(el.dataset.mood);

  /* 每日必做 */
  else if(act==='mustToggle') App.mustToggle(id);
  else if(act==='newMust') App.newMust();
  else if(act==='editMust') App.editMust(id);
  else if(act==='toggleMust') App.toggleMust(id);
  else if(act==='delMust') App.delMust(id);
  else if(act==='mustManage') App.mustManage();
  else if(act==='newMustManage') App.newMustManage();

  /* 计时器 */
  else if(act==='startTimer') App.startTimer(el.dataset.scope || 'loose', id);
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
  else if(act==='filterTask'){ _taskFilter = el.dataset.cat || ''; render(); }

  /* 活动记录 */
  else if(act==='actToggle'){ App.actToggle(); }
  else if(act==='actFolder'){ App.actFolder(); }
  else if(act==='actRank'){ App.actRank(); }
  else if(act==='actClearShots'){ App.actClearShots(); }
  else if(act==='actSave'){ App.actSave(); }
  /* 换应用自动计时（2026-10-13） */
  else if(act==='actAskToggle'){ App.actAskToggle(); }
  else if(act==='askGo'){ App.askGo(); }
  else if(act==='askSkip'){ App.askSkip(); }

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
  else if(act==='wxRetry'){ toast('重新取天气…'); ensureWx(true); }
  else if(act==='jwglStartLogin') App.jwglStartLogin();
  else if(act==='jwglRefreshCaptcha') App.jwglRefreshCaptcha();
  else if(act==='jwglLogin') App.jwglLogin();
  else if(act==='jwglCancel') App.jwglCancel();
  else if(act==='jwglLogout') App.jwglLogout();
  else if(act==='jwglSync') App.jwglSync();
  else if(act==='schedWeeks') App.schedWeeks(el.dataset.w);
  else if(act==='goToday'){ CUR_TAB='today'; render(); }
});

/* ================= 启动 ================= */
function init(){
  load();
  initWinVisibility();   /* 窗口可见性以主进程为准（原因见 _winVisible 那段的说明） */
  initActivity();        /* 活动感知：订阅主进程推来的快照 */

  /* 🔴 桥要**最早**挂上（2026-09-20 血案）：原来在 init() 最末尾，
     中间任何一步抛错都会让 window.App / window.Landing 双双 undefined，
     表现为整页白屏、pet.js 也永远 boot 不起来 —— 极难定位。
     它们只是引用，不依赖 DOM，没有理由排在后面。 */
  window.closeSheet=closeSheet;
  window.App=App;
  /* 给 pet.js 用的桥（保持 app.js 单例状态，不重复造轮子） */
  window.Landing = {
    state:function(){ return STATE; },
    save:save, render:render, toast:toast,
    openSheet:openSheet, closeSheet:closeSheet,
    callAI:callAI,
    /* 伙伴（宠物）单独那套：没填就是主 AI。pet.js 用它决定走 AI 还是本地台词 */
    callPetAI:function(messages, opts){ return callAI(messages, 'pet', opts); },
    petTools:PET_TOOLS,              /* 宠物能用的动作表（function calling） */
    runPetTool:runPetTool,           /* 执行一个动作；只认表里有的名字 */
    petAIReady:function(){ return aiReady('pet'); },
    /* 给伙伴页显示模式用：ready=能不能走 AI，local=是不是本地模型（环回地址），model=模型名 */
    petAIInfo:function(){
      var c = aiConfig('pet');
      return {
        ready: !!(c.baseUrl && c.key),
        local: isLocalUrl(c.baseUrl),
        model: c.model || ''
      };
    },
    addMemory:addMemory, grantFish:grantFish, petState:petState,
    vitality:catVitality, landingDays:catLandingDays, tierText:catTierText,
    tierOf:function(v){ return window.CyberCat ? CyberCat.tierOf(v) : (v<40?'low':(v>70?'high':'mid')); },
    poolProgress:poolProgress,   /* 今日时间池进度（纯查询，无副作用）—— 旧的 fishForMinutes 已随规则废除 */
    /* 给宠物用的「一周速览」：上周 + 本周至今（它得能回答「我上周干了什么、偏松还是偏紧」） */
    weekContext:petWeekContext,
    funRecent:funRecent,
    renderTimerBar:renderTimerBar,
    today:today, ymd:ymd, addDays:addDays, esc:esc, icon:icon, uid:uid,
    wx:function(force){ ensureWx(!!force); return STATE.wx; },
    MEM_KIND:MEM_KIND, CATEGORIES:CATEGORIES,
    tab:function(t){ CUR_TAB=t; render(); }
  };

  /* 上课时间结算：把今天的课表分钟倒进小鱼干池（幂等，只倒增量）。
     ⚠️ 刻意放 try/catch —— 这是 init() 早期，任何一步抛错都会把 window.App/Landing 带走、整页白屏
     （2026-09-20 在这段里踩过一次，见上面里程碑那段的注释）。 */
  var classFishToday = 0;
  try{ classFishToday = settleClassFish(); }
  catch(e){ try{ console.warn('[app] 上课时间结算失败（已跳过）', e); }catch(_){} }
  /* 上课换来的鱼要**说出来** —— 不然他打开应用莫名其妙多了几条鱼（或者反过来：上了 8 节课
     却一条鱼没见着，就会以为没生效）。只在真发了鱼的那天提示一次。 */
  if(classFishToday > 0){
    setTimeout(function(){
      toast('今天 '+classPeriodsOn(today())+' 节课也算投入 · +'+classFishToday+' 🐟');
    }, 1600);
  }
  /* 深链：#tab=me 之类的锚点可以直接打开对应模块（键名必须出现在 TAB_TITLE 里） */
  try{
    (location.hash||'').replace(/^#/,'').split('&').forEach(function(kv){
      var p = kv.split('=');
      if(p[0]==='tab' && TAB_TITLE[p[1]]) CUR_TAB = p[1];
    });
  }catch(e){}

  document.querySelectorAll('.nav-item').forEach(function(b){
    b.addEventListener('click',function(){ CUR_TAB=b.dataset.tab; render(); });
  });

  /* 任务模块删掉后，「新建」只剩"定今天那一件"这一个去处 */
  $('topNew').addEventListener('click',function(){ App.newOne(); });
  $('fabNew').addEventListener('click',function(){ App.newOne(); });
  $('topSettings').addEventListener('click',function(){ App.openSettings(); });

  /* 桥（window.closeSheet / window.App / window.Landing）已经在 init() 开头挂好了 —— 别挪回这儿 */

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

  /* 今日天气：启动拉一次，之后每 30 分钟检查（内部有新鲜度判断，不会真去重复请求） */
  ensureWx(false);
  setInterval(function(){ ensureWx(false); }, WX_TTL);

  /* 教务系统：先问一次状态 —— 连过就同步课表，没连过才在今日页给「去连接」入口 */
  if(hasJwglBridge()){
    refreshJwglStatus().then(function(st){
      if(st && st.hasCred){
        ensureSchedule(false);
      } else {
        _jwglNeedLogin = true;
        if(CUR_TAB === 'today') render();
      }
    });
  }
}
init();
})();
