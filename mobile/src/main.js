import {Capacitor} from '@capacitor/core';
import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';
const key='studytrail.mobile.v1', $=id=>document.getElementById(id);
let state={ledger:{version:2,currency:'CNY',entries:[],budgets:{},deleted:{}},language:'zh-CN',pats:0},tab='ledger',sprite,toastTimer;
try{const raw=localStorage.getItem(key);if(raw){const parsed=JSON.parse(raw);if(!parsed.ledger||!Array.isArray(parsed.ledger.entries))throw Error('Invalid ledger');state={...state,...parsed};}}catch(e){$('content').textContent='账本暂时无法读取，请保留应用数据后重试。';throw e;}
const extra={账本:['Ledger','家計簿'],伙伴:['Companion','パートナー'],我的:['Me','設定'],手机测试版:['Mobile preview','モバイル試用版'],摸摸初华:['Pat Uika','初華をなでる'],在这里陪你慢慢来:['One step at a time, together.','一緒に、少しずつ。'],已保存在本机:['Saved on this device','この端末に保存済み'],通知采集尚未接入:['Notification capture is not connected yet','通知の収集は未実装です'],导出备份:['Export backup','バックアップを書き出す'],本机账目:['Entries on this device','この端末の記録']};
const locale=StudyTrailLocaleCore.create(StudyTrailMessages,()=>state.language);
window.I18n={locale:()=>state.language,t:s=>extra[s]?(state.language==='en'?extra[s][0]:state.language==='ja'?extra[s][1]:s):locale.t(s)};
const t=s=>I18n.t(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(s){$('toast').textContent=s;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').textContent='',3500);}
function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch(e){toast(t('保存失败，请保留当前页面并导出备份。'));throw e;}}
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
window.landing={isDesktop:false,data:{async saveLedger(json){
try{if(!Capacitor.isNativePlatform()){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([json],{type:'application/json'}));a.href=url;a.download='StudyTrail-ledger-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);return {ok:true};}
const f=await Filesystem.writeFile({path:'StudyTrail-ledger-'+Date.now()+'.json',data:json,directory:Directory.Cache,encoding:Encoding.UTF8});await Share.share({title:'StudyTrail',files:[f.uri]});return {ok:true};}catch(_){return {ok:false,error:t('导出失败，请重试。')};}
}}};
function closeSheet(){if($('sheet').open)$('sheet').close();}
Ledger.init({state:()=>state,save,render,toast,esc,today,uid:()=>crypto.randomUUID(),openSheet(html){$('sheet-body').innerHTML=html;if(!$('sheet').open)$('sheet').showModal();},closeSheet});
function render(){sprite?.dispose?.();sprite=null;document.documentElement.lang=state.language;$('language').value=state.language;
$('tabs').innerHTML=[['ledger','账本'],['partner','伙伴'],['me','我的']].map(([id,label])=>'<button data-tab="'+id+'"'+(tab===id?' aria-current="page"':'')+'>'+t(label)+'</button>').join('');
if(tab==='ledger')$('content').innerHTML=Ledger.render();
else if(tab==='partner'){$('content').innerHTML='<section class="card partner"><p class="kicker">'+t('伙伴')+'</p><h2>'+t('在这里陪你慢慢来')+'</h2><button id="pet" aria-label="'+t('摸摸初华')+'"><span id="sprite"></span></button><p id="reply">'+t('摸摸初华')+'</p></section>';sprite=PetdexSprite.mount($('sprite'),{});let last='';$('pet').onclick=()=>{const choices=['wave','pat','highfive','hug'].filter(x=>x!==last);last=choices[Math.floor(Math.random()*choices.length)];sprite.play(last,1.8);state.pats++;save();$('reply').textContent=t('在这里陪你慢慢来');};}
else{$('content').innerHTML='<p class="kicker">'+t('手机测试版')+' · 0.1.0</p><h2>'+t('我的')+'</h2><section class="card"><p>'+t('已保存在本机')+'</p><p>'+t('本机账目')+' · '+state.ledger.entries.length+'</p><button id="backup">'+t('导出备份')+'</button></section><section class="card"><p>'+t('通知采集尚未接入')+'</p></section>';$('backup').onclick=()=>LedgerExchange.backup();}}
$('tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(b){tab=b.dataset.tab;render();scrollTo(0,0);}};$('language').onchange=e=>{closeSheet();state.language=e.target.value;save();render();};$('sheet-close').onclick=closeSheet;render();
