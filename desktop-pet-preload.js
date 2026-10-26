const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petdesk',{
  ready:()=>ipcRenderer.invoke('petdesk:ready'),
  command:p=>ipcRenderer.invoke('petdesk:command',p),
  onState:cb=>ipcRenderer.on('petdesk:state',(_e,p)=>cb(p)),
  hit:on=>ipcRenderer.send('petdesk:hit',!!on),
  move:p=>ipcRenderer.send('petdesk:move',p),
  menu:()=>ipcRenderer.send('petdesk:menu'),
  hide:()=>ipcRenderer.send('petdesk:hide')
});
