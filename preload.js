/* 着陆 preload —— 渲染进程与主进程之间唯一的通道。
 *
 * 原则：只暴露「具体能力」，不暴露 require / ipcRenderer 本身。
 * 渲染进程拿到的是几个写着明确用途的函数，拿不到任意 channel 的发送权，
 * 也拿不到 fs、path 这些 Node 模块。
 *
 * 暴露面（window.landing）：
 *   feed.list() / feed.post({body,nick}) / feed.clear()   本地树洞
 *   data.save({json}) / data.open()                        备份走系统文件对话框
 *   info()                                                 版本号 / 数据目录路径
 *   openDataDir()                                          在资源管理器里打开数据目录
 *   isDesktop = true                                       前端据此决定用哪套实现
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('landing', {
  isDesktop: true,

  feed: {
    list: () => ipcRenderer.invoke('feed:list'),
    post: (payload) => ipcRenderer.invoke('feed:post', {
      body: payload && payload.body,
      nick: payload && payload.nick
    }),
    clear: () => ipcRenderer.invoke('feed:clear')
  },

  data: {
    save: (json) => ipcRenderer.invoke('data:save', { json }),
    open: () => ipcRenderer.invoke('data:open')
  },

  info: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir')
});
