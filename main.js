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
   因为 AI 接口地址由用户在设置里自己填，事先无法枚举。
   2026-09-23：再放行**环回地址的 http** —— 本地 Ollama 的 OpenAI 兼容端点是
   http://127.0.0.1:11434/v1，少了这条 CSP 会"瞬间 Failed to fetch"（让人误以为是网络问题）。
   ⚠️ 只放环回，不放任意 http / 明文外网。 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
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
  /* 他在打游戏 —— 把窗口顶出来只会被反作弊/全屏挡住，还平白扫兴（2026-10-02 加） */
  if (_act.last && GAME_RE.test(_act.last.proc)) return;
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

/* 当前窗口可见吗（最小化也算不可见）。
   **这是渲染进程判断可见性的唯一权威来源** —— 原因见 createWindow 里那段说明。 */
function winVisibleNow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  try { return mainWindow.isVisible() && !mainWindow.isMinimized(); } catch (e) { return false; }
}
function notifyWinVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send('window:vis', winVisibleNow()); } catch (e) {}
}
/* 渲染进程启动时同步问一次（比如 --hidden 静默启动、或启动即最小化） */
ipcMain.on('window:vis:get', (e) => { e.returnValue = winVisibleNow(); });

/* ================= 活动感知 + 定时截屏（2026-10-02）=================
   master 要「着陆」知道他此刻在干什么：好在打游戏时不打扰他、能提示记一笔娱乐、
   也让伙伴知道他在忙什么。他选的：默认开、但界面上全程显化；入口在今日页 + 我的。

   两条通路都实测过（同一台机器）：
     · 拿前台窗口（PowerShell P/Invoke）≈ 350ms/次 —— **不用管理员**
     · desktopCapturer 出缩略图：1600×900 → JPEG(70) ≈ 59KB、≈ 460ms —— 也不用管理员
       每 5 分钟一张 ≈ 17MB/天（旧案里想存的 PNG 原图是 1GB+/天，所以这里直接抓缩略图）

   隐私（照他自己旧案里写的第一条来）：全程本地、绝不上云、一键可关、
   界面上永久显示「正在每 N 分钟截屏 · 已 X 张」，过期目录自动清（默认两周，每 6 小时扫一次）。 */
const ACTIVITY_DIR = path.join(app.getPath('userData'), 'activity');
/* keepDays 默认两周 —— master 2026-10-02 定的（「保留两周自动清一次」）。
   他还没保存过 prefs.json，所以改这里立刻生效。 */
/* ask / askCoolMin 是 2026-10-13 加的：换应用时问一句「这是在做什么」，
   确认后自动开始计时（master：「每次点计时有点麻烦」）。 */
const ACT_DEFAULTS = { enabled: true, sampleSec: 60, shotMin: 5, keepDays: 14, ask: true, askCoolMin: 15 };

function actPrefs() {
  return Object.assign({}, ACT_DEFAULTS, readPrefs().activity || {});
}
function setActPrefs(patch) {
  writePrefs({ activity: Object.assign({}, actPrefs(), patch) });
  applyActivityTimers();
  return actPrefs();
}

/* ---- 分类规则：进程名 + 窗口标题 → 一类。
   ⚠️ 顺序有讲究（先游戏、再"标题里的学习词"、再生产力软件、再视频站、最后聊天）——
      否则「在 B 站看 C++ 教程」会被当成娱乐（标题的信息量比想象中大，实测抓到过
      「…C++教程从0到1入门编程」这种）。改分类只动这张表。 */
const ACT_RULES = [
  ['fun',    /wuthering|client-win64-shipping|launcher_main|punishing|pgr|slaythespire|calabiyau|genshin|starrail|hkrpg|steam\.exe|epicgames|gog galaxy|minecraft/i],
  ['study',  /教程|入门|公开课|课程|第\s*\d+\s*讲|习题|题解|讲解|速成|零基础|c\+\+|python|算法|数据结构|文档|手册|论文|arxiv|stack ?overflow|csdn|菜鸟教程|学习/i],
  ['work',   /devenv|visual studio|code\.exe|jetbrains|idea64|pycharm|clion|goland|webstorm|cursor|ue4editor|unrealeditor|unity|blender|photoshop|premiere|after effects|matlab|origin|keil|stm32cube|cad|solidworks|autocad|word|excel|powerpoint|wps|notion|typora|obsidian|xmind|navicat|pgadmin|dbeaver|terminal|cmd\.exe|windowsterminal|git bash|powershell/i],
  ['fun',    /哔哩哔哩|bilibili|抖音|douyin|快手|kuaishou|优酷|youku|爱奇艺|iqiyi|腾讯视频|网易云音乐|cloudmusic|qq音乐|spotify|喜马拉雅|steam|游戏|game/i],
  ['social', /微信|wechat|weixin|^qq|dingtalk|钉钉|feishu|飞书|telegram|discord|slack|thunderbird|outlook|邮件/i],
];
/* 只用来判"是不是在打游戏"（决定要不要把窗口叫回来打扰他） */
const GAME_RE = ACT_RULES[0][1];

