/* 首页伙伴：共享原宠物存档和计时，只根据实际状态更新，不另起计时、不自动调用 AI。 */
(function () {
  'use strict';
  var speech = null, press = null, suppressClickUntil = 0;
  function L() { return window.Landing; }
  function esc(v) { return L().esc(String(v == null ? '' : v)); }
  function context(s) {
    var p = s.pet || {}, d = s.discipline || {}, learning = d.learning || {}, tracks = learning.tracks || [];
    var timer = s.timer && s.timer.discipline ? s.timer : null;
    var task = timer && (d.tasks || []).find(function (n) { return n.id === timer.taskId; });
    var course = tracks.find(function (t) { return t.id === (task && task.trackId || learning.selected); });
    var title = course ? course.name : I18n.t('眼前这一小步'), mode = 'idle', label = I18n.t('在这里等你'), line;
    if (p.sleeping) { mode = 'sleep'; label = I18n.t('小憩中'); line = I18n.t('它睡着了，给你留着一盏灯。想休息也可以。'); }
    else if (timer && timer.finished) { mode = 'done'; label = I18n.t('这一段，做到了'); line = I18n.t('先把刚才的进度记下来，再伸个懒腰。'); }
    else if (timer && timer.paused) { mode = 'paused'; label = I18n.t('陪你歇一会'); line = I18n.t('暂停也没关系。准备好了，就接着刚才那一步。'); }
    else if (timer || p.studyMode) { mode = 'focus'; label = timer ? I18n.t('安静陪读中') : I18n.t('书已翻开'); line = I18n.t('我陪你看 ') + title + I18n.t('。不用赶，先弄懂眼前这个例子。'); }
    else {
      var r = course && course.resume;
      line = r && r.topic ? I18n.t('上次看到「') + r.topic.slice(0, 65) + I18n.t('」。今天接着这一点就好。') : '把 ' + title + I18n.t(' 的资料打开，先看五分钟。我在旁边。');
    }
    var remain = timer ? Math.max(0, timer.finished ? 0 : timer.paused ? timer.remainMs : timer.endsAt - Date.now()) : 0;
    var n = Math.ceil(remain / 1000), clock = String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
    var total = (d.sessions || []).filter(function (v) { return v.date === L().today(); }).reduce(function (sum, v) { return sum + (Number(v.minutes) || 0); }, 0);
    var intimacy = Number(p.intimacy) || 0;
    return { mode: mode, label: label, line: line, course: title, timer: timer, clock: clock,
      progress: timer ? Math.max(0, Math.min(100, (1 - remain / (timer.plannedMin * 60000)) * 100)) : 0,
      mood: (Number(p.mood) || 0) >= 85 ? I18n.t('心情美滋滋') : (Number(p.mood) || 0) >= 60 ? I18n.t('心情不错') : I18n.t('想和你待一会'),
      bond: intimacy >= 80 ? I18n.t('形影不离') : intimacy >= 60 ? I18n.t('好朋友') : intimacy >= 40 ? I18n.t('很亲近') : intimacy >= 20 ? I18n.t('越来越熟') : I18n.t('慢慢熟悉中'),
      total: total, manualStudy: !!p.studyMode };
  }
  function render(s) {
    var p = s.pet || {}, c = context(s);
    return '<section class="ds-companion buddy-card" id="buddy-card" data-mode="' + c.mode + I18n.html('"><div class="buddy-scene"><div class="buddy-window" aria-hidden="true"><i></i><i></i><i></i></div><div class="buddy-books" aria-hidden="true"><i></i><i></i><i></i></div><div class="buddy-lamp" aria-hidden="true"><i></i></div><div class="buddy-desk" aria-hidden="true"></div><div id="ds-pet-host" aria-label="你的伙伴"></div><span class="buddy-scene-note">点一下摸头 · 按住抱抱</span></div><div class="ds-companion-content"><div class="buddy-heading"><span class="ds-eyebrow">A LITTLE COMPANY / 有我陪你</span><button type="button" class="buddy-settings" data-buddy="settings" aria-label="伙伴偏好设置" title="伙伴偏好设置">⚙</button></div><div class="buddy-name-row"><h2>') + esc(p.name || I18n.t('小陆')) + '</h2><span class="buddy-status" id="buddy-status"><i></i><span>' + esc(c.label) + '</span></span></div><div class="buddy-speech"><span class="buddy-quote" aria-hidden="true">“</span><span id="ds-pet-response" class="ds-pet-response" role="status" aria-live="polite">' + esc(speech && speech.until > Date.now() ? speech.text : c.line) + '</span></div><div class="buddy-under-speech"><span id="buddy-mood">' + esc(c.mood) + '</span><span id="buddy-bond">' + esc(c.bond) + '</span><span id="buddy-today">' + (c.total ? I18n.t('今天已专注 ') + c.total + I18n.t(' 分钟') : I18n.t('今天，从一点点开始')) + '</span></div><div class="ds-pet-actions">' + [['wave','👋',I18n.t('挥挥手')],['highfive','🙌',I18n.t('击个掌')],['hug','♡',I18n.t('抱一下')],['study','▤', c.manualStudy ? I18n.t('合上书') : I18n.t('陪我读书')]].map(function (a) { return '<button type="button" class="buddy-action" data-ds="petAction" data-pet-action="' + a[0] + '" data-base-label="' + a[2] + '"><span aria-hidden="true">' + a[1] + '</span><span class="buddy-action-label">' + a[2] + '</span><small class="buddy-cooldown"></small></button>'; }).join('') + I18n.html('</div><div class="buddy-links"><button type="button" data-buddy="walk">走两步</button><button type="button" data-buddy="encourage">有点学不动…</button><button type="button" data-buddy="chat">聊两句</button><button type="button" data-ds="petShow">') + (p.widget && p.widget.hidden ? I18n.t('叫它回来') : I18n.t('叫它过来')) + I18n.html('</button><button type="button" data-ds="petDetails">喂食与养成 ↗</button></div><div class="buddy-focus" id="buddy-focus" ') + (!c.timer ? 'hidden' : '') + '><span id="buddy-focus-title">' + esc(c.course) + '</span><span class="buddy-focus-track"><i id="buddy-focus-progress" style="width:' + c.progress + '%"></i></span><span id="buddy-focus-clock">' + c.clock + '</span></div></div></section>';
  }
  function text(id, value) { var el = document.getElementById(id); if (el && el.textContent !== value) el.textContent = value; }
  function refresh() {
    if (!L()) return;
    var root = document.getElementById('buddy-card'); if (!root) return;
    var s = L().state(), c = context(s), p = s.pet || {};
    root.dataset.mode = c.mode;
    var hour = new Date().getHours(); root.dataset.night = String(hour >= 18 || hour < 6);
    text('buddy-status', c.label); text('buddy-mood', c.mood); text('buddy-bond', c.bond);
    text('buddy-today', c.total ? I18n.t('今天已专注 ') + c.total + I18n.t(' 分钟') : I18n.t('今天，从一点点开始'));
    text('ds-pet-response', speech && speech.until > Date.now() ? speech.text : c.line);
    var focus = document.getElementById('buddy-focus'); if (focus) focus.hidden = !c.timer;
    var mainClock = document.getElementById('ds-clock');
    text('buddy-focus-title', c.course); text('buddy-focus-clock', c.timer && c.timer.finished ? I18n.t('待记录') : mainClock && c.timer ? mainClock.textContent : c.clock);
    var progress = document.getElementById('buddy-focus-progress'); if (progress) progress.style.width = c.progress + '%';
    var study = root.querySelector('[data-pet-action="study"]');
    if (study) {
      study.setAttribute('aria-pressed', String(!!p.studyMode));
      study.classList.toggle('is-active', !!p.studyMode);
      var label = study.querySelector('.buddy-action-label'); if (label) label.textContent = p.studyMode ? I18n.t('合上书') : I18n.t('陪我读书');
    }
    var canvas = root.querySelector('canvas');
    if (canvas && canvas.getAttribute('role') !== 'button') { canvas.removeAttribute('aria-hidden'); canvas.setAttribute('role', 'button'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', I18n.t('摸摸伙伴的头；按住可以抱抱')); }
    if (window.Pet && Pet.cooldown) root.querySelectorAll('[data-pet-action]').forEach(function (b) {
      var ms = Pet.cooldown(b.dataset.petAction), tag = b.querySelector('.buddy-cooldown');
      if (tag) tag.textContent = ms > 0 ? Math.ceil(ms / 1000) + 's' : '';
      b.title = ms > 0 ? I18n.t('仍会回应你；') + Math.ceil(ms / 1000) + I18n.t(' 秒后可再次获得互动成长') : '';
    });
  }
  function say(value, ms, typing) {
    speech = { text: typing ? I18n.t('它在认真想怎么回答你…') : value, until: Date.now() + (ms || 4000) };
    refresh();
  }
  function settings() {
    var p = Pet.state();
    L().openSheet(I18n.html('<h2>让陪伴舒服一点</h2><p class="hint">不用额外完成照料任务。你忙的时候，它会等你。</p><form id="buddy-settings-form"><label class="buddy-pref"><input type="checkbox" id="buddy-pref-quiet" ') + (p.widget.quiet ? 'checked' : '') + I18n.html('> 安静一点，只在我互动时回应<small>专注期间始终关闭自动闲聊。</small></label><label class="buddy-pref"><input type="checkbox" id="buddy-pref-motion" ') + (p.gentleMotion ? 'checked' : '') + I18n.html('> 减少动画，适合专心或容易晕动时<small>系统的减少动态效果设置也会生效。</small></label><label class="buddy-pref"><input type="checkbox" id="buddy-pref-hunger" ') + (p.noHunger ? 'checked' : '') + I18n.html('> 不用担心喂食，它不会变饿<small>原来的喂食、商店和养成仍可使用。</small></label><div class="sheet-actions"><button type="button" class="btn ghost" data-act="closeSheet">取消</button><button type="submit" class="btn primary">保存偏好</button></div></form>'));
    var desktop = window.landing && landing.desktopPet;
    if (desktop) {
      var pref=document.createElement('label'); pref.className='buddy-pref';
      pref.innerHTML=I18n.html('<input type="checkbox" id="buddy-pref-desktop"> 让初华住在桌面上<small>主窗口收起后，也能开始学习、暂停和记断点。资源：Petdex · 桜 八.</small>');
      document.querySelector('#buddy-settings-form .sheet-actions').before(pref);
      desktop.status().then(function(s){var input=document.getElementById('buddy-pref-desktop');if(input&&s)input.checked=s.enabled;});
    }
    document.getElementById('buddy-settings-form').onsubmit = function (e) {
      e.preventDefault(); p.widget.quiet = document.getElementById('buddy-pref-quiet').checked;
      p.gentleMotion = document.getElementById('buddy-pref-motion').checked; p.noHunger = document.getElementById('buddy-pref-hunger').checked;
      if(desktop)desktop.configure({enabled:document.getElementById('buddy-pref-desktop').checked});
      L().save(); L().closeSheet(); Pet.refresh(); L().toast(I18n.t('记住了，按你舒服的方式陪着你'));
    };
  }
  function cancelPress() { if (press) clearTimeout(press.timeout); press = null; }
  document.addEventListener('pointerdown', function (e) {
    if (!e.target.closest('#ds-pet-host canvas') || e.button !== 0) return;
    cancelPress();
    press = { x: e.clientX, y: e.clientY, id: e.pointerId, target: e.target };
    press.timeout = setTimeout(function () {
      if (!press || !press.target.isConnected || document.hidden) return;
      suppressClickUntil = Date.now() + 1000; Pet.interact('hug'); cancelPress();
    }, 600);
  }, true);
  document.addEventListener('pointermove', function (e) { if (press && (e.pointerId !== press.id || Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 9)) cancelPress(); }, true);
  document.addEventListener('pointerup', cancelPress, true);
  document.addEventListener('pointercancel', cancelPress, true);
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancelPress(); else refresh(); });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('#ds-pet-host canvas') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); Pet.pat(); }
  });
  document.addEventListener('click', function (e) {
    if (!L() || !window.Pet) return;
    if (e.target.closest('#ds-pet-host canvas')) { if (Date.now() >= suppressClickUntil) Pet.pat(); return; }
    var b = e.target.closest('[data-buddy]'); if (!b) return;
    if (b.dataset.buddy === 'settings') settings();
    else if (b.dataset.buddy === 'chat') Pet.open('panel', 'chat');
    else if (b.dataset.buddy === 'walk') { Pet.gesture('walk', 3); Pet.say(I18n.t('走两步，活动一下。回来再陪你看书。'), 3800); }
    else if (b.dataset.buddy === 'encourage') {
      var c = context(L().state());
      Pet.say(c.mode === 'focus' ? I18n.t('卡住了就把目标缩小：只运行一个例子，或者写下一个不懂的地方。') : I18n.t('今天不用追平所有进度。把 ') + c.course + I18n.t(' 的资料打开，看懂一个例子，就可以先停下来。'), 7500);
      Pet.gesture('encourage', 1.6);
    }
  });
  setInterval(function () { if (!document.hidden) refresh(); }, 1000);
  window.StudyBuddy = { render: render, refresh: refresh, say: say };
})();
