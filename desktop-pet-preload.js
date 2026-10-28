const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petdesk',{
  ready:()=>ipcRenderer.invoke('petdesk:ready'),
  status:()=>ipcRenderer.invoke('petdesk:status'),
  settings:()=>ipcRenderer.invoke('petdesk:settings'),
  panel:open=>ipcRenderer.send('petdesk:panel',!!open),
  onPreferences:cb=>ipcRenderer.on('petdesk:preferences',(_e,p)=>cb(p)),
  command:p=>ipcRenderer.invoke('petdesk:command',p),
  onState:cb=>ipcRenderer.on('petdesk:state',(_e,p)=>cb(p)),
  hit:on=>ipcRenderer.send('petdesk:hit',!!on),
  move:p=>ipcRenderer.send('petdesk:move',p),
  menu:()=>ipcRenderer.send('petdesk:menu'),
  hide:()=>ipcRenderer.send('petdesk:hide')
});

contextBridge.exposeInMainWorld('petSkins',{
  open:()=>ipcRenderer.invoke('skins:open'),state:()=>ipcRenderer.invoke('skins:state'),asset:id=>ipcRenderer.invoke('skins:asset',id),
  onActive:cb=>ipcRenderer.on('skins:active',(_e,p)=>cb(p))
});

contextBridge.exposeInMainWorld('studyTrailLocale',{get:()=>ipcRenderer.sendSync('language:get'),set:language=>ipcRenderer.invoke('language:set',language),onChange:cb=>ipcRenderer.on('language:changed',(_event,value)=>cb(value))});
