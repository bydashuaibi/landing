/* Shared, local companion progress. Playing never creates study minutes or fish. */
(function(){
  'use strict';
  var basePage=Pet.renderPage,baseRefresh=Pet.refresh,round=null,draw=null;
  var DIMS=[{key:'curiosity',name:I18n.t('好奇心'),icon:'🔎',hint:I18n.t('散步观察、翻牌和真实专注积累；20 解锁林间小径')},
    {key:'creativity',name:I18n.t('创造力'),icon:'🎨',hint:I18n.t('画下不重复的小作品；20 解锁薄荷与薰衣草画笔')},
    {key:'courage',name:I18n.t('勇气'),icon:'🧭',hint:I18n.t('尝试新路线与完成翻牌；20 解锁六对翻牌，35 解锁星光天台')}];
  var PATHS=[{id:'garden',icon:'🌼',name:I18n.t('花园小路'),need:0,key:'curiosity',line:I18n.t('花丛里传来轻轻的沙沙声。你们决定……')},
    {id:'forest',icon:'🌿',name:I18n.t('林间小径'),need:20,key:'curiosity',line:I18n.t('树梢漏下细细的光，路边像藏着什么。你们决定……')},
    {id:'roof',icon:'🌙',name:I18n.t('星光天台'),need:35,key:'courage',line:I18n.t('晚风吹动衣角，远处有一颗亮星。你们决定……')}];
  var FINDS=[{id:'petal',path:'garden',icon:'🌸',name:I18n.t('压平的小花'),text:I18n.t('你们蹲下来，发现花瓣边缘像一颗心。')},
    {id:'stone',path:'garden',icon:'🪨',name:I18n.t('口袋里的圆石'),text:I18n.t('掌心大小的一颗石头，摸起来温温的。')},
    {id:'seed',path:'garden',icon:'🌱',name:I18n.t('蒲公英种子'),text:I18n.t('没有许很大的愿望，只希望明天也轻松一点。')},
    {id:'leaf',path:'forest',icon:'🍃',name:I18n.t('叶脉书签'),text:I18n.t('对着阳光，叶脉像一幅细小的地图。')},
    {id:'feather',path:'forest',icon:'🪶',name:I18n.t('灰蓝羽毛'),text:I18n.t('一阵风过去，留下了一片轻轻的羽毛。')},
    {id:'acorn',path:'forest',icon:'🌰',name:I18n.t('松鼠的橡果'),text:I18n.t('你们把橡果留在树下，只带走了这张小画。')},
    {id:'star',path:'roof',icon:'⭐',name:I18n.t('星光明信片'),text:I18n.t('今晚的星星不多，但刚好够画一张明信片。')},
    {id:'kite',path:'roof',icon:'🪁',name:I18n.t('风筝的线头'),text:I18n.t('大胆往前一步，栏杆旁的彩线原来是一只旧风筝。')},
    {id:'moon',path:'roof',icon:'🌙',name:I18n.t('月牙剪影'),text:I18n.t('把月亮画进掌心，夜色也变得柔软了。')}];
  var COLORS=['#f3ecd2','#304d43','#c77c89','#e9bb6b','#7292b7','#9ca773','#9cdac6','#bda1d6'];
  function L(){return window.Landing;}
  function esc(v){return L().esc(String(v));}
  function day(){return L().today();}
  function state(){var p=Pet.state();DIMS.forEach(function(d){if(!Number.isFinite(p[d.key]))p[d.key]=10;p[d.key]=Math.max(0,Math.min(100,p[d.key]));});
    var g=p.adventure=p.adventure||{inspiration:3,collection:[],art:[],log:[],rounds:[],focusSeen:[],focusMinutes:0};
    ['collection','art','log','rounds','focusSeen','artSeen'].forEach(function(k){if(!Array.isArray(g[k]))g[k]=[];});
    if(!Number.isFinite(g.inspiration))g.inspiration=3;g.inspiration=Math.max(0,Math.min(9,g.inspiration));
    if(!g.daily||g.daily.date!==day()){g.daily={date:day(),plays:0,studyGifts:0};g.inspiration=Math.max(3,g.inspiration);}
    return g;
  }
  function playingAllowed(){var t=L().state().timer;if(t&&t.discipline&&!t.paused&&!t.finished){L().toast(I18n.t('先暂停专注，再和伙伴歇一会儿吧'));return false;}return true;}
  function shuffle(a){var out=a.slice(),rng=new Uint32Array(1);for(var i=out.length-1;i>0;i--){crypto.getRandomValues(rng);var n=rng[0]%(i+1),x=out[i];out[i]=out[n];out[n]=x;}return out;}
  function log(text){var g=state();g.log.unshift({at:Date.now(),text:text});g.log=g.log.slice(0,20);}
  function reward(id,deltas,text,options){var g=state(),p=Pet.state();if(g.rounds.indexOf(id)>=0)return false;
    var grow=g.daily.plays<6&&g.inspiration>=1;
    if(grow){g.rounds.push(id);g.rounds=g.rounds.slice(-120);g.inspiration--;g.daily.plays++;Object.keys(deltas).forEach(function(k){p[k]=Math.min(100,(p[k]||0)+deltas[k]);});if(!options||options.moodBonus!==false)p.mood=Math.min(100,p.mood+3);log(text);}
    L().save();if(grow){Pet.gesture('celebrate',2);Pet.say(text,4200);}else L().toast(I18n.t('这次是轻松练习。成长机会用完了，休息和游玩都随你。'));
    return grow;
  }
  function growthNote(){var g=state();return g.daily.plays>=6?I18n.t('今天的 6 次成长已完成，接下来可以轻松练习。'):g.inspiration<1?I18n.t('灵感暂时用完了，可以自由练习。新的一天至少补到 3 点。'):I18n.t('本次成长用 1 点灵感 · 还有 ')+g.inspiration+I18n.t(' 点 · 今日成长 ')+g.daily.plays+'/6';}
  function save(){L().save();}
  function metrics(){var p=Pet.state();return '<div class="adventure-dims">'+DIMS.map(function(d){return '<div class="adventure-dim"><div><b>'+d.icon+' '+d.name+'</b><span>'+Math.floor(p[d.key])+' / 100</span></div><progress max="100" value="'+p[d.key]+'" aria-label="'+d.name+'"></progress><small>'+d.hint+'</small></div>';}).join('')+'</div>';}
  function card(){var g=state();return I18n.html('<section class="card adventure-card"><div class="adventure-heading"><div><span class="adventure-eyebrow">SMALL ADVENTURES / 一起长大的日常</span><h2>今天，一起做点什么？</h2></div><div class="adventure-window-actions"><button class="btn ghost sm" data-sage="petSettings">桌宠设置 ⚙</button><button class="btn ghost sm" data-sage="desktop">显示到桌面 ↗</button><button class="btn ghost sm" data-adventure="skins">更换皮肤 · Petdex ↗</button></div></div>')+metrics()+I18n.html('<div class="adventure-resource"><span>✦ 灵感 <b>')+g.inspiration+I18n.html('/9</b></span><span>今日成长 ')+g.daily.plays+I18n.html('/6</span><button class="btn ghost sm" data-adventure="rules">成长规则</button></div><div class="adventure-options"><button data-adventure="explore"><span>🌿</span><b>口袋散步</b><small>选路线、做选择、收集小发现</small></button><button data-adventure="memory"><span>🃏</span><b>默契翻牌</b><small>翻开相同图案，试试记忆力</small></button><button data-adventure="draw"><span>🎨</span><b>像素手账</b><small>画一张小画，留进作品册</small></button></div><div class="adventure-footer"><button class="btn ghost sm" data-adventure="album">收集册 · ')+g.collection.length+I18n.html('/9</button><span>作品 ')+g.art.length+I18n.t('/12 · 保存了 ')+g.log.length+I18n.html(' 条成长足迹</span></div></section>');}
  function open(){if(!playingAllowed())return;L().openSheet(I18n.html('<h2>和伙伴玩一会</h2><p class="hint">')+growthNote()+'</p>'+metrics()+I18n.html('<div class="adventure-options"><button data-adventure="explore"><span>🌿</span><b>口袋散步</b></button><button data-adventure="memory"><span>🃏</span><b>默契翻牌</b></button><button data-adventure="draw"><span>🎨</span><b>像素手账</b></button></div><div class="sheet-actions"><button class="btn ghost" data-adventure="album">收集册与作品</button><button class="btn primary" data-act="closeSheet">回去歇一会</button></div>'));}
  function explore(pathId){if(!playingAllowed())return;state();var p=Pet.state(),path=PATHS.find(function(x){return x.id===pathId;});
    if(!path){L().openSheet(I18n.html('<h2>口袋散步</h2><p class="hint">')+growthNote()+I18n.html('。每条路线藏着 3 个小发现。</p><div class="adventure-paths">')+PATHS.map(function(x){var can=p[x.key]>=x.need;return '<button class="adventure-path" data-adventure="path" data-id="'+x.id+'" '+(can?'':'disabled')+'><span>'+x.icon+'</span><b>'+x.name+'</b><small>'+(can?I18n.t('出发 ↗'):(x.key==='curiosity'?I18n.t('好奇心'):I18n.t('勇气'))+' '+x.need+I18n.t(' 解锁'))+'</small></button>';}).join('')+I18n.html('</div><div class="sheet-actions"><button class="btn ghost" data-adventure="open">返回</button></div>'));return;}
    if(p[path.key]<path.need)return;
    round={id:L().uid('walk'),type:'walk',path:path.id};
    L().openSheet('<h2>'+path.icon+' '+path.name+'</h2><p class="adventure-story">'+path.line+I18n.html('</p><div class="adventure-choices"><button data-adventure="choice" data-id="observe">🔎 蹲下来仔细观察 <small>好奇心 +2 · 创造力 +1</small></button><button data-adventure="choice" data-id="try">🧭 和伙伴往前走走 <small>勇气 +2 · 好奇心 +1</small></button><button data-adventure="choice" data-id="record">✎ 把眼前的景色画下来 <small>创造力 +2 · 勇气 +1</small></button></div><p class="hint">')+growthNote()+I18n.html('</p><div class="sheet-actions"><button class="btn ghost" data-adventure="explore">换条路</button></div>'));
  }
  function choice(which){if(!round||round.type!=='walk'||!playingAllowed())return;var deltas={observe:{curiosity:2,creativity:1},try:{courage:2,curiosity:1},record:{creativity:2,courage:1}}[which];if(!deltas)return;
    var r=round;round=null;var g=state(),found=shuffle(FINDS.filter(function(f){return f.path===r.path&&g.collection.indexOf(f.id)<0;}))[0],path=PATHS.find(function(p){return p.id===r.path;});
    var text=found?found.text:I18n.t('熟悉的路也有新心情。今天的风，你们又一起感受了一次。'),grew=reward(r.id,deltas,text);
    if(found&&grew){g.collection.push(found.id);save();}var gains=Object.keys(deltas).map(function(k){return DIMS.find(function(d){return d.key===k;}).name+' +'+deltas[k];}).join(' · ');
    L().openSheet('<div class="adventure-result"><span>'+(found?found.icon:path.icon)+'</span><h2>'+(found?found.name:I18n.t('又走了一段熟悉的路'))+'</h2><p>'+text+'</p><small>'+(grew?gains+(found?I18n.t(' · 已放进收集册'):''):I18n.t('轻松练习 · 没有消耗灵感'))+I18n.html('</small></div><div class="sheet-actions"><button class="btn ghost" data-adventure="album">看看收集册</button><button class="btn primary" data-adventure="explore">再走走</button><button class="btn ghost" data-act="closeSheet">回去</button></div>'));L().render();
  }
  function memory(){if(!playingAllowed())return;state();var pairs=Pet.state().courage>=20?6:4,icons=['🌿','⭐','🌸','🌙','🍓','🪶'].slice(0,pairs);
    round={id:L().uid('cards'),type:'memory',cards:shuffle(icons.concat(icons)),matched:[],open:[],moves:0,hideAt:0};renderMemory();}
  function renderMemory(){if(!round||round.type!=='memory')return;var r=round;L().openSheet(I18n.html('<h2>默契翻牌 · ')+r.cards.length/2+I18n.html(' 对</h2><p class="hint">找到相同图案。翻错可以再试，不扣分。完成：勇气 +2、好奇心 +1。</p><div class="memory-status" id="memoryStatus"></div><div class="memory-grid" id="memoryGrid"></div><p class="hint">')+growthNote()+I18n.html('</p><div class="sheet-actions"><button class="btn ghost" data-adventure="memory">重新洗牌</button><button class="btn ghost" data-adventure="open">返回</button></div>'));paintMemory();}
  function paintMemory(){if(!round||round.type!=='memory'||!document.getElementById('memoryGrid'))return;var r=round;
    if(r.hideAt&&Date.now()>=r.hideAt){r.open=[];r.hideAt=0;}
    document.getElementById('memoryStatus').textContent=I18n.t('已配对 ')+r.matched.length/2+'/'+r.cards.length/2+I18n.t(' · 翻牌 ')+r.moves+I18n.t(' 次');
    document.getElementById('memoryGrid').innerHTML=r.cards.map(function(c,i){var visible=r.matched.indexOf(i)>=0||r.open.indexOf(i)>=0;return '<button class="memory-tile '+(visible?'revealed':'')+'" data-adventure="flip" data-id="'+i+I18n.html('" aria-label="第 ')+(i+1)+I18n.t(' 张')+(visible?' '+c:I18n.t('，未翻开'))+'" '+(r.matched.indexOf(i)>=0?'disabled':'')+'>'+(visible?c:'✦')+'</button>';}).join('');
  }
  function flip(id){if(!round||round.type!=='memory'||!playingAllowed())return;var r=round,n=Number(id);if(!Number.isInteger(n)||n<0||n>=r.cards.length||r.matched.indexOf(n)>=0||r.open.indexOf(n)>=0)return;
    if(r.hideAt&&Date.now()<r.hideAt)return;if(r.hideAt){r.open=[];r.hideAt=0;}r.open.push(n);
    if(r.open.length===2){r.moves++;if(r.cards[r.open[0]]===r.cards[r.open[1]]){r.matched=r.matched.concat(r.open);r.open=[];}else{r.hideAt=Date.now()+750;setTimeout(function(){if(round===r)paintMemory();},780);}}
    paintMemory();if(r.matched.length===r.cards.length){round=null;var grew=reward(r.id,{courage:2,curiosity:1},I18n.t('一起找到了 ')+r.cards.length/2+I18n.t(' 对图案，做得很好。'));L().openSheet(I18n.html('<div class="adventure-result"><span>🙌</span><h2>全部找到啦</h2><p>用了 ')+r.moves+I18n.html(' 次翻牌。慢一点也没关系，我们记住了彼此的节奏。</p><small>')+(grew?I18n.t('勇气 +2 · 好奇心 +1'):I18n.t('这次是自由练习'))+I18n.html('</small></div><div class="sheet-actions"><button class="btn primary" data-adventure="memory">再来一局</button><button class="btn ghost" data-act="closeSheet">收工</button></div>'));L().render();}
  }
  function drawing(){if(!playingAllowed())return;state();draw={pixels:new Array(192).fill(0),color:1,dragging:false};renderDrawing();}
  function renderDrawing(){var count=Pet.state().creativity>=20?8:6;L().openSheet(I18n.html('<h2>像素手账</h2><p class="hint">拖动画格子，也可用键盘逐格上色。保存新的作品：创造力 +3、好奇心 +1。空白或重复作品不消耗灵感。</p><div class="pixel-palette" role="group" aria-label="画笔颜色">')+COLORS.slice(0,count).map(function(c,i){return '<button data-adventure="color" data-id="'+i+'" style="--paint:'+c+'" aria-label="'+[I18n.t('奶油白（橡皮）'),I18n.t('森林绿'),I18n.t('莓果粉'),I18n.t('暖金'),I18n.t('天空蓝'),I18n.t('橄榄绿'),I18n.t('薄荷绿'),I18n.t('薰衣草紫')][i]+'" aria-pressed="'+(draw.color===i)+'"></button>';}).join('')+'</div><div class="pixel-paper" id="pixelPaper" role="group" aria-label="16 列 12 行像素画布">'+draw.pixels.map(function(c,i){return '<button data-pixel="'+i+'" style="background:'+COLORS[c]+I18n.html('" aria-label="第 ')+(i+1)+I18n.html(' 格"></button>');}).join('')+I18n.html('</div><div class="field"><label for="artName">给作品起个名字</label><input id="artName" maxlength="24" placeholder="今天的小心情"></div><p class="hint">')+growthNote()+I18n.html('</p><div class="sheet-actions"><button class="btn ghost" data-adventure="clearDraw">清空画布</button><button class="btn primary" data-adventure="saveDraw">保存到作品册</button><button class="btn ghost" data-adventure="open">返回</button></div>'));}
  function color(id){if(!draw)return;var n=Number(id),count=Pet.state().creativity>=20?8:6;if(!Number.isInteger(n)||n<0||n>=count)return;draw.color=n;document.querySelectorAll('.pixel-palette button').forEach(function(b){b.setAttribute('aria-pressed',String(Number(b.dataset.id)===n));});}
  function pixel(el){if(!draw||!el||!playingAllowed())return;var n=Number(el.dataset.pixel);if(!Number.isInteger(n)||n<0||n>=192)return;draw.pixels[n]=draw.color;el.style.background=COLORS[draw.color];}
  function saveDrawing(){if(!draw||!playingAllowed())return;var g=state(),pixels=draw.pixels.join('');if(!draw.pixels.some(function(c){return c!==0;})){L().toast(I18n.t('先画一点喜欢的东西吧'));return;}
    if(g.art.some(function(a){return a.pixels===pixels;})){L().toast(I18n.t('这张作品已经在册子里啦'));return;}
    if(g.art.length>=12){L().toast(I18n.t('作品册已有 12 张，先在作品册移除一张再保存'));return;}
    var input=document.getElementById('artName'),name=input&&input.value.trim()||I18n.t('今天的小心情'),id=L().uid('art');var fresh=g.artSeen.indexOf(pixels)<0;g.art.push({id:id,name:name,pixels:pixels,at:Date.now()});if(fresh)g.artSeen.push(pixels);var grew=fresh&&reward(id,{creativity:3,curiosity:1},I18n.t('把「')+name+I18n.t('」收进了你们的像素手账。'));save();draw=null;L().toast(grew?I18n.t('保存好了 · 创造力 +3，好奇心 +1'):I18n.t('作品保存好了 · 这次是自由创作'));album();L().render();}
  function artSVG(pixels){return I18n.html('<svg viewBox="0 0 16 12" role="img" aria-label="像素作品" shape-rendering="crispEdges">')+pixels.split('').map(function(c,i){return '<rect x="'+i%16+'" y="'+Math.floor(i/16)+'" width="1" height="1" fill="'+COLORS[Number(c)||0]+'"/>';}).join('')+'</svg>';}
  function album(){var g=state();L().openSheet(I18n.html('<h2>你们的收集册</h2><p class="hint">小发现 ')+g.collection.length+I18n.t('/9 · 像素作品 ')+g.art.length+'/12</p><div class="find-grid">'+FINDS.map(function(f){var has=g.collection.indexOf(f.id)>=0;return '<div class="find-card '+(has?'found':'')+'"><span>'+(has?f.icon:'？')+'</span><b>'+(has?f.name:I18n.t('还没遇见'))+'</b><small>'+PATHS.find(function(p){return p.id===f.path;}).name+'</small></div>';}).join('')+I18n.html('</div><h3>像素作品</h3><div class="art-grid">')+(g.art.length?g.art.map(function(a){return '<article>'+artSVG(a.pixels)+'<b>'+esc(a.name)+'</b><button class="btn ghost sm" data-adventure="removeArt" data-id="'+a.id+I18n.html('">移出册子</button></article>');}).join(''):I18n.html('<p class="hint">还没有作品，随手画一点就好。</p>'))+I18n.html('</div><details class="adventure-log"><summary>最近一起经历的事</summary>')+g.log.slice(0,8).map(function(x){return '<p>'+esc(x.text)+'</p>';}).join('')+I18n.html('</details><div class="sheet-actions"><button class="btn ghost" data-adventure="open">继续玩</button><button class="btn primary" data-act="closeSheet">合上册子</button></div>'));}
  function onFocus(id){var g=state(),session=(L().state().discipline.sessions||[]).find(function(s){return s.id===id;}),p=Pet.state();if(!session||!Number.isFinite(session.minutes)||session.minutes<1||g.focusSeen.indexOf(id)>=0)return;
    g.focusSeen.push(id);g.focusSeen=g.focusSeen.slice(-500);var before=Math.floor((g.focusMinutes||0)/15);g.focusMinutes=(g.focusMinutes||0)+Math.min(120,session.minutes);var gain=Math.floor(g.focusMinutes/15)-before;p.curiosity=Math.min(100,p.curiosity+gain);
    if(session.minutes>=5&&g.daily.studyGifts<3){g.inspiration=Math.min(9,g.inspiration+1);g.daily.studyGifts++;}save();
  }
  function rules(){L().openSheet(I18n.html('<h2>慢慢长大就好</h2><p class="hint">好奇心、创造力、勇气只涨不掉；换皮肤不重置。新的一天灵感至少补到 3 点，上限 9 点。</p><p class="hint">一次散步、完成一局翻牌或保存新的涂鸦，消耗 1 点灵感并获得成长。每天最多成长 6 次，用完后仍可自由练习和保存作品。</p><p class="hint">真实专注累计每 15 分钟，好奇心 +1；一次确认记录至少 5 分钟，灵感 +1，每天最多 3 次。玩游戏不增加学习时长，也不发小鱼干。专注计时中请先暂停再玩。</p><p class="hint">好奇心 20 解锁林间小径；勇气 20 解锁六对翻牌、35 解锁星光天台；创造力 20 解锁两种新画笔。散步每条路线有 3 件收藏。作品册最多 12 张；移除作品会清掉画面，但同一作品的成长领取记录会保留。</p><div class="sheet-actions"><button class="btn primary" data-act="closeSheet">知道啦</button></div>'));}
  function dispatch(act,id){if(act==='skins'){if(window.petSkins)petSkins.open().catch(function(){L().toast(I18n.t('换肤窗口暂时没打开，请重试'));});return;}
    if(act==='open')open();else if(act==='explore')explore();else if(act==='path')explore(id);else if(act==='choice')choice(id);else if(act==='memory')memory();else if(act==='flip')flip(id);else if(act==='draw')drawing();else if(act==='color')color(id);else if(act==='saveDraw')saveDrawing();else if(act==='clearDraw'){if(draw){draw.pixels.fill(0);document.querySelectorAll('[data-pixel]').forEach(function(el){el.style.background=COLORS[0];});}}
    else if(act==='album')album();else if(act==='removeArt'){var g=state();g.art=g.art.filter(function(a){return a.id!==id;});save();album();}else if(act==='rules')rules();
  }
  document.addEventListener('click',function(e){var b=e.target.closest('[data-adventure]');if(b){e.preventDefault();dispatch(b.dataset.adventure,b.dataset.id);}else if(e.detail===0&&e.target.closest('[data-pixel]'))pixel(e.target.closest('[data-pixel]'));});
  document.addEventListener('pointerdown',function(e){var el=e.target.closest('[data-pixel]');if(el&&e.button===0&&draw){e.preventDefault();draw.dragging=true;el.focus();pixel(el);}});
  document.addEventListener('pointermove',function(e){if(draw&&draw.dragging){var el=document.elementFromPoint(e.clientX,e.clientY);if(el&&el.matches('[data-pixel]'))pixel(el);}});
  ['pointerup','pointercancel','blur'].forEach(function(event){window.addEventListener(event,function(){if(draw)draw.dragging=false;});});
  Pet.renderPage=function(){basePage();var root=document.getElementById('petPage');if(!root)return;var shell=document.createElement('div');shell.innerHTML=card();root.insertBefore(shell.firstElementChild,root.children[1]||null);};
  Pet.refresh=function(){baseRefresh();if(!window.Landing)return;state();var links=document.querySelector('#buddy-card .buddy-links');if(links&&!links.querySelector('[data-adventure]')){links.insertAdjacentHTML('beforeend',I18n.html('<button data-adventure="skins">换皮肤</button><button data-adventure="open">一起玩 ↗</button>'));}var banner=document.querySelector('.market-banner');if(banner&&!banner.querySelector('[data-adventure]')){var button=document.createElement('button');button.className='btn ghost sm';button.dataset.adventure='skins';button.textContent=I18n.t('换皮肤 · Petdex ↗');banner.firstElementChild.appendChild(button);}};
  window.PetAdventure={state:state,open:open,onFocus:onFocus,reward:reward,playingAllowed:playingAllowed};
})();
