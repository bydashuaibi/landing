/* Personal daily reading. Private sources are never queried through public services. */
(function () {
  'use strict';
  var TOPICS = [
    {id:'ai', label:'AI 与机器学习', topic:'artificial-intelligence', note:I18n.t('了解模型、智能体与 AI 应用')},
    {id:'tools', label:'效率工具', topic:'productivity', note:I18n.t('找一个能省下重复劳动的工具')},
    {id:'frontend', label:'前端开发', topic:'frontend', note:I18n.t('看看界面与交互如何实现')},
    {id:'python', label:'Python', topic:'python', note:I18n.t('从示例入手，练习 Python')},
    {id:'pytorch', label:'PyTorch', topic:'pytorch', note:I18n.t('读训练示例，理解张量与模型')},
    {id:'data', label:'数据可视化', topic:'data-visualization', note:I18n.t('把数据变成更直观的图表')},
    {id:'devops', label:'DevOps', topic:'devops', note:I18n.t('了解构建、部署与运维流程')},
    {id:'security', label:'安全', topic:'security', note:I18n.t('了解安全工具及其使用边界')},
    {id:'mobile', label:'移动开发', topic:'mobile', note:I18n.t('发现移动端框架与开发工具')},
    {id:'hardware', label:'硬件与 IoT', topic:'iot', note:I18n.t('从软硬件结合的小项目开始')}
  ];
  var L, inflight = null, progress = '', error = '', selectedDate = '', filter = 'all', search = '', sort = 'stars', onlySaved = false;
  var nextAllowed = {};
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function displayCategory(label) { return TOPICS.some(function(t) { return t.label === label; }) ? I18n.t(label) : label; }
  function day() { return L.today(); }
  function prefs() {
    return Object.assign({provider:'github', base:'', interests:['ai','tools','frontend'], keywords:[], language:'', mode:'active', auto:true}, L.state().digestPrefs || {});
  }
  function groups(p) {
    return TOPICS.filter(function(t) { return p.interests.indexOf(t.id) >= 0; }).concat(p.keywords.map(function(k) { return {id:'custom:'+k, label:k, keyword:k, note:I18n.t('匹配你的自定义关键词')}; })).slice(0,8);
  }
  function identity(p) { return p.provider + ':' + (p.provider === 'github' ? 'https://api.github.com' : p.base.replace(/\/+$/, '')); }
  function signature(p) { return JSON.stringify([identity(p), p.interests, p.keywords, p.language, p.mode]); }
  function compatible(dg, p) { return dg && (dg.signature === signature(p) || (!dg.signature && p.provider === 'github')); }
  function snapshots(p) {
    var result = {};
    function add(date, dg) { if (/^\d{4}-\d{2}-\d{2}$/.test(date) && compatible(dg,p) && (!result[date] || dg.fetchedAt > result[date].fetchedAt)) result[date] = dg; }
    Object.values(L.state().digestHistory || {}).forEach(function(record) { add(record.date,record.digest); });
    Object.keys(L.state().digest || {}).forEach(function(date) { add(date,L.state().digest[date]); });
    return result;
  }
  function dates(p) { return Object.keys(snapshots(p)).sort().reverse(); }
  function latest(p) { var data=snapshots(p), ds=Object.keys(data).sort().reverse(); return ds.length ? data[ds[0]] : null; }
  function notify() {
    if (document.body.dataset.tab !== 'digest') return;
    var input=document.activeElement, focused=input && input.id==='digest-search';
    var selection=focused ? [input.selectionStart,input.selectionEnd] : null;
    L.render();
    if (focused) { input=document.getElementById('digest-search'); if (input) { input.focus({preventScroll:true}); input.setSelectionRange(selection[0],selection[1]); } }
  }
  function message(e) { return String(e && e.message || I18n.t('连接失败')).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
  function num(n) { return Number(n || 0).toLocaleString(I18n.locale()); }
  function stamp(ts) { return ts ? new Date(ts).toLocaleString(I18n.locale(), {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : I18n.t('时间未知'); }
  function safeLink(v) { try { var u = new URL(v); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } }
  function repository(r, gitlab) {
    var name = gitlab ? r.path_with_namespace : r.full_name;
    var url = safeLink(gitlab ? r.web_url : r.html_url);
    if (!name || !url || r.archived) return null;
    return {name:String(name).slice(0,200), url:url, desc:String(r.description || '').slice(0,600), stars:Number(gitlab ? r.star_count : r.stargazers_count) || 0,
      lang:gitlab ? '' : String(r.language || ''), updatedAt:gitlab ? r.last_activity_at : r.pushed_at, createdAt:r.created_at, private:!!(r.private || r.visibility === 'private')};
  }
  function params(p, g) {
    if (p.provider === 'gitlab') {
      var gp = {archived:'false', simple:'true', order_by:p.mode === 'new' ? 'created_at' : 'last_activity_at', sort:'desc', per_page:12};
      gp[g.keyword ? 'search' : 'topic'] = g.keyword || g.topic;
      return gp;
    }
    var q = (g.keyword ? '"' + g.keyword.replace(/["\\]/g,' ') + '"' : 'topic:' + g.topic) + ' archived:false fork:false';
    q += p.mode === 'new' ? ' created:>=' + L.addDays(day(),-90) : ' pushed:>=' + L.addDays(day(),-30);
    if (p.provider === 'github') q += p.mode === 'new' ? ' stars:>=5' : ' stars:>=30';
    if (p.language) q += ' language:"' + p.language + '"';
    return {q:q, sort:'stars', order:'desc', per_page:12};
  }
  async function request(p, g) {
    if (!window.landing || !window.landing.digest) throw new Error(I18n.t('请通过更新后的桌面程序打开日报'));
    var result = await window.landing.digest.request({provider:p.provider, base:p.base, params:params(p,g), publicToken:p.provider === 'github' ? (L.state().settings.githubToken || '') : ''});
    if (result.status < 200 || result.status >= 300) {
      var limited = result.status === 429 || (result.status === 403 && (String(result.remaining) === '0' || /rate.limit/i.test(JSON.stringify(result.body))));
      var e = new Error(limited ? I18n.t('请求达到服务限额，请稍后重试') : result.status === 401 ? I18n.t('访问令牌无效或已过期，请在定制中更新') : result.status === 403 ? I18n.t('没有读取权限，请检查令牌权限') : result.status === 404 ? I18n.t('未找到服务接口，请检查服务地址') : result.status >= 300 && result.status < 400 ? I18n.t('服务发生重定向，请填写最终服务地址') : I18n.t('数据源暂时不可用（HTTP ')+result.status+'）');
      e.stop = limited || result.status === 401 || result.status === 403 || result.status === 404;
      if (limited) {
        var retry = Number(result.retryAfter), reset = Number(result.reset) * 1000;
        nextAllowed[identity(p)] = Math.max(Date.now()+60000, Number.isFinite(retry) ? Date.now()+Math.min(retry,3600)*1000 : 0, Number.isFinite(reset) ? Math.min(reset,Date.now()+3600000) : 0);
      }
      throw e;
    }
    var raw = p.provider === 'gitlab' ? result.body : result.body && result.body.items;
    if (!Array.isArray(raw)) throw new Error(I18n.t('服务返回的数据格式不正确，请检查接口地址'));
    if (result.body && result.body.incomplete_results) throw new Error(I18n.t('服务搜索尚未完成，请稍后重试'));
    return raw.map(function(r) { return repository(r, p.provider === 'gitlab'); }).filter(Boolean);
  }
  function refresh(force) {
    if (inflight) return inflight;
    var p = prefs(), dt = day(), old = snapshots(p)[dt];
    if (!force && old && old.signature === signature(p) && !old.partial) return Promise.resolve(old);
    if (Date.now() < (nextAllowed[identity(p)] || 0)) { error = '请在 '+stamp(nextAllowed[identity(p)])+I18n.t(' 后再刷新，避免触发请求限额。'); notify(); return Promise.resolve(null); }
    error = ''; progress = I18n.t('准备获取');
    // Defer the work so render sees the shared promise even on a fast local source.
    inflight = Promise.resolve().then(async function() {
      var previous = latest(p), categories = {}, categoryTimes = {}, failures = {}, wanted = groups(p), success = 0, stopped = '';
      var prev = {};
      if (previous) Object.keys(previous.categories || {}).forEach(function(k) { (previous.categories[k] || []).forEach(function(r) { prev[r.name] = r.stars; }); });
      for (var i=0; i<wanted.length; i++) {
        var g = wanted[i];
        progress = I18n.t('正在获取 ')+g.label+' · '+(i+1)+'/'+wanted.length; notify();
        if (stopped) { failures[g.label] = stopped; }
        else {
          try { categories[g.label] = await request(p,g); categoryTimes[g.label] = Date.now(); success++; }
          catch(e) { failures[g.label] = message(e); if (e.stop) stopped = failures[g.label]; }
        }
        if (failures[g.label]) {
          categories[g.label] = previous && previous.categories[g.label] || [];
          categoryTimes[g.label] = previous && (previous.categoryTimes && previous.categoryTimes[g.label] || previous.fetchedAt) || 0;
        }
        if (!stopped && i < wanted.length-1 && p.provider !== 'gitlab') await new Promise(function(resolve) { setTimeout(resolve,6500); });
      }
      if (signature(prefs()) !== signature(p)) return null;
      var count = Object.keys(failures).length;
      if (!success) { error = Object.values(failures)[0] || '未选择关注领域'; return null; }
      var dg = {fetchedAt:Date.now(), categories:categories, categoryTimes:categoryTimes, failures:failures, partial:count>0,
        signature:signature(p), source:identity(p), provider:p.provider, mode:p.mode, _prev:prev, previousAt:previous && previous.fetchedAt || 0};
      var displaced = L.state().digest[dt];
      if (displaced && displaced.signature !== dg.signature) {
        var history = L.state().digestHistory || (L.state().digestHistory = {});
        history[dt+':'+displaced.fetchedAt] = {date:dt,digest:displaced};
      }
      L.state().digest[dt] = dg;
      // Existing history stays intact; bookmarks keep their own complete snapshots.
      L.save(); selectedDate = dt;
      if (count) error = count+I18n.t(' 个领域未更新，已保留它们的上次内容。');
      return dg;
    }).catch(function(e) { error = message(e); return null; }).finally(function() {
      progress = ''; inflight = null; nextAllowed[identity(p)] = Math.max(nextAllowed[identity(p)] || 0,Date.now()+60000); notify();
    });
    notify(); return inflight;
  }
  function bookmarks() { return L.state().digestSaved || (L.state().digestSaved = {}); }
  function key(r) { return r.url; }
  function entries(dg) {
    var map = new Map();
    Object.keys(dg && dg.categories || {}).forEach(function(cat) {
      (dg.categories[cat] || []).forEach(function(r) {
        if (!safeLink(r.url)) return;
        var id = key(r), entry = map.get(id);
        var observed = dg.categoryTimes && dg.categoryTimes[cat] || dg.fetchedAt || 0;
        if (entry) {
          var cats = entry.cats.concat(cat);
          if (observed > entry.observedAt) map.set(id,Object.assign({},r,{cats:cats,observedAt:observed}));
          else entry.cats = cats;
        } else map.set(id, Object.assign({},r,{cats:[cat],observedAt:observed}));
      });
    });
    return Array.from(map.values());
  }
  function current() {
    var p = prefs(), ds = dates(p), date = ds.indexOf(selectedDate)>=0 ? selectedDate : ds[0] || day();
    return {p:p, dates:ds, date:date, dg:snapshots(p)[date] || null};
  }
  function visible(c) {
    var all = onlySaved ? Object.values(bookmarks()).filter(function(r) { return r.source === identity(c.p); }) : entries(c.dg);
    return all.filter(function(r) { return (filter === 'all' || (r.cats || []).indexOf(filter)>=0) && (!search || (r.name+' '+r.desc+' '+r.lang+' '+(r.cats || []).map(displayCategory).join(' ')).toLowerCase().includes(search.toLowerCase())); })
      .sort(function(a,b) { return sort === 'recent' ? (Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0) : (b.stars||0)-(a.stars||0); });
  }
  function card(r, c, index) {
    var saved = !!bookmarks()[key(r)], growth = '', cats = r.cats || [];
    // Only calculate a change when both observations are real; old "近3天" labels were misleading.
    var fresh = cats.every(function(cat) { return !(c.dg && c.dg.failures && c.dg.failures[cat]); });
    if (!onlySaved && fresh && c.dg && c.dg.previousAt && c.dg._prev && Object.prototype.hasOwnProperty.call(c.dg._prev,r.name)) {
      var delta = r.stars-c.dg._prev[r.name];
      growth = I18n.html('<span class="digest-change">较上次收录 ')+(delta>0?'+':'')+num(delta)+' 星</span>';
    }
    var guide = groups(c.p).find(function(g) { return cats.indexOf(g.label)>=0; });
    return '<article class="digest-project"><div class="digest-project-top"><span class="digest-index">'+String(index+1).padStart(2,'0')+'</span><span class="digest-category">'+esc(cats.map(displayCategory).join(' / '))+'</span>'+(r.private?I18n.html('<span class="digest-private">私有</span>'):'')+'</div>'
      +'<a class="digest-project-name" href="'+esc(safeLink(r.url))+'" target="_blank" rel="noopener noreferrer" data-digest-read="'+esc(key(r))+'">'+esc(r.name)+' <span aria-hidden="true">↗</span></a>'
      +'<p class="digest-description">'+esc(r.desc || I18n.t('项目未提供简介，打开 README 了解详情。'))+'</p>'
      +'<div class="digest-project-meta"><span class="digest-star">★ '+num(r.stars)+'</span>'+(r.lang?'<span>'+esc(r.lang)+'</span>':'')+(r.updatedAt?I18n.html('<span>更新于 ')+esc(String(r.updatedAt).slice(0,10))+'</span>':'')+'</div>'
      +(growth?'<div class="digest-growth-row">'+growth+'</div>':'')
      +'<div class="digest-project-bottom"><span>'+esc(guide ? guide.note : I18n.t('先看 README，再挑一个示例试试'))+'</span><button class="digest-bookmark '+(saved?'is-saved':'')+'" data-digest="save" data-url="'+esc(key(r))+'" aria-pressed="'+saved+'" aria-label="'+(saved?I18n.t('取消收藏 '):I18n.t('收藏 '))+esc(r.name)+'">'+(saved?I18n.t('★ 已收藏'):I18n.t('☆ 收藏'))+'</button></div></article>';
  }
  function resultsHTML(c) {
    var list = visible(c);
    var h = '<div class="digest-results-head"><span>'+ (onlySaved ? I18n.t('我的收藏') : filter === 'all' ? I18n.t('为你发现') : esc(displayCategory(filter))) +'</span><small>'+list.length+I18n.t(' 个项目 · ')+(sort === 'stars'?I18n.t('按总星标排序'):I18n.t('按最近更新排序'))+'</small></div>';
    if (!list.length) return h+'<div class="digest-empty"><b>'+(onlySaved?I18n.t('还没有匹配的收藏'):search || filter!=='all'?I18n.t('没有找到匹配项目'):inflight?I18n.t('正在寻找值得一读的项目…'):I18n.t('暂时没有项目'))+'</b><p>'+(onlySaved?I18n.t('点项目卡片上的「收藏」，下次离线也能回看。'):search || filter!=='all'?I18n.t('试试其他关键词，或清除筛选。'):I18n.t('可以调整兴趣或语言条件，或点「更新日报」重试。'))+'</p>'+((search || filter!=='all')?I18n.html('<button class="btn sm" data-digest="clear">清除筛选</button>'):'')+'</div>';
    return h+'<div class="digest-grid">'+list.map(function(r,i) { return card(r,c,i); }).join('')+'</div>';
  }
  function render() {
    var c = current(), p = c.p, dg = c.dg, all = entries(dg), savedCount = Object.values(bookmarks()).filter(function(r) { return r.source === identity(p); }).length;
    var src = p.provider === 'github' ? 'GitHub' : p.provider === 'gitlab' ? I18n.t('私有 GitLab') : 'GitHub Enterprise';
    var h = I18n.html('<section class="digest-page"><header class="digest-hero"><div class="digest-eyebrow">DAILY DISCOVERY <span>技术日报</span></div><div class="digest-hero-row"><div><h2>每天一点新发现<span>。</span></h2><p>从你的兴趣出发，找到下一个值得动手的小项目。</p></div><button class="btn sm" data-digest="settings">定制我的日报</button></div><div class="digest-summary"><span><strong>')+all.length+I18n.html('</strong> 个项目</span><span><strong>')+groups(p).length+I18n.html('</strong> 个关注方向</span><span class="digest-source">')+esc(src)+'</span></div></header>';
    h += '<div class="digest-controls"><div class="digest-switch"><button data-digest="feed" class="'+(!onlySaved?'on':'')+'" aria-pressed="'+!onlySaved+I18n.html('">发现</button><button data-digest="saved" class="')+(onlySaved?'on':'')+'" aria-pressed="'+onlySaved+I18n.t('">收藏 ')+savedCount+I18n.html('</button></div><div class="digest-control-right"><label class="digest-sr" for="digest-date">日报日期</label><select id="digest-date" ')+(!c.dates.length?'disabled':'')+'>'+(c.dates.length?c.dates:[day()]).map(function(d) { return '<option '+(c.date===d?'selected':'')+' value="'+d+'">'+d+(d===day()?I18n.t(' · 今天'):'')+'</option>'; }).join('')+'</select><button class="btn primary sm" data-digest="refresh" '+(inflight?'disabled':'')+'>'+ (inflight?I18n.t('正在更新…'):I18n.t('更新日报'))+'</button></div></div>';
    h += '<div class="digest-status" role="status" aria-live="polite">'+(inflight?esc(progress):dg?I18n.t('上次更新 ')+esc(stamp(dg.fetchedAt))+' · '+(p.provider==='gitlab'?I18n.t('按服务端项目活跃时间发现'):p.mode==='new'?I18n.t('近 90 天新建项目'):I18n.t('近 30 天有代码更新的项目')):I18n.t('选择兴趣后，每天首次打开自动获取。'))+'</div>';
    if (error) h += '<div class="digest-notice" role="alert">'+esc(error)+(dg?I18n.t(' 当前仍可阅读缓存内容。'):'')+'</div>';
    if (dg && c.date !== day()) h += I18n.html('<div class="digest-notice">正在查看 ')+esc(c.date)+I18n.html(' 的缓存，内容不是今天的更新。</div>');
    if (dg && dg.partial) h += '<div class="digest-notice">'+Object.keys(dg.failures).map(function(k) { return esc(k)+'：'+esc(dg.failures[k]); }).join('；')+'</div>';
    h += '<div class="digest-filter-row"><div class="digest-filters"><button class="dg-pill '+(filter==='all'?'on':'')+'" data-digest="filter" data-cat="all" aria-pressed="'+(filter==='all')+I18n.html('">全部</button>');
    var labels = Array.from(new Set(groups(p).map(function(g) { return g.label; }).concat(Object.keys(dg && dg.categories || {}))));
    labels.forEach(function(label) { h += '<button class="dg-pill '+(filter===label?'on':'')+'" data-digest="filter" data-cat="'+esc(label)+'" aria-pressed="'+(filter===label)+'">'+esc(displayCategory(label))+'</button>'; });
    h += I18n.html('</div><div class="digest-search-row"><label class="digest-sr" for="digest-search">搜索项目、简介或语言</label><input id="digest-search" type="search" placeholder="搜索项目、简介或语言…" value="')+esc(search)+I18n.html('"><label class="digest-sr" for="digest-sort">排序方式</label><select id="digest-sort"><option value="stars" ')+(sort==='stars'?'selected':'')+I18n.html('>最多星标</option><option value="recent" ')+(sort==='recent'?'selected':'')+I18n.html('>最近更新</option></select></div></div>');
    h += '<div id="digest-results">'+resultsHTML(c)+I18n.html('</div><footer class="digest-footer">来源：')+esc(src)+(p.provider!=='github'?' · '+esc(p.base):'')+I18n.html(' · 星标为累计数量，不代表今日涨幅。<br>兴趣与收藏保存在本机；获取项目时，选中的主题和关键词仅发送给上述数据源。</footer></section>');
    return h;
  }
  function settings() {
    if (inflight) { L.toast(I18n.t('正在更新，请完成后再调整定制')); return; }
    var p = prefs();
    var h = I18n.html('<form id="digest-settings" class="digest-settings"><h2>定制我的日报</h2><p class="hint">关注你真正感兴趣的方向。最多选 8 个方向（含自定义关键词）。</p><fieldset><legend>兴趣方向</legend><div class="digest-interest-options">');
    TOPICS.forEach(function(t) { h += '<label><input type="checkbox" name="interest" value="'+t.id+'" '+(p.interests.includes(t.id)?'checked':'')+'><span>'+esc(displayCategory(t.label))+'</span></label>'; });
    h += I18n.html('</div></fieldset><label class="field">自定义关键词（逗号分隔，每项最多 40 字）<input name="keywords" maxlength="320" value="')+esc(p.keywords.join('，'))+I18n.html('" placeholder="例如：笔记、robotics、游戏开发"></label><div class="digest-setting-grid"><label class="field">发现方式<select name="mode"><option value="active" ')+(p.mode==='active'?'selected':'')+I18n.html('>近期活跃</option><option value="new" ')+(p.mode==='new'?'selected':'')+I18n.html('>新项目</option></select></label><label class="field">编程语言（GitHub 系列）<select name="language">');
    ['', 'Python','JavaScript','TypeScript','Go','Rust','Java','C++','C#','Swift','Kotlin'].forEach(function(v) { h += '<option value="'+esc(v)+'" '+(p.language===v?'selected':'')+'>'+esc(v||I18n.t('不限语言'))+'</option>'; });
    h += I18n.html('</select></label></div><fieldset><legend>数据源与私有部署</legend><label class="field">服务类型<select name="provider"><option value="github" ')+(p.provider==='github'?'selected':'')+I18n.html('>公共 GitHub</option><option value="enterprise" ')+(p.provider==='enterprise'?'selected':'')+I18n.html('>GitHub Enterprise（自部署）</option><option value="gitlab" ')+(p.provider==='gitlab'?'selected':'')+I18n.html('>GitLab（自部署 / gitlab.com）</option></select></label><label class="field" id="digest-base-field">服务地址<input name="base" type="url" value="')+esc(p.base)+I18n.html('" placeholder="https://git.example.com"><small>填写站点地址或 API 根地址。支持子路径；本机服务可用 HTTP。</small></label><label class="field">该服务的访问令牌<input name="token" type="password" autocomplete="new-password" placeholder="留空保留；公共 GitHub 也可不填"><small>私有项目需令牌具备读取权限。新令牌加密保存在此电脑，不写入日报和 JSON 备份。</small></label><label class="digest-check"><input type="checkbox" name="clearToken">清除该服务已保存的令牌</label><p class="hint" id="digest-provider-hint"></p></fieldset><label class="digest-check"><input type="checkbox" name="auto" ')+(p.auto?'checked':'')+I18n.html('>每天首次打开自动更新</label><p id="digest-settings-error" class="digest-form-error" role="alert"></p><div class="digest-form-actions"><button class="btn" type="button" data-digest="close">取消</button><button class="btn primary" type="submit">保存并更新</button></div></form>');
    L.openSheet(h, 'digest-sheet'); syncProvider();
  }
  function syncProvider() {
    var form = document.getElementById('digest-settings'); if (!form) return;
    var provider = form.elements.provider.value;
    form.elements.base.disabled = provider === 'github'; form.elements.language.disabled = provider === 'gitlab';
    document.getElementById('digest-base-field').hidden = provider === 'github';
    document.getElementById('digest-provider-hint').textContent = provider === 'gitlab' ? I18n.t('内置方向按项目 Topic 匹配；自定义关键词搜索名称和简介。按最近活跃 / 新建时间取前 12 项，不限制星标和语言。只请求此 GitLab。') : provider === 'enterprise' ? I18n.t('只请求此 Enterprise 服务，不向公共 GitHub 查询。私有项目不设最低星标门槛。') : I18n.t('使用 GitHub 搜索；活跃项目至少 30 星，新项目至少 5 星。已有「我的」中的 GitHub Token 可继续使用。');
  }
  async function saveSettings(form) {
    var output = document.getElementById('digest-settings-error'), submit = form.querySelector('[type="submit"]');
    var p = {provider:form.elements.provider.value, base:form.elements.base.value.trim().replace(/\/+$/,''), interests:Array.from(form.querySelectorAll('[name="interest"]:checked')).map(function(el) { return el.value; }),
      keywords:Array.from(new Set(form.elements.keywords.value.split(/[,，\n]/).map(function(s) { return s.trim(); }).filter(Boolean))), mode:form.elements.mode.value, language:form.elements.language.value, auto:form.elements.auto.checked};
    if (!p.interests.length && !p.keywords.length) { output.textContent=I18n.t('至少选择一个兴趣方向或填写关键词。'); return; }
    if (p.interests.length+p.keywords.length>8 || p.keywords.some(function(k) { return k.length>40; })) { output.textContent=I18n.t('最多 8 个方向，每个关键词最多 40 字。'); return; }
    submit.disabled = true;
    try {
      var config = await window.landing.digest.configure({provider:p.provider, base:p.base, token:form.elements.token.value.trim(), clearToken:form.elements.clearToken.checked});
      p.base = p.provider==='github'?'':config.base;
      if (form.elements.clearToken.checked && p.provider==='github') L.state().settings.githubToken = '';
      L.state().digestPrefs = p; L.save(); filter='all'; search=''; selectedDate=''; onlySaved=false;
      L.closeSheet(); L.render();
      // Honor a server rate limit even when interests are changed.
      await refresh(true);
    } catch(e) { output.textContent=message(e); }
    finally { submit.disabled=false; }
  }
  function init(bridge) {
    L = bridge;
    document.addEventListener('click', function(e) {
      var el = e.target.closest('[data-digest]'); if (!el) return;
      e.preventDefault(); var action=el.dataset.digest;
      if (action==='refresh') { refresh(true); return; }
      if (action==='settings') { settings(); return; }
      if (action==='close') { L.closeSheet(); return; }
      if (action==='filter') filter=el.dataset.cat;
      if (action==='feed' || action==='saved') { onlySaved=action==='saved'; filter='all'; search=''; }
      if (action==='clear') { filter='all'; search=''; }
      if (action==='save') {
        var url=el.dataset.url, saved=bookmarks();
        if (saved[url]) delete saved[url];
        else { var r=entries(current().dg).find(function(v) { return key(v)===url; }); if (r) saved[url]=Object.assign({},r,{savedAt:Date.now(),source:identity(prefs())}); }
        L.save();
      }
      notify();
    });
    document.addEventListener('input',function(e) { if (e.target.id==='digest-search') { search=e.target.value; document.getElementById('digest-results').innerHTML=resultsHTML(current()); } });
    document.addEventListener('change',function(e) {
      if (e.target.id==='digest-date') { selectedDate=e.target.value; notify(); }
      if (e.target.id==='digest-sort') { sort=e.target.value; document.getElementById('digest-results').innerHTML=resultsHTML(current()); }
      if (e.target.name==='provider' && e.target.closest('#digest-settings')) syncProvider();
    });
    document.addEventListener('submit',function(e) { if (e.target.id==='digest-settings') { e.preventDefault(); saveSettings(e.target); } });
  }
  window.Digest = {init:init, render:render, refresh:refresh, settings:settings, snapshot:function() { return snapshots(prefs())[day()] || null; }, auto:function() { if (prefs().auto) return refresh(false); return Promise.resolve(null); }};
})();
