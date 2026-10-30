/* Shared, offline ledger rules. No bank API, network access or platform globals. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LedgerCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX=999999999, LIMIT=10000;
  const text=v=>String(v==null?'':v).trim().replace(/^\uFEFF/,'');
  function amount(v){let s=text(v).replace(/^[¥￥]\s*/,'');if(/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s))s=s.replace(/,/g,'');if(!/^\d{1,7}(\.\d{1,2})?$/.test(s))return null;const a=s.split('.'),n=Number(a[0])*100+Number((a[1]||'').padEnd(2,'0'));return Number.isSafeInteger(n)&&n<=MAX?n:null;}
  function date(v){const s=text(v).slice(0,10).replace(/\//g,'-');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';const d=new Date(s+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===s?s:'';}
  function valid(e){return e&&typeof e.id==='string'&&e.id.length>0&&e.id.length<2048&&date(e.date)===e.date&&['expense','income','transfer'].includes(e.type)&&Number.isSafeInteger(e.cents)&&e.cents>0&&e.cents<=MAX&&(!e.review||['confirmed','pending','excluded'].includes(e.review));}
  function counted(e){return valid(e)&&e.type!=='transfer'&&(!e.review||e.review==='confirmed');}
  function clean(e){return {id:e.id,date:e.date,type:e.type,cents:e.cents,category:text(e.category).slice(0,120),note:text(e.note).slice(0,500),source:['wechat','alipay','bank','manual'].includes(e.source)?e.source:'manual',orderId:text(e.orderId).slice(0,150),review:e.review||'confirmed',reason:text(e.reason).slice(0,200),at:Number.isFinite(e.at)?e.at:0,updatedAt:Number.isFinite(e.updatedAt)?e.updatedAt:0};}
  function csvRows(input){const s=String(input).replace(/^\uFEFF/,''),rows=[];let row=[],v='',quoted=false;
    for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){v+='"';i++;}else if(quoted||!v)quoted=!quoted;else v+=c;}else if(!quoted&&(c===','||c==='\t')){row.push(v);v='';}else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&s[i+1]==='\n')i++;row.push(v);rows.push(row);row=[];v='';}else v+=c;if(rows.length>LIMIT+100)throw Error('账单超过 10000 行，请按月拆分后导入。');}
    if(quoted)throw Error('CSV 引号未闭合，请检查文件格式。');if(v||row.length){row.push(v);rows.push(row);}return rows;
  }
  const norm=s=>text(s).replace(/[\s()（）]/g,'').toLowerCase();
  function parse(input,filename){
    if(String(input).length>8*1024*1024)throw Error('文件过大，请使用不超过 8 MB 的账单。');
    if(/^\s*[\[{]/.test(input)){
      let doc;try{doc=JSON.parse(input);}catch(_){throw Error('不是有效的账本 JSON。');}
      if(!doc||doc.format!=='studytrail.ledger'||![1,2].includes(doc.version)||doc.currency!=='CNY'||!Array.isArray(doc.entries))throw Error('请导入学迹独立账本，完整应用备份请在设置中恢复。');
      if(doc.entries.length>LIMIT)throw Error('账单超过 10000 行，请按月拆分后导入。');
      const rows=doc.entries.map((e,i)=>({line:i+1,entry:valid(e)?clean(e):null,error:valid(e)?'':'无效日期、金额或收支类型'}));
      const budgets={};for(const [k,v] of Object.entries(doc.budgets||{})){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(k)||!Number.isSafeInteger(v)||v<=0||v>MAX)throw Error('账本预算格式无效。');budgets[k]=v;}
      return {source:'studytrail',rows,budgets};
    }
    const rows=csvRows(input),aliases={date:['交易时间','交易日期','交易创建时间','日期','Date','日付'],type:['收/支','收支','收支类型','Type','収支の種類'],amount:['金额元','金额','Amount CNY','金額人民元'],note:['备注','备注选填','Note optional','メモ任意'],merchant:['交易对方'],goods:['商品','商品说明'],status:['当前状态','交易状态'],order:['交易单号','交易订单号','交易号'],kind:['交易类型','交易分类'],currency:['currency'],review:['review'],source:['source'],category:['分类','Category','カテゴリ'],orderId:['orderId']};
    let idx=-1,map={};for(let i=0;i<Math.min(rows.length,100);i++){const h=rows[i].map(norm),m={};for(const k of Object.keys(aliases))m[k]=h.findIndex(x=>aliases[k].map(norm).includes(x));if(m.date>=0&&m.type>=0&&m.amount>=0){idx=i;map=m;break;}}
    if(idx<0)throw Error('没有识别到日期、收支、金额表头；请使用 CSV 或学迹账本 JSON。');
    const prefix=rows.slice(0,idx+1).map(r=>r.join(',')).join('\n');
    const source=/微信/.test(prefix+' '+filename)?'wechat':/支付宝|alipay/i.test(prefix+' '+filename)?'alipay':'bank';
    const out=[];
    for(let i=idx+1;i<rows.length;i++){
      const r=rows[i];if(r.every(v=>!text(v))||/^[-—=]{3,}|^共\s*\d+\s*笔|^总笔数/.test(text(r[0])))continue;
      const get=k=>map[k]>=0?text(r[map[k]]):'',d=date(get('date')),n=amount(get('amount')),direction=get('type'),status=get('status'),kind=get('kind');
      if(!d||!n||n<=0){out.push({line:i+1,error:'无效日期、金额或收支类型',entry:null});continue;}
      if(get('currency')&&get('currency')!=='CNY'){out.push({line:i+1,error:'仅支持人民币账单',entry:null});continue;}
      const type=/^(支出|expense)$/i.test(direction)?'expense':/^(收入|income)$/i.test(direction)?'income':/^(不计收支|不计收入支出|中性交易|转账|transfer|振替)$/i.test(direction)?'transfer':'';
      if(!type){out.push({line:i+1,error:'无效日期、金额或收支类型',entry:null});continue;}
      let review='confirmed',reason='';
      if(type==='transfer'||/充值|提现|信用卡还款|理财|转入|转出/.test(kind)){review='excluded';reason='转账、充值等不计入消费';}
      else if(/失败|关闭|取消|待付款|未支付|已撤销/.test(status)){review='excluded';reason='未完成的交易';}
      else if(/退款/.test(status)&&type==='expense'){review='pending';reason='退款状态需核对，避免重复冲减';}
      else if(/转账|红包/.test(kind)){review='pending';reason='请核对转账或红包的实际用途';}
      else if(map.status>=0&&!/^(支付成功|交易成功|收款成功|已支付|已收款|已收钱|对方已收钱|已转账|退款成功|已退款|完成|成功)$/.test(status)){review='pending';reason='交易状态需核对';}
      if(map.review>=0){if(!['confirmed','pending','excluded'].includes(get('review'))){out.push({line:i+1,error:'无效日期、金额或收支类型',entry:null});continue;}review=get('review');}
      const rowSource=['wechat','alipay','bank','manual'].includes(get('source'))?get('source'):source;
      const orderId=get('order')||get('orderId'),note=[get('merchant'),get('goods'),get('note')].filter(x=>x&&x!=='/').join(' · ').slice(0,500);
      // A file's source order ID is a string. Never coerce long order IDs to numbers.
      const id=orderId?'bill:'+rowSource+':'+orderId+':'+type:'bill:row:'+JSON.stringify([source,d,get('date'),type,n,note,status]);
      out.push({line:i+1,entry:{id,date:d,type,cents:n,category:get('category')||(type==='income'?(/退款/.test(kind+status)?'退款':'其他收入'):type==='transfer'?'转账':'其他支出'),note,source:rowSource,orderId,review,reason,at:0,updatedAt:0}});
    }
    return {source,rows:out};
  }
  function same(a,b){return ['date','type','cents','category','note','review'].every(k=>(a[k]||(k==='review'?'confirmed':''))===(b[k]||(k==='review'?'confirmed':'')));}
  function transactionSame(a,b){return a.date===b.date&&a.type===b.type&&a.cents===b.cents;}
  function preview(ledger,parsed){const existing=(ledger.entries||[]).filter(valid),seen=new Map(existing.map(e=>[e.id,e])),deleted=ledger.deleted||{},out=[];
    for(const row of parsed.rows){if(!row.entry){out.push({...row,action:'invalid'});continue;}const e=clean(row.entry),prior=seen.get(e.id);let action='add';
      if(Object.prototype.hasOwnProperty.call(deleted,e.id))action='deleted';
      else if(prior){action=same(prior,e)||(parsed.source!=='studytrail'&&transactionSame(prior,e))?'duplicate':'conflict';}
      else {const similar=Array.from(seen.values()).some(x=>transactionSame(x,e));if(similar&&e.review==='confirmed'){e.review='pending';e.reason='同日同额记录需核对，未自动合并';}seen.set(e.id,e);}
      out.push({line:row.line,entry:e,action,previous:action==='conflict'?clean(prior):null});
    }return out;
  }
  function merge(ledger,previewRows,selected){const entries=(ledger.entries||[]).slice(),deleted={...(ledger.deleted||{})};let added=0;
    const chosen=new Set(selected);for(const row of previewRows){if(row.action!=='add'||!chosen.has(row.line)||!valid(row.entry)||entries.some(e=>e.id===row.entry.id)||Object.prototype.hasOwnProperty.call(deleted,row.entry.id))continue;entries.push(clean(row.entry));added++;}
    return {ledger:{...ledger,version:2,currency:'CNY',entries,deleted},added};
  }
  function backup(ledger){return {format:'studytrail.ledger',version:2,currency:'CNY',exportedAt:new Date().toISOString(),entries:(ledger.entries||[]).filter(valid).map(clean),budgets:{...(ledger.budgets||{})}};}
  return {amount,date,valid,counted,clean,parse,preview,merge,backup};
});
