// Native notifications are evidence for review, not a complete transaction feed.
export function mergeEvents(state,events,date){
  state.captureReview ||= [];state.ledger.deleted ||= {};
  const ack=[];
  for(const e of events){
    if(!e||typeof e.id!=='string'||!e.id.startsWith('notification:')||!['wechat','alipay'].includes(e.source)||!['expense','income','transfer'].includes(e.type)||!Number.isFinite(e.at)||e.at<=0||!Number.isSafeInteger(e.cents)||e.cents<0||e.cents>999999999)continue;
    ack.push(e.id);
    if(state.ledger.entries.some(x=>x.id===e.id)||state.captureReview.some(x=>x.id===e.id)||Object.hasOwn(state.ledger.deleted,e.id))continue;
    if(!e.cents){state.captureReview.push({...e});continue;}
    const duplicate=state.ledger.entries.some(x=>x.source===e.source&&x.cents===e.cents&&Math.abs((x.at||0)-e.at)<120000);
    state.ledger.entries.push({id:e.id,date:date(e.at),type:e.type,cents:e.cents,category:e.type==='income'?(e.kind==='refund'?'退款':'其他收入'):e.type==='transfer'?'转账':'其他支出',note:e.source==='wechat'?'微信付款通知':'支付宝付款通知',source:e.source,orderId:'',review:'pending',reason:duplicate?'金额时间相近，请核对是否重复':e.kind==='refund'?'退款待核对':'付款通知待核对',at:e.at,updatedAt:Date.now()});
  }
  return ack;
}
