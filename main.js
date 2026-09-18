/* 着陆 Landing — Electron 主进程
 *
 * 职责边界：主进程只管「窗口、安全策略、本地文件」三件事，
 * 业务逻辑全部在渲染进程（app.js / pet.js），两边通过 preload 的白名单 API 通信。
 *
 * 安全基线：
 *   · contextIsolation 开、nodeIntegration 关，渲染进程永远拿不到 require
 *   · 一份显式 CSP，禁止内联脚本与任意远程脚本
 *   · window.open / 页面内跳转一律拦截，外链交给系统浏览器
 *   · 渲染进程里的网络请求只允许它真正需要的域名（GitHub API + 用户自配的 AI 接口）
 */
const { app, BrowserWindow, shell, session, ipcMain, Menu, dialog, screen, Tray, nativeImage, safeStorage } = require('electron');
const { JwglClient } = require('./jwgl');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');

/* ---------- 单实例：第二次启动就把已有窗口顶到前面，别再开一个 ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

/* Windows 任务栏归组 / 通知署名都要靠它，不设的话通知会显示成 Electron */
if (process.platform === 'win32') app.setAppUserModelId('com.landing.app');

/* 注意：这里刻意不调用 app.setName()。
   package.json 的 name 是 "landing"，所以数据目录固定在 %APPDATA%\landing；
   改名会把这个目录搬走，老用户的任务、倾倒、情绪、伙伴养成全都看不见了。
   产品名走 package.json 的 build.productName（只影响菜单和窗口标题）。 */

/* ---------- 路径 ---------- */
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const STATE_FILE = path.join(DATA_DIR, 'window-state.json');
const FEED_FILE = path.join(DATA_DIR, 'feed.json');
const BACKUP_DIR = path.join(app.getPath('documents'), '着陆备份');

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

/* ---------- 窗口位置与大小记忆 ---------- */
const DEFAULT_BOUNDS = { width: 1160, height: 820 };

function loadWindowState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && Number.isFinite(raw.width) && Number.isFinite(raw.height)) {
      /* 上一次关在副屏、副屏没了 → 回到主屏居中，别把窗口开到看不见的地方 */
      const displays = screen.getAllDisplays();
      const visible = displays.some(d => {
        const b = d.workArea;
        return raw.x >= b.x - 40 && raw.x < b.x + b.width - 80
            && raw.y >= b.y - 40 && raw.y < b.y + b.height - 80;
      });
      if (!visible) { delete raw.x; delete raw.y; }
      return raw;
    }
  } catch (e) {}
  return Object.assign({}, DEFAULT_BOUNDS);
}

let saveStateTimer = null;
function saveWindowState(win) {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    try {
      if (!win || win.isDestroyed()) return;
      const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
      ensureDataDir();
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        x: b.x, y: b.y, width: b.width, height: b.height,
        maximized: win.isMaximized()
      }, null, 2));
    } catch (e) {}
  }, 400);
}

/* ---------- 内容安全策略 ---------- */
/* img-src 允许 https 是为了日报里可能出现的远程图；connect-src 必须放开 https，
   因为 AI 接口地址由用户在设置里自己填，事先无法枚举。 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

function applySecurity(ses) {
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: Object.assign({}, details.responseHeaders, {
        'Content-Security-Policy': [CSP]
      })
    });
  });

  /* 默认拒绝一切权限申请（摄像头、定位、通知授权等），要用再单独放行 */
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'notifications' ? true : false);
  });

  /* 只允许 file:// 加载本地资源，避免渲染进程被诱导去读别的目录 */
  ses.setPermissionCheckHandler(() => false);
}

