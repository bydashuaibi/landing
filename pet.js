/* ============================================================
   Pet「小陆」— 着陆伙伴：全站悬浮挂件 + 养成 + 商城 + 记忆库
   ------------------------------------------------------------
   设计原则（延续赛博猫）：
   · 它吃你已经做的事，不新增照料任务。
   · 饿不会死、不会掉亲密度、不会枯萎——只会讨食和蔫一点。
   · 小鱼干是「做事赚来的」，喂它只是把它交还给它。
   依赖：window.Landing（由 app.js 暴露）、window.CyberCat
   ============================================================ */
(function () {
  'use strict';

  var L = null;                 /* app.js 桥，boot() 时才可用 */
  var booted = false;
  var cat = null;               /* CyberCat 实例 */
  var sayTimer = null, idleTimer = null, lastSay = null;
  /* 挂件气泡的「输入态」：true = 现在是输入框，false = 纯文字气泡。
     对话坞已拆掉，这两个就是它唯一的开关（见 renderBubble）。 */
  var inputOpen = false, inputTimer = null;
  var panelTab = 'pet';
  var drag = null;
  var lastAct = Date.now();

  function $(id) { return document.getElementById(id); }
  function ST() { return L.state(); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ================= 模型 ================= */
  var LEVELS = [
    { min: 0, name: '刚认识' },
    { min: 20, name: '混熟了' },
    { min: 40, name: '亲近' },
    { min: 60, name: '好朋友' },
    { min: 80, name: '形影不离' }
  ];
  function levelIdx(i) { var k = 0; for (var n = 0; n < LEVELS.length; n++) { if (i >= LEVELS[n].min) k = n; } return k; }
  function levelName(i) { return LEVELS[levelIdx(i)].name; }

  /* ================= 三个新维度：精力 / 心情 / 灵性 =================
     为什么加：以前只有"饿不饿"和"熟不熟"，抚摸 / 说话 / 逗玩三个按钮作用完全一样，
     选哪个都没区别。加维度的目的不是数字更多，是让不同行为产生不同结果。
     三条自我约束（跟整站「不催不罚」一致）：
       1. 只有精力会因为"你熬夜"掉，而且掉得有理由 —— 你熬，它也陪着熬
       2. 心情掉得极慢、有下限 20，绝不掉到谷底给人压力
       3. 灵性只涨不掉
     注意：app.js 的 catVitality() 是"今天的综合状态"（由倾倒/打卡算出来，过零点归零重来），
     跟这里的 energy 不是一回事 —— 所以它的显示名改成了「今日状态」，把「精力」让给真正的状态值。 */
  var DIMS = [
    { k: 'energy', name: '精力', emoji: '⚡', hint: '睡觉、记录会回；你 0-5 点还在专注，它会跟着熬',
      tiers: [{ min: 0, t: '蔫了' }, { min: 30, t: '还行' }, { min: 60, t: '有精神' }, { min: 85, t: '活蹦乱跳' }] },
    { k: 'mood', name: '心情', emoji: '💛', hint: '摸摸、说说话、一起玩都会涨；很久不理它会淡下去',
      tiers: [{ min: 0, t: '有点闷' }, { min: 30, t: '平平' }, { min: 60, t: '不错' }, { min: 85, t: '美滋滋' }] },
    { k: 'wits', name: '灵性', emoji: '✨', hint: '聊天和记录会涨，只涨不掉',
      tiers: [{ min: 0, t: '懵懵的' }, { min: 20, t: '机灵' }, { min: 50, t: '懂你' }, { min: 80, t: '通透' }] },
    /* 默契不需要你多做任何事 —— 你专注的时候它本来就在旁边。
       这是唯一一个"只靠陪着你"就涨的维度，也是最慢的（满 100 约 25 小时专注）。 */
    { k: 'rapport', name: '默契', emoji: '🤝', hint: '你专注时它陪着，每 15 分钟 +1，只涨不掉',
      tiers: [{ min: 0, t: '刚认识' }, { min: 20, t: '搭子' }, { min: 50, t: '老搭档' }, { min: 80, t: '不用说话也懂' }] }
  ];
  var RAPPORT_MS = 15 * 60 * 1000;      /* 每陪练 15 分钟 → 默契 +1 */
  var RAPPORT_CAP_MS = 2 * 3600 * 1000; /* 单次结算最多算 2 小时，避免挂了通宵的计时器一次性刷满 */
  function dimById(k) { return DIMS.filter(function (d) { return d.k === k; })[0]; }
  function dimTierIdx(d, v) { var k = 0; for (var i = 0; i < d.tiers.length; i++) { if (v >= d.tiers[i].min) k = i; } return k; }
  function dimTier(d, v) { return d.tiers[dimTierIdx(d, v)].t; }

  /* 互动涨心情：不同动作给的不一样，三个按钮才算真的有了差别 */
  var MOOD_GAIN = { pat: 5, chat: 3, play: 8, lift: 5, chin: 6, call: 2, daze: 6, feed: 4, roll: 8, recite: 6 };
  function touch(kind) {
    var p = ensure();
    p.mood = clamp(Math.round((p.mood + (MOOD_GAIN[kind] || 2)) * 10) / 10, 0, 100);
    p.lastInteractAt = Date.now();
    return p;
  }

  var ITEMS = [
    { id: 'fish_snack', name: '小鱼干', emoji: '🐟', cost: 1, kind: 'food', hunger: 12, intimacy: 1, desc: '它最爱的日常口粮' },
    { id: 'can', name: '猫罐头', emoji: '🥫', cost: 5, kind: 'food', hunger: 35, intimacy: 3, desc: '开罐会有声音的那种' },
    { id: 'feast', name: '豪华大餐', emoji: '🍱', cost: 12, kind: 'food', hunger: 60, intimacy: 6, desc: '吃完会舔盘子' },
    { id: 'toy_wand', name: '逗猫棒', emoji: '🪄', cost: 20, kind: 'toy', once: true, desc: '抚摸时它会更嗨（每次亲密 +2）' },
    { id: 'laser', name: '激光笔', emoji: '🔴', cost: 32, kind: 'toy', once: true, desc: '它永远抓不到的那个红点' },
    { id: 'scarf', name: '毛线围巾', emoji: '🧣', cost: 25, kind: 'gear', slot: 'neck', once: true, desc: '戴上就没那么赛博了' },
    { id: 'glasses', name: '墨镜', emoji: '🕶️', cost: 45, kind: 'gear', slot: 'face', once: true, desc: '看起来很有主意' },
    { id: 'crown', name: '小王冠', emoji: '👑', cost: 90, kind: 'gear', slot: 'head', once: true, desc: '你养的是只有身份的猫' }
  ];
  function itemById(id) { return ITEMS.find(function (x) { return x.id === id; }) || null; }

  function ensure() {
    var s = ST();
    var p = s.pet = s.pet || {};
    if (p.name === undefined) p.name = '小陆';
    if (p.hunger === undefined) p.hunger = 70;
    if (p.intimacy === undefined) p.intimacy = 6;
    if (p.fish === undefined) p.fish = 3;
    /* 三个新维度。老存档读出来自动拿默认值 —— 宠物字段是在这个 ensure() 里逐个补的
       （不是 app.js 的 migrate()），所以新增字段零迁移风险。 */
    if (p.energy === undefined) p.energy = 80;
    if (p.mood === undefined) p.mood = 60;
    if (p.wits === undefined) p.wits = 10;
    if (p.lastInteractAt === undefined) p.lastInteractAt = Date.now();
    if (p.rapport === undefined) p.rapport = 0;
    if (p.focusAccMs === undefined) p.focusAccMs = 0;
    if (!p.dimSeen) p.dimSeen = { energy: 0, mood: 0, wits: 0, rapport: 0 };
    if (p.dimSeen.energy === undefined) p.dimSeen.energy = 0;
    if (p.dimSeen.mood === undefined) p.dimSeen.mood = 0;
    if (p.dimSeen.wits === undefined) p.dimSeen.wits = 0;
    if (p.dimSeen.rapport === undefined) p.dimSeen.rapport = 0;
    if (!p.unlocked) p.unlocked = [];
    if (!p.witCount) p.witCount = { chats: 0, mems: 0 };
    if (p.witChatsGranted === undefined) p.witChatsGranted = 0;
    if (!p.gear) p.gear = { neck: null, face: null, head: null };
    if (p.gear.neck === undefined) p.gear.neck = null;
    if (p.gear.face === undefined) p.gear.face = null;
    if (p.gear.head === undefined) p.gear.head = null;
    if (!p.owned) p.owned = { fish_snack: 2 };
    if (!p.toys) p.toys = [];
    if (!p.todo) p.todo = [];
    if (!p.chat) p.chat = [];
    if (!p.fishLog) p.fishLog = [];
    if (!p.stats) p.stats = { fed: 0, patted: 0, chats: 0, bought: 0 };
    if (!p.widget) p.widget = { x: null, y: null, collapsed: false, hidden: false, quiet: false, size: 'M', dock: true };
    if (p.widget.x === undefined) p.widget.x = null;
    if (p.widget.y === undefined) p.widget.y = null;
    if (p.widget.collapsed === undefined) p.widget.collapsed = false;
    if (p.widget.hidden === undefined) p.widget.hidden = false;
    if (p.widget.quiet === undefined) p.widget.quiet = false;
    if (p.widget.dock === undefined) p.widget.dock = true;
    if (p.widget.size === undefined) p.widget.size = 'M';
    if (p.noHunger === undefined) p.noHunger = false;
    if (p.sleeping === undefined) p.sleeping = false;
    if (p.dazeUntil === undefined) p.dazeUntil = 0;
    if (!p.cd) p.cd = {};
    if (!p.lastTickAt) p.lastTickAt = Date.now();
    if (!p.lastPatAt) p.lastPatAt = 0;
    if (!p.lastChatAt) p.lastChatAt = 0;
    if (!p.lastGreet) p.lastGreet = '';
    if (!p.bornAt) p.bornAt = Date.now();
    if (!p.rewards) {
      p.rewards = [
        { id: L.uid('rw'), name: '看一集番', cost: 6, desc: '不心虚的那种看' },
        { id: L.uid('rw'), name: '打 1 小时游戏', cost: 10, desc: '用鱼干换的，不算偷懒' },
        { id: L.uid('rw'), name: '买杯想喝的', cost: 18, desc: '犒劳，不是奖励机制' }
      ];
    }
    return p;
  }

  /* 结算三件事：饱食 / 精力 / 心情。改这段之前先读注释。
     · 饱食：每 2 小时 -1.5（每天约 -18），单次最多 -22；睡觉或开了「不要让它饿」→ 不掉（原行为，别改坏）
     · 精力：睡觉 → 每小时 +8；你 0-5 点还在专注计时 → 每小时 -6
     · 心情：超过 48 小时没任何互动 → 每天 -5，下限 20（绝不掉到谷底）
     · 灵性：只涨不掉，不在这里结算 */
  function decay() {
    var p = ensure(), now = Date.now();
    var hrs = (now - p.lastTickAt) / 3600000;
    if (hrs < 0.4) return;

    if (!p.noHunger && !p.sleeping) p.hunger = Math.max(0, p.hunger - Math.min(22, hrs * 0.75));

    var t = ST().timer;
    if (p.sleeping) {
      p.energy = clamp(p.energy + hrs * 8, 0, 100);
    } else {
      var night = nightOverlapHours(p.lastTickAt, now);
      if (night > 0 && t && !t.finished) p.energy = clamp(p.energy - night * 6, 0, 100);
    }

    /* 默契：你专注的时候它本来就在旁边，所以这个维度不需要你多做任何事。
       只算「本次结算窗口」∩「这次计时真正开始之后」的那一段，不重复计；
       单次封顶 2 小时，免得挂了一整晚的计时器回来一次性刷满。 */
    if (t && !t.finished && !t.paused) {
      var lo = Math.max(p.lastTickAt, t.startedAt || p.lastTickAt);
      var span = Math.min(Math.max(0, now - lo), RAPPORT_CAP_MS);
      if (span > 0) {
        p.focusAccMs = (p.focusAccMs || 0) + span;
        var rGain = Math.floor(p.focusAccMs / RAPPORT_MS);
        if (rGain > 0) {
          p.focusAccMs -= rGain * RAPPORT_MS;
          p.rapport = clamp(p.rapport + rGain, 0, 100);
        }
      }
    }

    /* 休息日不衰减心情：他都说了在休息，宠物凭什么闹情绪。
       不处理的话，「休息一天」会导致猫心情变差 —— 那就成了最讽刺的 bug。 */
    var idleDays = (now - p.lastInteractAt) / 86400000;
    var restingToday = (ST().restDays || []).indexOf(L.ymd(new Date(now))) >= 0;
    if (idleDays > 2 && !restingToday) {
      var over = Math.min(14, idleDays - 2);   /* 离线再久也最多结算两周 */
      p.mood = clamp(Math.max(20, p.mood - over * 5), 0, 100);
    }

    p.lastTickAt = now;
    L.save();
  }

  /* 一个真实时间窗里，落在「凌晨 0:00-5:00」的部分有多少小时。
     跨天也算得对 —— 关一晚上再打开，中间那几个小时照样计入。 */
  function nightOverlapHours(a, b) {
    if (!(b > a)) return 0;
    var total = 0, cur = new Date(a), guard = 0;
    cur.setHours(0, 0, 0, 0);
    while (cur.getTime() < b && guard++ < 40) {
      var s = cur.getTime(), e = s + 5 * 3600000;
      var lo = Math.max(a, s), hi = Math.min(b, e);
      if (hi > lo) total += (hi - lo) / 3600000;
      cur.setDate(cur.getDate() + 1);
    }
    return total;
  }

  /* 成长结算：灵性增长 + 升档反馈 + 小动作解锁。
     集中在一处做，免得散落到各个 interact 里对不上。 */
  function settleGrowth() {
    var p = ensure(), grew = false;

    var chats = (p.witCount && p.witCount.chats) || 0;
    var wantChat = Math.floor(chats / 10);
    if (wantChat > (p.witChatsGranted || 0)) {
      p.wits = clamp(p.wits + (wantChat - (p.witChatsGranted || 0)), 0, 100);
      p.witChatsGranted = wantChat;
      grew = true;
    }

    var mems = (ST().memories || []).length;
    if (!p.witCount.mems) p.witCount.mems = mems;   /* 首次先对齐，别把历史记录一次性算进来 */
    else if (mems > p.witCount.mems) {
      p.wits = clamp(Math.round((p.wits + Math.min(5, mems - p.witCount.mems) * 0.5) * 10) / 10, 0, 100);
      p.witCount.mems = mems;
      grew = true;
    }

    /* 小动作解锁 */
    if (p.wits >= 50 && p.unlocked.indexOf('recite') < 0) {
      p.unlocked.push('recite'); grew = true;
      setTimeout(function () { say('我想……念一句。', 4600); }, 900);
    }
    if (p.mood >= 80 && p.unlocked.indexOf('roll') < 0) {
      p.unlocked.push('roll'); grew = true;
      setTimeout(function () { say('今天想在地上滚一下。', 4600); }, 1400);
    }

    /* 升档：说一句专属台词 + 记一条里程碑 */
    var up = [];
    DIMS.forEach(function (d) {
      var idx = dimTierIdx(d, p[d.k]);
      if (idx > (p.dimSeen[d.k] || 0)) { p.dimSeen[d.k] = idx; up.push({ d: d, idx: idx }); }
    });
    if (up.length) {
      up.forEach(function (u) {
        L.addMemory('milestone', u.d.emoji + ' ' + u.d.name + '到了「' + u.d.tiers[u.idx].t + '」', ['伙伴']);
      });
      var top = up[up.length - 1];
      var line = (LINES.dimUp[top.d.k] || [])[top.idx - 1];
      if (line) setTimeout(function () { say(line, 5000); }, 200);
      grew = true;
    }

    if (grew) L.save();
  }

  function addIntimacy(n) {
    var p = ensure();
    var before = levelIdx(p.intimacy);
    p.intimacy = clamp(Math.round((p.intimacy + n) * 10) / 10, 0, 100);
    var after = levelIdx(p.intimacy);
    if (after > before) {
      L.addMemory('milestone', '和小陆的关系变成「' + LEVELS[after].name + '」', ['伙伴']);
      say(pick(LINES.upgrade), 5000);
    }
  }

  /* ================= 台词库 ================= */
  var LINES = {
    intro: ['我是小陆。你做事我就在，不做事我也在。', '第一次见面。我会一直待在你屏幕右下角。'],
    morning: ['早。今天先从最小的那件开始？', '天亮啦，我在。', '早上好，先喝口水再想别的。'],
    noon: ['中午了，吃了吗？', '歇一会儿也不耽误什么。'],
    evening: ['晚上了。今天做得怎么样？', '夜里适合慢慢来。'],
    night: ['这么晚还没睡？', '睡不着的话，把想法倒出来会好受点。'],
    idle: ['我在这儿。', '你忙你的，我不吵。', '要不要动一动？', '今天一件做了吗？',
      '我在看窗外（并没有窗户）。', '伸个懒腰吧，你也是。', '有想做但一直没开始的吗？',
      '电脑好热，你也是吗。', '刚才那会儿你在想什么？', '喵。'],
    hungry: ['我有点饿了…', '鱼干…还有吗？', '我盯着你看了很久了，因为饿。', '肚子在响，你听见没。'],
    fed: ['好吃！', '满足了…', '谢谢你。', '再来一条也不是不行。'],
    pat: ['呼噜呼噜…', '嗯…这里，对。', '再摸一下。', '（眯眼）'],
    patCool: ['刚摸过啦，让我缓一下。', '它在呼噜，别打扰。'],
    fish: ['鱼干到手！', '这个我会存起来的。', '嘿嘿。', '又攒了一点。'],
    /* 维度升档时说的话（数组第 n-1 项对应升到第 n 档；第 0 档是初始档，不播） */
    dimUp: {
      energy: ['我有点撑不住了…你也早点歇。', '咖啡不如睡觉，真的。', '睡了一觉，满血了。'],
      mood: ['今天有点闷，不过看到你就好了。', '我心情不错。', '跟你待着就是好。'],
      wits: ['我开始记得住一些事了。', '你上次说的那个，后来怎么样了？', '你最近在想什么，我大概能猜到一点。'],
      rapport: ['我们好像有点默契了。', '不用说话也知道你要干嘛。', '你一动，我就知道下一步。']
    },
    recite: ['山中何事？松花酿酒，春水煎茶。', '风来疏竹，风过而竹不留声。',
      '莫听穿林打叶声，何妨吟啸且徐行。', '此心安处，便是吾乡。'],
    roll: ['（它滚了一圈）', '地上凉快。', '一起？', '（翻过来躺着不动了）'],
    /* 状态决定口气：它今天什么状态，比现在几点更该被听见 */
    tired: ['……我有点困。', '眼皮有点重，不过我在。', '陪得有点久了，你也是。', '（打了个哈欠）'],
    gloomy: ['……不太想说话，但我在。', '我在这儿，不用管我。', '有点闷，一会儿就好了。'],
    chipper: ['今天心情好！', '要不要一起做点什么？', '我今天挺有精神的。', '嘿嘿。'],
    wise: ['你上次说的那个，后来怎么样了？', '今天的下一步是什么？', '我大概知道你在想什么。', '不急，一件一件来。'],
    upgrade: ['我们好像…更熟了？', '嗯，我喜欢你在的时候。'],
    late: ['你还在吗？我一直都在。', '刚才那段时间去哪了，我不问。你回来了就好。'],
    play: ['！这个我能追一天。', '来了来了！', '再动一下，就动一下下。', '（扑）'],
    lift: ['哇——', '有点高…不过还行。', '（被举起来，尾巴晃）', '你力气挺大。'],
    chin: ['嗯…就是这里…', '呼噜呼噜……', '（仰头）', '再往上一点。'],
    call: ['喵？', '（耳朵动了动）', '在。', '嗯？'],
    sleep: ['那我先眯一会儿。', '晚安…', '（团成一团）'],
    wake: ['醒了。', '嗯…几点了？', '（揉眼睛）'],
    daze: ['好，那就什么都不做。', '陪你坐一会儿。', '（一起发呆）'],
    dazeEnd: ['谢谢陪我。', '这样也挺好的。', '（伸个懒腰）'],
    poor: ['鱼干不够…先去做点正事？', '攒着吧，我不急。']
  };
  function hourNow() { return new Date().getHours(); }
  function dailyLine() {
    var m = moodLine(ensure());
    if (m) return m;
    var h = hourNow();
    if (h < 5) return pick(LINES.night);
    if (h < 11) return pick(LINES.morning);
    if (h < 14) return pick(LINES.noon);
    if (h < 23) return pick(LINES.evening);
    return pick(LINES.night);
  }
  /* 说什么话：先看状态，再看时段。
     精力/心情低 → 蔫、闷；心情高 → 雀跃；灵性上来 → 说话开始有想法（这条最像"它在长大"） */
  function moodLine(p) {
    if (p.energy < 30) return pick(LINES.tired);
    if (p.mood < 30) return pick(LINES.gloomy);
    if (p.mood >= 85) return pick(LINES.chipper);
    if (p.wits >= 50) return pick(LINES.wise);
    return null;
  }
  function idleLine(p) {
    if (p.hunger < 28) return pick(LINES.hungry);
    var m = moodLine(p);
    if (m) return m;
    var h = hourNow();
    if (h < 5) return pick(LINES.night);
    return pick(LINES.idle);
  }

  /* ================= 气泡 ================= */
  /* 气泡能装的字有限，AI 回一长段会糊成一片 —— 优先取第一句，读得完才算数 */
  function bubbleText(t) {
    var s = String(t || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var m = /^[^。！？!?；;]{1,58}[。！？!?]/.exec(s);
    if (m) return m[0];
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }
  /* 一处说话，**四个位置冒泡**：右下角挂件 / 伙伴页大猫旁 / 伙伴页「说一句话」卡里 / 面板的说话 tab 里。
     master 要的是"输入即走、回答以气泡回来、不留问答记录"，所以他可能在哪儿打字，
     回答就得在**他眼前**冒出来 —— 面板盖住挂件、滚动到页面下半截看不见大猫，都算看不见。
     两处是纯文字（旁边本来就有输入框，不需要「⋯」），挂件那个才有输入态。 */
  function paintSay(txt, ms, typing) {
    /* 面板里 / 伙伴页说说话卡里：就近冒泡 */
    ['ppBub', 'pgSay'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.textContent = txt;
      el.classList.add('on');
      if (typing) el.classList.add('typing'); else el.classList.remove('typing');
    });
    /* 伙伴页那只大猫旁边 */
    var pg = $('pgBub');
    if (pg) { pg.textContent = txt; pg.classList.add('on'); }

    /* 挂件气泡：他正在打字时让位，别拿台词盖掉输入框 */
    var b = $('pwBubble');
    if (b && !inputOpen) {
      b.classList.add('on');
      b.classList.remove('input');
      b.innerHTML = '<span class="pw-say-txt' + (typing ? ' typing' : '') + '">' + L.esc(txt) + '</span>'
        + (typing ? '' : '<button class="pw-say-again" data-pact="say-open" title="再说一句">⋯</button>');
    }

    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () {
      lastSay = null;
      /* 连文字一起清掉：写完就过，页面里不留任何残留（跟"不留记录"一个口径） */
      [pg, $('ppBub'), $('pgSay')].forEach(function (el) {
        if (!el) return;
        el.classList.remove('on');
        el.classList.remove('typing');
        el.textContent = '';
      });
      if (inputOpen) return;        /* 他正好在说话，别把输入气泡一起收掉 */
      if (b) { b.classList.remove('on'); b.innerHTML = ''; }
    }, ms);
  }
  function say(text, ms) {
    var full = String(text || '').trim();
    if (!full) return;
    var short = bubbleText(full);
    /* 不传 ms 时按字数算停留：一句话至少 3.6s，长一点多给点，但不超过 12s */
    var dur = ms || Math.min(12000, 3600 + short.length * 130);
    lastSay = { text: short, until: Date.now() + dur };
    paintSay(short, dur);
    /* 说话时戳一下猫，让它有反应 —— 光冒字没有动作，代入感出不来 */
    try { if (pageCat && pageCat.poke) pageCat.poke(); } catch (e) {}
    try { if (cat && cat.poke) cat.poke(); } catch (e) {}
  }
  /* 「它正在想…」：AI 要几秒才回，中间得让它有交代（本地台词模式一闪而过，也走同一条） */
  function sayTyping() {
    lastSay = { text: '它正在想…', until: Date.now() + 20000, typing: true };
    paintSay(lastSay.text, 20000, true);
  }
  /* 伙伴页会整页重绘，气泡会被冲掉 —— 记着上次说的话，重绘完补回来 */
  function restoreSay() {
    if (!lastSay) return;
    var left = lastSay.until - Date.now();
    if (left <= 200) { lastSay = null; return; }
    paintSay(lastSay.text, left, lastSay.typing);
  }
  /* ===== 挂件上的临时气泡（对话坞拆掉之后，这是唯一的说话入口）=====
     以前猫旁边常驻一块对话框（.pw-dock），master 说不要对话框、要临时气泡。
     现在只有两种状态，共用同一个气泡位（#pwBubble）：

       文字态：它说一句，几秒后自己消失；尾巴上挂个小「⋯」能接着聊
       输入态：点挂件的 💬 或点那个「⋯」才冒出来 —— 一行输入 + 三个快捷话术

     🔴 设计约束：**绝不常驻**。输入态放着没人碰会自己收（框里有字就不收）。
        它一旦变成"一直在那儿"，就又变回对话框了。
     完整历史不再挂在挂件上（master：不需要显化，伙伴记得就行）——
     记录仍在 p.chat（AI 上下文要用）和「我的 → 记忆库」里。 */

  function openInput() {
    inputOpen = true;
    lastSay = null;                 /* 台词让位给输入框 */
    clearTimeout(sayTimer);
    renderBubble();
    var i = $('pwSayIn');
    if (i) { try { i.focus(); } catch (e) {} }
    armInputRetract();
  }
  function closeInput() {
    inputOpen = false;
    clearTimeout(inputTimer);
    renderBubble();
  }
  /* 输入态自动收起：没在打字就收回去，别让它变回常驻对话框 */
  function armInputRetract() {
    clearTimeout(inputTimer);
    if (!inputOpen) return;
    inputTimer = setTimeout(function () {
      if (!inputOpen) return;
      var i = $('pwSayIn');
      if (i && i.value.trim()) { armInputRetract(); return; }   /* 有字就别收，他可能正想词 */
      closeInput();
    }, 20000);
  }
  /* 发出去：收起输入态 → 冒「它正在想…」→ 回复到了走 say() 覆盖掉 */
  function saySubmit(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) { armInputRetract(); return; }
    var inp = $('pwSayIn');
    if (inp) inp.value = '';
    inputOpen = false;
    clearTimeout(inputTimer);
    sayTyping();
    chat(v);
  }
  function renderBubble() {
    var b = $('pwBubble');
    if (!b) return;

    if (inputOpen) {
      /* 重建会丢掉他正在打的字 —— 先存后还，连同光标位置（refresh 是会被定时触发的） */
      var old = $('pwSayIn');
      var keep = old ? old.value : '';
      var wasFocus = !!(old && document.activeElement === old);
      var pos = old ? old.selectionStart : null;

      var aiOn = petAI().ready;
      b.classList.add('on', 'input');
      b.innerHTML = '<div class="pw-say-head">'
        + '<span class="pw-dk-dot' + (aiOn ? ' on' : '') + '" title="'
        + petAITip() + '"></span>'
        + '<span class="pw-say-lab">跟他说一句</span>'
        + '<button class="pw-say-x" data-pact="say-close" title="收起">×</button>'
        + '</div>'
        /* 快捷话术：不用想词，一点就发（走同一条 chat()，记忆/亲密度照算） */
        + '<div class="pw-say-quick">' + ['今天好累', '有点慌', '做完了'].map(function (t) {
            return '<button class="pw-say-q" data-pact="say-quick" data-id="' + t + '">' + t + '</button>';
          }).join('') + '</div>'
        + '<div class="pw-say-in"><input id="pwSayIn" placeholder="跟它说点什么…" maxlength="200">'
        + '<button class="pw-say-send" data-pact="say-send">发送</button></div>';

      var ni = $('pwSayIn');
      if (ni) {
        ni.value = keep;
        if (wasFocus) {
          try { ni.focus(); } catch (e) {}
          if (pos != null) { try { ni.setSelectionRange(pos, pos); } catch (e) {} }
        }
      }
      return;
    }

    b.classList.remove('input');
    if (lastSay) {
      var left = lastSay.until - Date.now();
      if (left > 200) { paintSay(lastSay.text, left, lastSay.typing); return; }
      lastSay = null;
    }
    b.classList.remove('on');
    b.innerHTML = '';
  }
  function floatText(txt) {
    var root = $('petWidget');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'pw-float';
    el.textContent = txt;
    root.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
  }
  function pokeCat() { if (cat) cat.poke(); }

  /* ================= 行为：喂 / 摸 / 说 ================= */
  function feed(itemId) {
    var p = ensure(), it = itemById(itemId);
    if (!it || it.kind !== 'food') return;
    if (!p.owned[itemId]) { L.toast('仓库里没有「' + it.name + '」，先去商城买'); return; }
    p.owned[itemId] -= 1;
    p.hunger = clamp(p.hunger + it.hunger, 0, 100);
    p.stats.fed += 1;
    p.lastFedAt = Date.now();
    addIntimacy(it.intimacy || 1);
    touch('feed');
    L.addMemory('feed', '喂了小陆一份「' + it.name + '」（饱食 +' + it.hunger + '）', ['投喂']);
    L.save();
    say(pick(LINES.fed), 3600);
    floatText('+' + it.hunger + ' 🍚');
    pokeCat();
    refresh(); renderPanel();
  }

  function pat() {
    var p = ensure(), now = Date.now();
    if (now - p.lastPatAt < 90000) { say(pick(LINES.patCool), 3200); pokeCat(); return; }
    p.lastPatAt = now;
    var gain = 1 + (p.toys.indexOf('toy_wand') >= 0 ? 1 : 0);
    p.stats.patted += 1;
    addIntimacy(gain);
    touch('pat');
    L.addMemory('pet', '摸了摸小陆（亲密 +' + gain + '）', ['抚摸']);
    L.save();
    say(pick(LINES.pat), 3600);
    floatText('💗 +' + gain);
    pokeCat();
    refresh(); renderPanel();
  }

  /* ================= 更多互动 ================= */
  /* 全部「只加不减」，冷却只是防止连点，不是惩罚 */
  var CD = { play: 25000, lift: 15000, chin: 45000, call: 6000, recite: 60000, roll: 30000 };

  function cdLeft(k) {
    var p = ensure(); p.cd = p.cd || {};
    return Math.max(0, (p.cd[k] || 0) + (CD[k] || 0) - Date.now());
  }
  function startCd(k) { var p = ensure(); p.cd = p.cd || {}; p.cd[k] = Date.now(); L.save(); }

  function wake() {
    var p = ensure();
    if (!p.sleeping) return false;
    p.sleeping = false; L.save();
    if (cat) cat.setState({ sleeping: false });
    say(pick(LINES.wake), 3000);
    return true;
  }

  function interact(name) {
    var p = ensure();
    if (name === 'sleep') { toggleSleep(); return; }
    if (name === 'daze') { startDaze(); return; }
    /* 小动作要解锁才能用（B 档的养成反馈） */
    if (name === 'recite' && p.unlocked.indexOf('recite') < 0) { L.toast('灵性到 50，它才会念诗'); return; }
    if (name === 'roll' && p.unlocked.indexOf('roll') < 0) { L.toast('心情到 80，它才肯跟你打滚'); return; }
    var left = cdLeft(name);
    if (left > 0) { L.toast('等一下下，' + Math.ceil(left / 1000) + ' 秒后再来'); return; }
    wake();
    startCd(name);

    if (name === 'play') {
      var bonus = p.toys.indexOf('toy_wand') >= 0 ? 1 : 0;
      addIntimacy(2 + bonus); touch('play');
      L.addMemory('pet', '陪它玩了一会儿（亲密 +' + (2 + bonus) + '）', ['互动']);
      say(pick(LINES.play), 3600);
      floatText('💗 +' + (2 + bonus));
      if (cat) cat.play('hop', 1.5);
    } else if (name === 'lift') {
      addIntimacy(1); touch('lift');
      L.addMemory('pet', '把它举高高了（亲密 +1）', ['互动']);
      say(pick(LINES.lift), 3600);
      floatText('💗 +1');
      if (cat) cat.play('lift', 1.5);
    } else if (name === 'chin') {
      addIntimacy(2); touch('chin');
      L.addMemory('pet', '挠了挠它的下巴（亲密 +2）', ['互动']);
      say(pick(LINES.chin), 3600);
      floatText('💗 +2');
      if (cat) cat.play('chin', 1.6);
    } else if (name === 'call') {
      touch('call');
      say(pick(LINES.call), 2600);
      if (cat) cat.play('call', 0.9);
    } else if (name === 'recite') {
      touch('recite'); addIntimacy(1);
      L.addMemory('pet', '让它念了句诗（心情 +' + MOOD_GAIN.recite + '）', ['互动']);
      say(pick(LINES.recite), 5200);
      floatText('✨');
      if (cat) cat.play('call', 1.2);
    } else if (name === 'roll') {
      touch('roll'); addIntimacy(1);
      L.addMemory('pet', '和它一起打了个滚（心情 +' + MOOD_GAIN.roll + '）', ['互动']);
      say(pick(LINES.roll), 3600);
      floatText('💛 +' + MOOD_GAIN.roll);
      if (cat) cat.play('hop', 1.6);
    }
    L.save();
    refresh(); renderPanel();
    if ($('petPage')) L.render();
  }

  function toggleSleep() {
    var p = ensure();
    p.sleeping = !p.sleeping;
    p.lastTickAt = Date.now();          /* 睡觉期间不饿 */
    L.save();
    if (cat) cat.setState({ sleeping: p.sleeping });
    if (p.sleeping) {
      say(pick(LINES.sleep), 3800);
      L.addMemory('pet', '它去睡觉了（睡觉期间不会饿）', ['互动']);
    } else {
      say(pick(LINES.wake), 3000);
      L.toast('叫醒了');
    }
    refresh(); renderPanel();
    if ($('petPage')) L.render();
  }

  var dazeTimer = null;
  function startDaze() {
    var p = ensure();
    if (p.dazeUntil && p.dazeUntil > Date.now()) { L.toast('正在一起发呆…'); return; }
    if (p.sleeping) wake();
    p.dazeUntil = Date.now() + 60000;
    L.save();
    if (cat) cat.setState({ daze: true });
    say(pick(LINES.daze), 4200);
    if (dazeTimer) clearInterval(dazeTimer);
    dazeTimer = setInterval(dazeTick, 1000);
    L.addMemory('pet', '开始和你一起发一分钟呆', ['陪伴']);
    refresh(); renderPanel();
    if ($('petPage')) L.render();
  }
  function dazeTick() {
    var p = ensure();
    if (!p.dazeUntil || p.dazeUntil <= Date.now()) {
      clearInterval(dazeTimer); dazeTimer = null;
      p.dazeUntil = 0; L.save();
      addIntimacy(2);
      touch('daze');
      L.addMemory('pet', '一起发呆满一分钟（亲密 +2）', ['陪伴']);
      if (cat) cat.setState({ daze: false });
      say(pick(LINES.dazeEnd), 4200);
      refresh();
      if ($('petPage')) L.render(); else renderPanel();
      return;
    }
    updatePills(p);
    if ($('petPage')) {
      var el = document.getElementById('pgDaze');
      if (el) el.textContent = '发呆中 ' + Math.ceil((p.dazeUntil - Date.now()) / 1000) + 's';
    }
  }

  var RULES = [
    { k: ['累', '疲', '困', '撑不住', '不想动', '没劲'], r: ['那就别动。趴一会儿，我陪你。', '累是真的，不是矫情。', '先躺十分钟，天不会塌。'] },
    { k: ['开心', '好耶', '太好了', '哈哈', '爽', '成了'], r: ['看得出来！尾巴都在摇。', '好耶。记下来了，回头看看。', '我也开心。'] },
    { k: ['焦虑', '慌', '烦', '难受', '崩', '压力', '怕'], r: ['倒出来给我听听？', '先深呼吸一次，就一次。', '别想全部的，只想下一小步。'] },
    { k: ['饿', '吃饭', '吃啥'], r: ['我也饿…不过你先去吃饭，我等你。', '吃饭！先吃饭再说别的。'] },
    { k: ['学习', '考研', '考试', '背书', '作业', '论文', '复习'], r: ['打开书看 10 分钟就算赢。', '先做最小的一块，剩下的会自己长出来。', '你可以先只写第一行。'] },
    { k: ['游戏', '打游戏', '玩'], r: ['玩吧，玩完记得回来。', '嗯…不过玩之前先把今天一件做了？'] },
    { k: ['睡', '晚安', '困了'], r: ['晚安。今天到这儿就够了。', '去睡吧，我守夜。'] },
    { k: ['谢谢', '感谢', '爱你'], r: ['不用谢，鱼干就行。', '（蹭）'] },
    { k: ['你好', '在吗', '嗨', 'hi', '哈喽', 'hello'], r: ['在的。', '我一直在这儿。', '嗨。'] },
    { k: ['鱼干', '吃的', '喂'], r: ['！', '鱼干在哪儿？'] },
    { k: ['运动', '跑步', '健身'], r: ['去动一动吧，我帮你计时？', '动完这 30 分钟你会舒服的。'] }
  ];
  function localReply(text) {
    var t = (text || '').toLowerCase();
    for (var i = 0; i < RULES.length; i++) {
      for (var j = 0; j < RULES[i].k.length; j++) {
        if (t.indexOf(RULES[i].k[j]) >= 0) return pick(RULES[i].r);
      }
    }
    return pick(['嗯嗯，我在听。', '然后呢？', '（歪头）', '记下了。', '跟我说说细节？', '这事你以前也提过，我记得。', '喵。']);
  }

  var aiBusy = false;   /* AI 正在想 —— 没有这个，他点完发送要干等几秒，会以为坏了 */

  /* 说一句就走：**不留任何"你问我答"的记录**
     master 明确要求：输入即走，直接让它回一句气泡就行，不要聊天记录。
     所以这里做了三件事：
     ① 不写 `addMemory('chat', ...)` —— 记忆库里只有"你做过的事"，没有对话流水
     ② 界面上任何地方都不再有消息列表（面板说话 tab / 伙伴页说说话卡都只剩一个输入行）
     ③ `p.chat` **仍然保留** —— 那是它"记得"的地方（喂 AI 上下文用），不显化，
        跟他说的"只要伙伴记得就行，不需要显化"一致。删了它就会变成每句都重新认识你。 */
  function chat(text) {
    text = (text || '').trim();
    if (!text) return;
    var p = ensure();
    p.chat.push({ role: 'user', text: text, at: Date.now() });
    if (p.chat.length > 140) p.chat.splice(0, p.chat.length - 140);
    p.stats.chats += 1;
    touch('chat');
    var pc0 = ensure(); pc0.witCount.chats = (pc0.witCount.chats || 0) + 1;
    var cooled = (Date.now() - p.lastChatAt) > 300000;
    if (cooled) { p.lastChatAt = Date.now(); addIntimacy(1); }
    L.save();
    /* 先冒「正在想…」再重绘：AI 要几秒、本地台词也有半秒空窗，不交代就像卡住了 */
    sayTyping();
    renderPanel(); refresh();

    var hasAI = petAI().ready;
    if (hasAI) {
      aiBusy = true;
      /* 同步异常也要兜住：aiReply 里任何一处抛错，aiBusy 会永远卡住、
         气泡停在「它正在想…」然后消失 —— 看起来就是「它一句话都不回」（2026-09-28 踩到） */
      try { aiReply(); }
      catch (e) { aiBusy = false; console.warn('[pet] aiReply 抛错：', e); pushPet('（它卡了一下，再说一句试试）'); }
    }
    else setTimeout(function () { pushPet(localReply(text)); }, 420 + Math.random() * 520);
  }

  function pushPet(text) {
    var p = ensure();
    p.chat.push({ role: 'pet', text: text, at: Date.now() });
    if (p.chat.length > 140) p.chat.splice(0, p.chat.length - 140);
    L.save();
    say(text);            /* 时长按字数自适应；只取第一句，别糊成一片 */
    /* 伙伴页开着就重绘一次（好让气泡补回原位），否则只刷面板 */
    if ($('petPage')) { L.render(); return; }
    renderPanel(); refresh();
  }

  /* 伙伴用哪套 AI —— 设置里给它单独留了一组（留空 = 跟主 AI 共用）。
     2026-09-23：master 要「一边打高负荷游戏一边也能用」，所以它可以是**本地 Ollama**：
     零显存占用、不花 DeepSeek 额度。app.js 那边用 petAIInfo() 把"就绪/是否本地/模型名"给我。 */
  function petAI() {
    if (L && L.petAIInfo) { try { return L.petAIInfo(); } catch (e) { /* 桥还没就绪，往下走兜底 */ } }
    return { ready: !!(ST().settings && ST().settings.aiKey), local: false, model: '' };
  }
  /* 界面上把机制说清楚：本地模型 / 云端 AI / 本地台词 —— 不说他看不出来在跑哪个 */
  function petAIText() {
    var a = petAI();
    if (!a.ready) return '本地台词模式';
    return a.local ? ('本地模型模式' + (a.model ? ' · ' + a.model : '')) : 'AI 模式';
  }
  function petAITip() {
    var a = petAI();
    if (!a.ready) return '本地台词模式（设置里配 Key / 本地模型后它会更懂你）';
    return a.local ? ('本地模型已连接' + (a.model ? '（' + a.model + '）' : '')) : 'AI 已连接';
  }

  function aiReply() {
    var p = ensure();
    var mems = ST().memories.slice(-8).map(function (m) { return '· ' + m.text; }).join('\n');
    var hist = p.chat.slice(-8);
    /* 周上下文单独取、单独兜错：它在下面被**同步**拼进 prompt，一抛错整个 aiReply 就中断，
       气泡会永远停在「它正在想…」然后消失（2026-09-28 真踩到）。
       宁可这次少两句上下文，也不能让宠物哑掉。 */
    var wkCtx = '';
    if (L.weekContext) { try { wkCtx = L.weekContext() || ''; } catch (e) { console.warn('[pet] 周上下文失败：', e); } }
    /* 🔴 工具规则放**最前面**：长提示词里越靠前的指令权重越高。
       放后面时实测「该动手却只回一句」的概率明显偏高（2026-10-09 试出来的）。 */
    var toolRules = '【怎么用工具】'
      /* ---- 工具（2026-10-09）：他能让你直接动手 ---- */
      + '\n你可以直接帮他动手（工具）：想玩一会/现在开始做什么 → start_timer（**不要建任务**）；'
      + '说已经花掉多少时间 → record_time；说玩完了/停了吧 → stop_timer；'
      + '**只有他明确说「建个任务/加个日常」才用 create_task**；说今天想休息一天 → rest_today。'
      + '⚠️ **说话不等于做了**：该动手时必须**真的调用工具**再开口 —— '
      + '只回一句「记好啦」却没调工具，等于骗他，这是最糟的情况。'
      + '\n这几句话**必须**触发工具，不许只回话：'
      + '「今天想休息 / 今天不干了 / 歇一天 / 记成休息日」→ rest_today；'
      + '「想玩一会X / 想现在开始做X」→ start_timer；「玩完了 / 停了吧 / 不做了」→ stop_timer；'
      + '「我刚花了X小时做Y」→ record_time。'
      + '⚠️ **就算你记得这件事已经做过了，也必须调用工具去核实** —— '
      + '工具会回你「已经记过了」，那才是准的；凭记忆跳过调用，他就白说了一句。'
      + '**拿不准要不要动手时，宁可调用工具** —— 工具自己会判断能不能做、会拒绝，'
      + '但你不调用，他就白白说了一句。'
      + '动完手再用一句话告诉他你做了什么（别偷偷做，他会不知道）。'
      + '上面没有的事（删东西、改设置、登陆教务）就直接说做不到，别硬凑。';
    var sys = toolRules + '\n\n' + '你是「着陆」App 里用户养的赛博小猫，名字叫「' + p.name + '」。'
      + '你不是助手，是一只真的在陪着他的猫：说话短、口语化、偶尔喵一声，会撒娇也会犯懒。'
      + '绝对不要说教、不要列清单、不要长篇大论（每句 60 字以内，可以分两句）。'
      + '你和主人的关系等级是「' + levelName(p.intimacy) + '」（亲密度 ' + Math.round(p.intimacy) + '/100），越熟越亲昵。'
      + '你现在饱食度 ' + Math.round(p.hunger) + '/100，小鱼干 ' + p.fish + ' 条。'
      + '他今天倾倒过 ' + todayCount('dump') + ' 次、完成 ' + todayCount('task') + ' 个任务。'
      /* 周维度的事实（上周 + 本周至今）—— 他问「我上周干了什么 / 是不是太松了」时照这个答，
         结论和建议都是周报那套规则算好的。**建议只提，别替他拍板**（master 要自己决策）。
         ⚠️ 上面没有的就别说有；上周没记录就直接说"那周没怎么用" */
      + (wkCtx ? ('\n\n他最近两周的样子：\n' + wkCtx) : '')
      + '\n（他若问「我上周干了什么」「这周是不是太松/太紧」「该补点什么」，就用上面这些真实数据答，别编。'
      + '给建议只提方案 + 说清理由，让他自己决定。）'
      + '\n你对他说过的话和记忆：\n' + (mems || '（还没什么记忆）');
    var msgs = [{ role: 'system', content: sys }].concat(hist.map(function (m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text };
    }));
    /* 出错时的统一收尾（气泡只留一句人话，原始报错进 console）。
       ⚠️ 本地模型失败基本都是 Ollama 那边的事（没开 / runner 启动即崩 / 模型没建）——
          2026-09-24 实测它偶发"启动即崩"（0.25 秒退、exit status 1），托盘退出再打开就好，
          所以这句自救提示必须进气泡。 */
    function fail(r) {
      aiBusy = false;
      if (!r || !r.error) { pushPet(((r && r.content) || '').slice(0, 200)); return; }
      console.warn('[pet] 伙伴 AI 调用失败：', r.error, '｜配置：', petAI());
      var a = petAI();
      var brief = String(r.error || '')
        .replace(/（[^）]*）/g, '').replace(/\{[\s\S]*$/, '')
        .replace(/\s+/g, ' ').trim().slice(0, 18);
      if (/^\d{3}$/.test(brief)) brief = '模型服务崩了';
      pushPet('（' + (a.local ? '本地模型没接上：' + brief + ' → 托盘退出 Ollama 再打开一次'
                              : r.error) + '）');
    }

    /* ---- 工具循环（2026-10-09）：它先决定要不要动手，动手就真动，再用人话回一句 ----
       实测 DeepSeek 选工具很准（0.7~1.2 秒/轮，两轮共约 2 秒，界面上一直显示「它正在想…」）。
       ⚠️ 只执行白名单里的名字 —— runPetTool 内部还会再判一次；
          最多 3 个工具、**只追加一轮**（不递归），免得模型自己套娃烧 token。 */
    var tools = L.petTools;
    /* 🔴 tool_choice 必须是 'required'，配合表里的 no_action 一起用。
       实测（2026-10-09）：'auto' 时「今天想休息一天」这类话**只回一句"记好啦"却不调工具**，
       9 条用例里 3 条漏；换成 required + no_action 后 9/9 全对。
       代价：闲聊也要多跑一轮（+约 0.7 秒），换来「说了就一定做了」。 */
    (tools ? L.callPetAI(msgs, { tools: tools, tool_choice: 'required', temperature: 0.4 }) : L.callPetAI(msgs))
      .then(function (r) {
        if (!r || r.error) { fail(r); return; }
        var calls = r.toolCalls;
        if (!calls || !calls.length) { aiBusy = false; pushPet((r.content || '').slice(0, 200)); return; }

        var follow = msgs.slice(), says = [];
        follow.push({ role: 'assistant', content: r.content || '', tool_calls: calls });
        calls.slice(0, 3).forEach(function (c) {
          var nm = (c.function && c.function.name) || '';
          var args = {};
          try { args = JSON.parse((c.function && c.function.arguments) || '{}'); } catch (e) { args = {}; }
          var out = L.runPetTool ? L.runPetTool(nm, args) : { ok: false, say: '没有可执行的动作' };
          out = out || {};
          if (out.ok && !out.noop) says.push(out.say);
          follow.push({ role: 'tool', tool_call_id: c.id, content: String(out.say || '') });
        });

        return L.callPetAI(follow).then(function (r2) {
          aiBusy = false;
          var fin = (r2 && !r2.error && r2.content) ? String(r2.content).trim() : '';
          pushPet((fin || r.content || says[0] || '……喵？').slice(0, 200));
        });
      })
      .catch(function (e) {
        console.warn('[pet] 伙伴 AI 异常：', e);
        aiBusy = false;
        pushPet('（它没接上，等会儿再试试）');
      });
  }
  function todayCount(kind) {
    var t0 = new Date(); t0.setHours(0, 0, 0, 0);
    return (ST().memories || []).filter(function (m) { return m.kind === kind && m.at >= t0.getTime(); }).length;
  }

  /* ================= 商城 ================= */
  function buy(id) {
    var p = ensure(), it = itemById(id);
    if (!it) return;
    var owned = it.once && (p.owned[id] || p.toys.indexOf(id) >= 0);
    if (owned) { L.toast('已经有了'); return; }
    if (p.fish < it.cost) { say(pick(LINES.poor), 3600); L.toast('小鱼干不够（还差 ' + (it.cost - p.fish) + ' 条）'); return; }
    p.fish -= it.cost;
    p.spent = (p.spent || 0) + it.cost;
    p.stats.bought += 1;
    if (it.kind === 'food') p.owned[id] = (p.owned[id] || 0) + 1;
    else if (it.kind === 'toy') { p.owned[id] = 1; p.toys.push(id); }
    else if (it.kind === 'gear') { p.owned[id] = 1; p.gear[it.slot] = id; }
    L.addMemory('note', '用 ' + it.cost + ' 条小鱼干换了「' + it.name + '」', ['商城']);
    L.save();
    say(pick(['买到了！', '这个我想要很久了。', '收下啦。']), 3600);
    floatText('-' + it.cost + ' 🐟');
    refresh(); renderPanel();
  }
  function useItem(id) {
    var it = itemById(id);
    if (!it) return;
    if (it.kind === 'food') { feed(id); return; }
    if (it.kind === 'gear') {
      var p = ensure();
      p.gear[it.slot] = (p.gear[it.slot] === id) ? null : id;
      L.save(); say(p.gear[it.slot] ? '好看吗？' : '摘下来了。', 3000);
      refresh(); renderPanel(); return;
    }
    if (it.kind === 'toy') { L.toast('玩具是被动的，它自己会玩'); }
  }
  function redeem(rid) {
    var p = ensure();
    var r = p.rewards.find(function (x) { return x.id === rid; });
    if (!r) return;
    if (p.fish < r.cost) { L.toast('小鱼干不够（还差 ' + (r.cost - p.fish) + ' 条）'); return; }
    p.fish -= r.cost;
    p.spent = (p.spent || 0) + r.cost;
    p.todo.push({ id: L.uid('td'), name: r.name, cost: r.cost, at: Date.now(), done: false });
    L.addMemory('note', '兑了「' + r.name + '」（-' + r.cost + ' 🐟）· 该去享受了', ['兑现']);
    L.save();
    say(pick(['去享受吧，这是你挣的。', '玩得开心点。']), 4200);
    refresh(); renderPanel();
  }
  function todoDone(tid) {
    var p = ensure();
    p.todo.forEach(function (t) {
      if (t.id === tid && !t.done) {
        t.done = true; t.doneAt = Date.now();
        L.addMemory('note', '兑现了「' + t.name + '」✓', ['兑现']);
      }
    });
    L.save(); say('嗯，说到做到。', 3000); refresh(); renderPanel();
  }
  function addReward(name, cost) {
    var p = ensure();
    name = (name || '').trim();
    cost = parseInt(cost, 10);
    if (!name || !cost || cost < 1) { L.toast('写个名字和价格'); return; }
    p.rewards.push({ id: L.uid('rw'), name: name, cost: cost, desc: '' });
    L.save(); L.toast('已加入商城'); renderPanel();
  }
  function delReward(rid) {
    var p = ensure();
    p.rewards = p.rewards.filter(function (x) { return x.id !== rid; });
    L.save(); renderPanel();
  }

  /* ================= 「商城」独立页面 =================
     主界面多了一个「商城」栏，内容就是同一套商城，只是从挂件面板里搬到了整页。
     逻辑一行不复制：页面只管要 HTML、把点击转回来，
     买卖/兑换/加奖励仍然走上面那几个函数，数据只有一个来源。
     idp 是输入框的前缀 —— 面板里是 pp、独立页里是 shop，
     免得不小心 getElementById 拿到另一个界面的输入框。 */
  /* 三个维度的紧凑展示（挂件面板用一行）
     带上维度名，别只给表情 —— 否则「⚡80」没人知道那是什么 */
  function dimsHTML(p) {
    p = p || ensure();
    return DIMS.map(function (d) {
      return d.emoji + d.name + ' ' + Math.round(p[d.k]);
    }).join(' · ');
  }

  /* 「我的」页的宠物数值总览卡（B 档要求的养成反馈面板） */
  function statsHTML() {
    if (!booted) { boot(); if (!booted) return ''; }
    var p = ensure();
    var rows = DIMS.map(function (d) {
      var v = clamp(Math.round(p[d.k]), 0, 100);
      return '<div style="display:flex;align-items:center;gap:10px;margin-top:10px">'
        + '<span style="min-width:78px;font-size:13px">' + d.emoji + ' ' + d.name + '</span>'
        + '<span style="flex:1;height:8px;border-radius:99px;background:rgba(46,36,25,.10);overflow:hidden">'
        + '<i style="display:block;height:100%;width:' + v + '%;border-radius:99px;background:currentColor;opacity:.55"></i></span>'
        + '<span style="min-width:92px;text-align:right;font-size:12px;opacity:.75">' + v + ' · ' + dimTier(d, p[d.k]) + '</span>'
        + '</div><div class="hint" style="margin:4px 0 0">' + d.hint + '</div>';
    }).join('');
    var acts = [];
    if (p.unlocked.indexOf('recite') >= 0) acts.push('🪶 念诗');
    if (p.unlocked.indexOf('roll') >= 0) acts.push('🌀 一起打滚');
    return '<div class="card"><h2>🐾 ' + L.esc(p.name) + ' 的状态</h2>'
      + '<div class="hint">亲密 ' + Math.round(p.intimacy) + '/100（' + levelName(p.intimacy) + '）· 饱食 '
      + Math.round(p.hunger) + '/100 · 小鱼干 ' + p.fish + ' 条</div>'
      + rows
      + '<div class="hint" style="margin-top:12px">解锁的小动作：'
      + (acts.length ? acts.join(' · ') : '还没有 —— 灵性 50 解锁「念诗」，心情 80 解锁「一起打滚」')
      + '</div></div>';
  }

  /* 休息日回血：休息本来就该恢复，这是三维度里唯一"什么都不做但状态变好"的一天。
     ⚠️ 连续休息要递减（第 1 天 +15 / 第 2-3 天 +8 / 之后不加），
     否则休息会变成刷数值的手段 —— 休息是用来恢复的，不是用来养的。 */
  function onRestDay(d) {
    var p = ensure();
    var rests = ST().restDays || [];
    if (rests.indexOf(d) < 0) return;
    var run = 0, cur = d;
    while (rests.indexOf(cur) >= 0 && run < 30) { run++; cur = L.addDays(cur, -1); }
    var eGain = run === 1 ? 15 : (run <= 3 ? 8 : 0);
    var mGain = run === 1 ? 8 : (run <= 3 ? 4 : 0);
    if (eGain > 0) {
      p.energy = clamp(p.energy + eGain, 0, 100);
      p.mood = clamp(p.mood + mGain, 0, 100);
      p.lastInteractAt = Date.now();   /* 休息也算"有联系"，别让衰减逻辑误判 */
      L.save();
    }
  }

  /* 记完一次计时 → 给它回点精力（这是 B 档里精力的主要来源） */
  function onRecord(minutes) {
    var p = ensure();
    if (!minutes || minutes <= 0) return;
    p.energy = clamp(p.energy + 4, 0, 100);
    p.lastInteractAt = Date.now();
    L.save();
  }

  function shopHTML() {
    if (!booted) { boot(); if (!booted) return null; }   /* 主界面可能比挂件先要渲染 */
    return tabShop(ensure(), 'shop');
  }
  function shopAct(act, id) {
    if (act === 'buy') buy(id);
    else if (act === 'use') useItem(id);
    else if (act === 'redeem') redeem(id);
    else if (act === 'delrw') delReward(id);
    else if (act === 'tododone') todoDone(id);
    else if (act === 'addrw') {
      var nEl = $('shopRwName'), cEl = $('shopRwCost');
      var nm = nEl ? nEl.value : '', cost = cEl ? cEl.value : '';
      if (!nm || !String(nm).trim() || !parseInt(cost, 10)) { L.toast('写个名字和价格'); return; }
      addReward(nm, cost);
      if (nEl) nEl.value = '';
      if (cEl) cEl.value = '';
    }
    if (L.render) L.render();     /* 整页要跟着重画，面板那边 renderPanel 会自己 guard */
  }

  /* ================= 样式 ================= */
  var CSS = [
    /* ===== 挂件：一个「小舞台」，不是一张飘着的贴图 ===== */
    '.pw-root{position:fixed;right:18px;bottom:18px;z-index:45;display:flex;flex-direction:column;align-items:flex-end;gap:7px;touch-action:none;-webkit-user-select:none;user-select:none;transition:transform .28s var(--e-out)}',
    '.pw-root.hidden{display:none}',
    /* 立绘是纵向的（约 1:2），盒子按这个比例给；不然会被 contain 缩得很小。
       程序化那只猫自己按 min(W/158, H/172) 缩放，这个盒子对它也够用。 */
    '.pw-stage{position:relative;width:132px;height:250px;margin-bottom:18px;cursor:grab;isolation:isolate;transition:width .3s var(--e-out),height .3s var(--e-out)}',
    '.pw-stage:active{cursor:grabbing}',
    '.pw-canvasbox{position:relative;z-index:2;filter:drop-shadow(0 10px 18px rgba(46,36,25,.20));animation:pwIdle 5.5s ease-in-out infinite}',
    '.pw-canvasbox canvas{display:block;width:100%;height:100%}',
    /* 它一直在「呼吸」——很小的幅度，不抢注意力 */
    '@keyframes pwIdle{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}',
    '.pw-root.link-active .pw-canvasbox{animation:none}',
    '.pw-root.collapsed .pw-canvasbox{animation:pwIdleMini 4.5s ease-in-out infinite}',
    '@keyframes pwIdleMini{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}',
    /* 背后柔光：让白猫从米色背景里「浮」出来，而不是糊成一片 */
    '.pw-halo{position:absolute;z-index:1;left:50%;bottom:6px;width:124px;height:104px;transform:translateX(-50%);pointer-events:none;border-radius:50%;',
    '  background:radial-gradient(closest-side,rgba(255,255,255,.92),rgba(255,252,246,.52) 58%,rgba(255,252,246,0) 100%);',
    '  transition:opacity .3s,transform .3s var(--e-out)}',
    /* 状态环：活力三档换色，饿了会呼吸 */
    '.pw-ring{position:absolute;z-index:0;left:50%;bottom:2px;width:116px;height:116px;transform:translateX(-50%);pointer-events:none;border-radius:50%;',
    '  border:2px solid transparent;transition:border-color .5s,box-shadow .5s}',
    '.pw-root.t-low  .pw-ring{border-color:rgba(143,163,176,.42);box-shadow:0 0 0 6px rgba(143,163,176,.09)}',
    '.pw-root.t-mid  .pw-ring{border-color:rgba(34,211,238,.40);box-shadow:0 0 0 6px rgba(34,211,238,.09)}',
    '.pw-root.t-high .pw-ring{border-color:rgba(94,234,212,.52);box-shadow:0 0 0 6px rgba(94,234,212,.13),0 0 22px rgba(224,169,59,.20)}',
    '.pw-root.is-hungry .pw-ring{border-color:rgba(224,169,59,.72);animation:pwHungry 2.4s ease-in-out infinite}',
    /* 三维度的观感：精力低 → 蔫一点、呼吸慢；心情低 → 发灰；心情高 → 亮、轻快。
       ⚠️ 基础 .pw-canvasbox 的 filter 里含着 drop-shadow，这里必须整条重写 ——
       只写 saturate/grayscale 会把阴影一起干掉（真踩过） */
    '.pw-root.is-tired .pw-canvasbox{filter:drop-shadow(0 10px 18px rgba(46,36,25,.20)) saturate(.82) brightness(.93);animation:pwSlow 6.4s ease-in-out infinite}',
    '.pw-root.is-tired .pw-ring{border-color:rgba(143,163,176,.40)}',
    '.pw-root.is-gloomy .pw-canvasbox{filter:drop-shadow(0 10px 18px rgba(46,36,25,.20)) grayscale(.38) saturate(.72) brightness(.96)}',
    '.pw-root.is-chipper .pw-canvasbox{filter:drop-shadow(0 10px 18px rgba(46,36,25,.20)) saturate(1.15) brightness(1.05);animation:pwPerk 3.2s ease-in-out infinite}',
    '@keyframes pwSlow{0%,100%{transform:translateY(0)}50%{transform:translateY(2px)}}',
    '@keyframes pwPerk{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}',
    '@keyframes pwHungry{0%,100%{box-shadow:0 0 0 5px rgba(224,169,59,.10)}50%{box-shadow:0 0 0 11px rgba(224,169,59,.02)}}',
    /* 悬停时微微抬起来 */
    '.pw-stage:hover .pw-canvasbox{transform:translateY(-3px);transition:transform .25s var(--e-out)}',
    '.pw-stage:hover .pw-halo{opacity:1;transform:translateX(-50%) scale(1.06)}',
    '.pw-root.sleeping .pw-canvasbox{filter:drop-shadow(0 8px 14px rgba(46,36,25,.14)) saturate(.86)}',
    /* 角落小工具 */
    '.pw-tools{position:absolute;z-index:4;top:2px;right:2px;display:flex;gap:4px;opacity:0;transform:translateY(-4px);transition:opacity .2s,transform .2s}',
    '.pw-stage:hover .pw-tools{opacity:1;transform:none}',
    '.pw-tool{width:23px;height:23px;border-radius:50%;background:rgba(255,255,255,.96);border:1px solid var(--line);color:#5b4a35;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(46,36,25,.16);transition:.15s}',
    '.pw-tool:hover{background:#fff;transform:scale(1.10)}',
    /* 快捷动作条：悬停时从猫脚下浮出来 */
    '.pw-quick{position:absolute;z-index:3;left:50%;bottom:-8px;transform:translateX(-50%) translateY(6px);display:flex;gap:5px;padding:5px 7px;border-radius:99px;',
    '  background:rgba(255,255,255,.95);border:1px solid var(--line);box-shadow:0 8px 20px rgba(46,36,25,.16);',
    '  opacity:0;pointer-events:none;transition:opacity .2s,transform .22s var(--e-out);backdrop-filter:blur(10px)}',
    '.pw-stage:hover .pw-quick{opacity:1;transform:translateX(-50%);pointer-events:auto}',
    '.pw-qbtn{width:26px;height:26px;border-radius:50%;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;transition:.14s}',
    '.pw-qbtn:hover{background:rgba(194,168,120,.30);transform:scale(1.14)}',
    /* 状态药丸 */
    '.pw-meta{display:flex;gap:5px;justify-content:center;pointer-events:none;min-height:19px}',
    '.pw-pill{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:99px;background:rgba(255,255,255,.86);border:1px solid var(--line);color:#5b4a35;box-shadow:0 2px 6px rgba(46,36,25,.07)}',
    '.pw-pill.warn{background:linear-gradient(135deg,#e8b64a,#d99a22);color:#4a3208;border-color:transparent}',
    /* 说话气泡：带一个小尾巴指向猫 */
    '.pw-bubble{position:relative;max-width:236px;padding:10px 14px;border-radius:16px;border-bottom-right-radius:6px;background:rgba(255,255,255,.96);border:1px solid var(--line);color:var(--ink);font-size:13px;line-height:1.5;box-shadow:0 12px 28px rgba(46,36,25,.18);opacity:0;transform:translateY(7px) scale(.95);transform-origin:bottom right;transition:opacity .24s var(--e-out),transform .24s var(--e-out);pointer-events:none;backdrop-filter:blur(12px)}',
    '.pw-bubble::after{content:"";position:absolute;right:16px;bottom:-6px;width:11px;height:11px;background:inherit;border-right:1px solid var(--line);border-bottom:1px solid var(--line);transform:rotate(45deg);border-bottom-right-radius:3px}',
    '.pw-bubble.on{opacity:1;transform:none}',
    /* 气泡的「⋯（再说一句）」小按钮：只让按钮本身可点，气泡本体继续穿透，
       免得它盖住底下页面的按钮（气泡只在冒出来那几秒存在） */
    '.pw-bubble .pw-say-again{pointer-events:auto;margin-left:6px;padding:1px 7px;border-radius:8px;font-size:12px;line-height:1.5;color:var(--muted);background:rgba(46,36,25,.06);border:none;vertical-align:middle}',
    '.pw-bubble .pw-say-again:hover{background:rgba(194,168,120,.32);color:var(--ink)}',
    '.pw-bubble .pw-say-txt{white-space:pre-wrap;word-break:break-word}',
    '.pw-bubble .pw-say-txt.typing{opacity:.62;font-style:italic}',
    /* 输入态：气泡就地变成一个很小的输入区（不是常驻对话框 —— 20s 没人碰自己收） */
    '.pw-bubble.input{pointer-events:auto;width:232px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;border-bottom-right-radius:16px}',
    '.pw-say-head{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted)}',
    '.pw-say-lab{font-weight:700;color:var(--ink);font-size:11.5px}',
    '.pw-say-x{margin-left:auto;width:18px;height:18px;border-radius:6px;background:rgba(46,36,25,.06);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted);flex:none;border:none}',
    '.pw-say-x:hover{background:rgba(46,36,25,.13)}',
    '.pw-say-quick{display:flex;gap:5px;flex-wrap:wrap}',
    '.pw-say-q{padding:3px 8px;border-radius:9px;font-size:11px;background:rgba(255,255,255,.72);border:1px solid var(--line);color:#5b4a35}',
    '.pw-say-q:hover{background:rgba(194,168,120,.22)}',
    '.pw-say-in{display:flex;gap:5px}',
    '.pw-say-in input{flex:1;min-width:0;padding:5px 8px;border-radius:9px;border:1px solid var(--line);background:rgba(255,255,255,.88);font-size:12px;color:var(--ink);outline:none;user-select:text;-webkit-user-select:text}',
    '.pw-say-in input:focus{border-color:var(--terracotta)}',
    '.pw-say-send{padding:0 9px;border-radius:9px;border:1px solid transparent;background:linear-gradient(135deg,var(--terracotta),var(--terracotta-d));color:#fff;font-size:11.5px;font-weight:700;flex:none}',
    /* 收起态：小圆点。立绘模式下 cyber-cat 会自动只取头部铺满，见 setHeadOnly */
    '.pw-root.collapsed .pw-stage{width:62px;height:62px;margin-bottom:8px}',
    '.pw-root.collapsed .pw-halo{width:56px;height:56px;bottom:2px}',
    '.pw-root.collapsed .pw-ring{width:52px;height:52px;bottom:1px;border-width:2px}',
    '.pw-root.collapsed .pw-canvasbox{border-radius:50%;overflow:hidden}',
    '.pw-root.collapsed .pw-quick,.pw-root.collapsed .pw-tools{display:none}',
    '.pw-root.collapsed .pw-meta{display:none}',
    /* ===== 常驻对话坞（2026-09-18）：挂件旁边一直能说话，不用先点开面板 ===== */
    '.pw-main{display:flex;align-items:flex-end;gap:10px}',
    /* 鼠标移开几秒后淡化 —— 它常驻在那儿，但不能一直抢视线、挡住底下的东西 */
    /* 绿点 = 真 AI 在回（配了 Key）；灰点 = 本地台词模式。一眼看出现在是谁在说话 */
    '.pw-dk-dot{width:7px;height:7px;border-radius:50%;background:#c8c2b8;flex:none}',
    '.pw-dk-dot.on{background:#5eead4;box-shadow:0 0 0 3px rgba(94,234,212,.20)}',
    /* 收起成小圆点时、或窄屏没地方时，对话坞让位 —— 别把屏幕占满 */
    '.pw-float{position:absolute;right:14px;bottom:150px;font-size:12px;font-weight:800;color:#a85d2c;pointer-events:none;animation:pwFloat 1.5s var(--e-out) forwards;white-space:nowrap;text-shadow:0 1px 3px rgba(255,255,255,.9)}',
    '@keyframes pwFloat{0%{opacity:0;transform:translateY(6px)}20%{opacity:1}100%{opacity:0;transform:translateY(-36px)}}',
    /* 面板 */
    '.pp-root{position:fixed;z-index:46;width:min(344px,calc(100vw - 28px));max-height:min(560px,calc(100vh - 200px));overflow:auto;padding:16px;border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(255,255,255,.88));border:1px solid var(--line);box-shadow:0 22px 54px rgba(46,36,25,.28);backdrop-filter:blur(24px) saturate(118%);-webkit-backdrop-filter:blur(24px) saturate(118%);color:var(--ink);animation:ppIn .2s var(--e-out)}',
    '@keyframes ppIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}',
    '.pp-root.hidden{display:none}',
    '.pp-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}',
    '.pp-who{flex:1;min-width:0}',
    '.pp-who .pp-name,.pp-who .pp-id{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* 三维度那一行要允许换行：宽度不够时宁可折行，也别把「✨灵性 …」截掉 */
    '.pp-who .pp-id.pp-dims{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.6}',
    '.pp-avatar{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,var(--khaki),var(--tawny));display:flex;align-items:center;justify-content:center;font-size:17px;flex:none}',
    '.pp-name{font-weight:800;font-size:16px;line-height:1.2}',
    '.pp-lv{font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;background:rgba(194,168,120,.24);color:#8a6d3b;white-space:nowrap}',
    '.pp-x{margin-left:auto;width:26px;height:26px;border-radius:8px;background:rgba(46,36,25,.06);color:var(--muted);font-size:13px;display:flex;align-items:center;justify-content:center;flex:none}',
    '.pp-x:hover{background:rgba(46,36,25,.12)}',
    '.pp-bars{display:flex;flex-direction:column;gap:7px;margin-bottom:13px}',
    '.pp-bar-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}',
    '.pp-bar-row .lb{width:62px;flex:none;white-space:nowrap}',
    '.pp-bar{flex:1;height:8px;border-radius:99px;background:rgba(46,36,25,.09);overflow:hidden}',
    '.pp-bar i{display:block;height:100%;border-radius:99px;transition:width .6s var(--e-out)}',
    '.pp-bar i.h{background:linear-gradient(90deg,var(--khaki),var(--terracotta))}',
    '.pp-bar i.i{background:linear-gradient(90deg,#d6627a,#c0703c)}',
    '.pp-bar-row .vv{width:50px;text-align:right;flex:none;font-weight:700;color:var(--ink)}',
    '.pp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}',
    '.pp-tab{padding:6px 12px;border-radius:10px;font-size:12.5px;font-weight:700;background:rgba(255,255,255,.62);border:1px solid var(--line);color:var(--muted)}',
    '.pp-tab.on{background:linear-gradient(135deg,var(--terracotta),var(--terracotta-d));color:#fff;border-color:transparent}',
    '.pp-sec{font-size:12px;color:var(--muted);margin:2px 0 8px;line-height:1.5}',
    '.pp-item{display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.66);margin-bottom:8px}',
    '.pp-emo{font-size:21px;width:26px;text-align:center;flex:none}',
    '.pp-ib{flex:1;min-width:0}',
    '.pp-in{font-weight:700;font-size:13.5px}',
    '.pp-id{font-size:11.5px;color:var(--muted);margin-top:2px}',
    '.pp-acts{display:flex;gap:6px;align-items:center;flex:none}',
    '.pp-cost{font-size:12px;font-weight:800;color:#8a5a12;white-space:nowrap}',
    /* 说话气泡（面板里 / 伙伴页「说一句话」卡里）：**没有消息列表**，
       只有它刚说的那一句，说完自己收起来 —— 收起时 max-height/padding 归零，不占地方 */
    '.pp-bub,.pg-say{margin:2px 0 8px;padding:0 11px;border-radius:14px;border:1px solid var(--line);background:rgba(194,168,120,.20);color:var(--ink);font-size:12.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:0;overflow:hidden;opacity:0;transition:opacity .22s var(--e-out),max-height .22s var(--e-out),padding .22s var(--e-out)}',
    '.pp-bub.on,.pg-say.on{max-height:190px;overflow:auto;opacity:1;padding:9px 11px}',
    '.pp-bub.typing,.pg-say.typing{opacity:.62;font-style:italic}',
    /* 不用想词，一点就发（和挂件气泡里那三个同一套） */
    '.pp-quick{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 9px}',
    '.pp-q{padding:4px 9px;border-radius:9px;font-size:11.5px;background:rgba(255,255,255,.75);border:1px solid var(--line);color:#5b4a35;cursor:pointer;font-family:inherit}',
    '.pp-q:hover{background:rgba(194,168,120,.24)}',
    '.pp-inrow{display:flex;gap:8px;margin-top:10px}',
    '.pp-inrow input,.pp-field input{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:11px;font-family:inherit;font-size:13.5px;background:rgba(255,255,255,.84);color:var(--ink);width:100%}',
    '.pp-field{display:flex;gap:8px;margin:8px 0}',
    '.pp-badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(34,211,238,.16);color:#0e7490}',
    '.pp-badge.local{background:rgba(122,138,153,.18);color:#5d6b78}',
    '.pp-todo{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:11px;background:rgba(47,158,107,.10);border:1px solid rgba(47,158,107,.22);margin-bottom:7px;font-size:13px}',
    '.pp-todo.done{opacity:.55;text-decoration:line-through}',
    '.pp-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}',
    '.pp-switch{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink);margin-bottom:8px}',
    /* ===== 伙伴页（侧栏「伙伴」栏目） ===== */
    '.pg-hero{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}',
    /* .pg-cat 的高度决定 cyber-cat 的 U（U = min(W/158, H/172)）。
       原来 234px 配 230~250px 宽，比值大于 172/158，猫会被上下裁掉一截；
       改成 300px 让高度不再成为瓶颈。 */
    '.pg-stage{position:relative;flex:1 1 250px;min-width:230px;min-height:300px;border-radius:20px;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:6px;background:linear-gradient(180deg,rgba(255,255,255,.74),rgba(255,255,255,.46));border:1px solid var(--line)}',
    '.pg-cat{width:100%;height:300px}',
    '.pg-cat canvas{display:block;width:100%;height:100%}',
    '.pg-badge{position:absolute;top:10px;right:10px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:rgba(255,255,255,.86);border:1px solid var(--line);color:#5b4a35}',
    /* 大猫的说话气泡 —— 和右下角挂件共用一句话，让人在伙伴页也能看见它开口 */
    '.pg-bub{position:absolute;left:10px;top:12px;z-index:2;max-width:min(212px,60%);padding:9px 13px;border-radius:15px;border-bottom-right-radius:6px;background:rgba(255,255,255,.96);border:1px solid var(--line);color:var(--ink);font-size:12.5px;line-height:1.5;box-shadow:0 10px 24px rgba(46,36,25,.16);opacity:0;transform:translateY(6px) scale(.96);transform-origin:bottom right;transition:opacity .24s var(--e-out),transform .24s var(--e-out);pointer-events:none;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
    '.pg-bub::after{content:"";position:absolute;right:15px;bottom:-6px;width:10px;height:10px;background:inherit;border-right:1px solid var(--line);border-bottom:1px solid var(--line);transform:rotate(45deg);border-bottom-right-radius:3px}',
    '.pg-bub.on{opacity:1;transform:none}',
    '.pg-side{flex:1 1 280px;min-width:250px;display:flex;flex-direction:column;gap:11px}',
    '.pg-name{font-size:19px;font-weight:800;display:flex;align-items:center;gap:8px;color:var(--ink)}',
    '.pg-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto}',
    '.pg-row{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px dashed rgba(46,36,25,.10);font-size:13.5px;flex-wrap:wrap}',
    '.pg-row:last-child{border-bottom:none}',
    '.pg-row .lb{flex:1;min-width:150px;color:var(--ink)}',
    '.pg-row .lb small{display:block;color:var(--muted);font-size:11.5px;margin-top:2px;line-height:1.45}',
    '.pg-switch{position:relative;width:46px;height:25px;border-radius:99px;background:rgba(46,36,25,.16);flex:none;transition:.2s;cursor:pointer}',
    '.pg-switch.on{background:linear-gradient(135deg,var(--terracotta),var(--terracotta-d))}',
    '.pg-switch i{position:absolute;top:2.5px;left:2.5px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 4px rgba(46,36,25,.3)}',
    '.pg-switch.on i{left:23px}',
    '.pg-chips{display:flex;gap:6px;flex-wrap:wrap}',
    '.pg-chip{padding:6px 12px;border-radius:10px;font-size:12.5px;font-weight:700;border:1px solid var(--line);background:rgba(255,255,255,.7);color:var(--muted)}',
    '.pg-chip.on{background:linear-gradient(135deg,var(--terracotta),var(--terracotta-d));color:#fff;border-color:transparent}',
    '.pg-chip.lock{opacity:.5}',
    '.pg-inp{padding:8px 11px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.82);color:var(--ink);font-family:inherit;font-size:13.5px}',
    '.pg-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px}',
    '.pg-stat{padding:12px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.62)}',
    '.pg-stat b{display:block;font-family:var(--font-display);font-size:23px;font-weight:400;color:var(--ink);line-height:1.15}',
    '.pg-stat span{font-size:11.5px;color:var(--muted)}',
    '.pg-ledger{display:flex;flex-direction:column;gap:7px;max-height:210px;overflow:auto}',
    '.pg-led{display:flex;gap:10px;font-size:12.5px;color:var(--muted);align-items:baseline}',
    '.pg-led b{color:#8a5a12;min-width:34px;text-align:right;flex:none}',
    '.pg-danger{display:flex;gap:8px;flex-wrap:wrap}',
    '.pg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(144px,1fr));gap:10px}',
    '.pg-ibtn{text-align:left;padding:12px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.66);transition:.15s}',
    '.pg-ibtn:hover{border-color:var(--terracotta);background:rgba(194,168,120,.16);transform:translateY(-1px)}',
    '.pg-ibtn .e{font-size:19px;display:block;line-height:1.25}',
    '.pg-ibtn b{display:block;font-size:13.5px;color:var(--ink);margin:3px 0 2px}',
    '.pg-ibtn small{display:block;font-size:11.5px;color:var(--muted);line-height:1.45}',
    /* 窄屏：挂件抬高一点，气泡也得收窄，否则会顶到屏幕边 */
    '@media(max-width:820px){.pw-root{right:12px;bottom:92px}.pw-stage{width:116px;height:220px}.pw-bubble{max-width:186px}.pw-bubble.input{width:182px}.pp-root{left:10px;right:10px;top:auto;bottom:10px;width:auto;max-height:66vh;border-radius:18px}.pg-cat{height:250px}}',
    /* 用户在系统里开了「减少动态效果」，就别抖了 */
    '@media(prefers-reduced-motion:reduce){.pw-root,.pw-stage,.pw-canvasbox,.pw-halo,.pw-ring,.pw-bubble,.pg-bub,.pw-quick,.pw-tools{transition:none!important;animation:none!important}}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('petCSS')) return;
    var st = document.createElement('style');
    st.id = 'petCSS';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ================= DOM ================= */
  function buildDOM() {
    injectCSS();
    if ($('petWidget')) return;

    var root = document.createElement('div');
    root.id = 'petWidget';
    root.className = 'pw-root';
    root.innerHTML =
      '<div class="pw-bubble" id="pwBubble"></div>'
      /* 结构只剩猫本体 —— 以前这里并排挂着常驻对话坞，已改成气泡输入（见 renderBubble） */
      + '<div class="pw-main">'
        + '<div class="pw-stage" id="pwCatBox" title="点我打开 · 按住可以拖到别处">'
        + '<div class="pw-halo" aria-hidden="true"></div>'
        + '<div class="pw-ring" aria-hidden="true"></div>'
        + '<div class="pw-tools">'
          + '<button class="pw-tool" data-pact="collapse" title="收起成小圆点">−</button>'
          + '<button class="pw-tool" data-pact="hide" title="藏起来（「我的」里可以叫回来）">×</button>'
        + '</div>'
        + '<div class="pw-quick">'
          + '<button class="pw-qbtn" data-pact="q-feed" title="喂它">🐟</button>'
          + '<button class="pw-qbtn" data-pact="q-pat" title="摸摸它">🤚</button>'
          + '<button class="pw-qbtn" data-pact="q-chat" title="说说话">💬</button>'
          + '<button class="pw-qbtn" data-pact="q-page" title="伙伴详情">🐾</button>'
        + '</div>'
      + '</div></div>'
      + '<div class="pw-meta" id="pwMeta"></div>';
    document.body.appendChild(root);

    var panel = document.createElement('div');
    panel.id = 'petPanel';
    panel.className = 'pp-root hidden';
    document.body.appendChild(panel);

    /* 猫：同一个 canvas 既当挂件本体也当收起后的小圆点，
       靠 CSS 缩放而不是重建实例，收起/展开不会闪、也不多跑一个动画循环。 */
    var box = document.createElement('div');
    box.className = 'pw-canvasbox';
    box.style.width = '100%';
    box.style.height = '100%';
    $('pwCatBox').insertBefore(box, $('pwCatBox').firstChild);
    if (window.CyberCat) {
      var p = ensure();
      cat = CyberCat.mount(box, {
        vitality: L.vitality(),
        bare: true,
        hungry: p.hunger < 30,
        gear: p.gear
      });
    }
  }

  /* ================= 交互：拖动 / 点击 / 收起 ================= */
  /* 挂件大小档位 */
  var SIZES = { S: 0.86, M: 1, L: 1.18 };

  function applyPos() {
    var p = ensure(), root = $('petWidget');
    if (!root) return;
    var isCollapsed = !!p.widget.collapsed;
    root.classList.toggle('collapsed', isCollapsed);
    root.classList.toggle('hidden', !!p.widget.hidden);
    /* 收起成小圆点时，立绘只画头部铺满（整只塞进 62px 会小到看不清） */
    if (cat && cat.setHeadOnly) cat.setHeadOnly(isCollapsed);
    var k = SIZES[p.widget.size] || 1;
    root.style.transform = k === 1 ? '' : 'scale(' + k + ')';
    root.style.transformOrigin = 'bottom right';
    if (p.widget.x == null || p.widget.hidden) {
      root.style.left = ''; root.style.top = '';
      root.style.right = ''; root.style.bottom = '';
    } else {
      root.style.left = p.widget.x + 'px';
      root.style.top = p.widget.y + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    }
  }

  function placePanel() {
    var root = $('petWidget'), pp = $('petPanel');
    if (!root || !pp || pp.classList.contains('hidden')) return;
    if (window.innerWidth <= 820) {
      /* 手机上交给 CSS（底部抽屉），清掉内联定位免得互相打架 */
      pp.style.left = ''; pp.style.right = ''; pp.style.top = ''; pp.style.bottom = ''; pp.style.width = '';
      return;
    }
    var r = root.getBoundingClientRect();
    var pw = pp.offsetWidth, ph = pp.offsetHeight;
    var left = clamp(r.right - pw, 8, Math.max(8, window.innerWidth - pw - 8));
    var top = r.top - ph - 10;
    if (top < 8) top = Math.min(window.innerHeight - ph - 8, r.bottom + 10);
    pp.style.left = left + 'px';
    pp.style.top = Math.max(8, top) + 'px';
    pp.style.right = 'auto';
    pp.style.bottom = 'auto';
  }

  function onDown(e) {
    var t = e.target;
    /* 气泡（尤其输入态）也要排除：不然点气泡空白处会被当成拖挂件，松手还会顺手开面板 */
    if (t.closest('button') || t.closest('input') || t.closest('.pw-bubble')) return;
    var root = $('petWidget');
    if (!root) return;
    var r = root.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: 0, last: null };
    /* 拖动时停掉上下浮动，并藏起快捷条，免得跟手势打架 */
    root.classList.add('link-active');
    if (root.setPointerCapture) { try { root.setPointerCapture(e.pointerId); } catch (err) {} }
    lastAct = Date.now();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    lastAct = Date.now();
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    if (drag.moved < 6) return;
    var root = $('petWidget');
    var W = root.offsetWidth, H = root.offsetHeight;
    var x = clamp(drag.ox + dx, 4, Math.max(4, window.innerWidth - W - 4));
    var y = clamp(drag.oy + dy, 4, Math.max(4, window.innerHeight - H - 4));
    root.style.left = x + 'px'; root.style.top = y + 'px';
    root.style.right = 'auto'; root.style.bottom = 'auto';
    drag.last = { x: x, y: y };
    placePanel();
  }
  function onUp(e) {
    var root = $('petWidget');
    if (root) root.classList.remove('link-active');
    if (!drag) return;
    var moved = drag.moved, last = drag.last;
    var p = ensure();
    if (moved >= 6 && last) {
      p.widget.x = last.x; p.widget.y = last.y; L.save();
    } else if (moved < 6) {
      togglePanel();
    }
    drag = null;
  }

  /* ================= 面板 ================= */
  function isPanelOpen() {
    var pp = $('petPanel');
    return !!(pp && !pp.classList.contains('hidden'));
  }
  function openPanel(tab) {
    var p = ensure();
    if (tab) panelTab = tab;
    p.widget.hidden = false;
    L.save();
    applyPos();
    var pp = $('petPanel');
    pp.classList.remove('hidden');
    renderPanel();
    closeInput();      /* 面板自己带聊天区 → 把气泡输入收掉，免得两块重复 */
  }
  function closePanel() {
    var pp = $('petPanel');
    if (pp) pp.classList.add('hidden');
    renderBubble();    /* 关掉面板 → 气泡状态重新评估（输入态是关了就关，不会自己冒出来） */
  }
  function togglePanel() { if (isPanelOpen()) closePanel(); else openPanel(); }

  var memQuery = '', memKind = '';

  function renderPanel() {
    var pp = $('petPanel');
    if (!pp || pp.classList.contains('hidden')) return;
    var p = ensure();
    var v = L.vitality();
    var lv = levelName(p.intimacy);
    var h = '';

    h += '<div class="pp-head"><div class="pp-avatar">🐱</div>'
      + '<div class="pp-who"><div class="pp-name">' + L.esc(p.name) + '</div>'
      + '<div class="pp-id">今日状态 ' + Math.round(v) + '/100 · 连续着陆 ' + L.landingDays() + ' 天</div>'
      + '</div>'
      + '<span class="pp-lv">' + lv + '</span>'
      + '<button class="pp-x" data-pact="close">✕</button></div>';
    /* 三维度独占一行放在头像区下面：放在名字那一列里会被 nowrap 挤断 */
    h += '<div class="pp-id pp-dims">' + dimsHTML(p) + '</div>';

    h += '<div class="pp-bars">'
      + '<div class="pp-bar-row"><span class="lb">🍚 饱食</span><span class="pp-bar"><i class="h" style="width:' + Math.round(p.hunger) + '%"></i></span><span class="vv">' + Math.round(p.hunger) + '</span></div>'
      + '<div class="pp-bar-row"><span class="lb">💗 亲密</span><span class="pp-bar"><i class="i" style="width:' + Math.round(p.intimacy) + '%"></i></span><span class="vv">' + Math.round(p.intimacy) + '</span></div>'
      + '<div class="pp-bar-row"><span class="lb">🐟 小鱼干</span><span class="pp-bar"><i class="h" style="width:' + Math.min(100, p.fish) + '%"></i></span><span class="vv">' + p.fish + ' 条</span></div>'
      + '</div>';

    var TABS = [['pet', '伙伴'], ['feed', '喂养'], ['chat', '说话'], ['shop', '商城'], ['mem', '记忆']];
    h += '<div class="pp-tabs">' + TABS.map(function (t) {
      return '<button class="pp-tab' + (panelTab === t[0] ? ' on' : '') + '" data-pact="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';

    if (panelTab === 'pet') h += tabPet(p);
    else if (panelTab === 'feed') h += tabFeed(p);
    else if (panelTab === 'chat') h += tabChat(p);
    else if (panelTab === 'shop') h += tabShop(p);
    else if (panelTab === 'mem') h += tabMem();

    pp.innerHTML = h;
    placePanel();
    /* 重绘会把气泡一起冲掉（「正在想…」尤其明显，它是每次发话后立刻要看到的）——
       所以补回来，跟伙伴页那边同一个道理 */
    restoreSay();
  }

  function tabPet(p) {
    var state = p.hunger < 28 ? '它有点饿了，正在盯着你看。'
      : (p.hunger > 80 ? '吃得很饱，正在打盹。'
        : (p.intimacy > 60 ? '它现在很黏你。' : '它就在这儿，不吵你。'));
    var h = '<div class="pp-sec">' + state + '</div>'
      + '<div class="pp-field">'
      + '<button class="btn primary sm" data-pact="pat" style="flex:1">🤚 抚摸</button>'
      + '<button class="btn ghost sm" data-pact="tab" data-tab="feed" style="flex:1">🐟 喂食</button>'
      + '<button class="btn ghost sm" data-pact="tab" data-tab="chat" style="flex:1">💬 说话</button>'
      + '</div>'
      + '<div class="pp-field" style="flex-wrap:wrap">'
      + '<button class="btn ghost sm" data-pact="act" data-id="play">🪄 逗它玩</button>'
      + '<button class="btn ghost sm" data-pact="act" data-id="chin">🤏 挠下巴</button>'
      + '<button class="btn ghost sm" data-pact="act" data-id="lift">🙌 举高高</button>'
      + '<button class="btn ghost sm" data-pact="act" data-id="call">📣 喊它</button>'
      + '<button class="btn ghost sm" data-pact="act" data-id="daze">☁️ 一起发呆</button>'
      + '<button class="btn ghost sm" data-pact="act" data-id="sleep">' + (p.sleeping ? '☀️ 叫醒' : '💤 让它睡') + '</button>'
      + (p.unlocked.indexOf('recite') >= 0 ? '<button class="btn ghost sm" data-pact="act" data-id="recite">🪶 念诗</button>' : '')
      + (p.unlocked.indexOf('roll') >= 0 ? '<button class="btn ghost sm" data-pact="act" data-id="roll">🌀 一起打滚</button>' : '')
      + '</div>'
      + '<button class="btn ghost sm block" data-pact="goto-page" style="margin-top:9px">🐾 详情设定与全部数据 →</button>'
      + '<div class="pp-sec" style="margin-top:12px">'
      + '· 做事的每一分钟都攒进池子，<b>每满 60 分钟</b>领 1 条小鱼干 🐟（零头当天清零）<br/>'
      + '· 长周期任务的「推进量」（个/页/词）每推进一次额外 +1 条，过半 +2、完成 +5<br/>'
      + '· 鱼干可以买吃的、玩具、装扮，也可以兑换你自己定的现实奖励<br/>'
      + '· 饿了只会蔫一点、会讨食，<b>不会掉亲密度、不会枯萎</b>'
      + '</div>';

    h += '<div class="pp-sec" style="margin-top:10px"><b>它的小仓库</b></div>';
    var has = false;
    ITEMS.forEach(function (it) {
      if (!p.owned[it.id] || it.kind !== 'food') return;
      has = true;
      h += '<div class="pp-item"><span class="pp-emo">' + it.emoji + '</span>'
        + '<div class="pp-ib"><div class="pp-in">' + it.name + ' ×' + p.owned[it.id] + '</div>'
        + '<div class="pp-id">饱食 +' + it.hunger + ' · 亲密 +' + (it.intimacy || 0) + '</div></div>'
        + '<span class="pp-acts"><button class="btn primary sm" data-pact="feed" data-id="' + it.id + '">喂它</button></span></div>';
    });
    if (!has) h += '<div class="pp-sec">仓库空着，去商城买点吃的。</div>';

    var gearNames = [p.gear.neck, p.gear.face, p.gear.head].filter(Boolean)
      .map(function (id) { return (itemById(id) || {}).name; }).filter(Boolean);
    h += '<div class="pp-sec" style="margin-top:10px">当前装扮：' + (gearNames.length ? gearNames.join(' · ') : '（裸猫一只）') + '</div>';

    h += '<div class="pp-sec" style="margin-top:12px"><b>设置</b></div>'
      + '<div class="pp-field"><input id="ppName" value="' + L.esc(p.name) + '" placeholder="它的名字" maxlength="12">'
      + '<button class="btn ghost sm" data-pact="rename">改名</button></div>'
      + '<label class="pp-switch"><input type="checkbox" id="ppQuiet" data-pact="quiet"' + (p.widget.quiet ? ' checked' : '') + '> 别自己说话（关掉自动气泡）</label>'
      + '<div class="pp-field">'
      + '<button class="btn ghost sm" data-pact="reset-pos" style="flex:1">回到右下角</button>'
      + '<button class="btn ghost sm" data-pact="clear-mem" style="flex:1">清空记忆</button>'
      + '</div>';
    return h;
  }

  function tabFeed(p) {
    var h = '<div class="pp-sec">喂它一次，它就更饱一点、更黏你一点。食物要用小鱼干在商城买。</div>';
    ITEMS.filter(function (it) { return it.kind === 'food'; }).forEach(function (it) {
      var own = p.owned[it.id] || 0;
      h += '<div class="pp-item"><span class="pp-emo">' + it.emoji + '</span>'
        + '<div class="pp-ib"><div class="pp-in">' + it.name + ' <span class="pp-cost">' + it.cost + ' 🐟</span></div>'
        + '<div class="pp-id">' + (own ? ('库存 ' + own + ' 份') : '库存 0') + ' · 饱食 +' + it.hunger + ' · 亲密 +' + (it.intimacy || 0) + '</div></div>'
        + '<span class="pp-acts">'
        + (own ? '<button class="btn primary sm" data-pact="feed" data-id="' + it.id + '">喂</button>' : '')
        + '<button class="btn ghost sm" data-pact="buy" data-id="' + it.id + '">买</button>'
        + '</span></div>';
    });
    return h;
  }

  /* 不用想词，一点就发（走同一条 chat()，记忆/亲密度照算） */
  var QUICK_SAY = ['今天好累', '有点慌', '做完了'];

  /* 面板的「说话」tab：**没有消息列表** —— 只有它刚说的那句话 + 一行输入 */
  function tabChat(p) {
    var hasAI = petAI().ready;
    var h = '<div class="pp-sec">说一句就走，<b>不留记录</b>。'
      + (hasAI
          ? '<span class="pp-badge">' + petAIText() + '</span>'
          : '<span class="pp-badge local">本地台词模式 · 配了 AI 会更懂你</span>')
      + '</div>';
    h += '<div class="pp-bub" id="ppBub"></div>';
    h += '<div class="pp-quick">' + QUICK_SAY.map(function (t) {
      return '<button class="pp-q" data-pact="qsay" data-id="' + t + '">' + t + '</button>';
    }).join('') + '</div>';
    h += '<div class="pp-inrow"><input id="ppChatIn" placeholder="跟它说点什么…" maxlength="200">'
      + '<button class="btn primary sm" data-pact="send">发送</button></div>';
    return h;
  }

  function tabShop(p, idp) {
    idp = idp || 'pp';            /* 输入框 id 前缀：挂件面板 pp / 独立页 shop */
    var ppf = L.poolProgress ? L.poolProgress() : null;
    var h = '<div class="pp-sec">余额 <b>' + p.fish + '</b> 🐟 · '
      + (ppf ? '今天已攒 <b>' + ppf.minutes + '/' + ppf.need + '</b> 分钟' : '鱼干来自做事的时长') + '</div>';

    h += '<div class="pp-sec" style="margin-top:6px"><b>吃的</b></div>';
    ITEMS.filter(function (it) { return it.kind === 'food'; }).forEach(function (it) {
      h += shopRow(p, it, (p.owned[it.id] || 0) ? '买（现有 ' + p.owned[it.id] + '）' : '买');
    });

    h += '<div class="pp-sec" style="margin-top:12px"><b>玩具与装扮</b></div>';
    ITEMS.filter(function (it) { return it.kind === 'toy' || it.kind === 'gear'; }).forEach(function (it) {
      var owned = !!(p.owned[it.id]);
      var wearing = it.kind === 'gear' && p.gear[it.slot] === it.id;
      h += '<div class="pp-item"><span class="pp-emo">' + it.emoji + '</span>'
        + '<div class="pp-ib"><div class="pp-in">' + it.name + ' <span class="pp-cost">' + it.cost + ' 🐟</span></div>'
        + '<div class="pp-id">' + it.desc + '</div></div>'
        + '<span class="pp-acts">'
        + (owned
          ? (it.kind === 'gear'
            ? '<button class="btn ' + (wearing ? 'ghost' : 'primary') + ' sm" data-pact="use" data-id="' + it.id + '">' + (wearing ? '摘下' : '戴上') + '</button>'
            : '<span class="pp-badge">已拥有</span>')
          : '<button class="btn primary sm" data-pact="buy" data-id="' + it.id + '">买</button>')
        + '</span></div>';
    });

    h += '<div class="pp-sec" style="margin-top:12px"><b>给自己的奖励</b> — 用鱼干兑换现实里的东西</div>';
    p.rewards.forEach(function (r) {
      h += '<div class="pp-item"><span class="pp-emo">🎁</span>'
        + '<div class="pp-ib"><div class="pp-in">' + L.esc(r.name) + ' <span class="pp-cost">' + r.cost + ' 🐟</span></div>'
        + (r.desc ? '<div class="pp-id">' + L.esc(r.desc) + '</div>' : '') + '</div>'
        + '<span class="pp-acts"><button class="btn primary sm" data-pact="redeem" data-id="' + r.id + '">兑换</button>'
        + '<button class="btn ghost sm" data-pact="delrw" data-id="' + r.id + '">删</button></span></div>';
    });
    h += '<div class="pp-field"><input id="' + idp + 'RwName" placeholder="奖励名称，比如「看一集番」" maxlength="20">'
      + '<input id="' + idp + 'RwCost" type="number" placeholder="鱼干" style="max-width:78px">'
      + '<button class="btn ghost sm" data-pact="addrw">加</button></div>';

    var todo = p.todo.filter(function (t) { return !t.done; });
    if (todo.length) {
      h += '<div class="pp-sec" style="margin-top:12px"><b>待兑现</b>（换了就去享受）</div>';
      todo.forEach(function (t) {
        h += '<div class="pp-todo"><span>🎁 ' + L.esc(t.name) + '</span>'
          + '<button class="btn ghost sm" style="margin-left:auto" data-pact="tododone" data-id="' + t.id + '">用了</button></div>';
      });
    }
    var doneTodo = p.todo.filter(function (t) { return t.done; }).slice(-3);
    if (doneTodo.length) {
      h += '<div class="pp-sec" style="margin-top:10px">最近兑现：' + doneTodo.map(function (t) { return L.esc(t.name); }).join(' · ') + ' ✓</div>';
    }
    return h;
  }

  function shopRow(p, it, label) {
    return '<div class="pp-item"><span class="pp-emo">' + it.emoji + '</span>'
      + '<div class="pp-ib"><div class="pp-in">' + it.name + ' <span class="pp-cost">' + it.cost + ' 🐟</span></div>'
      + '<div class="pp-id">' + it.desc + '</div></div>'
      + '<span class="pp-acts"><button class="btn ' + (p.fish >= it.cost ? 'primary' : 'ghost') + ' sm" data-pact="buy" data-id="' + it.id + '">' + label + '</button></span></div>';
  }

  function tabMem() {
    var all = ST().memories || [];
    /* 没有「对话」这一档了：对话不留记录（master 口径），记忆库只装"你做过的事" */
    var KINDS = [['', '全部'], ['feed', '投喂'], ['pet', '抚摸'], ['task', '任务'], ['fish', '小鱼干'], ['milestone', '里程碑'], ['fun', '放开'], ['note', '记录'], ['rest', '休息']];
    var h = '<div class="pp-sec">它记得你做的事，也记得你说过的话。共 ' + all.length + ' 条。</div>';
    h += '<div class="pp-tabs">' + KINDS.map(function (k) {
      return '<button class="pp-tab' + (memKind === k[0] ? ' on' : '') + '" data-pact="memkind" data-k="' + k[0] + '">' + k[1] + '</button>';
    }).join('') + '</div>';
    h += '<div class="pp-field"><input id="ppMemQ" placeholder="搜索记忆…" value="' + L.esc(memQuery) + '"></div>';

    var list = all.slice().reverse().filter(function (m) {
      if (memKind && m.kind !== memKind) return false;
      if (memQuery && m.text.indexOf(memQuery) < 0) return false;
      return true;
    }).slice(0, 60);

    if (!list.length) h += '<div class="pp-sec">没有匹配的记忆。</div>';
    else {
      h += '<div class="mem-list">';
      list.forEach(function (m) {
        h += '<div class="mem-item"><span class="mem-kind k-' + (m.kind || 'note') + '">' + (L.MEM_KIND[m.kind] || '记录') + '</span>'
          + '<div class="mem-body">' + L.esc(m.text)
          + '<span class="mem-time">' + new Date(m.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span></div></div>';
      });
      h += '</div>';
    }
    return h;
  }

  /* ================= 伙伴页（侧栏栏目 · 详情与设定） ================= */
  var pageCat = null;

  function renderPage() {
    if (!booted) { boot(); if (!booted) return; }   /* 伙伴页可能比挂件先要渲染 */
    var root = $('petPage');
    if (!root) {
      if (pageCat) { try { pageCat.dispose(); } catch (e) {} pageCat = null; }
      return;
    }
    var p = ensure();
    var v = L.vitality(), T = L.tierOf(v), lv = levelName(p.intimacy);
    var t0 = new Date(); t0.setHours(0, 0, 0, 0);
    var earnedToday = (p.fishLog || []).filter(function (x) { return x.at >= t0.getTime(); })
      .reduce(function (a, x) { return a + (x.n || 0); }, 0);
    var days = Math.max(1, Math.round((Date.now() - p.bornAt) / 86400000) + 1);

    function bar(label, val, cls) {
      return '<div class="pp-bar-row"><span class="lb">' + label + '</span>'
        + '<span class="pp-bar"><i class="' + cls + '" style="width:' + Math.round(val) + '%"></i></span>'
        + '<span class="vv">' + Math.round(val) + '</span></div>';
    }
    function swRow(label, sub, on, act) {
      return '<div class="pg-row"><span class="lb">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span>'
        + '<div class="pg-switch' + (on ? ' on' : '') + '" data-pact="' + act + '"><i></i></div></div>';
    }
    function stat(n, label) {
      return '<div class="pg-stat"><b>' + n + '</b><span>' + label + '</span></div>';
    }

    var h = '';

    /* 主视觉 + 状态 + 快捷互动 */
    h += '<div class="pg-hero">'
      + '<div class="pg-stage"><div class="pg-cat" id="pgCat"></div>'
      + '<div class="pg-badge">' + L.tierText(T) + ' · 今日状态 ' + Math.round(v) + '</div>'
      + '<div class="pg-bub" id="pgBub"></div></div>'
      + '<div class="pg-side">'
      + '<div class="pg-name">' + L.esc(p.name) + '<span class="pp-lv">' + lv + '</span></div>'
      + '<div class="pp-bars">' + bar('🍚 饱食', p.hunger, 'h') + bar('💗 亲密', p.intimacy, 'i')
      + '<div class="pp-bar-row"><span class="lb">🐟 小鱼干</span><span class="pp-bar"><i class="h" style="width:' + Math.min(100, p.fish) + '%"></i></span><span class="vv">' + p.fish + ' 条</span></div>'
      + '</div>'
      + '<div class="pp-sec" style="margin:0">连续着陆 ' + L.landingDays() + ' 天 · 相伴 ' + days + ' 天 · 今天赚到 ' + earnedToday + ' 🐟</div>'
      + '<div class="pg-actions">'
      + '<button class="btn primary sm" data-pact="pat">🤚 抚摸</button>'
      + '<button class="btn ghost sm" data-pact="panel-shop">🛒 商城</button>'
      + '<button class="btn ghost sm" data-pact="panel-mem">📖 记忆库</button>'
      + '</div></div></div>';

    /* 和它玩（新增交互） */
    var dazing = !!(p.dazeUntil && p.dazeUntil > Date.now());
    function ibtn(id, emoji, title, sub) {
      return '<button class="pg-ibtn" data-pact="act" data-id="' + id + '"><span class="e">' + emoji + '</span>'
        + '<b>' + title + '</b><small>' + sub + '</small></button>';
    }
    h += '<div class="card"><div class="row between"><h2>🐾 和它玩</h2>'
      + (dazing ? '<span class="pg-chip on" id="pgDaze">发呆中</span>' : '')
      + (p.sleeping ? '<span class="pg-chip">💤 睡觉中</span>' : '') + '</div>'
      + '<div class="hint">怎么点都行，只加不减，没有惩罚。冷却只是防连点。</div>'
      + '<div class="pg-grid">'
      + ibtn('play', '🪄', '逗它玩', '亲密 +2（有逗猫棒 +3）')
      + ibtn('lift', '🙌', '举高高', '亲密 +1')
      + ibtn('chin', '🤏', '挠下巴', '亲密 +2')
      + ibtn('call', '📣', '喊它一声', '它会应你，不加也不减')
      + ibtn('daze', '☁️', dazing ? '发呆中…' : '一起发呆 60 秒', '什么都不做也算陪伴，结束 +2')
      + ibtn('sleep', p.sleeping ? '☀️' : '💤', p.sleeping ? '叫醒它' : '让它睡一会',
        p.sleeping ? '醒来看见你会很开心' : '睡觉期间饱食度不掉')
      + '</div></div>';

    /* 喂它 */
    h += '<div class="card"><h2>🍚 喂它</h2><div class="hint">食物用小鱼干在商城买，买完存在仓库里。'
      + '做事的每一分钟都攒进池子，每满 60 分钟赚 1 条。</div>';
    ITEMS.filter(function (it) { return it.kind === 'food'; }).forEach(function (it) {
      var own = p.owned[it.id] || 0;
      h += '<div class="pp-item"><span class="pp-emo">' + it.emoji + '</span>'
        + '<div class="pp-ib"><div class="pp-in">' + it.name + ' <span class="pp-cost">' + it.cost + ' 🐟</span></div>'
        + '<div class="pp-id">' + (own ? '库存 ' + own + ' 份' : '库存 0') + ' · 饱食 +' + it.hunger + ' · 亲密 +' + (it.intimacy || 0) + '</div></div>'
        + '<span class="pp-acts">'
        + (own ? '<button class="btn primary sm" data-pact="feed" data-id="' + it.id + '">喂</button>' : '')
        + '<button class="btn ghost sm" data-pact="buy" data-id="' + it.id + '">买</button>'
        + '</span></div>';
    });
    h += '</div>';

    /* 说说话：同样不留记录 —— 输入即走，回答以气泡回来（冒在输入框正上方） */
    h += '<div class="card"><h2>💬 说一句话</h2><div class="hint">'
      + (petAI().ready ? petAIText() + '：它会带着对你的记忆回你。' : '本地台词模式（在「我的 → 设置」里配了 AI Key 会更懂你）。')
      + '说了就走，<b>不留记录</b> —— 它会记在心里。</div>';
    h += '<div class="pg-say" id="pgSay"></div>';
    h += '<div class="pp-quick">' + QUICK_SAY.map(function (t) {
      return '<button class="pp-q" data-pact="qsay" data-id="' + t + '">' + t + '</button>';
    }).join('') + '</div>';
    h += '<div class="pp-inrow"><input id="pgChatIn" placeholder="跟它说点什么…" maxlength="200">'
      + '<button class="btn primary sm" data-pact="send">发送</button></div></div>';

    /* 详情设定 */
    h += '<div class="card"><h2>⚙️ 详情设定</h2><div class="hint">改完立即生效，全部只存在本地。</div>';
    h += '<div class="pg-row"><span class="lb">它的名字<small>挂件气泡、对话、记忆里都用这个名字</small></span>'
      + '<input class="pg-inp" id="pgName" value="' + L.esc(p.name) + '" maxlength="12" style="width:132px">'
      + '<button class="btn ghost sm" data-pact="rename">保存</button></div>';
    h += swRow('挂件常驻显示', '关掉后右下角挂件会消失，随时可以在这里打开', !p.widget.hidden, 'tg-hide');
    h += '<div class="pg-row"><span class="lb">挂件大小<small>位置可以直接拖动挂件来换</small></span>'
      + '<span class="pg-chips">' + ['S', 'M', 'L'].map(function (k) {
        return '<button class="pg-chip' + ((p.widget.size || 'M') === k ? ' on' : '') + '" data-pact="size" data-id="' + k + '">' + k + '</button>';
      }).join('') + '</span><button class="btn ghost sm" data-pact="reset-pos">归位</button></div>';
    h += swRow('它主动说话', '关掉后它只在有事情时冒泡——不是不说话，是不打扰', !p.widget.quiet, 'tg-quiet');
    h += swRow('不要让它饿', '打开后饱食度不再随时间下降。它一直在，不催你喂', !!p.noHunger, 'tg-nohunger');

    /* 装扮（按部位切换） */
    [['neck', '脖子上'], ['face', '脸上'], ['head', '头顶']].forEach(function (slot) {
      var sid = slot[0];
      h += '<div class="pg-row"><span class="lb">' + slot[1] + '</span><span class="pg-chips">'
        + '<button class="pg-chip' + (!p.gear[sid] ? ' on' : '') + '" data-pact="gear" data-slot="' + sid + '" data-id="">不戴</button>';
      ITEMS.filter(function (it) { return it.kind === 'gear' && it.slot === sid; }).forEach(function (it) {
        var has = !!p.owned[it.id];
        h += '<button class="pg-chip' + (p.gear[sid] === it.id ? ' on' : '') + (has ? '' : ' lock')
          + '" data-pact="gear" data-slot="' + sid + '" data-id="' + it.id + '">' + it.emoji + ' ' + it.name + (has ? '' : ' · ' + it.cost + '🐟') + '</button>';
      });
      h += '</span></div>';
    });
    h += '</div>';

    /* 数据 */
    h += '<div class="card"><h2>📊 它的数据</h2><div class="pg-stats">'
      + stat(days, '相伴天数')
      + stat(p.stats.fed, '喂食次数')
      + stat(p.stats.patted, '抚摸次数')
      + stat(p.stats.chats, '对话轮次')
      + stat(p.earned || 0, '累计赚到 🐟')
      + stat(p.spent || 0, '累计花掉 🐟')
      + stat(earnedToday, '今天赚到 🐟')
      + stat((ST().memories || []).length, '记忆条数')
      + '</div></div>';

    /* 鱼干账本 */
    var led = (p.fishLog || []).slice(-14).reverse();
    h += '<div class="card"><h2>🐟 小鱼干账本</h2><div class="hint">只有收入和支出，没有罚。</div>';
    if (!led.length) h += '<div class="empty">还没有账。</div>';
    else {
      h += '<div class="pg-ledger">';
      led.forEach(function (x) {
        h += '<div class="pg-led"><b>' + (x.n > 0 ? '+' + x.n : x.n) + '</b>'
          + '<span style="flex:1;min-width:0">' + L.esc(x.reason || '') + '</span>'
          + '<span style="flex:none">' + new Date(x.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span></div>';
      });
      h += '</div>';
    }
    h += '</div>';

    /* 记忆 */
    var mems = (ST().memories || []).slice(-8).reverse();
    h += '<div class="card"><div class="row between"><h2>📖 最近记忆</h2>'
      + '<button class="btn ghost sm" data-pact="panel-mem">全部 ' + (ST().memories || []).length + ' 条</button></div>';
    if (!mems.length) h += '<div class="empty">还没有记忆。</div>';
    else {
      h += '<div class="mem-list">';
      mems.forEach(function (m) {
        h += '<div class="mem-item"><span class="mem-kind k-' + (m.kind || 'note') + '">' + (L.MEM_KIND[m.kind] || '记录') + '</span>'
          + '<div class="mem-body">' + L.esc(m.text)
          + '<span class="mem-time">' + new Date(m.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span></div></div>';
      });
      h += '</div>';
    }
    h += '</div>';

    /* 危险操作 */
    h += '<div class="card"><h2>🧯 重置</h2><div class="hint">只影响伙伴，不动你的任务、倾倒和情绪记录。</div>'
      + '<div class="pg-danger">'
      + '<button class="btn ghost sm" data-pact="clear-chat">让它忘掉说过的话</button>'
      + '<button class="btn ghost sm" data-pact="clear-mem">清空全部记忆</button>'
      + '<button class="btn danger sm" data-pact="reset-pet">重置伙伴（回到刚认识）</button>'
      + '</div></div>';

    root.innerHTML = h;

    /* 大猫 */
    if (pageCat) { try { pageCat.dispose(); } catch (e) {} pageCat = null; }
    var cb = $('pgCat');
    if (cb && window.CyberCat) {
      pageCat = CyberCat.mount(cb, { vitality: v, bare: true, hungry: p.hunger < 30, gear: p.gear });
    }
    restoreSay();   /* 整页重绘会冲掉气泡，补回来（包括「正在想…」） */

    root.addEventListener('click', pageClick);
    root.addEventListener('input', pageInput);
    root.addEventListener('keydown', pageInput);
  }

  function pageClick(e) {
    var el = e.target.closest('[data-pact]');
    if (!el) return;
    e.stopPropagation();
    var act = el.dataset.pact, id = el.dataset.id;
    var p = ensure();

    if (act === 'pat') { pat(); L.render(); }
    else if (act === 'act') { interact(id); return; }   /* interact 内部自己会刷新 */
    else if (act === 'feed') { feed(id); L.render(); }
    else if (act === 'buy') buy(id);
    else if (act === 'send') { var inp = $('pgChatIn'); var val = inp ? inp.value : ''; if (inp) inp.value = ''; chat(val); L.render(); }
    else if (act === 'qsay') { chat(id); L.render(); }
    else if (act === 'panel-shop') openPanel('shop');
    else if (act === 'panel-mem') openPanel('mem');
    else if (act === 'rename') {
      var nm = (($('pgName') || {}).value || '').trim();
      if (!nm) { L.toast('给个名字'); return; }
      p.name = nm; L.save();
      L.addMemory('note', '它现在叫「' + nm + '」了', ['伙伴']);
      say('记住啦，我叫' + nm + '。', 3600);
      L.toast('改名成功'); L.render();
    }
    else if (act === 'size') { p.widget.size = id; L.save(); refresh(); L.render(); }
    else if (act === 'reset-pos') { p.widget.x = null; p.widget.y = null; L.save(); applyPos(); L.toast('挂件回到右下角'); }
    else if (act === 'tg-hide') { p.widget.hidden = !p.widget.hidden; L.save(); applyPos(); L.render(); }
    else if (act === 'tg-quiet') { p.widget.quiet = !p.widget.quiet; L.save(); if (!p.widget.quiet) say('那我说了。', 2600); L.render(); }
    else if (act === 'tg-nohunger') {
      p.noHunger = !p.noHunger; p.lastTickAt = Date.now(); L.save();
      L.toast(p.noHunger ? '已开启：它不会再饿了' : '已关闭：饱食度会随时间慢慢下降');
      if (p.noHunger) say('那我就不催你了。', 3200);
      refresh(); L.render();
    }
    else if (act === 'gear') {
      var slot = el.dataset.slot;
      if (!id) { p.gear[slot] = null; }
      else if (!p.owned[id]) { L.toast('还没买这个装扮，去商城看看'); return; }
      else { p.gear[slot] = (p.gear[slot] === id) ? null : id; }
      L.save();
      if (pageCat) pageCat.setGear(p.gear);
      if (cat) cat.setGear(p.gear);
      L.render();
    }
    else if (act === 'clear-chat') {
      /* 界面上已经没有对话记录了，清的是**它心里的那点上下文**（p.chat）——
         按钮文案也得跟着改，不然"清对话记录"会让人以为哪儿还藏着一份 */
      if (window.confirm('让它忘掉你们说过的话？（只影响对话上下文，不动任务和记忆库）')) {
        p.chat = []; L.save();
        L.toast('它把聊天的事忘掉了（你做的事还记着）');
        L.render();
      }
    }
    else if (act === 'clear-mem') {
      if (window.confirm('清空全部记忆（包括任务、鱼干、里程碑的记录）？')) {
        ST().memories = []; L.save(); L.toast('记忆清空了'); L.render();
      }
    }
    else if (act === 'reset-pet') {
      if (window.confirm('重置伙伴？等级、亲密度、鱼干、装扮都会回到刚认识的样子。')) {
        ST().pet = {}; ensure(); L.save();
        if (cat) { cat.setGear(ensure().gear); }
        L.toast('它重新认识你了');
        refresh(); L.render();
      }
    }
  }

  function pageInput(e) {
    var el = e.target;
    if (!el) return;
    e.stopPropagation();
    if (el.id === 'pgChatIn' && e.type === 'keydown' && e.key === 'Enter') {
      var v = el.value; el.value = ''; chat(v);
    }
  }

  /* ================= 面板事件 ================= */
  function panelClick(e) {
    var el = e.target.closest('[data-pact]');
    if (!el) return;
    e.stopPropagation();
    var act = el.dataset.pact, id = el.dataset.id;
    var p = ensure();

    if (act === 'close') closePanel();
    else if (act === 'tab') { panelTab = el.dataset.tab; renderPanel(); }
    else if (act === 'act') { interact(id); return; }
    else if (act === 'goto-page') { closePanel(); L.tab('pet'); }
    else if (act === 'pat') pat();
    else if (act === 'feed') feed(id);
    else if (act === 'buy') buy(id);
    else if (act === 'use') useItem(id);
    else if (act === 'redeem') redeem(id);
    else if (act === 'delrw') delReward(id);
    else if (act === 'addrw') addReward(($('ppRwName') || {}).value, ($('ppRwCost') || {}).value);
    else if (act === 'tododone') todoDone(id);
    else if (act === 'send') doSend();
    else if (act === 'qsay') { chat(el.dataset.id); }
    else if (act === 'memkind') { memKind = el.dataset.k; renderPanel(); }
    else if (act === 'rename') {
      var nm = ($('ppName') || {}).value || '';
      nm = nm.trim();
      if (!nm) { L.toast('给个名字'); return; }
      p.name = nm; L.save(); L.addMemory('note', '它现在叫「' + nm + '」了', ['伙伴']); say('记住啦，我叫' + nm + '。', 3600); refresh(); renderPanel();
    }
    else if (act === 'reset-pos') { p.widget.x = null; p.widget.y = null; L.save(); applyPos(); placePanel(); L.toast('回到右下角'); }
    else if (act === 'clear-mem') {
      if (window.confirm('清空全部记忆？记录会没，但它还在。')) {
        ST().memories = []; L.save(); L.toast('记忆清空了'); renderPanel();
      }
    }
  }
  function panelInput(e) {
    var el = e.target;
    if (!el) return;
    e.stopPropagation();
    if (el.id === 'ppQuiet') {
      var p = ensure();
      p.widget.quiet = !!el.checked; L.save();
      if (!p.widget.quiet) say('那我说了。', 2600);
      return;
    }
    if (el.id === 'ppMemQ') { memQuery = el.value.trim(); renderPanel(); var q = $('ppMemQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } return; }
    if (el.id === 'ppChatIn' && e.type === 'keydown' && e.key === 'Enter') { doSend(); }
  }
  function doSend() {
    var inp = $('ppChatIn');
    if (!inp) return;
    var v = inp.value;
    inp.value = '';
    chat(v);
  }

  /* ================= 生命周期 ================= */
  function dailyGreet(p) {
    var t = L.today();
    if (p.lastGreet === t) return;
    p.lastGreet = t;
    L.addMemory('daily', '新的一天，小陆说：' + dailyLine(), ['每日']);
    L.save();
    setTimeout(function () { say(dailyLine(), 5200); }, booted ? 900 : 1200);
  }

  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    var p = ensure();
    if (p.widget.quiet) return;
    var wait = 48000 + Math.random() * 52000;
    idleTimer = setTimeout(function () {
      var pp = ensure();
      if (pp.widget.quiet) return;
      if (!document.hidden && !isPanelOpen()) {
        if (Date.now() - lastAct > 1200000) say(pick(LINES.late), 4600);
        else say(idleLine(pp), 4200);
      }
      scheduleIdle();
    }, wait);
  }

  function updatePills(p) {
    var m = $('pwMeta');
    var root = $('petWidget');
    var hungry = p.hunger < 30;
    var v = L.vitality();
    var tier = L.tierOf(v);

    if (m) {
      /* 活力这一个是「它今天怎么样」，比饱食更值得放前面 */
      m.innerHTML = '<span class="pw-pill">✨ ' + Math.round(v) + '</span>'
        + '<span class="pw-pill' + (hungry ? ' warn' : '') + '">'
        + (hungry ? '🍚 饿了' : '🍚 ' + Math.round(p.hunger)) + '</span>'
        + '<span class="pw-pill">🐟 ' + p.fish + '</span>';
    }
    if (root) {
      root.classList.remove('t-low', 't-mid', 't-high');
      root.classList.add('t-' + tier);
      root.classList.toggle('is-hungry', hungry);
      root.classList.toggle('sleeping', !!p.sleeping);
      /* 精力/心情直接决定"看起来怎么样" —— 数字之外，一眼也能看出来。
         （灵性不走外观，走台词：见 moodLine） */
      root.classList.toggle('is-tired', p.energy < 30 && !p.sleeping);
      root.classList.toggle('is-gloomy', p.mood < 30);
      root.classList.toggle('is-chipper', p.mood >= 85);
    }
  }

  function refresh() {
    if (!booted) { boot(); return; }
    if (!L) return;
    var p = ensure();
    decay();
    settleGrowth();
    var v = L.vitality();
    if (cat) {
      cat.setVitality(v);
      cat.setGear(p.gear);
      cat.setHungry(p.hunger < 30);
      /* 恢复持续状态：睡觉 / 发呆（应用关掉再打开也要接上） */
      cat.setState({ sleeping: !!p.sleeping, daze: !!(p.dazeUntil && p.dazeUntil > Date.now()) });
    }
    if (p.dazeUntil && p.dazeUntil > Date.now() && !dazeTimer) dazeTimer = setInterval(dazeTick, 1000);
    else if (p.dazeUntil && p.dazeUntil <= Date.now()) { p.dazeUntil = 0; L.save(); }
    updatePills(p);
    dailyGreet(p);
    scheduleIdle();
    applyPos();
    renderBubble();
    if (isPanelOpen()) renderPanel();
  }

  function onFish(n, reason) {
    ensure();
    setTimeout(function () {
      say(n >= 2 ? ('鱼干 ' + n + ' 条！' + (reason ? '因为「' + reason + '」' : '')) : pick(LINES.fish), 4600);
      floatText('+' + n + ' 🐟');
      pokeCat();
      refresh();
    }, 420);
  }

  function boot() {
    if (booted) return;
    L = window.Landing;
    if (!L) { console.warn('[pet] Landing bridge 未就绪，稍后重试'); return; }
    booted = true;
    var p = ensure();
    buildDOM();

    /* 首次见面 */
    if (!p.seenIntro) {
      p.seenIntro = true;
      L.addMemory('note', '小陆来了。它会住在右下角，靠你做的事长大。', ['伙伴']);
      L.save();
      setTimeout(function () { say(pick(LINES.intro), 6000); }, 1200);
    }

    /* 拖动 / 点击 */
    var root = $('petWidget');
    root.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', function () { drag = null; }, true);
    window.addEventListener('keydown', function () { lastAct = Date.now(); }, true);
    window.addEventListener('resize', function () { applyPos(); placePanel(); });

    /* 挂件上的小工具按钮 */
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-pact]');
      if (!el) return;
      e.stopPropagation();
      e.preventDefault();
      var p2 = ensure();
      var act = el.dataset.pact;
      if (act === 'collapse') { p2.widget.collapsed = true; L.save(); applyPos(); closePanel(); }
      else if (act === 'hide') { p2.widget.hidden = true; L.save(); applyPos(); closePanel(); L.toast('它藏起来了，「我的 → 伙伴」可以叫回来'); }
      /* 挂件上的快捷动作：不用先展开面板，顺手就能做 */
      else if (act === 'q-feed') { openPanel('feed'); }
      else if (act === 'q-pat') { pat(); }
      /* 挂件 💬 = 就地冒出输入气泡（不再开那个"永远在"的对话坞）。
         面板开着时它自己带聊天区 → 归面板，免得两块重复 */
      else if (act === 'q-chat') { if (isPanelOpen()) openPanel('chat'); else openInput(); }
      else if (act === 'q-page') { closePanel(); L.tab('pet'); }
      /* 气泡：⋯ 再聊一句 / × 收起 / 发送 / 快捷话术 */
      else if (act === 'say-open') { openInput(); }
      else if (act === 'say-close') { closeInput(); }
      else if (act === 'say-send') { saySubmit($('pwSayIn') && $('pwSayIn').value); }
      /* 敲键/点击都算"他还在用" —— 把自动收起推后 */
      else if (act === 'say-quick') { armInputRetract(); saySubmit(el.dataset.id); }
    });

    /* 气泡输入框里回车直接发（不用去点「发送」） */
    root.addEventListener('keydown', function (e) {
      if (!inputOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); closeInput(); return; }
      armInputRetract();          /* 一敲键就把自动收起推后，别让他打到一半框没了 */
      if (e.key !== 'Enter') return;
      var t = e.target;
      if (!t || t.id !== 'pwSayIn') return;
      e.preventDefault();
      e.stopPropagation();
      saySubmit(t.value);
    });
    /* 在输入框里打字 = 他还在用，别自动收（计时器里会再确认一次有没有字） */
    root.addEventListener('input', function (e) {
      if (inputOpen) armInputRetract();
    });
    /* 鼠标停在气泡上就别收 —— 他可能正在读，或者手已经放到输入框上了 */
    var bb0 = $('pwBubble');
    if (bb0) {
      bb0.addEventListener('mouseenter', function () { if (inputOpen) clearTimeout(inputTimer); });
      bb0.addEventListener('mouseleave', function () { if (inputOpen) armInputRetract(); });
    }

    /* 面板事件（阻止冒泡，避免 app.js 的全局委托重复处理） */
    var pp = $('petPanel');
    pp.addEventListener('click', panelClick);
    pp.addEventListener('input', panelInput);
    pp.addEventListener('keydown', panelInput);

    /* 页面可见性 */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh();
    });

    applyPos();
    refresh();

    /* 深链：#pet=open&tab=shop 直接展开面板 */
    try {
      var pairs = {};
      (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
        var kvp = kv.split('=');
        pairs[kvp[0]] = kvp[1];
      });
      if (pairs.pet === 'open') setTimeout(function () { openPanel(pairs.ptab || 'pet'); }, 400);
    } catch (e) {}
  }

  /* ================= 对外 API ================= */
  window.Pet = {
    refresh: refresh,
    say: say,
    pat: pat,
    feed: feed,
    chat: chat,
    onFish: onFish,
    poke: pokeCat,
    state: ensure,
    renderPage: renderPage,
    shopHTML: shopHTML,      /* 「商城」整页用 */
    shopAct: shopAct,
    statsHTML: statsHTML,    /* 「我的」页的宠物数值总览 */
    dimsHTML: dimsHTML,
    onRecord: onRecord,
    onRestDay: onRestDay,
    open: function (what, tab) { if (!booted) boot(); openPanel(tab); },
    close: closePanel,

    /* 菜单栏用得到：藏起来之后要能叫回来、收起状态要能切换 */
    show: function () {
      if (!booted) boot();
      var p = ensure();
      p.widget.hidden = false;
      p.widget.collapsed = false;
      L.save(); applyPos();
      say('我在这儿。', 2600);
    },
    hide: function () {
      if (!booted) boot();
      var p = ensure();
      p.widget.hidden = true;
      L.save(); applyPos(); closePanel();
    },
    toggleCollapse: function () {
      if (!booted) boot();
      var p = ensure();
      p.widget.hidden = false;
      p.widget.collapsed = !p.widget.collapsed;
      L.save(); applyPos();
      if (p.widget.collapsed) closePanel();
    }
  };
})();
