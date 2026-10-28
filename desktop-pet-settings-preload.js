const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petSettings',{
  status:()=>ipcRenderer.invoke('petdesk:status'),
  configure:patch=>ipcRenderer.invoke('petdesk:configure',patch),
  reposition:()=>ipcRenderer.invoke('petdesk:reposition'),
  startup:()=>ipcRenderer.invoke('petdesk:startup'),
  setStartup:on=>ipcRenderer.invoke('petdesk:setStartup',!!on),
  closeBehavior:()=>ipcRenderer.invoke('petdesk:closeBehavior'),
  setCloseBehavior:value=>ipcRenderer.invoke('petdesk:setCloseBehavior',value),
  close:()=>ipcRenderer.send('petdesk:settingsClose'),
  onChange:cb=>ipcRenderer.on('petdesk:preferences',(_e,p)=>cb(p))
});
contextBridge.exposeInMainWorld('petSkins',{
  open:()=>ipcRenderer.invoke('skins:open'),state:()=>ipcRenderer.invoke('skins:state'),asset:id=>ipcRenderer.invoke('skins:asset',id),
  onActive:cb=>ipcRenderer.on('skins:active',(_e,p)=>cb(p))
});

contextBridge.exposeInMainWorld('studyTrailLocale',{get:()=>ipcRenderer.sendSync('language:get'),set:language=>ipcRenderer.invoke('language:set',language),onChange:cb=>ipcRenderer.on('language:changed',(_event,value)=>cb(value))});
