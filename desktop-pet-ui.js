(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);},state={},lastMotion=0,drag=null,hit=false;
  var sprite=PetdexSprite.mount($('sprite'),{});
  function send(action,extra){petdesk.command(Object.assign({action:action},extra||{})).then(function(r){if(!r.ok)$('line').textContent='着陆正在启动，请稍后再试一下。';});}
  function update(s){if(!s)return;var oldTrack=state.track;state=s;$('line').textContent=s.line||'只做五分钟，我陪你。';if(document.activeElement!==$('track')&&(oldTrack!==s.track||s.mode==='focus'||s.mode==='paused'))$('track').value=s.track||'python';$('clock').textContent=s.clock||'准备开始';$('start').textContent=s.mode==='focus'?'暂停一下':s.mode==='paused'?'继续学习':s.mode==='done'?'确认记录':'开始 5 分钟';sprite.setState({sleeping:s.sleeping,focus:s.mode==='focus',gentle:s.gentle});if(s.motionId&&s.motionId!==lastMotion){lastMotion=s.motionId;if(s.motion)sprite.play(s.motion,2);} }
  petdesk.onState(update);petdesk.ready().then(update);
  $('start').onclick=function(){send(state.mode==='focus'?'pause':state.mode==='paused'?'resume':state.mode==='done'?'settle':'study',{track:$('track').value});};
  ['capture','open','settle'].forEach(function(a){$(a).onclick=function(){send(a,{track:$('track').value});};});
  $('hide').onclick=function(){petdesk.hide();};
  $('command').onsubmit=function(e){e.preventDefault();var text=$('text').value.trim();if(text){send('text',{text:text,track:$('track').value});$('text').value='';}};
  document.addEventListener('mousemove',function(e){var on=!!drag||!!e.target.closest('#controls,#avatar');if(on!==hit){hit=on;petdesk.hit(on);}});
  document.addEventListener('contextmenu',function(e){e.preventDefault();petdesk.menu();});
  $('avatar').onpointerdown=function(e){if(e.button!==0)return;drag={x:e.screenX,y:e.screenY,ox:e.screenX,oy:e.screenY,moved:false};$('avatar').setPointerCapture(e.pointerId);petdesk.hit(true);};
  $('avatar').onpointermove=function(e){if(!drag)return;var dx=e.screenX-drag.x,dy=e.screenY-drag.y;if(!drag.moved&&Math.abs(e.screenX-drag.ox)+Math.abs(e.screenY-drag.oy)<6)return;drag.moved=true;drag.x=e.screenX;drag.y=e.screenY;petdesk.move({x:dx,y:dy});};
  function release(){if(!drag)return;var moved=drag.moved;drag=null;if(!moved){$('controls').hidden=!$('controls').hidden;sprite.play('wave',1.6);send('pat');}}
  $('avatar').onpointerup=release;$('avatar').onpointercancel=function(){drag=null;};
  $('avatar').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();$('controls').hidden=!$('controls').hidden;send('wave');}};
})();
