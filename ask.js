/* 桌面悬浮询问窗的脚本（2026-10-14；同日改语义：问的是「上一段」，直接补记）。
   为什么要单独一个文件：主进程给所有会话注入了 CSP（script-src 'self'），
   **内联脚本会被拦掉** —— 表现是弹出来个空框、点按钮没反应（真踩过）。 */
var api = window.landingAsk;
  function $(id){ return document.getElementById(id); }
  function fmtMin(m){
    m = Math.round(m || 0);
    if(m < 60) return m + I18n.t(' 分钟');
    return Math.floor(m / 60) + I18n.t(' 小时') + (m % 60 ? (m % 60) + I18n.t(' 分') : '');
  }
  function apply(d){
    d = d || {};
    /* 通知模式（2026-10-14）：「不用确认」档 —— 不是在问问题，只告诉他记了什么。
       输入框和按钮都藏掉，主进程 6 秒后自己收。 */
    if(d.notify){
      $('app').textContent = I18n.t('✅ 已记下');
      document.querySelector('.q').textContent = '「' + (d.name || d.appLabel || I18n.t('这段')) + '」· 约 ' + fmtMin(d.minutes);
      $('name').style.display = 'none';
      document.querySelector('.btns').style.display = 'none';
      $('hint').textContent = I18n.t('在别的程序里自动记的 · 记错了去今日页「今天的池子」里删');
      return;
    }
    $('app').textContent = (d.appLabel || I18n.t('某个程序')) + ' · 约 ' + fmtMin(d.minutes);
    /* ⚠️ 这个窗口是复用的：上一轮可能是「已记下」通知（藏了输入框和按钮），
        切回提问形态必须把样式恢复回去，不然弹出来是个没法回答的壳（真踩过） */
    document.querySelector('.q').textContent = I18n.t('这段时间记作什么？');
    $('name').style.display = '';
    document.querySelector('.btns').style.display = '';
    $('name').value = d.name || '';
    $('hint').textContent = d.known
      ? I18n.t('按你上次的叫法填好了 · 回车即记下')
      : I18n.t('确认一次就记住 · 回车即记下');
    setTimeout(function(){ try{ $('name').focus(); $('name').select(); }catch(e){} }, 60);
  }
  if(api && api.onData) api.onData(apply);
  /* 监听挂好了 → 告诉主进程「可以发了」。窗口可能比这行脚本先就绪，
     不喊这一声，第一条 ask:data 就会丢掉（实测：弹出来是个空框）。 */
  if(api && api.ready) api.ready();
  function go(){
    if($('name').style.display === 'none') return;   /* 通知模式没有输入这回事 */
    var v = String($('name').value || '').trim().slice(0, 20);
    if(!v){ $('hint').textContent = I18n.t('给它起个名字再记 —— 随便写两个字的都行。'); $('name').focus(); return; }
    if(api) api.resolve({ name: v });
  }
  $('go').addEventListener('click', go);
  $('no').addEventListener('click', function(){ if(api) api.resolve({ skipped: true }); });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); go(); }
    else if(e.key === 'Escape'){ e.preventDefault(); if(api) api.resolve({ skipped: true }); }
  });