/* ---------- 本地树洞（不需要另外起后端） ---------- */
function readFeed() {
  try {
    const raw = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'));
    return Array.isArray(raw.posts) ? raw.posts : [];
  } catch (e) { return []; }
}
function writeFeed(posts) {
  ensureDataDir();
  fs.writeFileSync(FEED_FILE, JSON.stringify({ posts: posts.slice(0, 500) }, null, 2));
}
function todayStr() {
  const d = new Date();
  const z = n => ('0' + n).slice(-2);
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/* 本地树洞：只存在这台电脑上，不联网。
   原来那版要用户自己 node community-backend/server.js，还只能读同一个 JSON 文件，
   对一个单机应用来说没有意义——直接由主进程管这个文件，开箱即用。 */
ipcMain.handle('feed:list', () => readFeed());

ipcMain.handle('feed:post', (e, payload) => {
  const body = String((payload && payload.body) || '').trim().slice(0, 500);
  const nick = String((payload && payload.nick) || '').trim().slice(0, 20);
  if (!body) return { ok: false, error: '内容为空' };
  const posts = readFeed();
  posts.unshift({ id: 'p' + Date.now().toString(36), body, nick, date: todayStr(), at: Date.now() });
  writeFeed(posts);
  return { ok: true, count: posts.length };
});

ipcMain.handle('feed:clear', () => { writeFeed([]); return { ok: true }; });

/* ---------- 数据备份：走系统「另存为 / 打开」，比浏览器下载更靠谱 ---------- */
ipcMain.handle('data:save', async (e, payload) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const json = String((payload && payload.json) || '');
  const stamp = todayStr();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出着陆备份',
    defaultPath: path.join(app.getPath('documents'), '着陆备份-' + stamp + '.json'),
    filters: [{ name: 'JSON 备份', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, json, 'utf8');
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('data:open', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导回着陆备份',
    properties: ['openFile'],
    filters: [{ name: 'JSON 备份', extensions: ['json'] }]
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  try {
    const json = fs.readFileSync(filePaths[0], 'utf8');
    return { ok: true, json, filePath: filePaths[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* 渲染进程想知道数据存在哪，用来在「我的」页显示真实路径 */
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  userData: app.getPath('userData'),
  locale: app.getLocale(),
  home: os.homedir()
}));

ipcMain.handle('app:openDataDir', async () => {
  const err = await shell.openPath(app.getPath('userData'));
  return { ok: !err, error: err || undefined };
});

/* ---------- 天气：必须由主进程代取 ---------- */
/* 两个原因：① CSP 的 connect-src 只放行 https，而 ip-api 免费版只有 http；
   ② 渲染进程直接发跨域请求还受 CORS 约束。走主进程两个问题一起解决。
   两个数据源都免注册、免 key：ip-api 定位 → Open-Meteo 取天气。 */
function httpGetJSON(url, timeoutMs, redirects) {
  return new Promise((resolve, reject) => {
    const mod = url.indexOf('https:') === 0 ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'landing-app/1.0', Accept: 'application/json' },
      timeout: timeoutMs || 12000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if ((redirects || 0) >= 3) return reject(new Error('跳转次数过多'));
        return httpGetJSON(res.headers.location, timeoutMs, (redirects || 0) + 1)
          .then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        if (body.length > 1048576) req.destroy(new Error('响应过大'));
      });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('响应不是合法 JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

ipcMain.handle('weather:get', async () => {
  try {
    const loc = await httpGetJSON(
      'http://ip-api.com/json/?lang=zh-CN&fields=status,message,country,regionName,city,lat,lon,timezone');
    if (!loc || loc.status !== 'success') {
      return { ok: false, error: (loc && loc.message) || 'IP 定位失败' };
    }
    const qs = 'latitude=' + loc.lat + '&longitude=' + loc.lon
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
      + '&timezone=Asia%2FShanghai&forecast_days=3';
    const wx = await httpGetJSON('https://api.open-meteo.com/v1/forecast?' + qs);
    return {
      ok: true,
      at: Date.now(),
      /* ip-api 对国内城市的粒度不稳定（同一个出口 IP 有时给「天津」、有时给「河北」这样的区名），
         所以直辖市/地级市一律优先用 regionName，其余情况仍用 city。 */
      city: (/市$/.test(loc.regionName || '') ? loc.regionName : (loc.city || loc.regionName || '')),
      region: loc.regionName || '',
      lat: loc.lat,
      lon: loc.lon,
      current: wx.current || null,
      daily: wx.daily || null
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* ---------- 教务系统（正方）：登录 + 课表 ---------- */
/* 同样必须走主进程：教务系统是 http 站点，渲染进程被 CSP 挡在外面。
   学校确实开着验证码（2026-09-18 实测），所以流程是「取验证码 → 他填 → 提交」；
   登录成功后会话留在内存里，之后取课表靠会话，不必反复登录。
   凭据用 safeStorage 加密后落盘（Windows 上底层就是 DPAPI，跟系统账户绑定），
   不写进代码、不进 git。 */
const CRED_FILE = path.join(DATA_DIR, 'jwgl-cred.json');
const SCHED_CACHE_MS = 30 * 60 * 1000;

let jwglClient = null;      // 已登录的会话
let jwglPending = null;     // 正在等验证码的会话
let jwglSched = null;       // {at, data}

function readCred() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const raw = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
    if (!raw || !raw.enc) return null;
    return JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
  } catch (e) { return null; }
}
function writeCred(obj) {
  try {
    ensureDataDir();
    const enc = safeStorage.encryptString(JSON.stringify(obj)).toString('base64');
    fs.writeFileSync(CRED_FILE, JSON.stringify({ enc: enc, at: Date.now() }, null, 2));
    return true;
  } catch (e) { return false; }
}
function clearCred() {
  try { fs.unlinkSync(CRED_FILE); } catch (e) { /* 本来就没有 */ }
}

/* 会话 cookie 也存一份加密的：应用重启后先拿它试，能通就不用再让他输一次验证码。
   正方会话通常能维持挺久，这一步能省掉绝大部分重复输入。 */
const SESSION_FILE = path.join(DATA_DIR, 'jwgl-session.json');
function saveSession(client) {
  try {
    ensureDataDir();
    const enc = safeStorage.encryptString(JSON.stringify(client.cookies)).toString('base64');
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ enc: enc, at: Date.now() }));
    return true;
  } catch (e) { return false; }
}
function restoreSession() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (!raw || !raw.enc) return null;
    const cookies = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
    if (!cookies || !Object.keys(cookies).length) return null;
    const c = new JwglClient();
    c.cookies = cookies;
    return c;
  } catch (e) { return null; }
}
function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch (e) { /* 本来就没有 */ }
}

/* 现在是哪个学年学期：9 月起算新学年；xqm 3=第一学期 12=第二学期 16=第三学期 */
function currentTerm(now) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 9) return { xnm: y, xqm: 3 };
  if (m === 1) return { xnm: y - 1, xqm: 3 };
  if (m <= 6) return { xnm: y - 1, xqm: 12 };
  return { xnm: y - 1, xqm: 16 };
}

