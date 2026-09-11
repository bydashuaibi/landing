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
  var sayTimer = null, idleTimer = null;
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
    if (!p.widget) p.widget = { x: null, y: null, collapsed: false, hidden: false, quiet: false, size: 'M' };
    if (p.widget.x === undefined) p.widget.x = null;
    if (p.widget.y === undefined) p.widget.y = null;
    if (p.widget.collapsed === undefined) p.widget.collapsed = false;
    if (p.widget.hidden === undefined) p.widget.hidden = false;
    if (p.widget.quiet === undefined) p.widget.quiet = false;
    if (p.widget.size === undefined) p.widget.size = 'M';
    if (p.noHunger === undefined) p.noHunger = false;
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

  /* 饱食衰减：每 2 小时 -1.5（每天约 -18），单次最多 -22。饿只影响表情和台词。
     开了「不要让它饿」就完全不衰减——它一直在，不催你。 */
  function decay() {
    var p = ensure(), now = Date.now();
    if (p.noHunger) { p.lastTickAt = now; return; }
    var hrs = (now - p.lastTickAt) / 3600000;
    if (hrs < 0.4) return;
    p.hunger = Math.max(0, p.hunger - Math.min(22, hrs * 0.75));
    p.lastTickAt = now;
    L.save();
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
    upgrade: ['我们好像…更熟了？', '嗯，我喜欢你在的时候。'],
    late: ['你还在吗？我一直都在。', '刚才那段时间去哪了，我不问。你回来了就好。'],
    poor: ['鱼干不够…先去做点正事？', '攒着吧，我不急。']
  };
  function hourNow() { return new Date().getHours(); }
  function dailyLine() {
    var h = hourNow();
    if (h < 5) return pick(LINES.night);
    if (h < 11) return pick(LINES.morning);
    if (h < 14) return pick(LINES.noon);
    if (h < 23) return pick(LINES.evening);
    return pick(LINES.night);
  }
  function idleLine(p) {
    if (p.hunger < 28) return pick(LINES.hungry);
    var h = hourNow();
    if (h < 5) return pick(LINES.night);
    return pick(LINES.idle);
  }

  /* ================= 气泡 ================= */
  function say(text, ms) {
    var b = $('pwBubble');
    if (!b) return;
    b.textContent = text;
    b.classList.add('on');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { b.classList.remove('on'); }, ms || 4200);
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
    L.addMemory('pet', '摸了摸小陆（亲密 +' + gain + '）', ['抚摸']);
    L.save();
    say(pick(LINES.pat), 3600);
    floatText('💗 +' + gain);
    pokeCat();
    refresh(); renderPanel();
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

  function chat(text) {
    text = (text || '').trim();
    if (!text) return;
    var p = ensure();
    p.chat.push({ role: 'user', text: text, at: Date.now() });
    if (p.chat.length > 140) p.chat.splice(0, p.chat.length - 140);
    p.stats.chats += 1;
    L.addMemory('chat', '我：' + text, ['对话']);
    var cooled = (Date.now() - p.lastChatAt) > 300000;
    if (cooled) { p.lastChatAt = Date.now(); addIntimacy(1); }
    L.save();
    renderPanel(); refresh();

    var hasAI = !!(ST().settings && ST().settings.aiKey);
    if (hasAI) aiReply();
    else setTimeout(function () { pushPet(localReply(text)); }, 420 + Math.random() * 520);
  }

  function pushPet(text) {
    var p = ensure();
    p.chat.push({ role: 'pet', text: text, at: Date.now() });
    if (p.chat.length > 140) p.chat.splice(0, p.chat.length - 140);
    L.addMemory('chat', p.name + '：' + text, ['对话']);
    L.save();
    say(text, 5400);
    if ($('petPage')) { L.render(); return; }   /* 伙伴页开着就整页刷新，对话立刻出现 */
    renderPanel(); refresh();
  }

  function aiReply() {
    var p = ensure();
    var mems = ST().memories.slice(-8).map(function (m) { return '· ' + m.text; }).join('\n');
    var hist = p.chat.slice(-8);
    var sys = '你是「着陆」App 里用户养的赛博小猫，名字叫「' + p.name + '」。'
      + '你不是助手，是一只真的在陪着他的猫：说话短、口语化、偶尔喵一声，会撒娇也会犯懒。'
      + '绝对不要说教、不要列清单、不要长篇大论（每句 60 字以内，可以分两句）。'
      + '你和主人的关系等级是「' + levelName(p.intimacy) + '」（亲密度 ' + Math.round(p.intimacy) + '/100），越熟越亲昵。'
      + '你现在饱食度 ' + Math.round(p.hunger) + '/100，小鱼干 ' + p.fish + ' 条。'
      + '他今天倾倒过 ' + todayCount('dump') + ' 次、完成 ' + todayCount('task') + ' 个任务。'
      + '\n你对他说过的话和记忆：\n' + (mems || '（还没什么记忆）');
    var msgs = [{ role: 'system', content: sys }].concat(hist.map(function (m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text };
    }));
    L.callAI(msgs).then(function (r) {
      pushPet(r.error ? '（' + r.error + '）' : (r.content || '').slice(0, 200));
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

  /* ================= 样式 ================= */
  var CSS = [
    '.pw-root{position:fixed;right:18px;bottom:18px;z-index:45;display:flex;flex-direction:column;align-items:flex-end;gap:6px;touch-action:none;-webkit-user-select:none;user-select:none}',
    '.pw-root.hidden{display:none}',
    '.pw-catbox{position:relative;width:134px;height:114px;cursor:grab;filter:drop-shadow(0 8px 16px rgba(46,36,25,.18))}',
    '.pw-catbox:active{cursor:grabbing}',
    '.pw-catbox canvas{display:block;width:100%;height:100%}',
    '.pw-meta{display:flex;gap:5px;justify-content:center;margin-top:-8px;pointer-events:none}',
    '.pw-pill{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.82);border:1px solid var(--line);color:#5b4a35;backdrop-filter:blur(6px)}',
    '.pw-pill.warn{background:rgba(224,169,59,.92);color:#4a3208;border-color:transparent}',
    '.pw-tools{position:absolute;top:-4px;right:-4px;display:flex;gap:4px;opacity:0;transition:opacity .18s}',
    '.pw-root:hover .pw-tools{opacity:1}',
    '.pw-tool{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.94);border:1px solid var(--line);color:#5b4a35;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(46,36,25,.14)}',
    '.pw-bubble{max-width:232px;padding:9px 13px;border-radius:14px;border-bottom-right-radius:5px;background:rgba(255,255,255,.94);border:1px solid var(--line);color:var(--ink);font-size:13px;line-height:1.45;box-shadow:0 10px 24px rgba(46,36,25,.16);opacity:0;transform:translateY(6px) scale(.96);transition:opacity .22s,transform .22s;pointer-events:none;backdrop-filter:blur(10px)}',
    '.pw-bubble.on{opacity:1;transform:none}',
    '.pw-mini{display:none;position:relative;width:54px;height:54px;border-radius:50%;background:rgba(255,255,255,.94);border:1px solid var(--line);box-shadow:0 8px 20px rgba(46,36,25,.2);align-items:center;justify-content:center;font-size:24px;cursor:pointer}',
    '.pw-root.collapsed .pw-mini{display:flex}',
    '.pw-root.collapsed .pw-catbox,.pw-root.collapsed .pw-meta{display:none}',
    '.pw-mini .dot{position:absolute;top:4px;right:4px;width:10px;height:10px;border-radius:50%;background:var(--amber);border:1.5px solid #fff}',
    '.pw-float{position:absolute;right:12px;bottom:70px;font-size:13px;font-weight:800;color:#a85d2c;pointer-events:none;animation:pwFloat 1.5s var(--e-out) forwards;white-space:nowrap}',
    '@keyframes pwFloat{0%{opacity:0;transform:translateY(6px)}20%{opacity:1}100%{opacity:0;transform:translateY(-34px)}}',
    /* 面板 */
    '.pp-root{position:fixed;z-index:46;width:min(344px,calc(100vw - 28px));max-height:min(560px,calc(100vh - 200px));overflow:auto;padding:16px;border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(255,255,255,.88));border:1px solid var(--line);box-shadow:0 22px 54px rgba(46,36,25,.28);backdrop-filter:blur(24px) saturate(118%);-webkit-backdrop-filter:blur(24px) saturate(118%);color:var(--ink);animation:ppIn .2s var(--e-out)}',
    '@keyframes ppIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}',
    '.pp-root.hidden{display:none}',
    '.pp-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}',
    '.pp-who{flex:1;min-width:0}',
    '.pp-who .pp-name,.pp-who .pp-id{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
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
    '.pp-chat{display:flex;flex-direction:column;gap:8px;max-height:236px;overflow:auto;padding:2px}',
    '.pp-msg{max-width:86%;padding:9px 12px;border-radius:13px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word}',
    '.pp-msg.pet{background:rgba(194,168,120,.20);align-self:flex-start;border-bottom-left-radius:4px}',
    '.pp-msg.me{background:linear-gradient(135deg,var(--terracotta),var(--terracotta-d));color:#fff;align-self:flex-end;border-bottom-right-radius:4px}',
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
    '.pg-stage{position:relative;flex:1 1 250px;min-width:230px;min-height:234px;border-radius:20px;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:6px;background:linear-gradient(180deg,rgba(255,255,255,.74),rgba(255,255,255,.46));border:1px solid var(--line)}',
    '.pg-cat{width:100%;height:234px}',
    '.pg-cat canvas{display:block;width:100%;height:100%}',
    '.pg-badge{position:absolute;top:10px;right:10px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:rgba(255,255,255,.86);border:1px solid var(--line);color:#5b4a35}',
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
    '@media(max-width:820px){.pw-root{right:12px;bottom:92px}.pp-root{left:10px;right:10px;top:auto;bottom:10px;width:auto;max-height:66vh;border-radius:18px}.pg-cat{height:190px}}'
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
      + '<div class="pw-catbox" id="pwCatBox" title="点我打开 · 按住拖动可换位置">'
        + '<div class="pw-tools">'
          + '<button class="pw-tool" data-pact="collapse" title="收起">−</button>'
          + '<button class="pw-tool" data-pact="hide" title="藏起来（在「我的」里可叫回来）">×</button>'
        + '</div>'
      + '</div>'
      + '<div class="pw-meta" id="pwMeta"></div>'
      + '<div class="pw-mini" id="pwMini">🐱<span class="dot hidden"></span></div>';
    document.body.appendChild(root);

    var panel = document.createElement('div');
    panel.id = 'petPanel';
    panel.className = 'pp-root hidden';
    document.body.appendChild(panel);

    /* 猫 */
    var box = document.createElement('div');
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
    root.classList.toggle('collapsed', !!p.widget.collapsed);
    root.classList.toggle('hidden', !!p.widget.hidden);
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
    if (t.closest('button') || t.closest('input')) return;
    var root = $('petWidget');
    if (!root) return;
    var r = root.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: 0, last: null };
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
  }
  function closePanel() {
    var pp = $('petPanel');
    if (pp) pp.classList.add('hidden');
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
      + '<div class="pp-id">活力 ' + Math.round(v) + '/100 · 连续着陆 ' + L.landingDays() + ' 天</div></div>'
      + '<span class="pp-lv">' + lv + '</span>'
      + '<button class="pp-x" data-pact="close">✕</button></div>';

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

    var ch = $('ppChatBox');
    if (ch) ch.scrollTop = ch.scrollHeight;
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
      + '<button class="btn ghost sm block" data-pact="goto-page" style="margin-top:9px">🐾 详情设定与全部数据 →</button>'
      + '<div class="pp-sec" style="margin-top:12px">'
      + '· 单次完成 <b>≥60 分钟</b>的任务，就能领 1~3 条小鱼干（60-119:1 / 120-179:2 / ≥180:3）<br/>'
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

  function tabChat(p) {
    var hasAI = !!(ST().settings && ST().settings.aiKey);
    var h = '<div class="pp-sec">和它说话会被记进<b>记忆库</b>（「我的」页也能翻）。'
      + (hasAI ? '<span class="pp-badge">AI 模式</span>' : '<span class="pp-badge local">本地台词模式 · 配了 AI Key 会更懂你</span>')
      + '</div>';
    h += '<div class="pp-chat" id="ppChatBox">';
    if (!p.chat.length) h += '<div class="pp-sec">还没说过话。试试“今天好累”。</div>';
    p.chat.slice(-40).forEach(function (m) {
      h += '<div class="pp-msg ' + (m.role === 'user' ? 'me' : 'pet') + '">' + L.esc(m.text) + '</div>';
    });
    h += '</div>';
    h += '<div class="pp-inrow"><input id="ppChatIn" placeholder="跟它说点什么…" maxlength="200">'
      + '<button class="btn primary sm" data-pact="send">发送</button></div>';
    return h;
  }

  function tabShop(p) {
    var h = '<div class="pp-sec">余额 <b>' + p.fish + '</b> 🐟 · 鱼干来自单次完成 ≥60 分钟的任务</div>';

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
    h += '<div class="pp-field"><input id="ppRwName" placeholder="奖励名称，比如「看一集番」" maxlength="20">'
      + '<input id="ppRwCost" type="number" placeholder="鱼干" style="max-width:78px">'
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
    var KINDS = [['', '全部'], ['chat', '对话'], ['feed', '投喂'], ['pet', '抚摸'], ['task', '任务'], ['fish', '小鱼干'], ['milestone', '里程碑'], ['note', '记录']];
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
      + '<div class="pg-badge">' + L.tierText(T) + ' · 活力 ' + Math.round(v) + '</div></div>'
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

    /* 喂它 */
    h += '<div class="card"><h2>🍚 喂它</h2><div class="hint">食物用小鱼干在商城买，买完存在仓库里。'
      + '单次完成 ≥60 分钟的任务就能赚到 1~3 条。</div>';
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

    /* 说说话 */
    h += '<div class="card"><h2>💬 说说话</h2><div class="hint">'
      + (ST().settings.aiKey ? 'AI 模式：它会带着对你的记忆回你。' : '本地台词模式（在「我的 → 设置」里配了 AI Key 会更懂你）。')
      + '每一句都会归到记忆库。</div>';
    h += '<div class="pp-chat" id="pgChat">';
    if (!p.chat.length) h += '<div class="pp-sec">还没说过话。试试「今天好累」。</div>';
    p.chat.slice(-30).forEach(function (m) {
      h += '<div class="pp-msg ' + (m.role === 'user' ? 'me' : 'pet') + '">' + L.esc(m.text) + '</div>';
    });
    h += '</div><div class="pp-inrow"><input id="pgChatIn" placeholder="跟它说点什么…" maxlength="200">'
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
      + '<button class="btn ghost sm" data-pact="clear-chat">只清对话记录</button>'
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
    var ch = $('pgChat'); if (ch) ch.scrollTop = ch.scrollHeight;

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
    else if (act === 'feed') { feed(id); L.render(); }
    else if (act === 'buy') buy(id);
    else if (act === 'send') { var inp = $('pgChatIn'); var val = inp ? inp.value : ''; if (inp) inp.value = ''; chat(val); L.render(); }
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
      if (window.confirm('只清掉和它的对话记录？')) {
        p.chat = []; L.save();
        L.toast('对话记录清空了');
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
    if (m) {
      var hungry = p.hunger < 30;
      m.innerHTML = '<span class="pw-pill' + (hungry ? ' warn' : '') + '">' + (hungry ? '🍚 饿了' : '🍚 ' + Math.round(p.hunger)) + '</span>'
        + '<span class="pw-pill">🐟 ' + p.fish + '</span>';
    }
    var dot = document.querySelector('#pwMini .dot');
    if (dot) dot.classList.toggle('hidden', p.hunger >= 30);
  }

  function refresh() {
    if (!booted) { boot(); return; }
    if (!L) return;
    var p = ensure();
    decay();
    var v = L.vitality();
    if (cat) {
      cat.setVitality(v);
      cat.setGear(p.gear);
      cat.setHungry(p.hunger < 30);
    }
    updatePills(p);
    dailyGreet(p);
    scheduleIdle();
    applyPos();
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
      var p2 = ensure();
      if (el.dataset.pact === 'collapse') { p2.widget.collapsed = true; L.save(); applyPos(); closePanel(); }
      else if (el.dataset.pact === 'hide') { p2.widget.hidden = true; L.save(); applyPos(); closePanel(); L.toast('它藏起来了，「我的 → 着陆伙伴」可以叫回来'); }
    });

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
    open: function (what, tab) { if (!booted) boot(); openPanel(tab); },
    close: closePanel
  };
})();
