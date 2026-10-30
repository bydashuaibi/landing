/* Local personal ledger. Money is stored as integer CNY cents, never pet currency. */
(function(){
  'use strict';
  var B, month='', filter='all',query='',sourceFilter='all',shown=50, importToken=0;
  var C=window.LedgerCore;
  var categories={expense:['餐饮','交通','学习资料','日用','娱乐消费','医疗健康','其他支出'],income:['生活费','奖学金','兼职收入','退款','其他收入'],transfer:['转账']};
  var sourceNames={manual:'手动记账',wechat:'微信',alipay:'支付宝',bank:'银行卡 / CSV'};
  function t(s){return I18n.t(s);}
  function esc(s){return B.esc(String(s==null?'':s));}
  function data(){var s=B.state();if(!s.ledger)s.ledger={version:1,currency:'CNY',entries:[],budgets:{}};return s.ledger;}
  function money(n){return new Intl.NumberFormat(I18n.locale(),{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);}
  function cents(value){var v=String(value).trim();if(!/^\d{1,7}(\.\d{1,2})?$/.test(v))return null;var a=v.split('.'),n=Number(a[0])*100+Number((a[1]||'').padEnd(2,'0'));return Number.isSafeInteger(n)?n:null;}
  function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;var d=new Date(s+'T12:00:00');return !isNaN(d)&&[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')===s;}
  function validEntry(e){return C.valid(e);}
  function entries(){return (Array.isArray(data().entries)?data().entries:[]).filter(validEntry);}
  function category(e){return categories[e.type].includes(e.category)?t(e.category):t(e.type==='income'?'其他收入':e.type==='transfer'?'转账':'其他支出');}
  function button(action,label,extra,cls){return '<button type="button" class="btn '+(cls||'ghost sm')+'" data-ledger="'+action+'" '+(extra||'')+'>'+label+'</button>';}
  function totals(){return entries().filter(e=>e.date.slice(0,7)===month&&C.counted(e)).reduce((a,e)=>{a[e.type]+=e.cents;return a;},{expense:0,income:0});}
  function render(){
    if(!month)month=B.today().slice(0,7);
    var all=entries().filter(e=>e.date.slice(0,7)===month),list=all.filter(e=>(filter==='all'||filter==='pending'&&e.review==='pending'||filter==='excluded'&&(e.review==='excluded'||e.type==='transfer')||e.type===filter&&C.counted(e))&&(sourceFilter==='all'||(e.source||'manual')===sourceFilter)&&(!query||[e.note,category(e),e.orderId].join(' ').toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>b.date.localeCompare(a.date)||(b.at||0)-(a.at||0)),s=totals();
    var h='<div class="mod-head"><div class="kicker">'+t('记录日常的另一种足迹')+'</div><h2>'+t('记账')+'</h2><p>'+t('看看钱花在哪里，给想做的事留一点余地。')+'</p></div>';
    h+='<div class="ledger-toolbar"><div class="field"><label for="ledger-month">'+t('查看月份')+'</label><input id="ledger-month" type="month" value="'+esc(month)+'"></div><div class="row wrap">'+button('import',t('导入 / 合并账单'))+button('backup',t('导出全部账目'))+button('export',t('导出本月 CSV'))+button('add',t('＋ 记一笔'),'','primary')+'</div></div>';
    var pending=all.filter(e=>e.review==='pending').length;
    if(pending)h+='<div class="card ledger-review-notice"><div><strong>'+t('待核对')+' · '+pending+'</strong><p>'+t('待核对和不计收支的记录暂不进入统计。核对后再确认，避免把重复付款算两遍。')+'</p></div>'+button('filter',t('去核对'),'data-filter="pending"','primary sm')+'</div>';
    h+='<div class="stat-row ledger-stats">'+[['本月支出',s.expense],['本月收入',s.income],['本月结余',s.income-s.expense]].map(x=>'<div class="stat-col"><div class="stat-label">'+t(x[0])+'</div><div class="ledger-value">'+money(x[1])+'</div></div>').join('')+'</div>';
    var budget=data().budgets&&data().budgets[month],hasBudget=Number.isSafeInteger(budget)&&budget>0;
    h+='<section class="card ledger-budget"><div class="row between wrap"><h2>'+t('月度预算')+'</h2>'+button('budget',t(hasBudget?'调整预算':'设置预算'))+'</div>';
    if(hasBudget){var left=budget-s.expense;h+='<div class="ledger-budget-line"><strong>'+money(budget)+'</strong><span class="'+(left<0?'ledger-over':'')+'">'+t(left<0?'已超出':'还可支出')+' '+money(Math.abs(left))+'</span></div><div class="ledger-meter"><i style="width:'+Math.min(100,Math.round(s.expense/budget*100))+'%"></i></div>';}
    else h+='<p class="hint">'+t('按需设置本月支出上限，不提醒、不催促。')+'</p>';
    h+='<p class="hint">'+t('金额单位为人民币；结余是本月收入减支出，不代表账户余额。')+'</p></section>';
    h+='<div class="ledger-columns"><section class="card"><div class="row between wrap"><h2>'+t('收支明细')+'</h2><div class="ledger-filters" role="group" aria-label="'+t('收支筛选')+'">'+[['all','全部'],['expense','支出'],['income','收入'],['pending','待核对'],['excluded','不计收支']].map(x=>button('filter',t(x[1]),'data-filter="'+x[0]+'" aria-pressed="'+(filter===x[0])+'"',filter===x[0]?'primary sm':'ghost sm')).join('')+'</div></div>';
    h+='<div class="ledger-search"><div class="field"><label for="ledger-search">'+t('搜索备注或交易号')+'</label><input id="ledger-search" type="search" value="'+esc(query)+'"></div><div class="field"><label for="ledger-source">'+t('记录来源')+'</label><select id="ledger-source"><option value="all">'+t('全部')+'</option>'+Object.keys(sourceNames).map(k=>'<option value="'+k+'"'+(sourceFilter===k?' selected':'')+'>'+t(sourceNames[k])+'</option>').join('')+'</select></div></div>';
    if(!list.length)h+='<div class="ledger-empty"><span aria-hidden="true">↗</span><h3>'+t(all.length?'当前筛选下没有记录':'这个月的账本还是空的')+'</h3><p>'+t('从今天的一顿饭、一本书开始记。')+'</p>'+button('add',t('记下第一笔'),'','primary')+'</div>';
    h+='<div class="ledger-list">'+list.slice(0,shown).map(e=>'<article class="ledger-entry"><div class="ledger-entry-main"><span class="ledger-type" aria-label="'+t(e.type==='income'?'收入':e.type==='transfer'?'转账':'支出')+'">'+(e.type==='income'?'+':e.type==='transfer'?'↔':'−')+'</span><div><strong>'+esc(e.note||category(e))+'</strong><small>'+esc(e.date)+' · '+esc(category(e))+' · '+t(sourceNames[e.source]||'手动记账')+'</small>'+(e.review==='pending'?'<small class="ledger-over">'+t('待核对')+' · '+esc(t(e.reason||'请核对记录'))+'</small>':e.review==='excluded'||e.type==='transfer'?'<small>'+t('不计收支')+'</small>':'')+'</div><b class="ledger-amount">'+(e.type==='income'?'+':e.type==='transfer'?'↔':'−')+money(e.cents)+'</b></div><div class="ledger-entry-actions">'+button('edit',t(e.review==='pending'?'核对':'编辑'),'data-id="'+esc(e.id)+'"')+button('delete',t('删除'),'data-id="'+esc(e.id)+'"')+'</div></article>').join('')+'</div>'+(list.length>shown?button('more',t('显示更多')+' ('+shown+'/'+list.length+')'):'')+'</section>';
    var cat={};all.filter(e=>e.type==='expense'&&C.counted(e)).forEach(e=>{var k=category(e);cat[k]=(cat[k]||0)+e.cents;});
    h+='<section class="card"><h2>'+t('支出去向')+'</h2>'+(s.expense?Object.keys(cat).sort((a,b)=>cat[b]-cat[a]).map(k=>'<div class="ledger-category"><div><span>'+esc(k)+'</span><b>'+money(cat[k])+'</b></div><div class="ledger-meter"><i style="width:'+Math.round(cat[k]/s.expense*100)+'%"></i></div></div>').join(''):'<p class="hint">'+t('记下支出后，这里会显示分类分布。')+'</p>')+'</section></div>';
    return h+'<p class="hint ledger-local">'+t('收支只保存在本机，随完整数据备份一起导入、导出。小鱼干与真实收支分开记录。')+'</p>';
  }
  function edit(id){
    var e=id?entries().find(x=>x.id===id):null;if(id&&!e)return;
    var date=e?e.date:(month===B.today().slice(0,7)?B.today():month+'-01');
    B.openSheet('<h2>'+t(e?'编辑收支':'记一笔')+'</h2><form id="ledger-form"><div class="settings-grid"><div class="field"><label for="ledger-type">'+t('收支类型')+'</label><select id="ledger-type"><option value="expense">'+t('支出')+'</option><option value="income">'+t('收入')+'</option><option value="transfer">'+t('转账')+'</option></select></div><div class="field"><label for="ledger-amount">'+t('金额（元）')+'</label><input id="ledger-amount" type="text" inputmode="decimal" maxlength="10" required autocomplete="off" placeholder="0.00" value="'+(e?(e.cents/100).toFixed(2):'')+'"></div><div class="field"><label for="ledger-date">'+t('日期')+'</label><input id="ledger-date" type="date" required value="'+esc(date)+'"></div><div class="field"><label for="ledger-category">'+t('分类')+'</label><select id="ledger-category"></select></div></div><div class="field"><label for="ledger-note">'+t('备注（选填）')+'</label><input id="ledger-note" maxlength="120" value="'+esc(e&&e.note)+'" placeholder="'+t('比如：午饭、Python 教材')+'"></div><div class="field"><label for="ledger-review">'+t('核对状态')+'</label><select id="ledger-review"><option value="confirmed">'+t('已确认')+'</option><option value="pending">'+t('待核对')+'</option><option value="excluded">'+t('不计收支')+'</option></select></div><p id="ledger-error" role="alert"></p><div class="sheet-actions">'+button('close',t('取消'))+'<button type="submit" class="btn primary">'+t('保存记录')+'</button></div></form>');
    var form=document.getElementById('ledger-form'),type=document.getElementById('ledger-type'),cat=document.getElementById('ledger-category');
    type.value=e?e.type:'expense';document.getElementById('ledger-review').value=e&&e.review||'confirmed';
    function options(){cat.innerHTML=categories[type.value].map(k=>'<option value="'+esc(k)+'">'+t(k)+'</option>').join('');}
    options();if(e&&categories[e.type].includes(e.category))cat.value=e.category;type.onchange=options;
    form.onsubmit=function(event){event.preventDefault();var n=cents(document.getElementById('ledger-amount').value),date=document.getElementById('ledger-date').value;
      if(n===null||n<=0||!validDate(date)){document.getElementById('ledger-error').textContent=t('请输入有效日期和大于 0 的金额，最多两位小数。');return;}
      var rec=Object.assign({},e||{source:'manual'},{id:e?e.id:B.uid('ledger'),type:type.value,cents:n,date:date,category:cat.value,note:document.getElementById('ledger-note').value.trim(),review:document.getElementById('ledger-review').value,reason:'',at:e?e.at:Date.now(),updatedAt:Date.now()});
      if(!Array.isArray(data().entries))data().entries=[];
      if(e)data().entries=data().entries.map(x=>x.id===e.id?rec:x);else data().entries.push(rec);
      month=date.slice(0,7);filter='all';query='';sourceFilter='all';document.getElementById('ledger-search').value='';document.getElementById('ledger-source').value='all';var picker=document.getElementById('ledger-month');if(picker)picker.value=month;B.save();B.closeSheet();B.render();B.toast(t('收支已保存'));
    };
    document.getElementById('ledger-amount').focus();
  }
  function budgetForm(){
    var current=data().budgets&&data().budgets[month];
    B.openSheet('<h2>'+t('月度预算')+' · '+esc(month)+'</h2><form id="ledger-budget-form"><div class="field"><label for="ledger-budget">'+t('本月支出上限（元，0 为不设预算）')+'</label><input id="ledger-budget" inputmode="decimal" type="text" required value="'+(current?(current/100).toFixed(2):'0')+'"></div><p id="ledger-error" role="alert"></p><div class="sheet-actions">'+button('close',t('取消'))+'<button type="submit" class="btn primary">'+t('保存预算')+'</button></div></form>');
    document.getElementById('ledger-budget-form').onsubmit=function(e){e.preventDefault();var n=cents(document.getElementById('ledger-budget').value);if(n===null){document.getElementById('ledger-error').textContent=t('请输入有效金额，最多两位小数。');return;}if(!data().budgets||typeof data().budgets!=='object')data().budgets={};if(n)data().budgets[month]=n;else delete data().budgets[month];B.save();B.closeSheet();B.render();};
  }
  function csv(){
    var rows=entries().filter(e=>e.date.slice(0,7)===month).sort((a,b)=>a.date.localeCompare(b.date));
    function cell(v){var s=String(v==null?'':v);if(/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
    return '\uFEFF'+[[t('日期'),t('收支类型'),t('分类'),t('金额（元）'),t('备注（选填）'),'currency','review','source','orderId']].concat(rows.map(e=>[e.date,t(e.type==='income'?'收入':e.type==='transfer'?'转账':'支出'),category(e),(e.cents/100).toFixed(2),e.note,'CNY',e.review||'confirmed',e.source||'manual',e.orderId||''])).map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function action(el){var a=el.dataset.ledger,id=el.dataset.id;
    if(a==='add'||a==='edit')edit(a==='edit'?id:null);
    if(a==='close')B.closeSheet();
    if(a==='filter'){filter=el.dataset.filter;shown=50;B.render();}
    if(a==='more'){shown+=50;B.render();}
    if(a==='import')LedgerExchange.open();
    if(a==='backup')LedgerExchange.backup();
    if(a==='budget')budgetForm();
    if(a==='delete'){var e=entries().find(x=>x.id===id);if(!e)return;B.openSheet('<h2>'+t('删除这笔收支？')+'</h2><p>'+esc(e.date)+' · '+money(e.cents)+' · '+esc(e.note||category(e))+'</p><div class="sheet-actions">'+button('close',t('取消'))+button('confirmDelete',t('确认删除'),'data-id="'+esc(id)+'"','danger')+'</div>');}
    if(a==='confirmDelete'){data().entries=data().entries.filter(x=>x.id!==id);if(!data().deleted)data().deleted={};Object.defineProperty(data().deleted,id,{value:Date.now(),writable:true,configurable:true,enumerable:true});B.save();B.closeSheet();B.render();B.toast(t('已删除'));}
    if(a==='export'){var url=URL.createObjectURL(new Blob([csv()],{type:'text/csv;charset=utf-8;'})),link=document.createElement('a');link.href=url;link.download='StudyTrail-'+month+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  }
  function init(bridge){B=bridge;LedgerExchange.init(B);document.addEventListener('click',e=>{var el=e.target.closest('[data-ledger]');if(el){e.preventDefault();action(el);}});document.addEventListener('change',e=>{if(e.target.id==='ledger-search'){query=e.target.value.trim();shown=50;B.render();}if(e.target.id==='ledger-source'){sourceFilter=e.target.value;shown=50;B.render();}if(e.target.id==='ledger-month'&&/^\d{4}-\d{2}$/.test(e.target.value)&&Number(e.target.value.slice(-2))>=1&&Number(e.target.value.slice(-2))<=12){month=e.target.value;B.render();}});}
  window.Ledger={init:init,render:render,add:function(){edit();}};
})();