function classifyActivity(proc, title) {
  const s2 = String(proc || '') + ' \u241F ' + String(title || '');
  for (const pair of ACT_RULES) { if (pair[1].test(s2)) return pair[0]; }
  return 'other';
}

/* ---- 拿前台窗口。⚠️ 三个坑：① -WindowStyle Hidden + windowsHide 才不闪黑框；
   ② 分隔符用 [char]9（PS 5.1 不认 `u{...}）；③ PS here-string 的 " @ 结束符必须顶格。 ---- */
const { execFile } = require('child_process');
const PS_FG = [
  /* 🔴 必须在写 stdout 之前设 UTF8：默认按系统 ANSI(GBK) 编码输出，
     中文窗口标题到 Node 这边就是 %EF%BF%BD 的乱码（实测过）。
     后果不只是难看 —— ACT_RULES 里的中文规则（教程/课程/学习/哔哩哔哩/微信…）
     全都匹配不上，分类直接退化成只看进程名。 */
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public class FgWin {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '}',
  '"@',
  '$h = [FgWin]::GetForegroundWindow()',
  '$sb = New-Object System.Text.StringBuilder 512',
  '[void][FgWin]::GetWindowText($h, $sb, 512)',
  '$procId = 0',
  '[void][FgWin]::GetWindowThreadProcessId($h, [ref]$procId)',
  '$name = ""',
  'try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }',
  '[Console]::Out.Write($name + [char]9 + $sb.ToString())',
].join('\n');

function sampleForeground() {
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', PS_FG],
      { windowsHide: true, timeout: 8000, maxBuffer: 1 << 18 },
      (err, stdout) => {
        if (err) return resolve(null);
        const parts = String(stdout).split('\t');
        const proc = (parts[0] || '').trim();
        const title = (parts.slice(1).join('\t') || '').trim();
        if (!proc) return resolve(null);
        /* 万一抓到探测进程自己，丢掉这次（隐藏窗口一般抢不到焦点，这是保险） */
        if (/^(powershell|pwsh|conhost|cmd|node)$/i.test(proc)) return resolve(null);
        resolve({ proc: proc, title: title });
      });
  });
}

/* ---- 当天的活动日志 ---- */
let _act = { date: '', samples: [], shots: 0, bytes: 0, last: null };
function actLogPath(d) { return path.join(ACTIVITY_DIR, 'log-' + d + '.json'); }
function saveActLog() {
  try { fs.mkdirSync(ACTIVITY_DIR, { recursive: true }); } catch (e) { }
  try { fs.writeFileSync(actLogPath(_act.date), JSON.stringify(_act), 'utf8'); } catch (e) { }
}
/* 每应用 / 每分类的**真实时长** —— 手机那种「应用使用时间」。
   算法：相邻两条采样的时间差，归给**前一条**的应用（那段时间里他在用的就是它）。
   ⚠️ 单段必须封顶 2×采样间隔：睡眠/关机/应用没开那种大空洞（开机后一算能差几小时）
      不能记到某个应用头上。最后一条按"一个采样间隔"算，且不超过此刻。 */
/* 时长算法本体：给一组采样算出 每应用/每分类 的毫秒数。
   ⚠️ 单段封顶 2×采样间隔（睡眠/关机那种大空洞不能算到某个 app 头上）；
      最后一条按"一个采样间隔"算、且不超过此刻；乱序/重复时间戳产生的负段直接丢掉。 */
