'use strict';
const {app,BrowserWindow,ipcMain,screen,Menu}=require('electron');
const path=require('path');
module.exports=function setup({getMain,showMain,readPrefs,writePrefs}) {
  let win=null,quitting=false,snapshot={},saveTimer;
  const actions=new Set(['open','study','pause','resume','capture','settle','chat','pat','wave','hug','text','weekly']);
  const mainSender=e=>getMain()&&!getMain().isDestroyed()&&e.sender===getMain().webContents;
  const petSender=e=>win&&!win.isDestroyed()&&e.sender===win.webContents;
  const prefs=()=>Object.assign({enabled:true},readPrefs().desktopPet||{});
  function clamp(x,y){const area=screen.getDisplayNearestPoint({x:Math.round(x),y:Math.round(y)}).workArea,b=win&&!win.isDestroyed()?win.getBounds():{width:308,height:444};return {x:Math.round(Math.max(area.x+4,Math.min(area.x+Math.max(4,area.width-b.width-8),x))),y:Math.round(Math.max(area.y+4,Math.min(area.y+Math.max(4,area.height-b.height-8),y)))};}
  function status(){return {enabled:prefs().enabled!==false,visible:!!(win&&!win.isDestroyed()&&win.isVisible())};}
  function configure(patch){const next=prefs();if(typeof patch.enabled==='boolean')next.enabled=patch.enabled;writePrefs({desktopPet:next});if(next.enabled)create();else if(win&&!win.isDestroyed())win.hide();return status();}
  function command(raw){
    if(!raw||!actions.has(raw.action))return {ok:false};
    const main=getMain();if(!main||main.isDestroyed()||main.webContents.isLoadingMainFrame())return {ok:false};
    if(['open','capture','settle','chat','weekly'].includes(raw.action))showMain();
    main.webContents.send('petdesk:command',{action:raw.action,track:raw.track==='pytorch'?'pytorch':raw.track==='python'?'python':undefined,text:String(raw.text||'').slice(0,160)});return {ok:true};
  }
  function create(){
    if(win&&!win.isDestroyed()){win.showInactive();return;}
    const area=screen.getPrimaryDisplay().workArea,p=prefs(),pos=clamp(Number.isFinite(p.x)?p.x:area.x+area.width-324,Number.isFinite(p.y)?p.y:area.y+area.height-460);
    win=new BrowserWindow({...pos,width:304,height:440,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,resizable:false,show:false,title:'初华 · 着陆桌宠',webPreferences:{preload:path.join(__dirname,'desktop-pet-preload.js'),contextIsolation:true,nodeIntegration:false,spellcheck:false}});
    win.setAlwaysOnTop(true,'floating');win.setIgnoreMouseEvents(true,{forward:true});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.once('ready-to-show',()=>{if(prefs().enabled!==false)win.showInactive();});win.loadFile(path.join(__dirname,'desktop-pet.html'));
    win.on('close',e=>{if(!quitting){e.preventDefault();configure({enabled:false});}});
    win.on('closed',()=>{win=null;});
  }
  ipcMain.handle('petdesk:status',e=>mainSender(e)?status():null);
  ipcMain.handle('petdesk:reveal',e=>{if(mainSender(e)){showMain();return true;}return false;});
  ipcMain.handle('petdesk:configure',(e,p)=>mainSender(e)?configure(p||{}):null);
  ipcMain.on('petdesk:publish',(e,p)=>{if(!mainSender(e)||!p||typeof p!=='object')return; snapshot={name:String(p.name||'初华').slice(0,32),course:String(p.course||'Python').slice(0,60),track:p.track==='pytorch'?'pytorch':'python',clock:String(p.clock||'').slice(0,12),mode:['idle','focus','paused','done','sleep'].includes(p.mode)?p.mode:'idle',line:String(p.line||'').slice(0,240),gentle:!!p.gentle,sleeping:!!p.sleeping,motion:['wave','hug','pat','highfive','walk'].includes(p.motion)?p.motion:null,motionId:Number(p.motionId)||0};if(win&&!win.isDestroyed())win.webContents.send('petdesk:state',snapshot);});
  ipcMain.handle('petdesk:ready',e=>petSender(e)?snapshot:null);
  ipcMain.handle('petdesk:command',(e,p)=>petSender(e)?command(p):{ok:false});
  ipcMain.on('petdesk:hit',(e,on)=>{if(petSender(e))win.setIgnoreMouseEvents(!on,{forward:true});});
  ipcMain.on('petdesk:hide',e=>{if(petSender(e))configure({enabled:false});});
  ipcMain.on('petdesk:move',(e,delta)=>{if(!petSender(e)||!delta||!Number.isFinite(delta.x)||!Number.isFinite(delta.y))return;const b=win.getBounds(),p=clamp(b.x+Math.max(-1000,Math.min(1000,delta.x)),b.y+Math.max(-1000,Math.min(1000,delta.y)));win.setPosition(p.x,p.y);clearTimeout(saveTimer);saveTimer=setTimeout(()=>{writePrefs({desktopPet:Object.assign(prefs(),p)});},200);});
  ipcMain.on('petdesk:menu',e=>{if(!petSender(e))return;Menu.buildFromTemplate([{label:'打开着陆',click:()=>command({action:'open'})},{label:'开始学 Python · 5 分钟',click:()=>command({action:'study',track:'python'})},{label:'开始学 PyTorch · 5 分钟',click:()=>command({action:'study',track:'pytorch'})},{label:snapshot.mode==='paused'?'继续学习':'暂停学习',click:()=>command({action:snapshot.mode==='paused'?'resume':'pause'})},{label:'截屏记断点',click:()=>command({action:'capture'})},{label:'结束并记录',click:()=>command({action:'settle'})},{type:'separator'},{label:'隐藏桌宠（首页齿轮可叫回）',click:()=>configure({enabled:false})}]).popup({window:win});});
  app.on('before-quit',()=>{quitting=true;clearTimeout(saveTimer);});
  if(prefs().enabled!==false)create();
  return {getWindows:()=>win&&!win.isDestroyed()?[win]:[]};
};
