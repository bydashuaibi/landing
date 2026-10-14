/* 桌面悬浮询问窗（ask.html）专用的 preload —— 只给它两件事：
   onData   收「问的是什么」
   resolve  把答案交回去
   和主窗口那份 preload 一样的原则：只暴露具体能力，不给 require / ipcRenderer。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('landingAsk', {
  onData: (cb) => { ipcRenderer.on('ask:data', (_e, d) => { try { cb(d); } catch (e) { } }); },
  /* 监听挂好之后喊一声，让主进程把"要问什么"再发一遍（第一条可能发得比监听还早） */
  ready: () => ipcRenderer.send('ask:ready'),
  resolve: (r) => ipcRenderer.send('ask:resolve', r || {}),
});
