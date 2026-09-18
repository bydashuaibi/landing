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
 *   tray.setHint(text)                                     把「现在在计什么」写到托盘悬停提示
 *   autoLaunch.get() / autoLaunch.set(bool)                开机自启开关
 *   closeChoice({choice,remember}) / closePromptOpened()    点 × 时的选择（托盘 / 退出 / 记住）
 *   closePref.get() / closePref.set(action)                关窗偏好：ask | tray | quit
 *   timerActive(bool)                                      计时中→关后台节流，保证到点准时
 *   nudge()                                                后台计时每 30 分钟把窗口叫回来
 *   weather.get()                                          今日天气（IP 定位 + Open-Meteo，主进程代取）
 *   jwgl.status() / captcha() / login() / schedule() / logout()   教务系统：登录 + 课表（主进程代取）
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
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),

  /* 天气：主进程代取——渲染进程受 CSP（connect-src 只放行 https）限制，连不了 http 的定位接口 */
  weather: {
    get: () => ipcRenderer.invoke('weather:get')
  },

  /* 教务系统（正方）：学校开着验证码，所以先 captcha() 让他填、再 login()。
     凭据由主进程用 safeStorage 加密存盘，渲染进程拿不到已保存的密码。 */
  jwgl: {
    status: () => ipcRenderer.invoke('jwgl:status'),
    captcha: () => ipcRenderer.invoke('jwgl:captcha'),
    login: (payload) => ipcRenderer.invoke('jwgl:login', {
      username: payload && payload.username,
      password: payload && payload.password,
      captcha: payload && payload.captcha,
      remember: !(payload && payload.remember === false)
    }),
    schedule: (force) => ipcRenderer.invoke('jwgl:schedule', { force: !!force }),
    logout: () => ipcRenderer.invoke('jwgl:logout')
  },

  tray: {
    setHint: (text) => ipcRenderer.send('tray:hint', String(text || ''))
  },
  autoLaunch: {
    get: () => ipcRenderer.invoke('app:getAutoLaunch'),
    set: (on) => ipcRenderer.invoke('app:setAutoLaunch', !!on)
  },
  /* 点 × 时的选择：最小化到托盘 / 彻底退出（可选「记住我的选择」） */
  closeChoice: (payload) => ipcRenderer.send('close:choice', {
    choice: payload && payload.choice,
    remember: !!(payload && payload.remember)
  }),
  closePromptOpened: () => ipcRenderer.send('close:prompt-opened'),
  closePref: {
    get: () => ipcRenderer.invoke('close:getPref'),
    set: (action) => ipcRenderer.invoke('close:setPref', action)
  },
  timerActive: (on) => ipcRenderer.send('timer:active', !!on),
  /* 后台计时时把窗口叫回来（主进程会先确认窗口确实不可见，不会抢焦点） */
  nudge: () => ipcRenderer.send('window:nudge'),
  /* 叫回来之后没人理 → 让它自己缩回托盘 */
  retract: () => ipcRenderer.send('window:retract')
});
