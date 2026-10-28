(function(){
  'use strict';
  function fold(card, title, open){
    var box=document.createElement('details');box.className='ui-fold page-fold';box.open=!!open;
    var summary=document.createElement('summary');summary.textContent=title;box.appendChild(summary);
    card.replaceWith(box);box.appendChild(card);return box;
  }
  function polishPet(root){
    root.classList.add('pet-layout');
    Array.from(root.children).forEach(function(card){
      var h=card.querySelector('h2');if(!h) return;
      var title=h.textContent.replace(/^[^\u4e00-\u9fa5]+/,'');
      if(/和它玩/.test(title)) card.classList.add('pet-play');
      if(/详情设定|它的数据|小鱼干账本|最近记忆|重置/.test(title)){
        var f=fold(card,title,false);f.classList.add('pet-detail');h.hidden=true;
        if(title==='重置') f.classList.add('danger-fold');
      }
    });
  }
  function labelFields(root){
    root.querySelectorAll('.field').forEach(function(field){
      var label=field.querySelector('label'),input=field.querySelector('input[id],textarea[id],select[id]');
      if(label && input && !label.htmlFor) label.htmlFor=input.id;
    });
    root.querySelectorAll('input[id],textarea[id],select[id]').forEach(function(el){
      if(!el.getAttribute('aria-label') && !root.querySelector('label[for="'+el.id+'"]')) el.setAttribute('aria-label',el.placeholder||el.id);
    });
  }
  function polishShop(root){
    if(!root || root.querySelector('.shop-grid,.market'))return;
    var grid=null;
    Array.from(root.children).forEach(function(el,i){
      if(i===0 && el.classList.contains('pp-sec')){el.classList.add('shop-wallet');return;}
      if(el.classList.contains('pp-sec')){
        el.classList.add('shop-heading');grid=document.createElement('div');grid.className='shop-grid';el.after(grid);
      }else if(grid && el.classList.contains('pp-item')) grid.appendChild(el);
    });
  }
  function polishPage(tab){
    var root=document.getElementById('view');
    if(tab==='shop')polishShop(document.getElementById('shopPage'));
    if(tab==='me'){
      Array.from(root.children).forEach(function(card){
        var h=card.querySelector('h2');if(!h || card.classList.contains('mod-head'))return;
        if(/记忆库|的状态|树洞/.test(h.textContent)){
          fold(card,h.textContent.trim(),false);h.hidden=true;
        }
      });
    }
    if(tab==='companion'){
      var cards=root.querySelectorAll(':scope > .card');
      if(cards[1]){
        cards[1].classList.add('conversation-card');
        var label=document.createElement('div');label.className='conversation-label';label.textContent='此刻，想聊些什么？';cards[1].prepend(label);
        var bubble=cards[1].querySelector('#cmpBub');if(bubble){bubble.setAttribute('role','status');bubble.setAttribute('aria-live','polite');}
      }
      var busy=!!root.querySelector('#cmpBub.typing');
      root.querySelectorAll('[data-act="sendAI"],[data-act="followup3"]').forEach(function(b){b.disabled=busy;});
    }
    labelFields(root);
  }
  function polishSettings(){
    var root=document.querySelector('#sheet .sheet');if(!root)return;
    root.classList.add('settings-sheet');
    var close=root.querySelector('.sheet-close'), title=root.querySelector('h2');
    var fields=Array.from(root.querySelectorAll(':scope > .field'));
    var actions=root.querySelector('.sheet-actions'), reset=document.getElementById('s_reset');
    var transfer=document.getElementById('s_export').parentElement;
    var version=root.querySelector('.ver');
    var school=Array.from(root.children).filter(function(x){return x!==close && x!==title && !fields.includes(x) && x!==actions && x!==transfer && x!==version;});
    school=school.concat(fields.filter(function(f){return !f.querySelector('#s_autostart,#s_term,#s_base,#s_pet_base,#s_gh');}));
    function section(name,desc,nodes,expanded){
      var box=document.createElement('details');box.className='settings-section';box.open=expanded;
      var summary=document.createElement('summary');summary.textContent=name;box.appendChild(summary);
      var hint=document.createElement('p');hint.className='hint';hint.textContent=desc;box.appendChild(hint);
      nodes.forEach(function(n){if(n)box.appendChild(n);});root.appendChild(box);return box;
    }
    var intro=document.createElement('p');intro.className='settings-intro';intro.textContent='让着陆，适合你的日常。';title.after(intro);
    section('日常与启动','启动和关闭方式立即生效；其他填写内容请点击底部保存。',fields.filter(function(f){return f.querySelector('#s_autostart')||f.querySelector('#s_term');}),true);
    section('AI 与陪伴','连接你选择的 AI 服务。没有配置也可以使用计划、计时和伙伴互动。',fields.filter(function(f){return f.querySelector('#s_base')||f.querySelector('#s_pet_base');}),false);
    section('课表与教务','查看或更新教务连接。',school,!!document.getElementById('jw_u'));
    section('日报访问','GitHub Token 为可选项。',fields.filter(function(f){return f.querySelector('#s_gh');}),false);
    var data=section('备份与重置','导出的备份可能包含 API Key，请妥善保管。',[transfer],false);
    if(reset){var danger=document.createElement('div');danger.className='settings-danger';danger.appendChild(reset);data.appendChild(danger);}
    if(version)root.appendChild(version);if(actions)root.appendChild(actions);
    labelFields(root);
  }
  window.UI={polishPage:polishPage,polishPet:polishPet,polishSettings:polishSettings};
})();
