/* 桌面悬浮询问窗的脚本（2026-10-14）。
   为什么要单独一个文件：主进程给所有会话注入了 CSP（script-src 'self'），
   **内联脚本会被拦掉** —— 表现是弹出来个空框、点按钮没反应（真踩过）。 */
var api = window.landingAsk;
  function $(id){ return document.getElementById(id); }
  function apply(d){
    d = d || {};
    $('app').textContent = d.appLabel || '某个程序';
    $('name').value = d.name || '';
    $('hint').textContent = d.known
      ? '回车即开始 · 改一下也行'
      : '确认一次就记住 · 回车即开始';
    setTimeout(function(){ try{ $('name').focus(); $('name').select(); }catch(e){} }, 60);
  }
  if(api && api.onData) api.onData(apply);
  /* 监听挂好了 → 告诉主进程「可以发了」。窗口可能比这行脚本先就绪，
     不喊这一声，第一条 ask:data 就会丢掉（实测：弹出来是个空框）。 */
  if(api && api.ready) api.ready();
  function go(){
    var v = String($('name').value || '').trim().slice(0, 20);
    if(!v){ $('hint').textContent = '给它起个名字再开始 —— 随便写两个字的都行。'; $('name').focus(); return; }
    if(api) api.resolve({ name: v });
  }
  $('go').addEventListener('click', go);
  $('no').addEventListener('click', function(){ if(api) api.resolve({ skipped: true }); });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); go(); }
    else if(e.key === 'Escape'){ e.preventDefault(); if(api) api.resolve({ skipped: true }); }
  });
