'use strict';
const path=require('path'),fs=require('fs');
module.exports=function autoLaunch(app,options={}) {
  const platform=options.platform||process.platform;
  function settings(){
    const portable=process.env.PORTABLE_EXECUTABLE_FILE;
    const executable=options.executable||(portable&&fs.existsSync(portable)?portable:process.execPath);
    const args=app.isPackaged?['--hidden']:['"'+path.resolve(app.getAppPath())+'"','--hidden'];
    return {path:executable,args,name:options.name||'com.landing.app'};
  }
  function get(){
    if(platform!=='win32'&&platform!=='darwin')throw new Error('此系统暂不支持在应用内设置开机自启');
    const config=settings(),value=app.getLoginItemSettings({path:config.path,args:config.args});
    if(platform==='win32'&&Array.isArray(value.launchItems)){
      const item=value.launchItems.find(i=>i.name===config.name&&i.scope==='user');
      if(item)return item.enabled!==false;
      return false;
    }
    return !!value.openAtLogin && value.executableWillLaunchAtLogin!==false;
  }
  function set(on){
    if(platform!=='win32'&&platform!=='darwin')throw new Error('此系统暂不支持在应用内设置开机自启');
    app.setLoginItemSettings({...settings(),openAtLogin:!!on,openAsHidden:true,enabled:!!on});
    const applied=get();
    if(applied!==!!on)throw new Error(on?'开机自启没有生效，请检查 Windows 设置 → 应用 → 启动中的着陆开关':'开机自启未能关闭，请稍后重试');
    return applied;
  }
  return {get,set,settings};
};
