(function(){
  'use strict';
  const $=id=>document.getElementById(id);let current={},preview,rangeTimer;
  const titles={appearance:I18n.t('外观与位置'),interaction:I18n.t('互动方式'),startup:I18n.t('启动与关闭'),guide:I18n.t('怎么相处')};
  function notice(message,error){$('notice').textContent=message;$('notice').dataset.kind=error?'error':'info';}
  function fail(e){notice(e.message||I18n.t('这次没有保存成功，请重试。'),true);petSettings.status().then(render);}
  function render(state){if(!state)return;current=state.settings||{};document.querySelectorAll('[data-pref]').forEach(el=>el.checked=!!current[el.dataset.pref]);
    for(const key of ['scale','opacity']){const percent=Math.round((current[key]||1)*100);if(document.activeElement!==$(key)){$(key).value=percent;$(key+'Value').textContent=percent+'%';}}
    $('desktopState').textContent=!state.enabled?I18n.t('桌宠已隐藏 · 着陆仍在运行'):current.clickThrough?I18n.t('鼠标穿透中 · F7 恢复互动'):current.panelOpen?I18n.t('对话已展开 · 关闭对话会保留角色'):I18n.t('伙伴在桌面 · 单击聊天，右键更多');
    if(state.error)notice(state.error,true);
  }
  function save(patch){return petSettings.configure(patch).then(s=>{render(s);notice(s.settings.clickThrough?I18n.t('已开启鼠标穿透。按 F7，或用托盘菜单恢复互动。'):I18n.t('已保存，桌宠已经同步。'));}).catch(fail);}
  document.querySelectorAll('[data-section]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-section]').forEach(b=>{if(b===button)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});document.querySelectorAll('.settings-panel').forEach(panel=>panel.hidden=panel.id!==button.dataset.section);$('sectionTitle').textContent=titles[button.dataset.section];});
  document.querySelectorAll('[data-pref]').forEach(el=>el.onchange=()=>save({[el.dataset.pref]:el.checked}));
  document.querySelectorAll('[data-range]').forEach(el=>{const key=el.dataset.range;function apply(){clearTimeout(rangeTimer);save({[key]:Number(el.value)/100});}el.oninput=()=>{$(key+'Value').textContent=el.value+'%';clearTimeout(rangeTimer);rangeTimer=setTimeout(apply,80);};el.onchange=apply;});
  $('findPet').onclick=()=>petSettings.reposition().then(s=>{render(s);notice(I18n.t('已回到主屏幕右下，并恢复互动。'));}).catch(fail);
  $('changeSkin').onclick=()=>petSkins.open().catch(fail);
  $('resetAppearance').onclick=()=>save({scale:1,opacity:1,alwaysOnTop:true,showTaskbar:false});
  $('autoStart').onchange=async()=>{const el=$('autoStart'),wanted=el.checked;el.disabled=true;try{el.checked=await petSettings.setStartup(wanted);notice(el.checked?I18n.t('已开启开机启动。'):I18n.t('已关闭开机启动。'));}catch(e){el.checked=!wanted;notice(e.message||I18n.t('开机启动没有生效，请重试。'),true);}finally{el.disabled=false;}};
  $('closeAction').onchange=()=>petSettings.setCloseBehavior($('closeAction').value).then(value=>{if(!value)throw Error(I18n.t('关闭方式未保存'));notice(value==='quit'?I18n.t('已设为退出整个着陆，桌宠也会退出。'):I18n.t('已保存关闭主窗口时的行为。'));}).catch(e=>{fail(e);petSettings.closeBehavior().then(value=>{$('closeAction').value=value||'tray';}).catch(()=>{});});
  $('closeSettings').onclick=()=>petSettings.close();document.addEventListener('keydown',e=>{if(e.key==='Escape')petSettings.close();});
  petSettings.onChange(render);petSettings.status().then(render).catch(fail);
  petSettings.startup().then(on=>{$('autoStart').checked=!!on;$('autoStart').disabled=false;}).catch(e=>notice(I18n.t('开机启动状态读取失败：')+e.message,true));
  petSettings.closeBehavior().then(value=>{$('closeAction').value=value||'tray';$('closeAction').disabled=false;}).catch(fail);
  preview=PetdexSprite.mount($('settingsPreview'),{});preview.setState({gentle:true});
  window.addEventListener('beforeunload',()=>{clearTimeout(rangeTimer);if(preview)preview.dispose();});
})();
