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
  desktopPet: {
    reveal: () => ipcRenderer.invoke('petdesk:reveal'),
    status: () => ipcRenderer.invoke('petdesk:status'),
    configure: (p) => ipcRenderer.invoke('petdesk:configure', p),
    publish: (p) => ipcRenderer.send('petdesk:publish', p),
    onCommand: (cb) => ipcRenderer.on('petdesk:command', (_e,p) => cb(p))
  },
  digest: {
    request: (payload) => ipcRenderer.invoke('digest:request', payload),
    configure: (payload) => ipcRenderer.invoke('digest:configure', payload)
  },
  learning: {
    displays: () => ipcRenderer.invoke('learning:displays'),
    capture: (displayId) => ipcRenderer.invoke('learning:capture', displayId)
  },

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
  retract: () => ipcRenderer.send('window:retract'),
  /* 活动感知 / 定时截屏：采集在主进程（规则表也在 main.js），这里只取快照、订阅、改设置 */
  activity: {
    get: () => ipcRenderer.invoke('activity:get'),
    week: (from, to) => ipcRenderer.invoke('activity:week', from, to),
    setPref: (patch) => ipcRenderer.invoke('activity:setPref', patch),
    openFolder: () => ipcRenderer.invoke('activity:openFolder'),
    clearShots: () => ipcRenderer.invoke('activity:clearShots'),
    onUpdate: (cb) => { ipcRenderer.on('activity:update', (_e, snap) => { try { cb(snap); } catch (e) { } }); },
    /* 换应用了（主进程按进程名变化判定）→ 渲染进程决定要不要弹「这是在做什么」并开始计时 */
    onAppChanged: (cb) => { ipcRenderer.on('activity:appChanged', (_e, inf) => { try { cb(inf); } catch (e) { } }); }
  },
  /* 桌面悬浮询问窗（2026-10-14）：窗口本身在主进程（它得浮在所有程序之上，
     页内弹卡他一转头就看不见）。渲染进程只决定「要不要问、预填什么名字」，
     答案从 ask:result 回来 —— 状态仍然全部留在渲染进程这边。 */
  ask: {
    show: (payload) => ipcRenderer.send('ask:show', payload || {}),
    hide: () => ipcRenderer.send('ask:hide'),
    onResult: (cb) => { ipcRenderer.on('ask:result', (_e, r) => { try { cb(r); } catch (e) { } }); }
  },
  /* 窗口可见性：以主进程为准（原因见 main.js）。
     winVisGet() 启动时同步查一次当前值；onWinVis(cb) 订阅 hide/show/minimize/restore 的变化 */
  winVisGet: () => ipcRenderer.sendSync('window:vis:get'),
  onWinVis: (cb) => { ipcRenderer.on('window:vis', (_e, v) => { try { cb(!!v); } catch (e) { } }); }
});