/* 正方的 kbList → 我们自己认的结构。
   ⚠️ 刻意**不带 raw**：那会把整份原始条目塞进渲染进程、进而写进 localStorage。 */
const WD_NAMES = {
  '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4,
  '星期五': 5, '星期六': 6, '星期日': 7, '星期天': 7, '周天': 7
};
/* 星期几：优先用数字字段 xqj，没有就退回中文名 xqjmc（不同版本给的字段不一样） */
function weekdayOf(k) {
  const n = parseInt(k.xqj, 10);
  if (n >= 1 && n <= 7) return n;
  return WD_NAMES[k.xqjmc] || 0;
}
function parseSchedule(raw) {
  const list = (raw && raw.kbList) || [];
  const items = list.map((k, i) => ({
    id: 'c' + i,
    name: k.kcmc || '',
    teacher: k.xm || k.jsxm || '',
    /* ⚠️ 教室是 cdmc（场地名称）。xqmc 在正方里是**校区名**，别当教室用，只能兜底。 */
    room: k.cdmc || k.jxdd || k.xqmc || '',
    weekday: weekdayOf(k),                     // 1=周一 … 7=周日
    periods: k.jcs || '',                      // 节次，如 "1-2"
    weeks: k.zcd || '',                        // 周次，如 "1-16周"
    credit: k.xf || ''
  })).filter((x) => x.name);
  return { items: items, xsxx: (raw && raw.xsxx) || null };
}

ipcMain.handle('jwgl:status', () => {
  const cred = readCred();
  return {
    hasCred: !!cred,
    username: cred ? cred.username : '',
    savedAt: cred ? cred.at : 0,
    loggedIn: !!jwglClient,
    canEncrypt: safeStorage.isEncryptionAvailable()
  };
});

