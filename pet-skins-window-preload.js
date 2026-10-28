const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petSkins',{
  state:()=>ipcRenderer.invoke('skins:state'),asset:id=>ipcRenderer.invoke('skins:asset',id),
  onActive:cb=>ipcRenderer.on('skins:active',(_e,p)=>cb(p))
});
contextBridge.exposeInMainWorld('skinManager',{
  showDesktop:()=>ipcRenderer.invoke('skins:desktop'),
  apply:id=>ipcRenderer.invoke('skins:apply',id),mode:m=>ipcRenderer.invoke('skins:mode',m),
  browse:url=>ipcRenderer.invoke('skins:browse',url),download:url=>ipcRenderer.invoke('skins:download',url),
  import:()=>ipcRenderer.invoke('skins:import'),external:()=>ipcRenderer.invoke('skins:external'),
  onState:cb=>ipcRenderer.on('skins:state',(_e,p)=>cb(p))
});

contextBridge.exposeInMainWorld('studyTrailLocale',{get:()=>ipcRenderer.sendSync('language:get'),set:language=>ipcRenderer.invoke('language:set',language),onChange:cb=>ipcRenderer.on('language:changed',(_event,value)=>cb(value))});
