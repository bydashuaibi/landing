(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);},state={},preferences={},lastMotion=0,lastReply=0,drag=null,hit=true;
  function message(text,who){var el=document.createElement('p');el.className='message '+who;el.textContent=text;$('messages').appendChild(el);while($('messages').children.length>16)$('messages').firstElementChild.remove();$('messages').scrollTop=$('messages').scrollHeight;}
  var sprite=PetdexSprite.mount($('sprite'),{});
  function send(action,extra){petdesk.command(Object.assign({action:action},extra||{})).then(function(r){if(!r.ok)message('着陆正在启动，请稍后再试一下。','assistant');}).catch(function(){message('这次没有连接到着陆，请稍后再试。','assistant');});}
  function update(s){if(!s)return;var oldTrack=state.track;state=s;$('line').textContent=s.mode==='focus'?'正在陪你学 '+s.course:s.mode==='paused'?'陪你歇一会，准备好再继续':s.mode==='done'?'这一段做到了，记下进度吧':'告诉我想去哪一页，或者从哪一步开始。';if(s.replyId&&s.replyId!==lastReply){lastReply=s.replyId;message(s.reply,'assistant');}if(document.activeElement!==$('track')&&(oldTrack!==s.track||s.mode==='focus'||s.mode==='paused'))$('track').value=s.track||'python';$('clock').textContent=s.clock||'准备开始';$('start').textContent=s.mode==='focus'?'暂停一下':s.mode==='paused'?'继续学习':s.mode==='done'?'确认记录':'开始 5 分钟';sprite.setGear(s.gear);sprite.setState({sleeping:s.sleeping,focus:s.mode==='focus'||s.studyMode,gentle:s.gentle});if(s.motionId&&s.motionId!==lastMotion){lastMotion=s.motionId;if(s.motion)sprite.play(s.motion,2);} }
  function applyPreferences(s){if(!s)return;preferences=s.settings||{};document.documentElement.style.setProperty('--pet-scale',preferences.scale||1);document.documentElement.style.setProperty('--pet-opacity',preferences.opacity||1);document.body.dataset.hoverFade=String(!!preferences.hoverFade);document.body.dataset.lockDrag=String(!!preferences.lockDrag);document.body.dataset.clickThrough=String(!!preferences.clickThrough);$('controls').hidden=!preferences.panelOpen;$('hint').hidden=preferences.showHints===false;if(preferences.clickThrough)drag=null;}
  function setPanel(open){$('controls').hidden=!open;petdesk.panel(open);}
  petdesk.onPreferences(applyPreferences);petdesk.status().then(applyPreferences);
  petdesk.onState(function(s){update(s);if(s){$('petName').textContent=(s.name||'初华')+' · 你的桌面伙伴';$('quickStatus').textContent=s.clock?(s.course+' · '+s.clock):(s.name||'初华')+' · 在这里陪你';}});petdesk.ready().then(update);
  $('start').onclick=function(){send(state.mode==='focus'?'pause':state.mode==='paused'?'resume':state.mode==='done'?'settle':'study',{track:$('track').value});};
  $('skins').onclick=function(){send('skins');};$('playground').onclick=function(){send('playground');};
  ['capture','open','settle'].forEach(function(a){$(a).onclick=function(){send(a,{track:$('track').value});};});
  $('closeDialog').onclick=function(){setPanel(false);};
  $('collapse').onclick=function(){setPanel(false);};
  $('settings').onclick=function(){petdesk.settings();};$('petMenu').onclick=function(){petdesk.menu();};
  $('command').onsubmit=function(e){e.preventDefault();var text=$('text').value.trim();if(text){message(text,'user');send('text',{text:text,track:$('track').value});$('text').value='';}};
  $('pages').onclick=function(e){var b=e.target.closest('[data-page]');if(b){message('打开'+b.textContent,'user');send('navigate',{page:b.dataset.page});}};
  $('help').onclick=function(){send('help');};
  $('track').onchange=function(){message('选择 '+$('track').selectedOptions[0].textContent,'user');send('select',{track:$('track').value});};
  document.addEventListener('mousemove',function(e){var on=!!drag||!!e.target.closest('#controls,#avatar,#quickbar');if(on!==hit){hit=on;petdesk.hit(on);}});
  document.addEventListener('contextmenu',function(e){e.preventDefault();petdesk.menu();});
  $('avatar').onpointerdown=function(e){if(e.button!==0||preferences.clickThrough)return;drag={x:e.screenX,y:e.screenY,ox:e.screenX,oy:e.screenY,moved:false};$('avatar').setPointerCapture(e.pointerId);petdesk.hit(true);};
  $('avatar').onpointermove=function(e){if(!drag||preferences.lockDrag)return;var dx=e.screenX-drag.x,dy=e.screenY-drag.y;if(!drag.moved&&Math.abs(e.screenX-drag.ox)+Math.abs(e.screenY-drag.oy)<6)return;drag.moved=true;drag.x=e.screenX;drag.y=e.screenY;petdesk.move({x:dx,y:dy});};
  function release(){if(!drag)return;var moved=drag.moved;drag=null;if(!moved){setPanel($('controls').hidden);sprite.play('wave',1.6);send('pat');}}
  $('avatar').onpointerup=release;$('avatar').onpointercancel=function(){drag=null;};
  $('avatar').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();setPanel($('controls').hidden);send('wave');}};
})();