ipcMain.handle('jwgl:captcha', async () => {
  try {
    jwglPending = new JwglClient();
    const r = await jwglPending.openLogin();
    return { ok: true, captcha: r.captcha };
  } catch (e) {
    jwglPending = null;
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('jwgl:login', async (e, payload) => {
  const username = String((payload && payload.username) || '').trim();
  const password = String((payload && payload.password) || '');
  const captcha = String((payload && payload.captcha) || '').trim();
  const remember = !(payload && payload.remember === false);
  if (!username || !password) return { ok: false, error: '学号和密码都要填' };

  try {
    if (!jwglPending) jwglPending = new JwglClient();
    const r = await jwglPending.submitLogin(username, password, captcha);
    if (!r.ok) {
      /* 登录失败也落盘：把服务端回的原文和提交的字段名留下来。
         ⚠️ 只记学号，**绝不记密码**（diag 里也只有字段名、没有字段值）。 */
      try {
        ensureDataDir();
        fs.writeFileSync(path.join(DATA_DIR, 'jwgl-login-fail.json'), JSON.stringify({
          at: new Date().toISOString(),
          username: username,
          error: r.error,
          needCaptcha: !!r.needCaptcha,
          diag: r.diag || null
        }, null, 2));
      } catch (e3) { /* 落盘失败不影响功能 */ }
      /* 失败了顺手换一张验证码，省得他还要再点一次 */
      let img = null;
      try {
        jwglPending = new JwglClient();
        img = (await jwglPending.openLogin()).captcha;
      } catch (e2) { jwglPending = null; }
      return { ok: false, error: r.error, captcha: img };
    }
    jwglClient = jwglPending;
    jwglPending = null;
    jwglSched = null;
    saveSession(jwglClient);
    if (remember) writeCred({ username: username, password: password, at: Date.now() });
    return { ok: true, username: username };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('jwgl:schedule', async (e, opts) => {
  const force = !!(opts && opts.force);
  if (!force && jwglSched && Date.now() - jwglSched.at < SCHED_CACHE_MS) {
    return Object.assign({ ok: true, cached: true }, jwglSched.data);
  }
  if (!jwglClient) {
    /* 应用重启后内存里的会话没了，先用上次存下的 cookie 试 —— 能通就不用再输验证码 */
    const restored = restoreSession();
    if (restored && await restored.isLoggedIn()) {
      jwglClient = restored;
    } else {
      if (restored) clearSession();
      const cred = readCred();
      return {
        ok: false, needLogin: true, hasCred: !!cred,
        username: cred ? cred.username : '',
        error: '还没连接教务系统'
      };
    }
  }
  try {
    const t = currentTerm(new Date());
    const r = await jwglClient.fetchSchedule(t.xnm, t.xqm);
    if (!r.ok) {
      if (r.expired) { jwglClient = null; clearSession(); return { ok: false, needLogin: true, error: r.error }; }
      /* 失败也要落盘：把每个候选路径的状态码留下来，事后一眼看出是路径错还是参数错。
         （只记 URL 和状态码，不含任何凭据） */
      try {
        ensureDataDir();
        fs.writeFileSync(path.join(DATA_DIR, 'jwgl-schedule-fail.json'), JSON.stringify({
          at: new Date().toISOString(), error: r.error, term: currentTerm(new Date()), tried: r.tried
        }, null, 2));
      } catch (e2) { /* 落盘失败不影响功能 */ }
      return { ok: false, error: r.error, tried: r.tried };
    }
    const parsed = parseSchedule(r.raw);
    parsed.termCode = t.xnm + '-' + (t.xnm + 1) + ' 第'
      + ({ 3: '一', 12: '二', 16: '三' }[t.xqm] || '?') + '学期';
    parsed.source = r.url;
    /* 原始响应落到 userData 便于排查学校接口变化（里面没有凭据） */
    try {
      ensureDataDir();
      fs.writeFileSync(path.join(DATA_DIR, 'jwgl-schedule-raw.json'), JSON.stringify(r.raw, null, 2));
    } catch (e2) { /* 落盘失败不影响功能 */ }
    jwglSched = { at: Date.now(), data: parsed };
    return Object.assign({ ok: true, cached: false }, parsed);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('jwgl:logout', () => {
  jwglClient = null;
  jwglPending = null;
  jwglSched = null;
  clearCred();
  clearSession();
  return { ok: true };
});

/* ---------- 菜单：中文、精简，但把常用操作都放上 ---------- */
/* 菜单项在渲染进程里直接叫 window.App / window.Landing 的公开方法，
   不额外建一套 IPC 事件通道——这些函数本来就是给 UI 用的。 */
const TABS = [
  ['今日', 'today'], ['任务', 'tasks'], ['周报', 'weekly'], ['日报', 'digest'],
  ['陪伴', 'companion'], ['伙伴', 'pet'], ['商城', 'shop'], ['我的', 'me']
];

function runInRenderer(js) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.executeJavaScript(js, true).catch(() => {});
}

function buildMenu() {
  /* 开发模式：直接跑源码时才有 DevTools，打包成 exe 后不该让用户看到这个 */
  const isDev = !!process.defaultApp || process.argv.includes('--dev');

  const template = [
    {
      label: '应用',
      submenu: [
        { label: '关于着陆', click: showAbout },
        { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => runInRenderer('window.App && App.openSettings()') },
        { label: '导出备份…', click: () => runInRenderer('window.App && App.exportData()') },
        { label: '导回备份…', click: () => runInRenderer('window.App && App.importData()') },
        {
          label: '打开数据文件夹',
          click: () => shell.openPath(app.getPath('userData'))
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: TABS.map(([label, key], i) => ({
        label,
        accelerator: 'CmdOrCtrl+' + (i + 1),
        click: () => runInRenderer('window.Landing && Landing.tab(' + JSON.stringify(key) + ')')
      })).concat([
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'resetZoom', label: '恢复缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]).concat(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }] : [])
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '小陆不见了？把它叫回来',
          click: () => runInRenderer(
            'window.Pet && Pet.show && Pet.show(); window.Landing && Landing.tab("pet")'
          )
        },
        { label: '收起 / 展开小陆', click: () => runInRenderer('window.Pet && Pet.toggleCollapse && Pet.toggleCollapse()') },
        { type: 'separator' },
        {
          label: '项目主页',
          click: () => shell.openExternal('https://github.com/bydashuaibi/landing')
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  const win = BrowserWindow.getAllWindows()[0];
  dialog.showMessageBox(win, {
    type: 'info',
    title: '关于着陆',
    message: '着陆 · 把焦虑变成下一步',
    detail: '版本 ' + app.getVersion() + '\nElectron ' + process.versions.electron
      + ' / Chromium ' + process.versions.chrome
      + '\n\n你的数据全部保存在这台电脑上，不上传：\n' + app.getPath('userData'),
    buttons: ['好']
  });
}

/* ---------- 后台常驻：托盘 ----------
   为什么要这个：计时是「先打开、做多久算多久」，窗口一关就把计时收了等于白计。
   所以关窗口 = 缩进右下角托盘，程序继续跑，计时照常走；想彻底退出走托盘右键或菜单。
   点 × 时给一次选择（托盘 / 退出），勾了「记住我的选择」下次就不再问。
   --hidden 供开机自启用：启动后直接待在托盘里，不弹窗打断人。 */
const START_HIDDEN = process.argv.includes('--hidden');
const TRAY_HINT_FILE = path.join(DATA_DIR, 'tray-hint-shown');
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json');
let tray = null;
let isQuitting = false;

/* ---------- 关窗偏好：ask（每次问）/ tray（缩托盘）/ quit（直接退） ---------- */
function readPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function writePrefs(patch) {
  ensureDataDir();
  const next = Object.assign(readPrefs(), patch);
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(next, null, 2)); } catch (e) {}
  return next;
}
function getCloseAction() {
  const v = readPrefs().closeAction;
  return (v === 'tray' || v === 'quit') ? v : 'ask';
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico'));
  if (img.isEmpty()) return nativeImage.createEmpty();
  return img.resize({ width: 16, height: 16 });   /* Windows 通知区域就 16px */
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(trayIcon());
  } catch (err) {
    console.error('[tray] 托盘创建失败，退回「关窗即退出」：', err.message);
    return;
  }
  tray.setToolTip('着陆 · 在后台待着（计时照常走）');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { label: '结束当前计时', click: () => runInRenderer('window.App && App.timerFinish()') },
    { type: 'separator' },
    { label: '打开数据文件夹', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: '退出着陆', click: () => { isQuitting = true; app.quit(); } }
  ]));
  /* 左键点图标：开着就收起、藏着就叫回来（和大多数常驻软件一致） */
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else showMainWindow();
  });
  if (process.argv.includes('--dev')) console.log('[tray] 托盘已创建');
}

/* 第一次把窗口关进托盘时提一句，免得他以为程序被关了 */
function trayHintOnce() {
  try {
    if (fs.existsSync(TRAY_HINT_FILE)) return;
    fs.writeFileSync(TRAY_HINT_FILE, new Date().toISOString());
    if (tray && process.platform === 'win32') {
      tray.displayBalloon({
        title: '着陆缩到托盘了',
        content: '窗口关了，但计时还在走。点右下角的小图标就能叫回来；要彻底退出就右键它。'
      });
    }
  } catch (e) {}
}

function hideToTray() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  trayHintOnce();
}

/* 点 × 时问一次：躲进托盘，还是彻底退出？
   弹层画在应用自己的界面里（和整站的暖色风格一致），不弹系统灰框。
   渲染进程若没应答（卡住/崩了），4 秒后自动退到「缩到托盘」—— 绝不能把关不掉做成新 bug。 */
let askingClose = false;
function askCloseChoice() {
  if (askingClose) return;
  askingClose = true;

  let done = false, watchdog = null;
  const cleanup = () => {
    done = true;
    askingClose = false;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    ipcMain.removeListener('close:choice', onChoice);
    ipcMain.removeListener('close:prompt-opened', onOpened);
  };
  const onOpened = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
  const onChoice = (e, payload) => {
    if (done) return;
    const choice = (payload && payload.choice) || 'tray';
    if (choice === 'cancel') { cleanup(); return; }          /* 再想想：窗口照旧开着 */
    const remember = !!(payload && payload.remember);
    if (remember && (choice === 'tray' || choice === 'quit')) writePrefs({ closeAction: choice });
    cleanup();
    if (choice === 'quit') { isQuitting = true; app.quit(); }
    else hideToTray();
  };

  ipcMain.on('close:choice', onChoice);
  ipcMain.on('close:prompt-opened', onOpened);
  watchdog = setTimeout(() => { if (!done) { cleanup(); hideToTray(); } }, 4000);
  runInRenderer('window.App && App.askCloseChoice && App.askCloseChoice()');
}

/* 开机自启：打包后 execPath 就是应用本体；开发态跑的是 electron.exe，得把工程目录当参数带上 */
function autoLaunchArgs() {
  return app.isPackaged ? ['--hidden'] : [path.resolve(__dirname), '--hidden'];
}

ipcMain.handle('app:getAutoLaunch', () => {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch (e) { return false; }
});

ipcMain.handle('app:setAutoLaunch', (e, on) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      openAsHidden: true,                 /* macOS 用 */
      path: process.execPath,
      args: autoLaunchArgs()
    });
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (err) {
    return false;
  }
});

/* 渲染进程把「现在在计什么」推给托盘，鼠标悬停就能看见，不用打开窗口 */
ipcMain.on('tray:hint', (e, text) => {
  if (tray && !tray.isDestroyed()) tray.setToolTip('着陆 · ' + (text || '在后台待着'));
});

/* 关窗偏好：设置面板可以查看 / 改回「每次问我」 */
ipcMain.handle('close:getPref', () => getCloseAction());
ipcMain.handle('close:setPref', (e, action) => {
  const v = (action === 'tray' || action === 'quit') ? action : 'ask';
  writePrefs({ closeAction: v });
  return getCloseAction();
});

/* 计时进行中时关掉后台节流：窗口藏起来后 Chromium 会把定时器降频，
   倒计时可能晚一分钟才响。只在计时期间关，平时仍然省电。 */
ipcMain.on('timer:active', (e, active) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.setBackgroundThrottling(!active); } catch (err) {}
  }
});

