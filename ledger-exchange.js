/* User-selected local files only. Import never replaces the full application state. */
(function(){
  'use strict';
  var B,C=window.LedgerCore,token=0;
  var t=s=>I18n.t(s),esc=s=>B.esc(String(s==null?'':s));
  function importForm(){
    token++;
    B.openSheet('<h2>'+t('导入 / 合并账单')+'</h2><p class="hint">'+t('选择微信、支付宝 CSV，或学迹独立账本 JSON。只合并账目，不覆盖学习计划。Excel 文件请先另存为 CSV。')+'</p><div class="field"><label for="ledger-file">'+t('选择本地文件')+'</label><input id="ledger-file" type="file" accept=".csv,.tsv,.txt,.json"></div><div id="ledger-import-result" role="status"></div><div class="sheet-actions"><button type="button" class="btn ghost" data-ledger="close">'+t('取消')+'</button></div>');
    var input=document.getElementById('ledger-file');
    input.onchange=async function(){var file=input.files[0];if(!file)return;var result=document.getElementById('ledger-import-result'),current=++token;
      try{
        if(file.size>8*1024*1024)throw Error('文件过大，请使用不超过 8 MB 的账单。');
        if(!/\.(csv|tsv|txt|json)$/i.test(file.name))throw Error('仅支持 CSV、TSV 或账本 JSON 文件。');
        var buf=await file.arrayBuffer(),bytes=new Uint8Array(buf),raw;
        if(bytes[0]===255&&bytes[1]===254)raw=new TextDecoder('utf-16le',{fatal:true}).decode(buf);
        else try{raw=new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch(_){raw=new TextDecoder('gb18030',{fatal:true}).decode(buf);}
        if(current!==token||!input.isConnected)return;
        var parsed=C.parse(raw,file.name);showPreview(parsed,C.preview(B.state().ledger,parsed),file.name);
      }catch(error){if(current===token&&input.isConnected)result.innerHTML='<p class="ledger-over">'+esc(t(error.message||'导入失败，请检查文件。'))+'</p>';}
    };
  }
  function showPreview(parsed,preview,filename){
    var counts={add:0,duplicate:0,conflict:0,invalid:0,deleted:0};preview.forEach(r=>counts[r.action]++);
    var labels={add:'可新增',duplicate:'重复跳过',conflict:'内容冲突，保留本机',invalid:'格式不符，跳过',deleted:'已删除，不恢复'};
    var h='<h2>'+t('导入预览')+'</h2><p class="hint">'+esc(filename)+'</p><div class="ledger-import-summary">'+Object.keys(labels).map(k=>'<span>'+t(labels[k])+' <b>'+counts[k]+'</b></span>').join('')+'</div><p class="hint">'+t('疑似重复或用途不明的交易进入待核对，不计入统计。冲突记录保留本机版本；已删除记录不会因再次导入而恢复。')+'</p>';
    h+='<div class="ledger-import-table"><table><thead><tr>'+['日期','金额（元）','备注（选填）','处理方式'].map(k=>'<th>'+t(k)+'</th>').join('')+'</tr></thead><tbody>'+preview.slice(0,200).map(r=>'<tr><td>'+esc(r.entry?r.entry.date:'#'+r.line)+'</td><td>'+(r.entry?new Intl.NumberFormat(I18n.locale(),{style:'currency',currency:'CNY'}).format(r.entry.cents/100):'—')+'</td><td>'+esc(r.entry?r.entry.note:t(r.error))+'</td><td>'+t(r.action==='add'&&r.entry.review==='pending'?'待核对':r.action==='add'&&r.entry.review==='excluded'?'不计收支':labels[r.action])+'</td></tr>').join('')+'</tbody></table></div>';
    if(preview.length>200)h+='<p class="hint">'+t('这里只预览前 200 行；合并范围为文件中全部可新增记录。')+'</p>';
    if(parsed.budgets&&Object.keys(parsed.budgets).length)h+='<label class="ledger-budget-option"><input type="checkbox" id="ledger-import-budgets"> '+t('同时导入缺失月份的预算，已有预算保持不变')+'</label>';
    h+='<div class="sheet-actions"><button type="button" class="btn ghost" data-ledger="close">'+t('取消')+'</button><button type="button" class="btn primary" id="ledger-import-confirm"'+(!counts.add&&!Object.keys(parsed.budgets||{}).length?' disabled':'')+'>'+t('确认合并')+' · '+counts.add+'</button></div>';
    B.openSheet(h);var current=token,confirm=document.getElementById('ledger-import-confirm');
    confirm.onclick=function(){if(current!==token||!confirm.isConnected)return;confirm.disabled=true;
      var merged=C.merge(B.state().ledger,preview,preview.filter(r=>r.action==='add').map(r=>r.line)),budget=document.getElementById('ledger-import-budgets');
      if(budget&&budget.checked){merged.ledger.budgets=Object.assign({},merged.ledger.budgets);Object.keys(parsed.budgets).forEach(k=>{if(!Object.prototype.hasOwnProperty.call(merged.ledger.budgets,k))merged.ledger.budgets[k]=parsed.budgets[k];});}
      B.state().ledger=merged.ledger;B.save();token++;B.closeSheet();B.render();B.toast(t('账目已合并，其他数据保持原样。'));
    };
  }
  function backup(){var json=JSON.stringify(C.backup(B.state().ledger),null,2);
    if(window.landing&&landing.data&&landing.data.saveLedger){landing.data.saveLedger(json).then(r=>{if(r&&r.ok)B.toast(t('账本已导出'));else if(r&&!r.canceled)B.toast(t('导出失败：')+(r.error||''));}).catch(()=>B.toast(t('导出失败，请重试。')));return;}
    var url=URL.createObjectURL(new Blob([json],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='StudyTrail-ledger-'+B.today()+'.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  window.LedgerExchange={init:bridge=>B=bridge,open:importForm,backup};
})();
