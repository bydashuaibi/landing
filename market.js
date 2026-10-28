/* Shop presentation shares the pet's existing wallet, inventory and purchase actions. */
(function(){
  'use strict';
  var category='all',affordable=false,previewId=null,previewSprite=null,previewHost=null,toyMotion=null;
  var baseHTML=Pet.shopHTML,baseAct=Pet.shopAct,baseRefresh=Pet.refresh,basePage=Pet.renderPage;
  var categories=[['all','逛一逛'],['food','点心'],['gear','装扮'],['toy','互动'],['scene','房间'],['owned','我的收藏'],['reward','现实奖励']];
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function item(id){return Pet.catalog().find(function(i){return i.id===id;});}
  function owned(p,i){return (p.owned[i.id]||0)>0 || (i.kind==='toy'&&p.toys.indexOf(i.id)>=0);}
  function equipped(p,i){return i.kind==='gear'?p.gear[i.slot]===i.id:i.kind==='scene'&&p.scene===i.id;}
  function btn(act,id,text,extra){return '<button type="button" class="btn sm '+(extra||'ghost')+'" data-pact="'+act+'" data-id="'+esc(id)+'">'+text+'</button>';}
  function wish(p){var i=item(p.wishId);if(!i)return '<div class="market-wish"><span>♡ 留一个小心愿</span><p>挑中喜欢的物品，点「心愿」。慢慢攒，也可以随时换。</p></div>';
    var done=i.once&&owned(p,i),percent=done?100:Math.min(100,Math.round(p.fish/i.cost*100));
    return '<div class="market-wish"><div class="market-line"><b>'+i.emoji+' '+esc(i.name)+'</b><span>'+ (done?'已经拥有':p.fish+' / '+i.cost+' 🐟')+'</span></div><progress max="100" value="'+percent+'" aria-label="心愿进度"></progress><div class="market-line"><small>'+(done?'心愿实现啦，可以挑下一个了。':p.fish>=i.cost?'已经攒够了，喜欢就带回家。':'还差 '+(i.cost-p.fish)+' 条，按自己的节奏来。')+'</small>'+btn('wish','', '取消')+'</div></div>';
  }
  function card(p,i){var has=owned(p,i),on=equipped(p,i),can=p.fish>=i.cost;
    var effect=i.kind==='food'?'饱食 +'+i.hunger+' · 亲密 +'+i.intimacy:i.kind==='toy'?'可重复互动 · 亲密 +1 / 分钟':i.kind==='gear'?'像素配饰 · 同步桌宠':'布置首页与伙伴房间';
    var action=i.once&&has?btn('use',i.id,on?'卸下':i.kind==='gear'?'戴上':i.kind==='scene'?'布置':'一起玩','primary'):(can?btn('buy',i.id,'兑换 · '+i.cost+' 🐟','primary'):'<button type="button" class="btn sm" disabled>还差 '+(i.cost-p.fish)+' 🐟</button>');
    return '<article class="market-item" data-item="'+i.id+'"><div class="market-item-art" data-kind="'+i.kind+'"><span aria-hidden="true">'+i.emoji+'</span><small>'+(on?'使用中':has?(i.kind==='food'?'库存 ×'+p.owned[i.id]:'已收藏'):(i.once?'永久拥有':'一份点心'))+'</small></div><div class="market-item-body"><div class="market-line"><h3>'+esc(i.name)+'</h3><span class="market-price">'+i.cost+' 🐟</span></div><p>'+esc(i.desc)+'</p><small>'+effect+'</small><div class="market-item-actions">'+action+(i.kind==='food'?(has?btn('use',i.id,'分享一份'):''):btn('preview',i.id,'预览'))+'</div>'+btn('wish',i.id,p.wishId===i.id?'♥ 当前心愿':'♡ 心愿')+'</div></article>';
  }
  function rewards(p){return '<div class="market-rewards"><div class="market-section-title"><h2>也给自己一点奖励</h2><p>兑换后会留在「待兑现」，享受完再打勾。</p></div><div class="market-reward-grid">'+p.rewards.map(function(r){return '<article class="market-reward"><span>🎁</span><h3>'+esc(r.name)+'</h3><p>'+r.cost+' 🐟</p><div>'+ (p.fish>=r.cost?btn('redeem',r.id,'兑换','primary'):'<button class="btn sm" disabled>还差 '+(r.cost-p.fish)+' 🐟</button>')+btn('delrw',r.id,'删除')+'</div></article>';}).join('')+'</div><div class="market-reward-form"><label>奖励名称<input id="shopRwName" maxlength="20" placeholder="比如：看一集喜欢的番"></label><label>小鱼干<input id="shopRwCost" type="number" min="1" max="9999" step="1" placeholder="6"></label>'+btn('addrw','','添加奖励','primary')+'</div><h3>待兑现 · '+p.todo.filter(function(t){return !t.done;}).length+'</h3>'+p.todo.filter(function(t){return !t.done;}).map(function(t){return '<div class="market-todo"><span>🎁 '+esc(t.name)+'</span>'+btn('tododone',t.id,'享受过了 ✓')+'</div>';}).join('')+'<p class="hint">最近兑现：'+(p.todo.filter(function(t){return t.done;}).slice(-3).map(function(t){return esc(t.name);}).join(' · ')||'还没有，给自己留一个期待吧。')+'</p></div>';}
  Pet.shopHTML=function(){if(baseHTML()===null)return null;var p=Pet.state(),all=Pet.catalog(),selected=item(previewId);
    var picks=['ribbon','musicbox','dawn','cookie','camera','night'];
    var shelf=category==='all'?all.slice().sort(function(a,b){var ai=picks.indexOf(a.id),bi=picks.indexOf(b.id);return (ai<0?99:ai)-(bi<0?99:bi);}):all;
    var list=shelf.filter(function(i){return (category==='all'||category===i.kind||(category==='owned'&&owned(p,i)))&&(!affordable||p.fish>=i.cost||owned(p,i));});
    return '<div class="market"><header class="market-banner"><div><span class="market-eyebrow">LITTLE JOYS / 日常里的小欢喜</span><h2>把认真生活，换成一点喜欢。</h2><p>给'+esc(p.name)+'挑一份礼物，也为自己留一份期待。</p></div><div class="market-wallet"><small>我的小鱼干</small><strong>'+p.fish+' <span>🐟</span></strong><small>物品 '+all.length+' 件 · 已收藏 '+all.filter(function(i){return owned(p,i);}).length+' 件</small></div></header><div class="market-layout"><aside class="market-preview"><div class="market-section-title"><span class="market-eyebrow">FITTING ROOM / '+(selected?'正在预览':'伙伴小屋')+'</span><h3>'+esc(selected?selected.name:p.name)+'</h3></div><div class="market-room" id="marketRoom"><div class="market-window" aria-hidden="true"></div><div class="market-floor" aria-hidden="true"></div><div id="marketAvatar"></div><span class="market-room-note">'+(selected?'试用效果 · 尚未改变装扮':'今天也一起慢慢来')+'</span></div><div class="market-preview-actions">'+(selected?btn('preview','','恢复当前装扮'):btn('preview-motion','','挥挥手'))+'</div>'+wish(p)+'</aside><section class="market-shelf"><div class="market-categories" role="group" aria-label="商品分类">'+categories.map(function(c){return '<button type="button" data-pact="category" data-id="'+c[0]+'" aria-pressed="'+(category===c[0])+'">'+c[1]+'</button>';}).join('')+'</div>'+(category==='reward'?rewards(p):'<div class="market-line market-filter"><span>'+ (category==='owned'?'已经带回家的小物':'挑一件喜欢的')+' · '+list.length+' 件</span><button type="button" class="btn ghost sm" data-pact="affordable" aria-pressed="'+affordable+'">'+(affordable?'✓ ':'')+'只看可用余额范围</button></div><div class="market-grid">'+(list.length?list.map(function(i){return card(p,i);}).join(''):'<div class="market-empty">这里还空着。先去逛逛，或者取消余额筛选。</div>')+'</div>')+'</section></div></div>';
  };
  Pet.shopAct=function(act,id){var p=Pet.state();
    if(act==='category'){if(categories.some(function(c){return c[0]===id;}))category=id;}
    else if(act==='affordable')affordable=!affordable;
    else if(act==='preview'){previewId=item(id)?id:null;}
    else if(act==='preview-motion'){if(previewSprite)previewSprite.play('wave',2);return;}
    else if(act==='wish'){p.wishId=id===p.wishId?null:item(id)?id:null;Landing.save();}
    else {if(act==='addrw'){var value=Number(document.getElementById('shopRwCost').value);if(!Number.isSafeInteger(value)||value<1||value>9999){Landing.toast('价格填 1～9999 的整数就好');return;}}
      if(act==='buy'||act==='use')previewId=null;
      var used=item(id);if(act==='use'&&used&&used.kind==='toy'&&owned(p,used))toyMotion={name:used.motion||(id==='laser'?'laser':'hop'),at:Date.now()};
      baseAct(act,id);return;}
    Landing.render();
  };
  function sync(){if(!window.Landing)return;var p=Pet.state(),host=document.getElementById('marketAvatar');
    if(previewHost!==host){if(previewSprite)previewSprite.dispose();previewSprite=null;previewHost=host;
      if(host){var i=item(previewId),gear=Object.assign({},p.gear),scene=p.scene;if(i&&i.kind==='gear')gear[i.slot]=i.id;if(i&&i.kind==='scene')scene=i.id;
        document.getElementById('marketRoom').dataset.scene=scene||'default';previewSprite=PetdexSprite.mount(host,{gear:gear});previewSprite.setState({gentle:!!p.gentleMotion});if(i&&i.kind==='toy')previewSprite.play(i.motion||(i.id==='laser'?'laser':'hop'),3);
        else if(toyMotion&&Date.now()-toyMotion.at<3000)previewSprite.play(toyMotion.name,(3000-Date.now()+toyMotion.at)/1000);}
    }
    document.querySelectorAll('#buddy-card .buddy-scene,.pg-stage').forEach(function(el){el.dataset.scene=p.scene||'default';});
  }
  Pet.refresh=function(){baseRefresh();sync();};
  Pet.renderPage=function(){basePage();var root=document.getElementById('petPage');if(!root)return;var p=Pet.state();
    var box=document.createElement('div');box.className='card partner-collection';box.innerHTML='<div class="market-line"><h2>一起用的小物</h2><button class="btn ghost sm" data-market-open>去商城 ↗</button></div><p class="hint">玩具可以反复用。亲密奖励每分钟一次，休息时也能一起玩。</p><div class="partner-toys">'+Pet.catalog().filter(function(i){return i.kind==='toy'&&owned(p,i);}).map(function(i){return '<button class="btn ghost" data-market-toy="'+i.id+'">'+i.emoji+' '+esc(i.name)+'</button>';}).join('')+'</div>'+(!Pet.catalog().some(function(i){return i.kind==='toy'&&owned(p,i);})?'<p class="hint">还没有互动道具。商城里可以先看看动作，再决定喜欢哪一个。</p>':'')+wish(p);
    box.addEventListener('click',function(e){var toy=e.target.closest('[data-market-toy]');if(toy)Pet.shopAct('use',toy.dataset.marketToy);if(e.target.closest('[data-market-open]'))Landing.tab('shop');var b=e.target.closest('[data-pact="wish"]');if(b)Pet.shopAct('wish',b.dataset.id);});
    root.insertBefore(box,root.children[1]||null);sync();
  };
})();