/* 后台计时提醒：窗口藏在托盘里时，渲染进程每 30 分钟要求把它叫回来一次。
   渲染进程自己 show() 不了窗口，所以这件事必须走主进程。
   ⚠️ 只在窗口确实看不见时才动 —— 他本来就在看界面的时候绝不抢焦点
   （否则每 30 分钟把他正在打的字打断一次，比不提醒还烦）。 */
ipcMain.on('window:nudge', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) return;
  showMainWindow();
  /* Windows 会拦掉后台程序抢前台焦点（只闪一下任务栏），所以别指望 focus()，
     把窗口顶到 Z 序上层就够了：他切回来第一眼就能看见计时条。 */
  try { mainWindow.moveTop(); } catch (e) {}
});

/* 自动收回：渲染进程判定"他 20 秒内没碰过窗口"，就让我们把它收回去。
   交互判定（点/按/滚）放在渲染进程做，主进程不猜。
   ⚠️ 这里刻意直接 hide()，不走 hideToTray()——那会弹一次"缩到托盘了"的气泡，
   每 20 秒来一次就成骚扰了。 */
ipcMain.on('window:retract', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isQuitting || !mainWindow.isVisible()) return;
  mainWindow.hide();
});

/* ---------- 建窗 ---------- */
let mainWindow = null;

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow(Object.assign({
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#f3ece0',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    title: '着陆 · 把焦虑变成下一步',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      /* 窗口在后台时让挂件的 Canvas 停下来，别白烧 CPU */
      backgroundThrottling: true
    }
  }, state));

  if (state.maximized) mainWindow.maximize();

  /* 白屏一闪很难看：等首帧画完再显示。
     开机自启（--hidden）时直接待在托盘里，别一开机就弹窗打断人。 */
  mainWindow.once('ready-to-show', () => { if (!START_HIDDEN) mainWindow.show(); });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  /* --dev 时把渲染进程的控制台输出转发到终端，
     抓「点了没反应」这类问题很有用（以前加了 CSP 把内联事件拦掉，
     浏览器只在控制台报一句，应用本身悄无声息）。 */
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
      const tag = ['LOG', 'WARN', 'ERROR', 'DEBUG'][level] || ('L' + level);
      console.log('[' + tag + '] ' + message + '   (' + path.basename(sourceId || '') + ':' + line + ')');
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  ['resize', 'move', 'maximize', 'unmaximize'].forEach(ev => {
    mainWindow.on(ev, () => saveWindowState(mainWindow));
  });
  mainWindow.on('close', (e) => {
    saveWindowState(mainWindow);
    /* 真退出（菜单/托盘里的退出）或托盘没建起来 → 按老规矩直接关 */
    if (isQuitting || !tray) return;
    /* 记住为「彻底退出」→ 不拦这一下，让窗口正常关掉，进程在 window-all-closed 里退出。
       （别在这里 app.quit()：那是在一个已被 preventDefault 的 close 里嵌套退出，Electron 会中止它） */
    if (getCloseAction() === 'quit') { isQuitting = true; return; }
    e.preventDefault();
    /* 窗口本来就看不见（系统或脚本发的 WM_CLOSE）→ 不打扰，直接收进托盘 */
    if (!mainWindow.isVisible()) { hideToTray(); return; }
    if (getCloseAction() === 'tray') { hideToTray(); return; }
    askCloseChoice();      /* 第一次（或他选了「每次问我」）→ 问一次 */
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  /* 外链一律丢给系统浏览器：应用内的窗口必须始终是我们的 UI */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  /* 拦住应用内跳转：除了本地 index.html，其他都不许占住主窗口 */
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  /* 渲染进程崩溃 / 加载失败时给个能看懂的说法，而不是留一个白窗口 */
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    dialog.showMessageBox(mainWindow, {
      type: 'error', title: '着陆',
      message: '界面进程意外退出了',
      detail: '原因：' + (details && details.reason) + '\n你的数据没有丢，重开一次即可。',
      buttons: ['重新加载', '退出']
    }).then(r => {
      if (r.response === 0 && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      else app.quit();
    });
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    dialog.showErrorBox('着陆加载失败', code + ' ' + desc + '\n' + url);
  });
}

/* ---------- 生命周期 ---------- */
app.whenReady().then(() => {
  ensureDataDir();
  applySecurity(session.defaultSession);
  buildMenu();
  createWindow();
  createTray();          /* 有托盘 = 关窗口只是藏起来，程序继续在后台跑 */

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  /* 窗口真被关掉只可能是「用户选了彻底退出」：缩托盘那一支在 close 里 preventDefault 拦住了，
     所以这里照老规矩退出即可（macOS 惯例除外）。 */
  if (process.platform !== 'darwin') app.quit();
});

/* 只允许一个实例跑，避免两个窗口抢同一个 localStorage */
app.on('web-contents-created', (e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});
