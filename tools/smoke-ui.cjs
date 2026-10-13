/* 界面冒烟测试：真浏览器加载 index.html，断言关键样式/交互 + 出截图。
 *
 * 用法：  node tools/smoke-ui.cjs
 * 前提：  本机 Edge；puppeteer-core（本机在 WorkBuddy 托管区，见下方 TIPS 常量）
 * 产物：  tools/_shots/*.png（已加进 .gitignore）
 *
 * 为什么不用 Electron 跑：app.js 的状态全在 localStorage，window.landing 那套桥
 * 每一处都用 `if(window.landing)` 兜底（"网页版没有这个桥，直接跳过"），
 * 所以 index.html 在普通浏览器里就能完整渲染 —— 起个静态服务就够，比拼 Electron 快得多。
 *
 * ⚠️ 两个必踩的坑（都真踩过）：
 *  1) 无头浏览器默认 `prefers-reduced-motion: reduce`，会让**所有动效走兜底分支**。
 *     测动效前必须 emulateMediaFeatures 声明 no-preference，否则测出来永远是"没变化"。
 *  2) 形变类动效只活一帧就交给 CSS transition 了，采样式断言抓不到；
 *     要用 MutationObserver 记录"曾经出现过的那一帧"。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, '_shots');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) { puppeteer = require('C:/Users/31701/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core'); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.webp': 'image/webp' };

/* 端口交给系统分配（listen 0），拿到真实端口再拼 URL —— 写死端口会被残留服务撞上 */
function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      const p = path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(REPO) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rq.writeHead(404); return rq.end(); }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rq);
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

let fails = 0;
const log = (...a) => console.log(...a);
function check(name, ok, extra) {
  log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (extra !== undefined && extra !== '' ? '  → ' + extra : ''));
  if (!ok) fails++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const PORT = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'], defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  const errs = [], bad = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);

  log('\n== 1. 页面加载 ==');
  check('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  // favicon 与浏览器直连 api.github.com（日报功能，Electron 里走主进程）不算
  check('本地资源无 404', bad.filter(b => !/favicon|api\.github\.com/.test(b)).length === 0,
        bad.filter(b => !/favicon|api\.github\.com/.test(b)).slice(0, 3).join(' | '));
  check('#view 有内容', (await page.$eval('#view', el => el.innerHTML.length)) > 500);

  log('\n== 2.「一束光」开关 ==');
  const tabAttr = await page.evaluate(() => document.body.getAttribute('data-tab'));
  check('body[data-tab]=today', tabAttr === 'today', tabAttr);
  check('今日页 ::before 有暖光渐变',
        (await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage.length)) > 50);

  log('\n== 3. 两段式标题 ==');
  const hero = await page.evaluate(() => {
    const s = document.querySelector('.hero-serif');
    if (!s) return null;
    const c = getComputedStyle(s), w = document.querySelector('.hero-line .warp-head h2');
    return { text: s.textContent, font: c.fontFamily, style: c.fontStyle, color: c.color, size: c.fontSize,
             align: c.textAlign, warpText: w ? w.textContent : null, warpSize: w ? getComputedStyle(w).fontSize : null };
  });
  check('.hero-serif 存在', !!hero, hero && hero.text);
  if (hero) {
    check('是衬线斜体', /serif|Georgia|Times/i.test(hero.font) && hero.style === 'italic', hero.style);
    check('赭石色', hero.color.replace(/\s/g, '') === 'rgb(224,138,78)', hero.color);
    check('前半仍走 warp', hero.warpText === '把焦虑，', hero.warpText);
    check('两行字号一致', hero.size === hero.warpSize, hero.size + ' vs ' + hero.warpSize);
    // warp-text 是框内居中绘制，后半不居中就会错开半个屏
    check('后半居中（与 warp 对齐）', hero.align === 'center', hero.align);
  }
  await page.screenshot({ path: path.join(SHOTS, 'today.png'), clip: { x: 0, y: 0, width: 1280, height: 760 } });

  log('\n== 4. eyebrow 小标签 ==');
  const k = await page.evaluate(() => {
    const e = document.querySelector('.mod-head .kicker'); if (!e) return null;
    const c = getComputedStyle(e);
    return { text: e.textContent, size: c.fontSize, ls: c.letterSpacing, tt: c.textTransform };
  });
  check('kicker 存在', !!k, k && k.text);
  if (k) {
    check('11px / 0.3em / 全大写',
          k.size === '11px' && Math.abs(parseFloat(k.ls) - 3.3) < 0.35 && k.tt === 'uppercase',
          k.size + ' / ' + k.ls + ' / ' + k.tt);
  }

  log('\n== 5. 胶囊按钮 ==');
  check('按钮 border-radius 999px',
        (await page.evaluate(() => {
          const b = document.querySelector('.btn.sm') || document.querySelector('.btn');
          return b ? parseFloat(getComputedStyle(b).borderRadius) : 0;
        })) >= 40);

  log('\n== 6. 宠物共享元素形变 ==');
  check('挂件已挂载', await page.evaluate(() => !!document.querySelector('#pwCatBox')));
  await page.evaluate(() => {
    window.__tfSeen = [];
    new MutationObserver(ms => ms.forEach(m => {
      if (m.type === 'attributes' && m.target.classList && m.target.classList.contains('pp-avatar'))
        window.__tfSeen.push(m.target.style.transform);
    })).observe(document.getElementById('petPanel'), { attributes: true, subtree: true, attributeFilter: ['style'] });
  });
  await page.click('#pwCatBox');
  await sleep(700);
  const pt = await page.evaluate(() => {
    const pp = document.getElementById('petPanel');
    return { open: !pp.classList.contains('hidden'), sharedIn: pp.classList.contains('shared-in'),
             tf: document.querySelector('#petPanel .pp-avatar').style.transform };
  });
  const seen = await page.evaluate(() => window.__tfSeen);
  check('面板已打开', pt.open);
  check('头像从挂件位置形变出场', seen.some(t => /translate/.test(t)), seen[0] || '(无)');
  check('过渡后清掉内联样式', pt.tf === '' && pt.sharedIn === false, 'tf="' + pt.tf + '"');

  log('\n== 7. 切栏目 ==');
  const nav = await page.$$('.nav-item');
  if (nav.length > 3) {
    await nav[3].click();
    await sleep(900);
    const t2 = await page.evaluate(() => document.body.getAttribute('data-tab'));
    check('data-tab 跟着切', t2 && t2 !== 'today', t2);
  }

  await browser.close();
  server.close();
  log('\n' + (fails ? '❌ 失败 ' + fails + ' 项' : '✅ 全部通过') + '  截图 → tools/_shots/');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('崩了:', e); process.exit(2); });
