import {Capacitor,registerPlugin} from '@capacitor/core';
import {mergeEvents} from './notification-core.js';
export const Native=registerPlugin('StudyTrailNative');
export const native=Capacitor.isNativePlatform();
export function createCapture(B){
  let status={available:native},busy=false;
  async function sync(){if(!native||busy)return;busy=true;try{const old=JSON.stringify(status);status={available:true,...await Native.status()};const {events}=await Native.events();if(events.length){const ids=mergeEvents(B.state(),events,B.date);await B.save();await Native.acknowledge({ids});}if(events.length||JSON.stringify(status)!==old)B.refresh();}catch(_){status.error=true;B.refresh();}finally{busy=false;}}
  const time=n=>n?new Date(n).toLocaleString(B.lang()):B.t('尚无可识别付款通知');
  function render(){const t=B.t,s=status;return '<section class="card capture"><div class="row between wrap"><h2>'+t('自动记账')+'</h2><span class="badge">'+t(!s.available?'浏览器预览':!s.enabled?'未开启':!s.granted?'等待授权':s.connected?'监听已连接':'监听未连接')+'</span></div><p class="hint">'+t('仅收集微信、支付宝实际发出的支付通知，集中核对后计入统计；没有通知的交易请导入账单补漏。')+'</p><p class="hint">'+t('最近采集')+' · '+B.esc(time(s.lastCaptured))+'</p>'+(s.error?'<p role="alert">'+t('采集或保存异常，请检查权限与本机存储')+'</p>':'')+'<div class="row wrap"><button id="capture-toggle" '+(!native?'disabled':'')+'>'+t(s.enabled?'暂停采集':'开启自动记账')+'</button><button id="capture-access" '+(!native?'disabled':'')+'>'+t('通知使用权')+'</button><button id="capture-settings" '+(!native?'disabled':'')+'>'+t('应用系统设置')+'</button><button id="capture-refresh">'+t('刷新状态')+'</button></div></section>';}
  function bind(){const el=id=>document.getElementById(id);if(!el('capture-toggle'))return;el('capture-toggle').onclick=()=>{if(status.enabled){Native.configure({enabled:false}).then(sync).catch(()=>B.toast(B.t('采集或保存异常，请检查权限与本机存储')));return;}
    B.open('<h2>'+B.t('开启自动记账')+'</h2><p>'+B.t('系统通知使用权允许读取通知。本应用只在本机处理微信和支付宝的付款通知，不保存普通聊天、验证码或通知原文，不上传云端。授权不会补回历史交易，也不能保证每笔付款都有通知。')+'</p><button id="capture-consent" class="primary">'+B.t('同意并前往系统授权')+'</button>');
    el('capture-consent').onclick=async()=>{try{await Native.configure({enabled:true});await Native.openAccess();B.close();await sync();}catch(_){B.toast(B.t('无法打开系统设置，请稍后重试'));}};
  };el('capture-access').onclick=()=>Native.openAccess().catch(()=>B.toast(B.t('无法打开系统设置，请稍后重试')));el('capture-settings').onclick=()=>Native.openAppSettings().catch(()=>B.toast(B.t('无法打开系统设置，请稍后重试')));el('capture-refresh').onclick=async()=>{try{if(native&&status.enabled&&status.granted&&!status.connected)await Native.configure({enabled:true});await sync();}catch(_){B.toast(B.t('采集或保存异常，请检查权限与本机存储'));}};}
  return {sync,render,bind};
}