function durOf(samples, stepMs) {
  const cap = stepMs * 2;
  const byAppMs = {}, byCatMs = {}, appCat = {};
  const arr = samples || [];
  const now = Date.now();
  for (let i = 0; i < arr.length; i++) {
    const cur = arr[i];
    const nxt = (i + 1 < arr.length) ? arr[i + 1].at : Math.min(cur.at + stepMs, now);
    const seg = Math.min(Math.max(0, nxt - cur.at), cap);
    if (!seg) continue;
    const p = cur.proc || '(未知)';
    byAppMs[p] = (byAppMs[p] || 0) + seg;
    if (!appCat[p]) appCat[p] = cur.cat || 'other';
    const c = cur.cat || 'other';
    byCatMs[c] = (byCatMs[c] || 0) + seg;
  }
  return { byAppMs: byAppMs, byCatMs: byCatMs, appCat: appCat };
}

function actDurations() {
  const step = Math.max(10, actPrefs().sampleSec) * 1000;
  const r = durOf(_act.samples, step);
  const byAppMs = r.byAppMs, byCatMs = r.byCatMs, appCat = r.appCat;
  const byApp = Object.keys(byAppMs)
    .map((k) => ({ proc: k, ms: byAppMs[k], cat: appCat[k] }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 40);
  const totalMs = Object.keys(byAppMs).reduce((a, k) => a + byAppMs[k], 0);
  const byCatMin = {};
  Object.keys(byCatMs).forEach((k) => { byCatMin[k] = Math.round(byCatMs[k] / 60000); });
  return { byApp: byApp, byCatMin: byCatMin, totalMin: Math.round(totalMs / 60000), totalMs: totalMs };
}

/* 某一周（from ~ to）的**自动采集**汇总 —— 周报的松紧判断要用
   （master 2026-10-09 定：自动采到的娱乐时长**直接参与**判断，不用他手动记）。
   逐天读 log-YYYY-MM-DD.json（保留期内的都在），用同一套时长算法。 */
function addDaysYmd(ymd, n) {
  const p = String(ymd).split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
}
function actWeekStats(from, to) {
  const step = Math.max(10, actPrefs().sampleSec) * 1000;
  const byCatMs = {}, funAppMs = {};
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysYmd(from, i);
    if (to && d > to) break;
    let samples = [];
    try { samples = (JSON.parse(fs.readFileSync(actLogPath(d), 'utf8')).samples) || []; } catch (e) { samples = []; }
    if (!samples.length) { days.push({ date: d, totalMin: 0 }); continue; }
    const r = durOf(samples, step);
    let dm = 0;
    Object.keys(r.byCatMs).forEach((k) => { byCatMs[k] = (byCatMs[k] || 0) + r.byCatMs[k]; dm += r.byCatMs[k]; });
    Object.keys(r.byAppMs).forEach((p) => {
      if ((r.appCat[p] || '') === 'fun') funAppMs[p] = (funAppMs[p] || 0) + r.byAppMs[p];
    });
    days.push({ date: d, totalMin: Math.round(dm / 60000) });
  }
  const byCatMin = {};
  Object.keys(byCatMs).forEach((k) => { byCatMin[k] = Math.round(byCatMs[k] / 60000); });
  const totalMin = Object.keys(byCatMin).reduce((a, k) => a + byCatMin[k], 0);
  return {
    from: from, to: to || null, days: days, byCatMin: byCatMin, totalMin: totalMin,
    funMin: byCatMin.fun || 0,
    funTop: Object.keys(funAppMs).map((p) => ({ proc: p, ms: funAppMs[p] }))
      .sort((a, b) => b.ms - a.ms).slice(0, 3)
  };
}

function actSnapshot() {
  const p = actPrefs();
  const byCat = {};
  _act.samples.forEach((x) => { byCat[x.cat] = (byCat[x.cat] || 0) + 1; });
  const dur = actDurations();
  return {
    date: _act.date, enabled: p.enabled, sampleSec: p.sampleSec, shotMin: p.shotMin, keepDays: p.keepDays,
    ask: p.ask, askCoolMin: p.askCoolMin,
    count: _act.samples.length, byCat: byCat,
    /* byCatMin / byApp / totalMin 是**真实时长**（2026-10-09 加，手机式"应用使用时间"）；
       byCat(条数) 留着兼容老渲染，新的都读 byCatMin */
    byCatMin: dur.byCatMin, byApp: dur.byApp, totalMin: dur.totalMin,
    last: _act.last, isGame: !!(_act.last && GAME_RE.test(_act.last.proc)),
    shots: _act.shots, bytes: _act.bytes, dir: ACTIVITY_DIR,
  };
}
function actPush() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('activity:update', actSnapshot()); } catch (e) { }
  }
}

