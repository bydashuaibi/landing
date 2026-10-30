/* 着陆 · 每日行动。数据与原存档一起导入、导出；计时复用桌面的后台计时器。 */
(function () {
  'use strict';
  var B, selected = '', duration = 25, lastDay = '', reviewTimer, pendingReminder = false, lastDistractionAt = 0, lastSampleAt = 0;
  function state() {
    var s = B.state();
    if (!s.discipline) s.discipline = { version: 1, tasks: [], sessions: [], reviews: {}, goal: 25 };
    var d = s.discipline;
    if (!Array.isArray(d.tasks)) d.tasks = [];
    if (!Array.isArray(d.sessions)) d.sessions = [];
    if (!d.reviews || typeof d.reviews !== 'object') d.reviews = {};
    d.goal = Math.max(5, Math.min(240, Number(d.goal) || 25));
    if (!d.learning) d.learning = { selected: 'python', tracks: [
      { id: 'python', name: 'Python', checkpoint: I18n.t('打开正在学的 Python 资料，运行一个例子'), url: '' },
      { id: 'pytorch', name: 'PyTorch', checkpoint: I18n.t('打开正在学的 PyTorch 资料，运行一个例子'), url: '' }
    ] };
    d.learning.minutes = Math.max(5, Math.min(240, Math.round(Number(d.learning.minutes) || 25)));
    if (!d.reminder) d.reminder = { enabled: false, time: '19:30', weekdays: [1, 2, 3, 4, 5], date: '', status: '', snoozeUntil: 0 };
    if (!d.reminder.mode) d.reminder.mode = 'timetable';
    if (!d.reminder.periodEnds) d.reminder.periodEnds = {};
    if (!d.reminder.schoolTimesConfirmed) {
      d.reminder.periodEnds = Object.assign({ 2:'09:35', 4:'11:40', 6:'15:05', 8:'17:10', 10:'20:05', 12:'22:10' }, d.reminder.periodEnds);
      d.reminder.schoolTimesConfirmed = true;
    }
    if (d.reminder.breakMin === undefined) d.reminder.breakMin = 30;
    if (!d.phone) d.phone = 'android';
    if (d.distractionNudge === undefined) d.distractionNudge = true;
    return d;
  }
  function day() { return B.today(); }
  function esc(s) { return B.esc(String(s == null ? '' : s)); }
  function tasks(date) { return state().tasks.filter(function (t) { return t.date === (date || day()); }); }
  function task(id) { return state().tasks.find(function (t) { return t.id === id; }); }
  function completeTask(n, done) {
    if (!n) return;
    n.done = done; n.completedAt = done ? Date.now() : null;
    var ot = B.state().oneThing;
    if (n.legacyOne && ot && ot.date === n.date && ot.text === n.name) ot.done = done;
    var dump = n.dumpId && (B.state().dumps || []).find(function (d) { return d.id === n.dumpId; });
    if (dump) { dump.done = done; if (done && !dump.kind) dump.kind = 'do'; }
  }
  function captureOne(text, dumpId) {
    var same = tasks().find(function (t) { return t.name === text; });
    if (same) { selected = same.id; return true; }
    if (tasks().length >= 3) { B.toast(I18n.t('今天已有三件计划，先移除一件，再把这一步加进来')); return false; }
    var n = {id:B.uid('plan'),date:day(),name:text,step:I18n.t('先准备需要的资料，做 5 分钟'),minutes:25,done:false,legacyOne:true,dumpId:dumpId||null};
    state().tasks.push(n); selected = n.id; return true;
  }
  function sessions(date) { return state().sessions.filter(function (s) { return s.date === (date || day()); }); }
  function minutes(date) { return sessions(date).reduce(function (n, s) { return n + s.minutes; }, 0); }
  function next() {
    var list = tasks().filter(function (t) { return !t.done; });
    return list.find(function (t) { return t.id === selected; }) || list[0];
  }
  function timer() { var t = B.state().timer; return t && t.discipline ? t : null; }
  function button(action, text, cls, attrs) {
    return '<button type="button" class="' + (cls || 'ds-link') + '" data-ds="' + action + '" ' + (attrs || '') + '>' + text + '</button>';
  }
  function commit(message) { B.save(); B.render(); if (message) B.toast(message); }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function streak() {
    var dates = new Set(state().sessions.filter(function (s) { return s.minutes > 0; }).map(function (s) { return s.date; }));
    state().tasks.filter(function (t) { return t.done; }).forEach(function (t) { dates.add(t.date); });
    var n = 0, date = dates.has(day()) ? day() : B.addDays(day(), -1);
    while (dates.has(date)) { n++; date = B.addDays(date, -1); }
    return n;
  }
  function track(id) { return state().learning.tracks.find(function (t) { return t.id === (id || state().learning.selected); }); }
  function lastPeriod(course) {
    var ns = String(course.periods || '').match(/\d+/g);
    return ns ? Math.max.apply(null, ns.map(Number)) : 0;
  }
  function reminderPlan(date) {
    var r = state().reminder, schedule = B.state().schedule;
    if (r.mode !== 'timetable') return { time: r.time, reason: I18n.t('按固定时间提醒'), courseCount: 0 };
    if (!schedule || !Array.isArray(schedule.items) || !schedule.items.length) return { time: r.time, reason: I18n.t('还没有课表，暂用备用时间'), courseCount: 0 };
    var list = B.courses(new Date((date || day()) + 'T12:00:00'));
    if (!list.length) return { time: r.time, reason: I18n.t('今天无课，使用备用时间'), courseCount: 0 };
    var period = Math.max.apply(null, list.map(lastPeriod)), end = r.periodEnds[period];
    if (!end || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return { time: r.time, reason: I18n.t('第 ') + period + I18n.t(' 节下课时间待补，暂用备用时间'), courseCount: list.length, period: period };
    var p = end.split(':'), min = Number(p[0]) * 60 + Number(p[1]) + Number(r.breakMin);
    if (min >= 23 * 60) return { time: '', reason: I18n.t('今天下课较晚，休息后已过 23 点，不再提醒'), courseCount: list.length, period: period };
    return { time: String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'), reason: I18n.t('今天最后一节是第 ') + period + I18n.t(' 节，') + end + I18n.t(' 下课后休息 ') + r.breakMin + I18n.t(' 分钟'), courseCount: list.length, period: period };
  }
  function checkpointText(t) {
    // Only translate the shipped placeholder; a learner's own checkpoint stays verbatim.
    var source=t.id==='pytorch'?'打开正在学的 PyTorch 资料，运行一个例子':'打开正在学的 Python 资料，运行一个例子';
    var variants=window.StudyTrailMessages&&StudyTrailMessages[source];
    return variants&&Object.values(variants).indexOf(t.checkpoint)>=0?I18n.t(source):t.checkpoint;
  }
  function learningHTML() {
    var d = state(), r = d.reminder, plan = reminderPlan();
    return I18n.html('<section class="ds-study"><div class="ds-section-head"><div><span class="ds-eyebrow">AFTER CLASS / 给自己的学习时间</span><h2>下课之后，接着上次那一步</h2></div>') + button('reminderSettings', r.enabled ? '◷ ' + (plan.time ? esc(plan.time) : I18n.t('今天休息')) + (r.mode === 'timetable' ? I18n.t(' · 按课表') : I18n.t(' 课后提醒')) : I18n.t('◷ 设置课后提醒'), 'ds-reminder-pill') + '</div><div class="ds-track-grid">' + d.learning.tracks.map(function (t) {
      var active = d.learning.selected === t.id;
      return '<article class="ds-learning-track' + (active ? ' is-selected' : '') + '"><div class="ds-section-head"><span class="ds-course-name">' + esc(t.name) + '</span>' + button('trackEdit', I18n.t('手动记进度 ↗'), 'ds-link', 'data-track="' + esc(t.id) + '"') + '</div>' + (window.LearningCheckpoint ? LearningCheckpoint.summary(t) : '') + '<p>' + esc(checkpointText(t) || I18n.t('先记下你下次要做的第一步')) + '</p><div class="ds-learning-actions">' + button('captureProgress', I18n.t('▣ 截屏记断点'), 'ds-capture-button', 'data-track="' + esc(t.id) + '"') + button('captureHistory', I18n.t('历史断点'), 'ds-link', 'data-track="' + esc(t.id) + '"') + '</div><div class="ds-learning-actions">' + button('prepare', I18n.t('▶ 接着学习'), 'ds-track-start', 'data-track="' + esc(t.id) + '"') + (t.url ? button('resource', t.resume ? I18n.t('打开上次位置') : I18n.t('打开资料'), 'ds-link', 'data-track="' + esc(t.id) + '"') : '') + '</div></article>';
    }).join('') + I18n.html('</div><div class="ds-study-bottom"><span>开始前：把手机调成专注模式，放到伸手拿不到的地方。</span>') + button('phone', I18n.t('设置安卓手机防分心 →')) + '</div>' + (r.enabled ? '<p class="ds-note">' + esc(plan.reason) + '。' + button('background', I18n.t('配置开机自启和托盘常驻')) + '</p>' : '') + '</section>';
  }
  function safeURL(raw) {
    try { var u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch (e) { return ''; }
  }
  function companionHTML() {
    if (window.StudyBuddy) return StudyBuddy.render(B.state());
    var p = B.state().pet || {};
    return I18n.html('<section class="ds-companion"><div id="ds-pet-host" aria-label="你的宠物"></div><div class="ds-companion-content"><span class="ds-eyebrow">STUDY BUDDY / 一起慢慢来</span><h2>') + esc(p.name || I18n.t('小陆')) + I18n.html('也在这里</h2><p>学累了就互动一下。专注时，它会安静陪你。</p><div class="ds-pet-actions">') + [['wave',I18n.t('👋 挥挥手')],['highfive',I18n.t('🙌 击个掌')],['hug',I18n.t('🫶 抱一下')],['study',I18n.t('📖 陪我读书')]].map(function (a) { return button('petAction', a[1], 'btn ghost sm', 'data-pet-action="' + a[0] + '"'); }).join('') + button('petShow', p.widget && p.widget.hidden ? I18n.t('叫它回来') : I18n.t('展开 / 叫它过来'), 'ds-link') + button('petDetails', I18n.t('喂食、聊天与养成 →'), 'ds-link') + '</div><span id="ds-pet-response" class="ds-pet-response" role="status"></span></div></section>';
  }
  function openResource(t) { var url = t && (window.LearningCheckpoint ? LearningCheckpoint.resumeURL(t) : safeURL(t.url)); if (safeURL(url)) window.open(url, '_blank', 'noopener'); }
  function trackForm(id) {
    var t = track(id); if (!t) return;
    B.openSheet('<h2>' + esc(t.name) + I18n.html(' · 下次从这里继续</h2><p class="hint">留一个具体的学习断点，下次打开就能接上。资料链接可以留空。</p><form id="ds-track-form"><div class="field"><label for="ds-checkpoint">下次先做什么？</label><textarea id="ds-checkpoint" maxlength="350" required placeholder="比如：接着第 6 节，自己写一遍列表推导式">') + esc(checkpointText(t)) + I18n.html('</textarea></div><div class="field"><label for="ds-url">你的课程 / 文档链接（HTTPS，可选）</label><input id="ds-url" type="url" placeholder="粘贴你正在学的资料地址" value="') + esc(t.url) + I18n.html('"></div><div class="sheet-actions"><button type="button" class="btn ghost" data-act="closeSheet">取消</button><button type="submit" class="btn primary">记住这个断点</button></div></form>'));
    document.getElementById('ds-track-form').onsubmit = function (e) {
      e.preventDefault(); var step = document.getElementById('ds-checkpoint').value.trim(), raw = document.getElementById('ds-url').value.trim();
      if (!step) return;
      if (raw && !safeURL(raw)) { B.toast(I18n.t('请填写 HTTPS 资料链接，或先留空')); return; }
      t.checkpoint = step; t.url = raw ? safeURL(raw) : ''; if (t.resume && t.resume.resourceUrl !== t.url) t.resume = null; state().learning.selected = t.id; B.closeSheet(); commit(I18n.t('记住了，下次直接从这里继续'));
    };
  }
  function prepare(id) {
    var t = track(id); if (!t) return;
    if (B.state().timer) { B.toast(I18n.t('先结束当前的计时，再接着学')); return; }
    state().learning.selected = t.id; B.save();
    B.openSheet(I18n.html('<span class="ds-eyebrow">给想学的东西留一段时间</span><h2 class="ds-prepare-title">准备开始学习</h2><p class="hint">选一个适合今天的时长。5 分钟适合热身，也可以完整学一段；结束后再记录下次的起点。</p><div class="ds-next-step"><span>这次先做</span><p>') + esc(checkpointText(t)) + I18n.html('</p></div><div class="field"><label for="ds-learning-minutes">本次学习时长（5–240 分钟）</label><input id="ds-learning-minutes" type="number" min="5" max="240" step="1" required value="') + state().learning.minutes + '"></div>' + (window.FocusMonitor?FocusMonitor.fields(Object.assign({resourceUrl:t.url||''},t.monitor||{}),'fm-learn'):'') + I18n.html('<div class="ds-learning-presets">') + [5,25,50].map(function(m){return button('learnMinutes',m+I18n.t(' 分钟'),'btn ghost sm','data-minutes="'+m+'"');}).join('') + I18n.html('</div><p class="hint">时长会记住。学习前可以放远手机，开启勿扰；不必每次重新设置。</p><div class="sheet-actions">') + button('phone', I18n.t('手机怎么设置'), 'btn ghost') + button('learnStart', (t.url ? I18n.t('打开资料，') : '') + I18n.t('开始学习'), 'btn primary', 'data-track="' + esc(t.id) + '"') + '</div>');
  }
  function learnStart(id) {
    var t = track(id); if (!t || B.state().timer) return;
    var input=document.getElementById('ds-learning-minutes');
    if(input && !input.reportValidity()) return;
    var min=input?Number(input.value):state().learning.minutes;
    if(!Number.isInteger(min) || min<5 || min>240) return;
    var monitoring=window.FocusMonitor?FocusMonitor.read('fm-learn'):{};if(!monitoring)return;state().learning.minutes=min;t.monitor=monitoring;
    var n = tasks().find(function (x) { return x.trackId === t.id && !x.done; });
    if (!n) {
      if (tasks().length >= 3) { B.toast(I18n.t('今天已经安排三件，可以先移除一件，再加入学习')); return; }
      n = { id: B.uid('plan'), date: day(), name: I18n.t('自学 ') + t.name, step: t.checkpoint, minutes: 25, done: false, trackId: t.id, createdAt: Date.now() }; state().tasks.push(n);
    }
    n.step = t.checkpoint; n.minutes=min;Object.assign(n,monitoring); selected = n.id;
    var r = state().reminder; r.date = day(); r.status = 'started'; r.snoozeUntil = 0; pendingReminder = false;
    B.closeSheet();if(!n.resourceUrl)openResource(t);start(false,true);
  }
  function reminderForm() {
    var r = state().reminder, plan = reminderPlan();
    var periods = Array.from(new Set([2,4,6,8,10,12].concat(((B.state().schedule || {}).items || []).map(lastPeriod)))).filter(function (n) { return n > 0 && n <= 24; }).sort(function (a,b) { return a-b; });
    B.openSheet(I18n.html('<h2>下课后，让着陆来找你</h2><p class="hint">每天读取当前教学周的课表，在最后一节课结束后休息一会，再来找你。</p><form id="ds-reminder-form"><div class="field"><label for="ds-reminder-mode">提醒方式</label><select id="ds-reminder-mode"><option value="timetable" ') + (r.mode === 'timetable' ? 'selected' : '') + I18n.html('>根据课表最后一节课</option><option value="fixed" ') + (r.mode === 'fixed' ? 'selected' : '') + I18n.html('>固定时间</option></select></div><div class="ds-reminder-preview">') + esc(plan.reason) + (plan.time ? ' → ' + esc(plan.time) : '') + I18n.html('</div><div class="field"><label for="ds-break-min">下课后休息多久（0–180 分钟）</label><input id="ds-break-min" type="number" min="0" max="180" step="1" required value="') + r.breakMin + I18n.html('"></div><details class="ds-school-times"><summary>填写学校下课时间（一次设置，之后按课表自动安排）</summary><p class="hint">现有教务课表只提供节次。请填写本校实际下课时间，留空的节次使用备用提醒时间。</p><div class="ds-school-grid">') + periods.map(function (n) { return '<div class="field"><label for="ds-period-' + n + I18n.t('">第 ') + n + I18n.html(' 节下课</label><input type="time" id="ds-period-') + n + '" data-period-end="' + n + '" value="' + esc(r.periodEnds[n] || '') + '"></div>'; }).join('') + I18n.html('</div></details><div class="field"><label for="ds-reminder-time">固定 / 备用提醒时间（无课或缺少下课时间时）</label><input id="ds-reminder-time" type="time" required value="') + esc(r.time) + I18n.html('"></div><div class="field"><label>固定提醒 / 无课日在哪几天提醒？有课日按课表提醒。</label><div class="ds-weekdays">') + [1,2,3,4,5,6,0].map(function (n) { return '<label><input type="checkbox" name="ds-weekday" value="' + n + '" ' + (r.weekdays.indexOf(n) >= 0 ? 'checked' : '') + '> ' + I18n.weekdays()[n] + '</label>'; }).join('') + '</div></div><div class="field"><label><input id="ds-reminder-enabled" type="checkbox" ' + (r.enabled ? 'checked' : '') + I18n.html('> 开启课后提醒</label></div><div class="field"><label><input id="ds-distraction-enabled" type="checkbox" ') + (state().distractionNudge ? 'checked' : '') + I18n.html('> 专注时识别到短视频关键词，暂停并提醒</label><p class="hint">依赖活动感知开启，通过窗口标题粗略判断，可能识别不准；不会关闭或拦截应用。</p></div><p class="hint">需要电脑开机、软件在后台运行。不会对手机推送；开机自启可在下一步单独设置。课表有调整时，请同步教务系统。</p><div class="sheet-actions"><button type="button" class="btn ghost" data-act="closeSheet">取消</button><button type="submit" class="btn primary">保存提醒</button></div></form>'));
    document.getElementById('ds-reminder-form').onsubmit = function (e) {
      e.preventDefault(); var time = document.getElementById('ds-reminder-time').value, days = Array.from(document.querySelectorAll('[name="ds-weekday"]:checked')).map(function (el) { return Number(el.value); }), enabled = document.getElementById('ds-reminder-enabled').checked;
      if (!/^\d{2}:\d{2}$/.test(time)) return;
      var mode = document.getElementById('ds-reminder-mode').value, rest = Number(document.getElementById('ds-break-min').value);
      if (enabled && !days.length && mode === 'fixed') { B.toast(I18n.t('至少选一天，或关闭提醒')); return; }
      if (!Number.isInteger(rest) || rest < 0 || rest > 180) return;
      r.mode = mode; r.breakMin = rest; r.periodEnds = {};
      document.querySelectorAll('[data-period-end]').forEach(function (el) { if (el.value) r.periodEnds[el.dataset.periodEnd] = el.value; });
      state().distractionNudge = document.getElementById('ds-distraction-enabled').checked;
      r.time = time; r.weekdays = days; r.enabled = enabled; r.date = ''; r.status = ''; r.snoozeUntil = 0; pendingReminder = false;
      B.closeSheet(); commit(enabled ? I18n.t('提醒已开启，记得让软件待在托盘里') : I18n.t('提醒已关闭'));
    };
  }
  function reminderPrompt() {
    var t = track(); if (!t) return;
    pendingReminder = false;
    B.openSheet(I18n.html('<span class="ds-eyebrow">课后，留一点时间给自己</span><h2 class="ds-prepare-title">接着学一点 ') + esc(t.name) + I18n.html('？</h2><p class="hint">先选一段适合今天的学习时间，放好手机，从上次的进度继续。</p><div class="ds-next-step"><span>上次给自己留下的下一步</span><p>') + esc(checkpointText(t)) + '</p></div><div class="sheet-actions">' + button('restEvening', I18n.t('今天休息'), 'btn ghost') + button('snooze', I18n.t('20 分钟后提醒'), 'btn ghost') + button('prepare', I18n.t('选择时长，开始学习'), 'btn primary', 'data-track="' + esc(t.id) + '"') + '</div>');
  }
  function checkReminder() {
    if (!B) return;
    var r = state().reminder, now = new Date(), date = day(), plan = reminderPlan();
    if (!r.enabled || B.state().timer) return;
    if (!(r.mode === 'timetable' && plan.courseCount > 0) && r.weekdays.indexOf(now.getDay()) < 0) return;
    if (r.date === date && (r.status === 'started' || r.status === 'rest')) return;
    if (r.date === date && r.status === 'shown' && !pendingReminder) return;
    if (pendingReminder) {
      // 用户正在填写内容时先等着，不覆盖表单或已有弹层。
      if (!document.querySelector('#sheet.show') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) reminderPrompt();
      return;
    }
    if (r.date === date && r.status === 'snoozed') { if (Date.now() < r.snoozeUntil) return; }
    else {
      if (!plan.time) return;
      var p = plan.time.split(':'), due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +p[0], +p[1]);
      // 过了当天睡前窗口就不补弹昨天的提醒。
      if (now < due || now.getHours() >= 23) return;
    }
    r.date = date; r.status = 'shown'; r.snoozeUntil = 0; pendingReminder = true; B.save();
    B.notify(I18n.t('着陆 · 给自己的学习时间'), I18n.t('接着学 ') + track().name + I18n.t('，按自己的节奏来。'));
    if (window.landing && window.landing.nudge) window.landing.nudge();
    if (!document.querySelector('#sheet.show') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) reminderPrompt();
  }
  function phoneForm() {
    var phone = state().phone;
    B.openSheet(I18n.html('<h2>给手机也留一道停顿</h2><p class="hint">电脑端不能直接限制手机。可以先用手机系统提供的功能，配合这次学习。</p><div class="ds-phone-tabs">') + button('phoneAndroid', I18n.t('安卓手机'), phone === 'android' ? 'btn primary' : 'btn ghost') + button('phoneIPhone', 'iPhone', phone === 'iphone' ? 'btn primary' : 'btn ghost') + '</div>' + (phone === 'iphone' ? I18n.html('<ol class="ds-phone-steps"><li>打开「设置 → 屏幕使用时间」，给常刷的短视频、短剧应用设置「App 限额」。</li><li>在「停用时间」中安排课后自学时段；学习、通讯等必要应用按需允许。</li><li>学习前开启「专注模式」，把手机放到桌面以外的位置。</li></ol>') : I18n.html('<ol class="ds-phone-steps"><li>打开「设置」，搜索「数字健康」或「健康使用手机」。各品牌名称可能不同。</li><li>为常刷的短视频、短剧应用设置每天的应用时长限制；支持「专注模式」的手机可安排课后时段。</li><li>学习前开启专注 / 勿扰，把手机放到桌面以外的位置。</li></ol>')) + I18n.html('<p class="hint">这些限制仍可由你修改。先用一周观察是否能帮你及时停下来。</p><div class="sheet-actions">') + button('phoneHelp', I18n.t('查看系统官方说明'), 'btn ghost') + I18n.html('<button type="button" class="btn primary" data-act="closeSheet">我去设置</button></div>'));
  }
  function backgroundForm() {
    B.openSheet(I18n.html('<h2>让提醒在后台等你</h2><p class="hint">课后提醒依赖着陆仍在运行。建议开启开机自启，并让关闭窗口时缩到托盘。彻底退出或电脑关机后无法提醒。</p><p id="ds-background-status" class="hint">正在读取设置…</p><div class="sheet-actions">') + button('enableBackground', I18n.t('开启自启和托盘常驻'), 'btn primary') + I18n.html('<button type="button" class="btn ghost" data-act="closeSheet">关闭</button></div>'));
    if (!window.landing || !window.landing.autoLaunch) { document.getElementById('ds-background-status').textContent = I18n.t('请使用桌面版本配置后台运行。'); return; }
    Promise.all([window.landing.autoLaunch.get(), window.landing.closePref.get()]).then(function (v) { var el = document.getElementById('ds-background-status'); if (el) el.textContent = I18n.t('开机自启：') + (v[0] ? I18n.t('已开启') : I18n.t('未开启')) + I18n.t('；关闭窗口：') + (v[1] === 'tray' ? I18n.t('缩到托盘') : v[1] === 'quit' ? I18n.t('退出软件') : I18n.t('每次询问')); }).catch(function () { B.toast(I18n.t('读取后台设置失败，可以稍后重试')); });
  }
  function focusHTML() {
    var t = timer(), n = next(), mins = n ? n.minutes : duration;
    var busy = B.state().timer && !t;
    var html = I18n.html('<section class="ds-panel ds-focus" aria-labelledby="ds-focus-title"><div class="ds-section-head"><span class="ds-eyebrow">FOCUS / 专注这一刻</span><span class="ds-live">') + (t ? (t.finished ? I18n.t('等待记录') : (t.paused ? I18n.t('已暂停') : I18n.t('专注中'))) : I18n.t('准备开始')) + '</span></div>';
    html += '<div class="ds-dial"><svg viewBox="0 0 220 220" aria-hidden="true"><circle class="ds-track" cx="110" cy="110" r="96"/><circle id="ds-ring" class="ds-ring" cx="110" cy="110" r="96"/></svg><div class="ds-dial-text"><span id="ds-clock">' + (t ? clock(B.remaining()) : clock(mins * 60000)) + '</span><span id="ds-clock-caption">' + (t ? (t.finished ? I18n.t('这一段，你做到了') : (t.paused ? I18n.t('调整一下，再继续') : I18n.t('只管眼前这一小步'))) : I18n.t('留给重要的事')) + '</span></div></div>';
    html += '<h2 id="ds-focus-title">' + esc(t ? t.name : (n ? n.name : I18n.t('先选一件想做的事'))) + '</h2><p class="ds-focus-step">' + esc(t ? (t.step || I18n.t('把手机放远一点，继续眼前的事。')) : (n ? n.step || I18n.t('准备好需要的东西，就可以开始。') : I18n.t('不用安排完美的一天，从一个小动作开始。'))) + '</p>';
    if (t) {
      html += '<div class="ds-focus-actions">' + (t.finished ? button('settle', I18n.t('✓ 记录本次专注'), 'ds-primary') : button('pause', t.paused ? I18n.t('▶ 继续专注') : I18n.t('Ⅱ 暂停一下'), 'ds-primary') + button('settle', I18n.t('结束并记录'), 'ds-secondary')) + '</div>';
    } else if (busy) {
      html += I18n.html('<p class="ds-note">另一个计时还在账上，请先在底部计时条结束并记录。</p>');
    } else if (n) {
      html += I18n.html('<div class="ds-durations" aria-label="本次专注时长">') + [5, 15, 25, 50].map(function (m) { return button('duration', m + I18n.t(' 分钟'), mins === m ? 'is-selected' : '', 'data-minutes="' + m + '" aria-pressed="' + (mins === m) + '"'); }).join('') + '</div>';
      html += '<div class="ds-focus-actions">' + button('start', I18n.t('▶ 开始这 ') + mins + I18n.t(' 分钟'), 'ds-primary') + (mins !== 5 ? button('small', I18n.t('没状态？先做 5 分钟'), 'ds-secondary') : '') + '</div>';
    } else {
      html += button('new', I18n.t('+ 定下今天第一件事'), 'ds-primary');
    }
    if(t && t.monitorEnabled)html+='<div class="focus-status" id="focus-monitor-status" role="status" data-paused="'+!!t.monitorHold+'">'+esc(FocusMonitor.status()||I18n.t('等待确认当前窗口与任务相关'))+'</div>';
    html += I18n.html('<div class="ds-focus-footer"><span>◷ 一次只做一件</span><span>完成专注后，再确认任务是否做完</span></div></section>');
    return html;
  }
  function plansHTML() {
    var list = tasks(), n = next();
    var h = I18n.html('<section class="ds-panel ds-plans"><div class="ds-section-head"><div><span class="ds-eyebrow">TODAY / 每日计划</span><h2>今天的三件小事 <span>') + list.filter(function (t) { return t.done; }).length + ' / ' + list.length + '</span></h2></div>' + (list.length < 3 ? button('new', I18n.t('+ 添加'), 'ds-link') : '') + '</div>';
    if (!list.length) {
      h += I18n.html('<div class="ds-empty"><span class="ds-empty-icon">↗</span><h3>把“要努力”变成一个动作</h3><p>写清做什么、从哪开始。今天最多安排三件。</p><div class="ds-suggestions">') + button('preset', I18n.t('读书 10 分钟'), 'ds-chip', 'data-preset="read"') + button('preset', I18n.t('学习 25 分钟'), 'ds-chip', 'data-preset="study"') + button('preset', I18n.t('出门走 5 分钟'), 'ds-chip', 'data-preset="walk"') + '</div></div>';
    }
    list.forEach(function (t, i) {
      var active = n && n.id === t.id && !t.done;
      h += '<article class="ds-task' + (t.done ? ' is-done' : '') + (active ? ' is-current' : '') + '"><button type="button" class="ds-check" data-ds="toggle" data-id="' + esc(t.id) + '" aria-label="' + (t.done ? I18n.t('撤销完成：') : I18n.t('完成：')) + esc(t.name) + '" aria-pressed="' + !!t.done + '">' + (t.done ? '✓' : '<span>' + (i + 1) + '</span>') + '</button><div class="ds-task-body"><h3>' + esc(t.name) + '</h3><p>' + esc(t.step || I18n.t('准备好需要的东西，先开始。')) + '</p><div class="ds-task-meta"><span>◷ ' + t.minutes + I18n.html(' 分钟</span>') + (active ? I18n.html('<span class="ds-current-label">接下来做这件</span>') : '') + '</div></div><div class="ds-task-tools">' + (!t.done ? button('select', '▶', 'ds-task-play', 'data-id="' + esc(t.id) + I18n.html('" aria-label="选择专注：') + esc(t.name) + '"') : '') + button('edit', I18n.t('编辑'), 'ds-link', 'data-id="' + esc(t.id) + '"') + '</div></article>';
    });
    var yesterday = tasks(B.addDays(day(), -1)).filter(function (t) { return !t.done && !list.some(function (x) { return x.carriedFrom === t.id; }); });
    if (yesterday.length && list.length < 3) h += I18n.html('<div class="ds-carry">昨天还有 ') + yesterday.length + I18n.t(' 件没做完。') + button('carry', I18n.t('挑一件接着做 →')) + '</div>';
    h += '<p class="ds-note">' + (list.length && list.every(function (t) { return t.done; }) ? I18n.t('✓ 今天安排的事已经做完。给自己一点休息时间。') : I18n.t('计划留少一点，给真正开始留多一点。')) + '</p></section>';
    return h;
  }
  function weekHTML() {
    var dates = [], total = 0, days = 0;
    for (var i = -6; i <= 0; i++) {
      var date = B.addDays(day(), i), m = minutes(date), done = tasks(date).filter(function (t) { return t.done; }).length;
      dates.push({ date: date, m: m, done: done }); total += m; if (m || done) days++;
    }
    var max = Math.max.apply(null, [state().goal].concat(dates.map(function (x) { return x.m; })));
    return I18n.html('<section class="ds-panel ds-week"><div class="ds-section-head"><div><span class="ds-eyebrow">MOMENTUM / 最近七天</span><h2>每一点行动，都有痕迹</h2></div><span class="ds-week-total">') + total + I18n.html('<small> 分钟</small></span></div><div class="ds-bars" role="img" aria-label="最近七天的专注分钟数：') + dates.map(function (x) { return x.date + '：' + x.m + I18n.t(' 分钟'); }).join('；') + '">' + dates.map(function (x, i) { return '<div class="ds-bar-col' + (i === 6 ? ' is-today' : '') + '"><span class="ds-bar-value">' + x.m + '</span><div class="ds-bar-track"><i style="height:' + (x.m ? Math.max(4, x.m / max * 100) : 0) + '%"></i></div><span>' + (i === 6 ? I18n.t('今天') : I18n.weekdays()[new Date(x.date + 'T12:00:00').getDay()]) + '</span></div>'; }).join('') + I18n.html('</div><p class="ds-note">七天里行动了 ') + days + I18n.html(' 天。空白的一天，也可以从下一次开始。</p></section>');
  }
  function reviewHTML() {
    var r = state().reviews[day()] || { win: '', obstacle: '' };
    return I18n.html('<section class="ds-panel ds-review"><div class="ds-section-head"><div><span class="ds-eyebrow">REFLECT / 一分钟收尾</span><h2>给今天一个交代</h2></div><span id="ds-review-status" class="ds-note">') + (r.at ? I18n.t('已自动保存') : I18n.t('随时写一点')) + I18n.html('</span></div><label for="ds-win">今天哪一步做得不错？</label><textarea id="ds-win" maxlength="600" rows="2" placeholder="哪怕只是坐下来开始了……">') + esc(r.win) + I18n.html('</textarea><label for="ds-obstacle">什么让你分心？下次怎么更容易开始？</label><textarea id="ds-obstacle" maxlength="600" rows="2" placeholder="比如：手机放到另一个房间，先打开书。">') + esc(r.obstacle) + '</textarea>' + button('history', I18n.t('翻翻之前的记录 →')) + '</section>';
  }
  function render() {
    var d = state(), list = tasks(), m = minutes(), count = list.filter(function (t) { return t.done; }).length;
    var date = new Date(), label = I18n.date(date);
    return I18n.html('<div class="ds-home"><header class="ds-hero"><div><div class="ds-eyebrow">ONE DAY AT A TIME · 一天一点</div><h1>今天，先做好<span>一件事。</span></h1><p>下课以后，留一点时间给真正想学的东西。先从 5 分钟开始。</p></div><span class="ds-date">') + label + '</span></header>' + learningHTML() + companionHTML() + I18n.html('<div class="ds-stats"><div><span>今日专注</span><p><b>') + m + '</b><small> / ' + d.goal + I18n.html(' 分钟</small></p><div class="ds-progress"><i style="width:') + Math.min(100, m / d.goal * 100) + '%"></i></div>' + button('goal', I18n.t('调整每日目标 ↗')) + I18n.html('</div><div><span>完成计划</span><p><b>') + count + '</b><small> / ' + list.length + I18n.html(' 件</small></p><em>') + (count ? I18n.t('你已经向前走了一步') : I18n.t('完成后点一下左边的圆圈')) + I18n.html('</em></div><div><span>连续行动</span><p><b>') + streak() + I18n.html('</b><small> 天</small></p><em>专注或完成一件事，就算行动</em></div></div><div class="ds-grid"><div class="ds-left">') + focusHTML() + weekHTML() + '</div><div class="ds-right">' + plansHTML() + reviewHTML() + '</div></div></div>';
  }
  function form(id, preset, carriedFrom) {
    var t = id ? task(id) : preset || { name: '', minutes: 25, step: '' };
    if (!t) return;
    if (!id && tasks().length >= 3) { B.toast(I18n.t('今天先做好这三件，做少一点也可以')); return; }
    B.openSheet('<h2>' + (id ? I18n.t('调整这件小事') : I18n.t('今天想做哪件小事？')) + I18n.html('</h2><p class="hint">把目标缩成一个具体动作。最多三件，第一步越小越好。</p><form id="ds-task-form"><div class="field"><label for="ds-name">要做的事</label><input id="ds-name" maxlength="60" required placeholder="比如：学习一节 C++ 课程" value="') + esc(t.name) + I18n.html('"></div><div class="field"><label for="ds-step">第一步怎么开始？</label><input id="ds-step" maxlength="100" placeholder="比如：打开教程，看到第一个例子" value="') + esc(t.step) + I18n.html('"></div><div class="field"><label for="ds-minutes">一次专注多久（1–180 分钟）</label><input id="ds-minutes" type="number" min="1" max="180" step="1" required value="') + t.minutes + '"></div>' + (window.FocusMonitor?FocusMonitor.fields(t,'fm-task'):'') + '<div class="sheet-actions">' + (id ? button('delete', I18n.t('删除这件事'), 'btn ghost', 'data-id="' + esc(id) + '"') : '') + I18n.html('<button type="button" class="btn ghost" data-act="closeSheet">取消</button><button type="submit" class="btn primary">') + (id ? I18n.t('保存调整') : I18n.t('就从这件开始')) + '</button></div></form>');
    var name = document.getElementById('ds-name'); name.focus();
    document.getElementById('ds-task-form').onsubmit = function (e) {
      e.preventDefault(); var v = name.value.trim(), min = Number(document.getElementById('ds-minutes').value);
      if (!v || !Number.isInteger(min) || min < 1 || min > 180) return;
      if (id && timer() && timer().taskId === id) { B.toast(I18n.t('先结束当前专注，再调整这件事')); return; }
      if (!id && tasks().length >= 3) return;
      var rec = id ? task(id) : { id: B.uid('plan'), date: day(), done: false, createdAt: Date.now() };
      if (!rec) return;
      var monitoring=window.FocusMonitor?FocusMonitor.read('fm-task'):{};if(!monitoring)return;Object.assign(rec,monitoring);rec.name = v; rec.step = document.getElementById('ds-step').value.trim(); rec.minutes = min;
      if (carriedFrom) rec.carriedFrom = carriedFrom;
      if (!id) state().tasks.push(rec);
      selected = rec.id; B.closeSheet(); commit(I18n.t('计划好了，现在就可以开始'));
    };
  }
  function start(small, prepared) {
    if (B.state().timer) { B.toast(I18n.t('先记录当前的计时，再开始下一段')); return; }
    var n = next(); if (!n) { form(); return; }
    if(window.FocusMonitor&&!prepared){FocusMonitor.form(n,function(){start(small,true);});return;}
    var min = small ? 5 : n.minutes;
    B.state().timer = { id: B.uid('focus'), discipline: true, mode: 'countdown', scope: 'loose', taskId: n.id, name: n.name, step: n.step, category: 'work', date: day(), plannedMin: min, startedAt: Date.now(), endsAt: Date.now() + min * 60000, paused: false, remainMs: min * 60000, finished: false };
    Object.assign(B.state().timer,{resourceUrl:n.resourceUrl||'',monitorEnabled:!!n.monitorEnabled,monitorVision:!!n.monitorVision,monitorKeywords:n.monitorKeywords||''});
    if(window.FocusMonitor)FocusMonitor.start(B.state().timer);
    B.save(); B.tick(); B.render(); B.toast(I18n.t('开始了。现在只做「') + n.name + '」');
  }
  function settle() {
    var t = timer(); if (!t) return;
    // 收尾时先暂停，实际分钟向下取整，不能把没做的时间也记进去。
    if (!t.finished && !t.paused) B.pause();
    var used = Math.min(t.plannedMin * 60000, B.elapsed()), m = Math.floor(used / 60000);
    var n = task(t.taskId), course = n && n.trackId ? track(n.trackId) : null;
    B.openSheet('<h2>' + (t.finished ? I18n.t('这一段专注，完成了。') : I18n.t('先记录到这里')) + '</h2><p class="hint">' + esc(t.name) + I18n.t(' · 实际专注 ') + clock(used) + (m ? I18n.t('，可记 ') + m + I18n.t(' 分钟。') : I18n.t('。不足 1 分钟，这次不计入时长。')) + I18n.html('</p><p class="hint">专注时间和任务完成分开记录。只有确实做完，才勾选完成。</p><div class="ds-settle-check"><label><input type="checkbox" id="ds-complete"> 这件事已经做完了</label></div>') + (course ? I18n.html('<div class="field"><label for="ds-next-checkpoint">下次先做什么？留一句给下次的自己</label><input id="ds-next-checkpoint" maxlength="180" placeholder="比如：自己写一遍刚才的例子，再看下一节" value="') + esc(course.checkpoint) + '"></div>' : '') + '<div class="sheet-actions">' + button('discard', I18n.t('放弃这次记录'), 'btn ghost') + I18n.html('<button type="button" class="btn ghost" data-act="closeSheet">返回</button>') + button('confirm', m ? I18n.t('记下 ') + m + I18n.t(' 分钟') : I18n.t('结束本次'), 'btn primary', 'data-session="' + esc(t.id) + '"') + '</div>');
  }
  function confirm(id) {
    var t = timer(); if (!t || t.id !== id) return;
    var d = state(), min = Math.floor(Math.min(t.plannedMin * 60000, B.elapsed()) / 60000);
    var checked = document.getElementById('ds-complete'), n = task(t.taskId);
    if (!d.sessions.some(function (s) { return s.id === t.id; }) && min > 0) {
      d.sessions.push({ id: t.id, taskId: t.taskId, date: t.date, name: t.name, minutes: min, at: Date.now() });
      // 与原来的周报、伙伴奖励共用同一笔账。跨午夜归入本次开始的日期。
      var rec = B.record(t.name, min, 'work', t.date); if (rec) rec.focusId = t.id;
      if(window.PetAdventure)PetAdventure.onFocus(t.id);
    }
    if (n && checked && checked.checked) completeTask(n, true);
    var checkpoint = document.getElementById('ds-next-checkpoint'), course = n && n.trackId ? track(n.trackId) : null;
    if (checkpoint && course && checkpoint.value.trim()) course.checkpoint = checkpoint.value.trim();
    B.state().timer = null; B.closeSheet(); commit(min ? I18n.t('已记录 ') + min + I18n.t(' 分钟。休息一下也很好。') : I18n.t('这一段结束了，准备好再来'));
  }
  function history() {
    var dates = Array.from(new Set(state().tasks.map(function (t) { return t.date; }).concat(state().sessions.map(function (s) { return s.date; }), Object.keys(state().reviews)))).sort().reverse();
    B.openSheet(I18n.html('<h2>我的行动记录</h2><p class="hint">专注、完成的小事和每天的复盘，都留在这里。</p><div class="ds-history">') + (dates.length ? dates.map(function (date) {
      var r = state().reviews[date] || {};
      return '<article><h3>' + esc(date) + '<span>' + minutes(date) + I18n.html(' 分钟专注</span></h3>') + tasks(date).map(function (t) { return '<p>' + (t.done ? '✓ ' : '○ ') + esc(t.name) + '</p>'; }).join('') + sessions(date).map(function (s) { return '<p class="ds-note">◷ ' + esc(s.name) + ' · ' + s.minutes + I18n.html(' 分钟</p>'); }).join('') + (r.win ? I18n.html('<p class="ds-history-text">做得不错：') + esc(r.win) + '</p>' : '') + (r.obstacle ? I18n.html('<p class="ds-history-text">下次试试：') + esc(r.obstacle) + '</p>' : '') + '</article>';
    }).join('') : I18n.html('<div class="empty">还没有记录，从今天的第一步开始。</div>')) + I18n.html('</div><div class="sheet-actions"><button class="btn primary" data-act="closeSheet">关闭</button></div>'));
  }
  var actions = {
    captureProgress: function (el) { if (window.LearningCheckpoint) LearningCheckpoint.capture(el.dataset.track); },
    captureHistory: function (el) { if (window.LearningCheckpoint) LearningCheckpoint.history(el.dataset.track); },
    petAction: function (el) { if (window.Pet) { Pet.show(); Pet.interact(el.dataset.petAction); } },
    petShow: function () { if (window.Pet) Pet.show(); },
    petDetails: function () { if (window.Landing) Landing.tab('pet'); },
    prepare: function (el) { prepare(el.dataset.track); },
    learnStart: function (el) { learnStart(el.dataset.track); },
    learnMinutes: function(el){ var input=document.getElementById('ds-learning-minutes'); if(input) input.value=el.dataset.minutes; },
    trackEdit: function (el) { trackForm(el.dataset.track); },
    resource: function (el) { openResource(track(el.dataset.track)); },
    reminderSettings: reminderForm,
    snooze: function () { var r = state().reminder; r.date = day(); r.status = 'snoozed'; r.snoozeUntil = Date.now() + 20 * 60000; pendingReminder = false; B.closeSheet(); commit(I18n.t('先休息，20 分钟后再提醒你')); },
    restEvening: function () { var r = state().reminder; r.date = day(); r.status = 'rest'; r.snoozeUntil = 0; pendingReminder = false; B.closeSheet(); commit(I18n.t('今天就休息吧，明天再来')); },
    background: backgroundForm,
    enableBackground: function (el) {
      if (!window.landing || !window.landing.autoLaunch) return;
      el.disabled = true;
      window.landing.autoLaunch.set(true).then(function (on) { return window.landing.closePref.set('tray').then(function () { return on; }); }).then(function (on) { el.disabled = false; backgroundForm(); B.toast(on ? I18n.t('已开启自启，关闭窗口后会留在托盘') : I18n.t('已设置托盘常驻，开机自启未能启用，请在设置里重试')); }).catch(function (error) { el.disabled = false; B.toast(error.message || I18n.t('设置失败，请稍后重试')); });
    },
    phone: phoneForm,
    phoneAndroid: function () { state().phone = 'android'; B.save(); phoneForm(); },
    phoneIPhone: function () { state().phone = 'iphone'; B.save(); phoneForm(); },
    phoneHelp: function () { window.open(state().phone === 'iphone' ? 'https://support.apple.com/zh-cn/guide/iphone/iphb0c7313c9/ios' : 'https://support.google.com/android/answer/9346420?hl=zh-Hans', '_blank', 'noopener'); },
    distractionToggle: function () { state().distractionNudge = !state().distractionNudge; commit(); },
    returnFocus: function () { B.closeSheet(); if (timer() && timer().paused && !timer().finished) B.pause(); B.render(); },
    new: function () { form(); }, edit: function (el) { form(el.dataset.id); },
    preset: function (el) { form(null, { read: { name: I18n.t('读书 10 分钟'), minutes: 10, step: I18n.t('拿出书，翻到上次读到的地方') }, study: { name: I18n.t('学习 25 分钟'), minutes: 25, step: I18n.t('打开学习资料，只看眼前这一节') }, walk: { name: I18n.t('出门走 5 分钟'), minutes: 5, step: I18n.t('穿上鞋，走到门外') } }[el.dataset.preset]); },
    select: function (el) { selected = el.dataset.id; B.render(); },
    duration: function (el) { var n = next(); if (n) { n.minutes = Number(el.dataset.minutes); commit(); } },
    start: function () { start(false); }, small: function () { start(true); },
    pause: function () { B.pause(); B.render(); }, settle: settle,
    confirm: function (el) { confirm(el.dataset.session); },
    discard: function () { if (!timer()) return; B.state().timer = null; B.closeSheet(); commit(I18n.t('这次没有计入时长，准备好可以再开始')); },
    toggle: function (el) { var n = task(el.dataset.id); if (!n) return; if (timer() && timer().taskId === n.id) { settle(); return; } completeTask(n, !n.done); commit(n.done ? I18n.t('做完一件了 ✓') : I18n.t('已撤销完成，可以继续做')); },
    delete: function (el) {
      if (timer() && timer().taskId === el.dataset.id) { B.toast(I18n.t('先结束当前专注，再删除这件事')); return; }
      var n = task(el.dataset.id); if (!n) return;
      state().tasks = state().tasks.filter(function (t) { return t.id !== n.id; }); B.closeSheet(); commit(I18n.t('已移除计划，已记录的专注时间保留'));
    },
    carry: function () {
      var list = tasks(), old = tasks(B.addDays(day(), -1)).filter(function (t) { return !t.done && !list.some(function (x) { return x.carriedFrom === t.id; }); });
      B.openSheet(I18n.html('<h2>今天接着做哪件？</h2><p class="hint">昨天的记录会保留，只把你选的这一件加入今天。</p>') + old.map(function (t) { return '<div class="ds-carry-option">' + button('carryItem', esc(t.name) + ' →', 'btn ghost block', 'data-id="' + esc(t.id) + '"') + '</div>'; }).join(''));
    },
    carryItem: function (el) { var n = task(el.dataset.id); if (n) form(null, n, n.id); },
    history: history,
    goal: function () {
      B.openSheet(I18n.html('<h2>给自己一个够得着的目标</h2><p class="hint">只统计你确认记录的专注时长。状态一般时，5 分钟也可以。</p><form id="ds-goal-form"><div class="field"><label for="ds-goal">每天专注（5–240 分钟）</label><input id="ds-goal" type="number" min="5" max="240" step="1" required value="') + state().goal + I18n.html('"></div><div class="sheet-actions"><button type="button" class="btn ghost" data-act="closeSheet">取消</button><button class="btn primary" type="submit">保存目标</button></div></form>'));
      document.getElementById('ds-goal-form').onsubmit = function (e) { e.preventDefault(); var n = Number(document.getElementById('ds-goal').value); if (Number.isInteger(n) && n >= 5 && n <= 240) { state().goal = n; B.closeSheet(); commit(I18n.t('目标已调整')); } };
    }
  };
  function update() {
    if (!B) return;
    var t = timer(), el = document.getElementById('ds-clock'), ring = document.getElementById('ds-ring');
    if (t && el) {
      el.textContent = clock(B.remaining());
      var caption = document.getElementById('ds-clock-caption');
      if (caption) caption.textContent = t.finished ? I18n.t('这一段，你做到了') : (t.paused ? I18n.t('调整一下，再继续') : I18n.t('只管眼前这一小步'));
      var pause = document.querySelector('[data-ds="pause"]');
      if(pause) pause.textContent = t.paused ? I18n.t('▶ 继续专注') : I18n.t('Ⅱ 暂停一下');
      if (ring) ring.style.strokeDashoffset = 603.19 * (B.remaining() / (t.plannedMin * 60000));
    }
    if (window.StudyBuddy) StudyBuddy.refresh();
  }
  function init(bridge) {
    B = bridge; state(); lastDay = day();
    // 旧的「今日一件」只迁入一次，保留完成状态，不产生虚构的时长。
    var s = B.state(), d = state();
    if (!d.migratedOne) {
      if (s.oneThing && s.oneThing.date === day() && !tasks().length) d.tasks.push({ id: B.uid('plan'), date: day(), name: s.oneThing.text, step: '', minutes: 25, done: !!s.oneThing.done, legacyOne: true, dumpId:s.oneThing.dumpId||null });
      d.migratedOne = true; B.save();
    }
    document.addEventListener('click', function (e) { var el = e.target.closest('[data-ds]'); if (el && actions[el.dataset.ds]) actions[el.dataset.ds](el); });
    document.addEventListener('input', function (e) {
      if (e.target.id !== 'ds-win' && e.target.id !== 'ds-obstacle') return;
      var date = day(), r = state().reviews[date] || { win: '', obstacle: '' };
      r[e.target.id === 'ds-win' ? 'win' : 'obstacle'] = e.target.value; r.at = Date.now(); state().reviews[date] = r;
      clearTimeout(reviewTimer); reviewTimer = setTimeout(function () { B.save(); var status = document.getElementById('ds-review-status'); if (status) status.textContent = I18n.t('已自动保存'); }, 300);
    });
    window.addEventListener('beforeunload', function () { clearTimeout(reviewTimer); B.save(); });
    setInterval(function () { if (day() !== lastDay) { lastDay = day(); selected = ''; pendingReminder = false; B.render(); } checkReminder(); }, 1000);
  }
  function onActivity(snapshot) {
    var t = timer(), last = snapshot && snapshot.last;
    if (!t || t.monitorEnabled || t.paused || t.finished || !state().distractionNudge || !last || !snapshot.enabled) return;
    if (last.at === lastSampleAt || Date.now() - lastDistractionAt < 10 * 60000) return;
    lastSampleAt = last.at;
    var text = String(last.proc || '') + ' ' + String(last.title || '');
    if (!/抖音|快手|短剧|短视频|douyin|kuaishou|红果/i.test(text) || /教程|python|pytorch|课程|学习|入门|编程/i.test(text)) return;
    if (document.querySelector('#sheet.show') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    lastDistractionAt = Date.now(); B.pause();
    B.notify(I18n.t('着陆 · 要回到刚才那一步吗？'), I18n.t('当前专注已暂停，准备好后再继续。'));
    if (window.landing && window.landing.nudge) window.landing.nudge();
    B.openSheet(I18n.html('<h2>刚才好像刷到视频了</h2><p class="hint">窗口标题里出现了短视频或短剧关键词，可能识别不准。已暂停专注计时，可以接着做，也可以结束记录。</p><div class="ds-next-step"><span>你刚才在做</span><p>') + esc(t.name) + '</p></div><div class="sheet-actions">' + button('settle', I18n.t('先结束这次'), 'btn ghost') + button('returnFocus', I18n.t('回到学习，继续计时'), 'btn primary') + '</div>');
    B.render();
  }
  function desktopAction(action, id) {
    if (!B) return I18n.t('着陆还在准备，请稍等。');
    if (document.querySelector('#sheet.show form') && ['study','capture','settle'].indexOf(action) >= 0) return I18n.t('着陆里还有正在填写的内容，先保存或取消，我会等你。');
    if (window.LearningCheckpoint && LearningCheckpoint.isOpen() && ['study','capture','settle'].indexOf(action) >= 0) return I18n.t('先保存或取消正在编辑的学习断点，我会等你。');
    if (action === 'study') {
      if (B.state().timer) return I18n.t('已经有一个计时了，可以暂停、继续或结束记录。');
      var t = track(id); if (!t) return I18n.t('请先选择 Python 或 PyTorch。');
      prepare(t.id);return I18n.t('请在主窗口确认学习时长和检测方式');
    }
    if (action === 'pause' || action === 'resume') {
      var active = timer(); if (!active || active.finished) return I18n.t('现在没有可以暂停或继续的学习计时。');
      if ((action === 'pause' && !active.paused) || (action === 'resume' && active.paused)) { B.pause(); B.render(); }
      return active.paused ? I18n.t('暂停了，歇一会也没关系。') : I18n.t('接着刚才那一步，我陪你。');
    }
    if (action === 'settle') { if (!timer()) return I18n.t('现在没有学习计时，可以先选择时长再开始。'); settle(); return I18n.t('请在着陆里确认实际学习时间，再保存记录。'); }
    if (action === 'capture') { var course=track(id); if (!course || !window.LearningCheckpoint) return I18n.t('暂时无法截屏，请打开着陆重试。'); LearningCheckpoint.capture(course.id); return I18n.t('正在截取学习画面，请在着陆里核对并保存断点。'); }
    return '';
  }
  window.Discipline = { prepare:prepare, desktopAction: desktopAction, init: init, render: render, update: update, settle: settle, onActivity: onActivity, reminderPlan: reminderPlan, captureOne: captureOne,
    needsBackground: function () { return !!(B && state().reminder.enabled); },
    newTask: function () { form(); } };
})();
