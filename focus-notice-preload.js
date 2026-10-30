const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('focusNotice',{get:()=>ipcRenderer.invoke('focus:notice-data'),ack:()=>ipcRenderer.send('focus:ack'),onLanguage:fn=>ipcRenderer.on('language:changed',()=>fn())});
