/* Permanent tools and a small, local travel journal. No study time or currency is created here. */
(function(){
  'use strict';
  var previousAct=Pet.shopAct,previousPage=Pet.renderPage,previousRefresh=Pet.refresh,game=null,restInterval=null;
  var DIM={curiosity:'好奇心',creativity:'创造力',courage:'勇气',wits:'灵性',rapport:'默契',energy:'精力'};
  var ROUTES=[{id:'garden',name:'花园邮路',icon:'✿',tool:null},{id:'forest',name:'林间邮路',icon:'♧',tool:'field_lens'},{id:'stars',name:'星光邮路',icon:'✧',tool:'brass_compass'}];
  var WEATHER=['晴日','微雨','晚霞','薄雾'];
  var STORIES={
    garden:['小路尽头有一间还没开门的邮局。窗台上，三片叶子排成一封信。','风把空白信纸吹到了花坛边。你们决定给这一天留下一句话。','邮差问：想把今天寄给谁？你们把收件人写成了“未来的我们”。'],
    forest:['观察镜里，树叶的纹路连成了一条新路。你们循着光往里走。','木桥中央有一串小小的铃铛。伙伴停下来，等你一起过去。','树屋信箱里躺着一张旧地图。背面写着：走慢一点，也会到达。'],
    stars:['指南针的指针轻轻转动。楼梯尽头是一片安静的星空。','天台上有一架旧望远镜。今晚的月亮刚好装得进镜筒。','你们在最后一页画下星座，把这张明信片寄向下一次相见。']
  };
  function L(){return window.Landing;}
  function t(s){return I18n.t(s);}
  function esc(s){return L().esc(String(s));}
  function state(){var p=Pet.state(),w=p.trailWorkshop=p.trailWorkshop||{};
    if(!Array.isArray(w.postcards))w.postcards=[];
    if(!w.daily||w.daily.date!==L().today())w.daily={date:L().today(),tools:[],journey:false};
    if(!Array.isArray(w.daily.tools))w.daily.tools=[];
    return w;
  }
  function owned(id){return !!(Pet.state().owned[id]>0);}
  function allowed(){return window.PetAdventure&&PetAdventure.playingAllowed();}
  function closeButton(){return '<button class="btn ghost" data-act="closeSheet">'+t('收好工具')+'</button>';}
  function actions(html){return '<div class="sheet-actions">'+html+closeButton()+'</div>';}
  function button(act,text,id){return '<button class="btn primary" data-trail="'+act+'"'+(id==null?'':' data-id="'+esc(id)+'"')+'>'+text+'</button>';}
  function growTool(item){var w=state(),p=Pet.state();if(w.daily.tools.indexOf(item.id)>=0)return false;
    var deltas={};deltas[item.dimension]=item.id==='cloud_thermos'?6:3;if(item.id==='cloud_thermos')deltas.mood=2;
    var grew=PetAdventure.reward('tool:'+w.daily.date+':'+item.id,deltas,t('一起使用了')+' '+item.name,{moodBonus:false});
    if(grew){w.daily.tools.push(item.id);L().save();}return grew;
  }
  function complete(item){if(!game||game.finished||!allowed())return;game.finished=true;
    var grew=growTool(item);L().openSheet('<div class="trail-result">'+art(item.id)+'<span class="market-eyebrow">A LITTLE DISCOVERY</span><h2>'+t('这一小步，做到了')+'</h2><p>'+esc(item.name)+'</p><p class="trail-gain">'+(grew?esc(item.effect):t('这次是自由体验，今天这件工具已成长或灵感不足。'))+'</p><p class="hint">'+t('每件工具每天成长一次，与散步、翻牌、画画共用每日 6 次成长和灵感。')+'</p></div>'+actions(button('tools',t('看看其他工具'))));
    L().render();
  }
  function tool(id){if(!allowed())return;var item=Pet.catalog().find(function(i){return i.id===id&&i.kind==='tool';});if(!item)return;
    if(!owned(id)){L().toast(t('先在商城兑换这件工具吧'));return;}
    stopRest();game={type:'tool',item:item,finished:false};
    var html='<div class="trail-tool-heading">'+art(id)+'<div><span class="market-eyebrow">SMALL RITUAL / '+t('成长工具')+'</span><h2>'+esc(item.name)+'</h2><p class="hint">'+esc(item.effect)+'</p></div></div>';
    if(id==='field_lens'){
      game.answer=random(4);html+='<p>'+t('有一片叶子的叶脉不同，找找看。')+'</p><div class="trail-leaves">'+Array.from({length:4},function(_,i){return '<button data-trail="answer" data-id="'+i+'" aria-label="'+t('叶片')+' '+(i+1)+'"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 3 Q2 12 7 28 Q12 40 20 39 Q34 39 34 23 Q34 12 20 3" fill="#a5b498"/><path d="M20 10v34m0-22-9-7m9 14 10-8m-10 14-8-6'+(i===game.answer?'m8-17 9 5':'m0-5-8-5')+'" fill="none" stroke="#3c5946" stroke-width="2"/></svg></button>';}).join('')+'</div><p id="trailFeedback" aria-live="polite"></p>';
    }else if(id==='sky_atlas'){
      var sequences=[['🌑','🌒','🌓','🌔','🌕'],['🌕','🌖','🌗','🌘','🌑'],['🌘','🌑','🌒','🌓','🌔']],seq=sequences[random(3)];game.answer=seq[2];var options=['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'];html+='<p>'+t('把缺少的月亮放回序列。')+'</p><div class="trail-moons">'+seq.map(function(x,i){return '<span>'+(i===2?'?':x)+'</span>';}).join('')+'</div><div class="trail-answer-grid">'+options.map(function(x){return button('answer',x,x);}).join('')+'</div><p id="trailFeedback" aria-live="polite"></p>';
    }else if(id==='watercolors'){
      game.colors=[];html+='<p>'+t('选两种颜色，调出一枚只属于今天的邮戳。')+'</p><div class="trail-pigments">'+['#ae6981','#e1b76a','#719c99','#768ba8','#99a673','#a18bb8'].map(function(x){return '<button data-trail="pigment" data-id="'+x+'" style="--pigment:'+x+'" aria-label="'+x+'" aria-pressed="false"></button>';}).join('')+'</div><div id="trailSwatch" class="trail-swatch">✿</div><p class="hint" id="trailFeedback" aria-live="polite"></p>'+actions(button('mix',t('保存我的邮戳')));L().openSheet(html);return;
    }else if(id==='brass_compass'){
      // A winding walkable area. Only adjacent cells can be entered.
      game.position=0;game.walked=[0];game.path=[0,1,5,4,8,12,13,14,10,11,15];
      html+='<p>'+t('从脚印出发，点相邻石板走到星星。走错可以退回来。')+'</p><div class="trail-maze" role="group" aria-label="'+t('迷你迷宫')+'">'+Array.from({length:16},function(_,i){return '<button data-trail="step" data-id="'+i+'" '+(game.path.indexOf(i)<0?'disabled':'')+' aria-label="'+(i+1)+'">'+(i===0?'♟':i===15?'✧':'·')+'</button>';}).join('')+'</div><p id="trailFeedback" aria-live="polite"></p>';
    }else if(id==='travel_journal'){
      var preferences=[['雨天的书店','雨天书店'],['有风的海边','海边'],['安静的花园','花园']],p=preferences[random(3)];game.answer=p[1];html+='<p class="trail-story">'+t('伙伴说，今天最想去的地方是：')+'<b>'+t(p[0])+'</b></p><p>'+t('翻到下一页，你会画下哪一种风景？')+'</p><div class="trail-answer-grid">'+preferences.map(function(x){return button('answer',t(x[0]),x[1]);}).join('')+'</div><p id="trailFeedback" aria-live="polite"></p>';
    }else{
      game.until=Date.now()+30000;html+='<p>'+t('把视线从屏幕移开，肩膀放松。没有声音，也没有结束提醒。')+'</p><div class="trail-rest"><span>☁</span><b id="trailRestClock">30</b></div><p class="hint">'+t('这只是应用里的休息片刻，随时可以结束。')+'</p><div id="trailRestDone"></div>';
      restInterval=setInterval(function(){var clock=document.getElementById('trailRestClock');if(!clock||!game||game.item!==item){stopRest();return;}var left=Math.max(0,Math.ceil((game.until-Date.now())/1000));clock.textContent=left;if(!left){stopRest();document.getElementById('trailRestDone').innerHTML=button('restDone',t('休息好了'));}},250);
    }
    L().openSheet(html+actions(''));
  }
  function random(n){var a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]%n;}
  function stopRest(){if(restInterval){clearInterval(restInterval);restInterval=null;}}
  function feedback(text){var el=document.getElementById('trailFeedback');if(el)el.textContent=t(text);}
  function tools(){if(!allowed())return;var items=Pet.catalog().filter(function(i){return i.kind==='tool';});L().openSheet('<h2>'+t('随身工具包')+'</h2><p class="hint">'+t('永久工具可以反复使用；成长有每日上限，不用追赶。')+'</p><div class="trail-tool-list">'+items.map(function(i){return '<article>'+art(i.id)+'<div><b>'+esc(i.name)+'</b><small>'+esc(i.effect)+'</small></div>'+(owned(i.id)?button('tool',t('打开'),i.id):'<span>'+i.cost+' 🐟</span>')+'</article>';}).join('')+'</div>'+actions(button('shop',t('去商城看看'))));}
  function board(){var w=state();return '<section class="card trail-board"><div class="trail-board-copy"><span class="market-eyebrow">LETTERS TO TOMORROW</span><h2>'+t('给明天寄张明信片')+'</h2><p>'+t('三段小旅途，十二种天气记忆。带上工具，把风景和心情装进信封。')+'</p><div class="trail-board-buttons">'+button('travel',w.journey?t('继续这段旅程'):t('开始一封旅行信'))+'<button class="btn ghost" data-trail="album">'+t('明信片册')+' · '+w.postcards.length+'/12</button><button class="btn ghost" data-trail="tools">'+t('随身工具包')+'</button></div><small>'+t('每天第一封完成的旅行信可成长；之后仍可散步和收集。')+'</small></div><div class="trail-envelope" aria-hidden="true"><span>✿</span><i>TO OUR FUTURE</i></div></section>';}
  function travel(routeId){if(!allowed())return;var w=state(),route=ROUTES.find(function(x){return x.id===routeId;});
    if(!w.journey&&!route){L().openSheet('<h2>'+t('今天想把信寄向哪里？')+'</h2><div class="trail-route-list">'+ROUTES.map(function(r){var can=!r.tool||owned(r.tool),item=r.tool&&Pet.catalog().find(function(i){return i.id===r.tool;});return '<button data-trail="route" data-id="'+r.id+'" '+(can?'':'disabled')+'><span>'+r.icon+'</span><b>'+t(r.name)+'</b><small>'+(can?t('整装出发'):t('需要')+' '+esc(item.name))+'</small></button>';}).join('')+'</div>'+actions(''));return;}
    if(!w.journey){if(route.tool&&!owned(route.tool))return;var unseen=[0,1,2,3].filter(function(weather){return !w.postcards.some(function(c){return c.key===route.id+':'+weather;});});w.journey={id:L().uid('letter'),route:route.id,weather:unseen.length?unseen[random(unseen.length)]:random(4),step:0,choices:[],at:Date.now()};L().save();}
    var j=w.journey,r=ROUTES.find(function(x){return x.id===j.route;});if(!r||!Number.isInteger(j.step)||j.step<0||j.step>2){w.journey=null;L().save();return;}
    L().openSheet('<div class="trail-travel-header"><span>'+r.icon+'</span><p>'+t(r.name)+' · '+t(WEATHER[j.weather])+'</p><small>'+(j.step+1)+' / 3</small></div><p class="trail-story">'+t(STORIES[r.id][j.step])+'</p><div class="trail-route-choices">'+['仔细看看眼前的小细节','给这一幕涂上颜色','和伙伴向前迈一步'].map(function(x,i){return '<button data-trail="travelChoice" data-id="'+i+'"><span>'+['⌕','✎','♧'][i]+'</span>'+t(x)+'</button>';}).join('')+'</div><p class="hint">'+t('进度自动保存，随时收起，下次接着走。')+'</p>'+actions(''));
  }
  function travelChoice(id){if(!allowed())return;var w=state(),j=w.journey,n=Number(id);if(!j||![0,1,2].includes(n))return;j.choices.push(n);j.step++;
    if(j.step<3){L().save();travel();return;}
    var key=j.route+':'+j.weather,card=w.postcards.find(function(c){return c.key===key;});
    if(!card){card={key:key,route:j.route,weather:j.weather,at:Date.now(),colors:w.stampColors||['#ae6981','#e1b76a']};w.postcards.push(card);}
    var grew=false;if(!w.daily.journey){var counts=[0,0,0];j.choices.forEach(function(c){counts[c]++;});var largest=Math.max.apply(null,counts),dimension=['curiosity','creativity','courage'][counts.indexOf(largest)],deltas={};deltas[dimension]=3;deltas.rapport=1;
      grew=PetAdventure.reward('letter:'+w.daily.date,deltas,t('给未来的我们寄出了一张明信片。'));if(grew)w.daily.journey=true;}
    w.journey=null;L().save();L().openSheet('<div class="trail-result">'+postcard(card)+'<h2>'+t('这封信，寄给未来的我们')+'</h2><p>'+t('风景已经收进明信片册。')+'</p><p class="trail-gain">'+(grew?t(DIM[dimension])+' +3 · '+t('默契')+' +1':t('轻松旅行 · 未消耗灵感'))+'</p></div>'+actions(button('album',t('翻开明信片册'))));L().render();
  }
  function postcard(c){var r=ROUTES.find(function(x){return x.id===c.route;}),palette=c.colors||['#ae6981','#e1b76a'];return '<div class="trail-postcard" style="--stamp-a:'+palette[0]+';--stamp-b:'+palette[1]+'"><div class="trail-landscape" data-route="'+r.id+'"><span>'+r.icon+'</span><i>'+['☀','☂','◒','☁'][c.weather]+'</i></div><div><small>STUDYTRAIL / POSTCARD</small><h3>'+t(r.name)+'</h3><p>'+t(WEATHER[c.weather])+'</p><span class="trail-stamp">✿</span></div></div>';}
  function album(){if(!allowed())return;var w=state();L().openSheet('<h2>'+t('寄给明天的十二张信')+' · '+w.postcards.length+'/12</h2><p class="hint">'+t('不同邮路与天气各留一张。重复风景不会挤掉旧收藏。')+'</p><div class="trail-postcard-grid">'+ROUTES.map(function(r){return WEATHER.map(function(_,i){var c=w.postcards.find(function(x){return x.key===r.id+':'+i;});return c?postcard(c):'<div class="trail-postcard-empty"><span>'+r.icon+'</span><b>'+t(r.name)+'</b><small>'+t(WEATHER[i])+'</small></div>';}).join('');}).join('')+'</div>'+actions(button('travel',t('再寄一封'))));}
  function dispatch(action,id,target){if(action==='close')return;if(action==='tool')tool(id);else if(action==='tools')tools();else if(action==='shop'){L().closeSheet();L().tab('shop');}else if(action==='travel')travel();else if(action==='route')travel(id);else if(action==='album')album();
    else if(action==='travelChoice')travelChoice(id);else if(!game||game.type!=='tool'||game.finished||!allowed())return;
    else if(action==='answer'){if(String(id)===String(game.answer))complete(game.item);else feedback('再看一眼就好，不扣分。');}
    else if(action==='pigment'){var colors=game.colors,i=colors.indexOf(id);if(i>=0)colors.splice(i,1);else if(colors.length<2)colors.push(id);document.querySelectorAll('[data-trail="pigment"]').forEach(function(b){b.setAttribute('aria-pressed',String(colors.indexOf(b.dataset.id)>=0));});var swatch=document.getElementById('trailSwatch');swatch.style.background=colors.length===2?'linear-gradient(135deg,'+colors[0]+','+colors[1]+')':colors[0]||'';}
    else if(action==='mix'){if(game.colors.length!==2){feedback('先选两种颜色吧');return;}state().stampColors=game.colors.slice();complete(game.item);}
    else if(action==='step'){var n=Number(id),a=game.position;if(game.path.indexOf(n)<0||Math.abs(n%4-a%4)+Math.abs(Math.floor(n/4)-Math.floor(a/4))!==1){feedback('点一块相邻的石板就好');return;}game.position=n;game.walked.push(n);document.querySelectorAll('[data-trail="step"]').forEach(function(b){var p=Number(b.dataset.id);b.textContent=p===n?'♟':p===15?'✧':game.walked.includes(p)?'•':'·';b.classList.toggle('visited',game.walked.includes(p));});if(n===15)complete(game.item);}
    else if(action==='restDone'&&Date.now()>=game.until)complete(game.item);
  }
  document.addEventListener('click',function(e){var b=e.target.closest('[data-trail]');if(b){e.preventDefault();dispatch(b.dataset.trail,b.dataset.id,b);}});
  Pet.shopAct=function(action,id){var item=Pet.catalog().find(function(i){return i.id===id;});if(item&&item.kind==='tool'&&(action==='use'||action==='preview')){if(action==='preview'&&!owned(id)){L().openSheet('<div class="trail-result">'+art(id)+'<h2>'+esc(item.name)+'</h2><p>'+esc(item.desc)+'</p><p>'+esc(item.effect)+'</p><p class="hint">'+t('兑换后永久拥有。使用并完成互动才成长，每天一次。')+'</p></div>'+actions(''));return;}tool(id);return;}return previousAct(action,id);};
  Pet.renderPage=function(){previousPage();var root=document.getElementById('petPage');if(root&&!root.querySelector('.trail-board'))root.insertAdjacentHTML('afterbegin',board());};
  Pet.refresh=function(){previousRefresh();if(!window.Landing)return;var banner=document.querySelector('.market-banner>div');if(banner&&!banner.querySelector('[data-trail]'))banner.insertAdjacentHTML('beforeend','<button class="btn ghost sm" data-trail="travel">'+t('寄张旅行明信片')+' ↗</button>');};
  /* Small authored pixel illustrations share outlines, materials and a 32px grid. */
  function art(id,kind){var colors={o:'#4b5443',d:'#8c7658',g:'#c1a369',h:'#f3dfaa',p:'#b27183',l:'#e7b0b7',s:'#8fac9d',v:'#668978',b:'#7794a4',w:'#f9f3db'};var rects=[];
    function rect(x,y,w,h,c){rects.push('<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+(colors[c]||c)+'"/>');}
    if(id==='field_lens'||id==='brass_compass'){rect(8,5,16,2,'o');rect(6,7,20,2,'o');rect(5,9,22,13,'o');rect(7,9,18,13,'g');rect(9,8,14,16,'h');rect(10,10,12,12,id==='field_lens'?'b':'w');rect(12,11,3,3,'w');if(id==='field_lens'){rect(21,22,4,3,'o');rect(23,24,4,5,'d');}else{rect(15,11,2,10,'o');rect(12,15,8,2,'o');rect(16,11,2,5,'p');}}
    else if(id==='watercolors'||id==='sketchbook'){rect(4,7,24,20,'o');rect(5,8,22,18,'d');rect(7,10,18,14,'w');if(id==='watercolors'){['p','g','s','b','v','l'].forEach(function(c,i){rect(8+i%3*6,11+Math.floor(i/3)*6,4,4,c);});rect(2,24,27,2,'g');}else{rect(9,13,14,2,'s');rect(9,18,10,2,'s');rect(18,3,2,21,'g');rect(20,4,2,19,'h');}}
    else if(id==='sky_atlas'||id==='travel_journal'){rect(6,5,20,23,'o');rect(7,6,18,20,id==='sky_atlas'?'b':'p');rect(9,6,2,20,'d');rect(8,26,17,2,'w');if(id==='sky_atlas'){rect(16,10,6,8,'h');rect(19,9,4,7,'b');rect(13,20,2,2,'h');}else{rect(15,11,7,2,'h');rect(14,13,9,5,'h');rect(16,18,5,2,'h');rect(18,20,1,1,'h');}}
    else if(id==='cloud_thermos'||id==='matcha'){rect(10,6,13,3,'o');rect(9,9,15,17,'o');rect(11,10,11,14,'s');rect(12,11,3,11,'w');rect(24,12,4,10,'o');rect(24,14,2,6,'h');rect(11,25,11,2,'d');rect(14,14,7,5,'w');rect(16,12,3,8,'w');}
    else if(id==='ribbon'){rect(4,9,8,2,'o');rect(20,9,8,2,'o');rect(3,11,11,11,'o');rect(18,11,11,11,'o');rect(5,11,7,8,'p');rect(20,11,7,8,'p');rect(6,12,4,3,'l');rect(22,12,4,3,'l');rect(13,13,6,7,'o');rect(14,14,4,5,'p');rect(9,20,5,8,'p');rect(19,20,5,7,'p');rect(9,20,2,5,'l');}
    else if(id==='starclip'||id==='crown'){if(id==='crown'){rect(5,11,22,14,'o');rect(7,6,3,18,'g');rect(15,3,3,21,'g');rect(23,6,3,18,'g');rect(8,15,16,8,'h');rect(15,19,3,3,'p');}else{rect(14,3,4,24,'g');rect(4,13,24,4,'g');rect(8,9,16,12,'g');rect(11,7,10,18,'g');rect(13,11,5,8,'h');}}
    else if(kind==='gear'||['beret','headphones','scarf','glasses'].includes(id)){if(id==='headphones'){rect(7,6,18,3,'o');rect(5,9,4,13,'o');rect(23,9,4,13,'o');rect(3,17,7,10,'h');rect(22,17,7,10,'h');rect(4,18,2,8,'d');rect(26,18,2,8,'d');}else if(id==='glasses'){rect(3,12,12,10,'o');rect(18,12,12,10,'o');rect(15,14,3,2,'o');rect(5,14,8,2,'b');rect(20,14,8,2,'b');}else if(id==='scarf'){rect(6,9,21,7,'p');rect(19,14,7,12,'p');rect(7,10,19,2,'l');rect(20,24,1,4,'d');rect(23,24,1,4,'d');}else{rect(5,14,23,5,'o');rect(7,8,19,8,'d');rect(11,5,13,5,'d');rect(18,3,3,3,'o');rect(11,9,10,2,'h');}}
    else if(kind==='scene'||['dawn','rain','night','library'].includes(id)){rect(3,4,26,25,'d');rect(5,6,22,19,id==='night'?'#475b70':id==='rain'?'b':'s');rect(15,6,2,19,'w');rect(5,14,22,2,'w');rect(3,26,26,3,'g');rect(20,8,4,4,'h');rect(7,20,5,5,'v');rect(8,17,3,3,'s');}
    else if(kind==='toy'||['musicbox','camera','laser','toy_wand'].includes(id)){if(id==='camera'){rect(5,11,23,16,'o');rect(6,12,21,13,'h');rect(9,7,9,4,'d');rect(12,14,10,10,'o');rect(14,16,6,6,'b');rect(24,13,2,2,'p');}else{rect(7,15,20,12,'d');rect(8,16,18,9,'h');rect(10,8,14,7,'p');rect(9,6,16,3,'o');rect(16,10,2,8,'g');rect(14,18,7,2,'d');}}
    else {rect(5,24,24,3,'s');rect(8,11,18,13,id==='fish_snack'?'b':id==='berry'?'p':'g');rect(11,8,12,3,'h');rect(10,13,3,2,'d');rect(18,18,3,3,'d');rect(22,12,2,2,'w');if(id==='fish_snack'){rect(3,12,5,9,'b');rect(23,14,2,2,'o');}if(id==='berry'){rect(14,6,6,6,'v');rect(18,13,2,2,'w');rect(12,18,2,2,'w');}}
    return '<svg class="trail-item-art" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">'+rects.join('')+'</svg>';
  }
  window.TrailShop={state:state,art:art,openTool:tool,travel:travel};
})();
