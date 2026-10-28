/* Sage Studio: retain the live learning and pet nodes while changing their composition. */
(function () {
  'use strict';
  var menu, entrancePlayed = false, pendingAnimations = [], lastTab;
  function closeMenu() {
    document.body.classList.remove('sage-menu-open');
    if (menu) menu.setAttribute('aria-expanded', 'false');
    var nav = document.querySelector('.tabbar'); if (nav) nav.inert = innerWidth <= 820;
  }
  function showDesktop() {
    if (!window.landing || !landing.desktopPet) return;
    landing.desktopPet.configure({enabled:true}).then(function () {
      Landing.toast(I18n.t('伙伴已经来到桌面，收起着陆也能继续陪你'));
    }).catch(function () { Landing.toast(I18n.t('桌宠暂时没有打开，请重试')); });
  }
  function entrance(stage) {
    if (entrancePlayed || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    entrancePlayed = true;
    document.fonts.ready.then(function () {
      if (!stage.isConnected) return;
      var elements = stage.querySelectorAll('.ds-eyebrow,.sage-line,.ds-hero p,.sage-hero-actions,.buddy-scene,.ds-companion-content,.ds-stats>div');
      pendingAnimations = Array.from(elements).map(function (el, i) {
        var a = el.animate([{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'translateY(0)'}],
          {duration:560,delay:Math.min(i * 55,440),easing:'cubic-bezier(.22,.61,.36,1)',fill:'backwards'});
        a.finished.then(function () { a.cancel(); }).catch(function () {}); return a;
      });
    });
  }
  function compose() {
    var home = document.querySelector('.ds-home'); if (!home || home.querySelector('.sage-stage')) return;
    var header=home.querySelector('.ds-hero'),buddy=home.querySelector('#buddy-card'),stats=home.querySelector('.ds-stats');
    if (!header || !buddy || !stats) return;
    var stage=document.createElement('section');stage.className='sage-stage';stage.setAttribute('aria-label',I18n.t('今天的学习与陪伴'));
    home.prepend(stage);stage.append(header,buddy,stats);
    header.querySelector('h1').innerHTML=I18n.html('<span class="sage-line-mask"><span class="sage-line">慢慢来，</span></span><span class="sage-line-mask"><span class="sage-line">也在向前。</span></span>');
    header.querySelector('p').textContent=I18n.t('留一点时间，给真正想学的东西。\n从 Python 或 PyTorch 的一个小例子开始。');
    var actions=document.createElement('div');actions.className='sage-hero-actions';
    var active=Landing.state().timer;
    actions.innerHTML='<button class="btn primary" data-sage="begin">'+(active?I18n.t('回到当前专注'):I18n.t('先学 5 分钟'))+I18n.html(' <span aria-hidden="true">↗</span></button><button class="sage-desktop-link" data-sage="desktop">显示到桌面 <span aria-hidden="true">↗</span></button><button class="sage-desktop-link" data-sage="petSettings">桌宠设置 <span aria-hidden="true">⚙</span></button>');
    header.querySelector('p').after(actions);
    var labels=[I18n.t('FOCUS / 今日专注'),I18n.t('PLANS / 完成计划'),I18n.t('RHYTHM / 连续行动')];
    stats.querySelectorAll(':scope>div>span').forEach(function(el,i){el.textContent=labels[i];});
    var foot=document.createElement('div');foot.className='sage-stage-footer';
    foot.innerHTML=I18n.html('<span>少一点催促，多一点陪伴。</span><button data-sage="workspace">继续上次的进度 <span aria-hidden="true">↓</span></button>');
    stage.append(foot);entrance(stage);
  }
  var polish=UI.polishPage;
  UI.polishPage=function(tab){polish(tab);if(tab!==lastTab)closeMenu();lastTab=tab;pendingAnimations.forEach(function(a){a.cancel();});pendingAnimations=[];if(tab==='today')compose();};
  menu=document.createElement('button');menu.id='sageMenu';menu.className='sage-menu';menu.type='button';
  menu.setAttribute('aria-label',I18n.t('打开主导航'));menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-controls','sageNavigation');menu.innerHTML='<span></span><span></span>';
  document.querySelector('.topbar').prepend(menu);
  var nav=document.querySelector('.tabbar');nav.id='sageNavigation';nav.inert=innerWidth<=820;
  menu.onclick=function(){var open=!document.body.classList.contains('sage-menu-open');document.body.classList.toggle('sage-menu-open',open);menu.setAttribute('aria-expanded',String(open));nav.inert=!open&&innerWidth<=820;};
  document.addEventListener('click',function(e){
    var button=e.target.closest('[data-sage]');
    if(button){
      if(button.dataset.sage==='desktop')showDesktop();
      if(button.dataset.sage==='petSettings'&&window.landing&&landing.desktopPet)landing.desktopPet.settings();
      if(button.dataset.sage==='begin'){
        if(Landing.state().timer){var focus=document.querySelector('.ds-focus');if(focus)focus.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});}
        else {var learning=Landing.state().discipline.learning;Discipline.desktopAction('study',learning.selected||'python');}
      }
      if(button.dataset.sage==='workspace'){var study=document.querySelector('.ds-study');if(study)study.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
    }
    if(!e.target.closest('.tabbar,#sageMenu'))closeMenu();
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.body.classList.contains('sage-menu-open')){closeMenu();menu.focus();}});
  window.addEventListener('resize',function(){if(innerWidth>820)closeMenu();nav.inert=innerWidth<=820&&!document.body.classList.contains('sage-menu-open');});
})();