/* ---- 换应用 → 通知渲染进程（自动计时用，2026-10-13 加）----
   ⚠️ 跟截图没关系：真正知道"他在用哪个程序"的是 sampleForeground 这条线。
   只在**进程名真的变了**、且不在冷却期、且不是壳进程时才推 —— 免得切个输入法就被问一次。 */
const PROC_SHELL = /^(applicationframehost|textinputhost|shellexperiencehost|startmenuexperiencehost|searchhost|runtimebroker|widgets|widgetservice|lockapp|sihost|dwm|taskhostw|securityhealthsystray|gamebar|gamebarftserver|xboxgamebarwidgets|phoneexperiencehost|backgroundtaskhost|conhost|cmd|powershell|pwsh|node|idle)$/i;
let _lastProc = '';
let _askAt = 0;
function _sendAppChanged(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('activity:appChanged', payload); } catch (e) { }
  }
}
/* ⚠️ fg 可能是 null（桌面上没窗口 / 只有系统壳窗口）。
   这时**也要发一条 idle 事件** —— 否则他切到桌面去吃饭，渲染进程那段自动计时会一直跑下去。 */
function maybeAskApp(fg) {
  const proc = (fg && fg.proc) || 'idle';
  const prev = _lastProc;
  _lastProc = proc;
  if (!prev || prev === proc) return;                 /* 第一次采样 / 没换应用，不发 */

  if (PROC_SHELL.test(proc)) {
    /* 切到桌面/系统壳：不发"问一句"，只发"停" —— 只在上一段是真实应用时才值得发 */
    if (proc === 'idle' || !fg) _sendAppChanged({ proc: 'idle', idle: true, at: Date.now() });
    return;
  }
  if (!actPrefs().ask) return;                        /* 他自己关掉了自动询问 */
  if (Date.now() - _askAt < Math.max(3, actPrefs().askCoolMin) * 60000) return;
  _askAt = Date.now();
  _sendAppChanged({
    proc: proc,
    title: String(fg.title || '').slice(0, 120),
    cat: classifyActivity(proc, fg.title),
    at: Date.now(),
  });
}

/* ---- 采样一次 ---- */
async function actTick() {
  if (!actPrefs().enabled) return;
  const today0 = ymdLocal();
  if (_act.date !== today0) { _act = { date: today0, samples: [], shots: 0, bytes: 0, last: null }; }
  const fg = await sampleForeground();
  if (fg) {
    const cat = classifyActivity(fg.proc, fg.title);
    _act.last = { proc: fg.proc, title: fg.title, cat: cat, at: Date.now() };
    /* 同一分钟只记一条（采样偶尔会抖动/重入） */
    const lastS = _act.samples[_act.samples.length - 1];
    if (!lastS || (Date.now() - lastS.at) >= 30000) {
      _act.samples.push({ at: Date.now(), proc: fg.proc, title: fg.title.slice(0, 120), cat: cat });
      if (_act.samples.length > 3000) _act.samples.splice(0, _act.samples.length - 3000);
    }
    saveActLog();
  }
  maybeAskApp(fg);           /* ⚠️ 放在 if 外面：fg=null（桌面/没窗口）时也要发"停"信号 */
  actPush();
}

/* ---- 截一张 ---- */
async function actShot() {
  if (!actPrefs().enabled) return;
  try {
    const { desktopCapturer } = require('electron');
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } });
    if (!srcs.length) return;
    const jpg = srcs[0].thumbnail.toJPEG(70);
    const d = new Date();
    const dayDir = path.join(ACTIVITY_DIR, ymdLocal(d));
    fs.mkdirSync(dayDir, { recursive: true });
    const name = pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.jpg';
    fs.writeFileSync(path.join(dayDir, name), jpg);
    _act.shots++; _act.bytes += jpg.length;
    saveActLog(); actPush();
  } catch (e) { console.error('[activity] 截屏失败：', e.message); }
}

/* ---- 清掉过期截图（默认两周）----
   ⚠️ 原来只在 startActivity 里跑一次 —— 他要的是"自动清"，所以再挂一个
   每 6 小时的定时扫描（独立的 setInterval，不放进 _actTimers，
   免得改设置时被 applyActivityTimers 清掉、或者暂停记录后就不再清理）。 */
