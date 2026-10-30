'use strict';
// Native foreground sampling and an independent, non-focus-stealing reminder.
module.exports=function({app,BrowserWindow,ipcMain,screen,powerMonitor,desktopCapturer,path,I18n,mainWindow,sampleForeground}){
  let config=null,notice=null,message='',busy=false,wantsNotice=false;
  const owner=e=>mainWindow()&&!mainWindow().isDestroyed()&&e.sender===mainWindow().webContents;
  function hide(){wantsNotice=false;if(notice&&!notice.isDestroyed())notice.hide();}
  ipcMain.handle('focus:configure',(e,c)=>{if(!owner(e))return false;config=c&&typeof c.id==='string'?{id:c.id,vision:c.vision===true}:null;mainWindow().webContents.setBackgroundThrottling(!config);if(!config)hide();return true;});
  ipcMain.handle('focus:sample',async(e,capture)=>{
    if(!owner(e)||!config||busy)return null;busy=true;const id=config.id;
    try{
      if(powerMonitor.getSystemIdleState(120)==='locked')return {id,locked:true};
      const fg=await sampleForeground();if(!config||config.id!==id)return null;if(!fg)return {id,proc:'',title:''};
      const out={id,proc:fg.proc,title:fg.title,at:Date.now()};
      if(capture===true&&config.vision){
        const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1280,height:720}});
        const matching=sources.filter(s=>s.name===fg.title);
        const after=await sampleForeground();
        if(!after||after.proc!==fg.proc||after.title!==fg.title)return null;
        if(matching.length===1&&!matching[0].thumbnail.isEmpty())out.image='data:image/jpeg;base64,'+matching[0].thumbnail.toJPEG(65).toString('base64');
      }
      return config&&config.id===id?out:null;
    }catch(_){return {id,error:true};}finally{busy=false;}
  });
  ipcMain.handle('focus:remind',(e,reason)=>{
    if(!owner(e)||!config)return false;message=String(reason||'').slice(0,200);wantsNotice=true;
    if(!notice||notice.isDestroyed()){
      notice=new BrowserWindow({width:370,height:210,show:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,autoHideMenuBar:true,title:I18n.t('回到当前任务'),webPreferences:{preload:path.join(__dirname,'focus-notice-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
      notice.loadFile(path.join(__dirname,'focus-notice.html'));notice.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      notice.once('ready-to-show',()=>{if(config&&wantsNotice&&!notice.isDestroyed())notice.showInactive();});
      notice.on('close',e=>{if(config){e.preventDefault();notice.hide();}});
    }else notice.showInactive();
    const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;notice.setPosition(area.x+area.width-382,area.y+area.height-222);return true;
  });
  ipcMain.handle('focus:notice-data',e=>notice&&!notice.isDestroyed()&&e.sender===notice.webContents?{title:I18n.t('回到当前任务'),body:I18n.t('计时已暂停。回到相关内容后，系统会重新检测并继续计时。'),reason:I18n.t(message),button:I18n.t('知道了')}:null);
  ipcMain.on('focus:ack',e=>{if(notice&&!notice.isDestroyed()&&e.sender===notice.webContents)hide();});
  ipcMain.on('focus:hide',e=>{if(owner(e))hide();});
  app.on('before-quit',()=>{config=null;if(notice&&!notice.isDestroyed())notice.destroy();});
};
