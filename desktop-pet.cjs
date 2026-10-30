'use strict';
const {app,BrowserWindow,ipcMain,screen,Menu,globalShortcut}=require('electron');
const path=require('path');
module.exports=function setup({getMain,showMain,readPrefs,writePrefs,openSkins,autoLaunch,closeBehavior,i18n:I18n}) {
  let win=null,settingsWin=null,quitting=false,snapshot={},saveTimer,hit=true,recoveryRegistered=false,lastError='',regions=[],dragging=false;
  const defaults={enabled:true,scale:1,opacity:1,lockDrag:false,clickThrough:false,hoverFade:false,alwaysOnTop:true,showTaskbar:false,showHints:true,panelOpen:false};
  const actions=new Set(['open','study','pause','resume','capture','settle','chat','pat','wave','hug','highfive','text','weekly','navigate','select','help','skins','playground']);
  const pages=new Set(['today','weekly','digest','companion','pet','shop','me']);
  const alive=w=>w&&!w.isDestroyed();
  const mainSender=e=>alive(getMain())&&e.sender===getMain().webContents;
  const petSender=e=>alive(win)&&e.sender===win.webContents;
  const settingsSender=e=>alive(settingsWin)&&e.sender===settingsWin.webContents;
  const owner=e=>mainSender(e)||settingsSender(e);
  function prefs(){const raw=readPrefs().desktopPet||{},p={};for(const [k,v] of Object.entries(defaults))p[k]=typeof v==='boolean'?(typeof raw[k]==='boolean'?raw[k]:v):Number.isFinite(raw[k])?Math.max(k==='scale'?.6:.25,Math.min(k==='scale'?1.6:1,raw[k])):v;for(const k of ['x','y'])if(Number.isFinite(raw[k]))p[k]=raw[k];return p;}
  function clamp(x,y,bounds){const a=screen.getDisplayNearestPoint({x:Math.round(x),y:Math.round(y)}).workArea,b=bounds||(alive(win)?win.getBounds():{width:340,height:596});return {x:Math.round(Math.max(a.x+4,Math.min(a.x+Math.max(4,a.width-b.width-8),x))),y:Math.round(Math.max(a.y+4,Math.min(a.y+Math.max(4,a.height-b.height-8),y)))};}
  function status(){return {enabled:prefs().enabled,visible:!!(alive(win)&&win.isVisible()),settings:prefs(),error:lastError};}
  function notify(){for(const w of [getMain(),win,settingsWin])if(alive(w))w.webContents.send('petdesk:preferences',status());}
  function persistPosition(){clearTimeout(saveTimer);if(!alive(win))return;const b=win.getBounds();writePrefs({desktopPet:Object.assign({},readPrefs().desktopPet||{},prefs(),{x:b.x,y:b.y})});}
  function recover(){lastError='';return configure({enabled:true,clickThrough:false});}
  function shortcut(on){
    if(on&&!recoveryRegistered){if(!globalShortcut.register('F7',()=>recover()))throw Error(I18n.t('F7 已被其他程序占用，暂时不能开启鼠标穿透。可关闭占用后重试。'));recoveryRegistered=true;}
    if(!on&&recoveryRegistered){globalShortcut.unregister('F7');recoveryRegistered=false;}
  }
  function inputMode(){if(alive(win))win.setIgnoreMouseEvents(prefs().clickThrough||!hit,{forward:true});}
  // Forwarded mousemove can be lost after reload or movement. Recover from native cursor coordinates.
  function refreshHit(){
    if(!alive(win)||!win.isVisible()||!regions.length)return;
    const cursor=screen.getCursorScreenPoint(),b=win.getBounds(),z=win.webContents.getZoomFactor(),x=(cursor.x-b.x)/z,y=(cursor.y-b.y)/z;
    const next=dragging||regions.some(r=>x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height);
    if(next!==hit){hit=next;inputMode();}
  }
  const hitWatch=setInterval(refreshHit,150);
  function applyWindow(){
    if(!alive(win))return;const p=prefs(),b=win.getBounds(),a=screen.getDisplayMatching(b).workArea;
    const size={width:Math.min(340,a.width-16),height:Math.min(Math.round(596+163*(p.scale-1)),a.height-16)};
    const position=clamp(b.x,b.y+b.height-size.height,size);win.setBounds({...position,...size});
    win.setAlwaysOnTop(p.alwaysOnTop,'floating');win.setSkipTaskbar(!p.showTaskbar);inputMode();
  }
  function configure(patch){
    const next=prefs();patch=patch&&typeof patch==='object'?patch:{};
    for(const [k,v] of Object.entries(defaults)){
      if(typeof v==='boolean'&&typeof patch[k]==='boolean')next[k]=patch[k];
      else if(typeof v==='number'&&Number.isFinite(patch[k]))next[k]=Math.max(k==='scale'?.6:.25,Math.min(k==='scale'?1.6:1,patch[k]));
    }
    if(!next.enabled)next.clickThrough=false;
    if(next.clickThrough)next.panelOpen=false;
    if(!next.enabled||next.clickThrough)dragging=false;
    try{shortcut(next.enabled&&next.clickThrough);}catch(e){lastError=e.message;notify();throw e;}
    lastError='';clearTimeout(saveTimer);writePrefs({desktopPet:Object.assign({},readPrefs().desktopPet||{},next)});
    if(next.enabled){create();applyWindow();}else if(alive(win))win.hide();notify();return status();
  }
  function reposition(){recover();const a=screen.getPrimaryDisplay().workArea,b=win.getBounds(),p=clamp(a.x+a.width-b.width-20,a.y+a.height-b.height-20);win.setPosition(p.x,p.y);persistPosition();notify();return status();}
  function setPanel(open){configure({panelOpen:!!open});}
  function command(raw){
    if(!raw||!actions.has(raw.action))return {ok:false};
    if(raw.action==='skins'){if(openSkins)openSkins();return {ok:true};}
    const main=getMain();if(!alive(main)||main.webContents.isLoadingMainFrame())return {ok:false};
    if(raw.action==='navigate'&&!pages.has(raw.page))return {ok:false};
    if(raw.action==='select'&&!['python','pytorch'].includes(raw.track))return {ok:false};
    if(['open','capture','settle','chat','weekly','navigate','select','playground'].includes(raw.action))showMain();
    main.webContents.send('petdesk:command',{action:raw.action,page:pages.has(raw.page)?raw.page:undefined,track:raw.track==='pytorch'?'pytorch':raw.track==='python'?'python':undefined,text:String(raw.text||'').slice(0,160)});return {ok:true};
  }
  function create(){
    if(alive(win)){const b=win.getBounds(),p=clamp(b.x,b.y);win.setPosition(p.x,p.y);win.showInactive();return;}
    const area=screen.getPrimaryDisplay().workArea,p=prefs(),size={width:Math.min(340,area.width-16),height:Math.min(Math.round(596+163*(p.scale-1)),area.height-16)},pos=clamp(Number.isFinite(p.x)?p.x:area.x+area.width-size.width-20,Number.isFinite(p.y)?p.y:area.y+area.height-size.height-20,size);
    win=new BrowserWindow({...pos,...size,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:p.alwaysOnTop,skipTaskbar:!p.showTaskbar,resizable:false,show:false,title:I18n.t('初华 · 着陆桌宠'),webPreferences:{preload:path.join(__dirname,'desktop-pet-preload.js'),contextIsolation:true,nodeIntegration:false,spellcheck:false}});
    win.setAlwaysOnTop(p.alwaysOnTop,'floating');inputMode();
    win.webContents.on('did-start-loading',()=>{regions=[];dragging=false;hit=true;inputMode();});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==win.webContents.getURL())e.preventDefault();});
    win.once('ready-to-show',()=>{if(prefs().enabled)win.showInactive();notify();});win.loadFile(path.join(__dirname,'desktop-pet.html'));
    win.on('close',e=>{if(!quitting){e.preventDefault();setPanel(false);}});win.on('closed',()=>{win=null;});
    win.on('move',()=>{clearTimeout(saveTimer);saveTimer=setTimeout(persistPosition,200);});
    win.on('show',notify);win.on('hide',notify);
  }
  function openSettings(){
    if(alive(settingsWin)){if(settingsWin.isMinimized())settingsWin.restore();settingsWin.show();settingsWin.focus();notify();return true;}
    settingsWin=new BrowserWindow({width:980,height:740,minWidth:740,minHeight:560,title:I18n.t('桌宠设置 · 着陆'),backgroundColor:'#cbcfb8',show:false,webPreferences:{preload:path.join(__dirname,'desktop-pet-settings-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    settingsWin.webContents.setWindowOpenHandler(()=>({action:'deny'}));settingsWin.webContents.on('will-navigate',(e,url)=>{if(url!==settingsWin.webContents.getURL())e.preventDefault();});
    settingsWin.once('ready-to-show',()=>settingsWin.show());settingsWin.on('closed',()=>{settingsWin=null;});settingsWin.loadFile(path.join(__dirname,'desktop-pet-settings.html'));return true;
  }
  function menuConfigure(p){try{configure(p);}catch(e){lastError=e.message;openSettings();notify();}}
  function contextMenu(){const p=prefs();return Menu.buildFromTemplate([
    {label:I18n.t('桌宠设置…'),click:openSettings},{label:p.panelOpen?I18n.t('收起对话（角色保留）'):I18n.t('和伙伴说话'),click:()=>setPanel(!p.panelOpen)},
    {label:I18n.t('更换皮肤 · Petdex'),click:()=>openSkins&&openSkins()},{label:I18n.t('和伙伴玩一会'),click:()=>command({action:'playground'})},{type:'separator'},
    {label:I18n.t('锁定位置'),type:'checkbox',checked:p.lockDrag,click:i=>menuConfigure({lockDrag:i.checked})},
    {label:I18n.t('游戏模式 / 鼠标穿透（F7 恢复）'),type:'checkbox',checked:p.clickThrough,click:i=>menuConfigure({clickThrough:i.checked})},
    {label:I18n.t('找回桌宠并恢复互动'),click:reposition},{type:'separator'},
    {label:I18n.t('打开着陆'),click:()=>command({action:'open'})},{label:I18n.t('开始学 Python · 5 分钟'),click:()=>command({action:'study',track:'python'})},{label:I18n.t('开始学 PyTorch · 5 分钟'),click:()=>command({action:'study',track:'pytorch'})},
    {label:snapshot.mode==='paused'?I18n.t('继续学习'):I18n.t('暂停学习'),click:()=>command({action:snapshot.mode==='paused'?'resume':'pause'})},{label:I18n.t('截屏记断点'),click:()=>command({action:'capture'})},{label:I18n.t('结束并记录'),click:()=>command({action:'settle'})},
    {type:'separator'},{label:I18n.t('隐藏整个桌宠（托盘或首页可叫回）'),click:()=>configure({enabled:false})}
  ]);}
  ipcMain.handle('petdesk:status',e=>(owner(e)||petSender(e))?status():null);
  ipcMain.handle('petdesk:reveal',e=>{if(mainSender(e)){showMain();return true;}return false;});
  ipcMain.handle('petdesk:configure',(e,p)=>owner(e)?configure(p):null);
  ipcMain.handle('petdesk:settings',e=>(owner(e)||petSender(e))?openSettings():false);
  ipcMain.handle('petdesk:reposition',e=>owner(e)?reposition():null);
  ipcMain.handle('petdesk:startup',e=>settingsSender(e)&&autoLaunch?autoLaunch.get():null);
  ipcMain.handle('petdesk:setStartup',(e,on)=>settingsSender(e)&&autoLaunch?autoLaunch.set(!!on):null);
  ipcMain.handle('petdesk:closeBehavior',e=>settingsSender(e)&&closeBehavior?closeBehavior.get():null);
  ipcMain.handle('petdesk:setCloseBehavior',(e,value)=>{if(!settingsSender(e)||!closeBehavior||!['tray','ask','quit'].includes(value))return null;closeBehavior.set(value);return closeBehavior.get();});
  ipcMain.on('petdesk:panel',(e,on)=>{if(petSender(e))setPanel(on);});
  ipcMain.on('petdesk:settingsClose',e=>{if(settingsSender(e))settingsWin.close();});
  ipcMain.on('petdesk:publish',(e,p)=>{if(!mainSender(e)||!p||typeof p!=='object')return; snapshot={name:String(p.name||I18n.t('初华')).slice(0,32),course:String(p.course||'Python').slice(0,60),track:p.track==='pytorch'?'pytorch':'python',clock:String(p.clock||'').slice(0,12),mode:['idle','focus','paused','done','sleep'].includes(p.mode)?p.mode:'idle',line:String(p.line||'').slice(0,240),reply:String(p.reply||'').slice(0,240),replyId:Number(p.replyId)||0,gear:{head:['crown','ribbon','beret','headphones','starclip'].includes(p.gear?.head)?p.gear.head:null,face:p.gear?.face==='glasses'?'glasses':null,neck:p.gear?.neck==='scarf'?'scarf':null},studyMode:!!p.studyMode,gentle:!!p.gentle,sleeping:!!p.sleeping,motion:['wave','hug','pat','highfive','walk','music','camera','sketch','laser','hop'].includes(p.motion)?p.motion:null,motionId:Number(p.motionId)||0};if(win&&!win.isDestroyed())win.webContents.send('petdesk:state',snapshot);});

  ipcMain.handle('petdesk:ready',e=>petSender(e)?snapshot:null);
  ipcMain.handle('petdesk:command',(e,p)=>petSender(e)&&!prefs().clickThrough?command(p):{ok:false});
  ipcMain.on('petdesk:hit',(e,on)=>{if(petSender(e)){hit=!!on;inputMode();}});
  ipcMain.on('petdesk:regions',(e,list)=>{if(!petSender(e)||!Array.isArray(list))return;regions=list.slice(0,3).filter(r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0).map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}));refreshHit();});
  ipcMain.on('petdesk:drag',(e,on)=>{if(petSender(e)){dragging=!!on&&!prefs().clickThrough;if(dragging){hit=true;inputMode();}else refreshHit();}});
  ipcMain.on('petdesk:hide',e=>{if(petSender(e))configure({enabled:false});});
  ipcMain.on('petdesk:move',(e,delta)=>{if(!petSender(e)||prefs().lockDrag||prefs().clickThrough||!delta||!Number.isFinite(delta.x)||!Number.isFinite(delta.y))return;const b=win.getBounds(),p=clamp(b.x+Math.max(-1000,Math.min(1000,delta.x)),b.y+Math.max(-1000,Math.min(1000,delta.y)));win.setPosition(p.x,p.y);});
  ipcMain.on('petdesk:menu',e=>{if(petSender(e)&&!prefs().clickThrough)contextMenu().popup({window:win});});
  app.on('before-quit',()=>{quitting=true;clearInterval(hitWatch);persistPosition();shortcut(false);});
  try{shortcut(prefs().enabled&&prefs().clickThrough);}catch(e){lastError=e.message;writePrefs({desktopPet:Object.assign({},readPrefs().desktopPet||{},prefs(),{clickThrough:false})});}
  if(prefs().enabled)create();
  function reveal(){if(prefs().enabled)create();}
  getMain().on('show',reveal);getMain().on('restore',reveal);
  return {getWindows:()=>[win,settingsWin].filter(alive),reveal,show:recover,status,openSettings};
};