function cleanOldShots() {
  try {
    const keep = actPrefs().keepDays;
    const cutoff = Date.now() - keep * 86400000;
    for (const name of fs.readdirSync(ACTIVITY_DIR)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
      const full = path.join(ACTIVITY_DIR, name);
      const t = new Date(name + 'T00:00:00').getTime();
      if (t < cutoff) {
        fs.rmSync(full, { recursive: true, force: true });
        try { fs.rmSync(actLogPath(name), { force: true }); } catch (e) { }
      }
    }
  } catch (e) { }
}

let _actTimers = [];
let _actCleanTimer = null;      /* 过期截图的周期清理（每 6 小时） */
function applyActivityTimers() {
  _actTimers.forEach((t) => clearTimeout(t));
  _actTimers = [];
  if (!actPrefs().enabled) return;
  const p = actPrefs();
  const loop = (fn, ms) => {
    const tick = async () => { try { await fn(); } catch (e) { } _actTimers.push(setTimeout(tick, ms)); };
    _actTimers.push(setTimeout(tick, ms));
  };
  actTick();                       /* 立刻来一次 */
  loop(actTick, Math.max(10, p.sampleSec) * 1000);
  loop(actShot, Math.max(1, p.shotMin) * 60000);
}
function ymdLocal(d) {
  d = d || new Date();
  const z = (n) => ('0' + n).slice(-2);
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}
function pad2(n) { return ('0' + n).slice(-2); }

function startActivity() {
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
  const today0 = ymdLocal();
  try { _act = JSON.parse(fs.readFileSync(actLogPath(today0), 'utf8')); } catch (e) { _act = { date: today0, samples: [], shots: 0, bytes: 0, last: null }; }
  _act.date = today0;
  cleanOldShots();
  if (!_actCleanTimer) {
    _actCleanTimer = setInterval(cleanOldShots, 6 * 3600 * 1000);
    if (_actCleanTimer.unref) _actCleanTimer.unref();
  }
  applyActivityTimers();
  actPush();
}

/* ---- IPC ---- */
ipcMain.handle('activity:get', () => actSnapshot());
/* 某一周的自动采集汇总（周报松紧判断用，2026-10-09 加） */
ipcMain.handle('activity:week', (e, from, to) => actWeekStats(from, to));
ipcMain.handle('activity:setPref', (e, patch) => { setActPrefs(patch || {}); actPush(); return actSnapshot(); });
ipcMain.handle('activity:openFolder', async () => {
  try { fs.mkdirSync(ACTIVITY_DIR, { recursive: true }); } catch (e) { }
  return await shell.openPath(ACTIVITY_DIR);
});
ipcMain.handle('activity:clearShots', () => {
  let freed = 0, n = 0;
  try {
    for (const name of fs.readdirSync(ACTIVITY_DIR)) {
      const full = path.join(ACTIVITY_DIR, name);
      if (fs.statSync(full).isDirectory()) {
        for (const f of fs.readdirSync(full)) { try { freed += fs.statSync(path.join(full, f)).size; n++; } catch (e) { } }
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
    _act.shots = 0; _act.bytes = 0; saveActLog();
  } catch (e) { }
  actPush();
  return { ok: true, files: n, freed: freed };
});


function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow(Object.assign({
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#0d0b0a',  /* 深色主题：原来是奶白 #f3ece0，深色下启动会闪白 */
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

  /* 把「窗口到底看不看得见」广播给渲染进程。
     🔴 为什么必须由主进程说了算：计时期间会给这个窗口 setBackgroundThrottling(false)，
        而它的副作用是 —— 窗口藏起来之后，渲染进程的 document.hidden **仍然报 false**
        （rAF 也照跑）。2026-10-02 实测确认：
          不设节流 → hide 后 hidden=true、rAF 停；
          设了节流 → hide 后 hidden=false、rAF 仍 117 帧/0.7 秒。
        渲染进程要是拿 document.hidden 判断可见性，「后台每 30 分钟把窗口叫回来」
        就**永远不触发**（这功能从 09-17 做出来起就没生效过）。
        isVisible()/isMinimized() 在主进程侧不受节流影响，以它为准。 */
  ['hide', 'show', 'minimize', 'restore'].forEach(ev => {
    mainWindow.on(ev, () => notifyWinVisibility());
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
  try { startActivity(); } catch (err) { console.error('[activity] 启动失败：', err.message); }

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
