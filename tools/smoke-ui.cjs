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
    await page.click('.nav-item[data-tab="weekly"]');
    await sleep(900);
    const t2 = await page.evaluate(() => document.body.getAttribute('data-tab'));
    check('data-tab 跟着切', t2 === 'weekly', t2);
  }

  log('\n== 8. 「任务」模块确实没了 ==');
  check('侧栏 / tabbar 没有 data-tab="tasks"',
        (await page.$$eval('[data-tab="tasks"]', els => els.length)) === 0);
  const navCount = (await page.$$('.nav-item')).length;
  check('导航项 = 14（侧栏 7 + tabbar 7）', navCount === 14, navCount + ' 个');
  // 切回今日页看卡片
  await page.click('.nav-item[data-tab="today"]');
  await sleep(900);
  const todayHtml = await page.evaluate(() => document.getElementById('view').innerHTML);
  check('今日页有「今天的池子」', /今天的池子/.test(todayHtml));
  check('今日页没有「快捷打卡」', !/快捷打卡/.test(todayHtml));
  check('今日页不报错地渲染完', todayHtml.length > 500);

  log('\n== 9. 每日必做：管理弹层（任务页删掉后的替代入口）==');
  // 造数据必须走**活跃 STATE** —— 直接 setItem 会被应用的自动保存覆盖（踩过）
  await page.evaluate(() => {
    const s = window.Landing.state();
    s.mustDos = [
      { id: 'm1', name: '吃维生素', enabled: true, records: [], createdAt: '2026-10-01' },
      { id: 'm2', name: '记账', enabled: false, records: [], createdAt: '2026-10-01' },
    ];
    // 松散时长：本周几笔，覆盖两类，好让周报的「各类别投入占比」有东西渲染
    const p = n => ('0' + n).slice(-2);
    const day = off => { const d = new Date(); d.setDate(d.getDate() - off);
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
    s.loose = [
      { id: 'l1', date: day(0), name: '打游戏', minutes: 50, category: 'fun' },
      { id: 'l2', date: day(0), name: '看论文', minutes: 30, category: 'work' },
      { id: 'l3', date: day(1), name: '读了两章', minutes: 25, category: 'growth' },
    ];
    window.Landing.save();
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
  check('必做卡出现「管理」按钮', await page.evaluate(() => !!document.querySelector('[data-act="mustManage"]')));
  await page.click('[data-act="mustManage"]');
  await sleep(400);
  const s1 = await page.evaluate(() => document.getElementById('sheet').innerHTML);
  check('管理弹层打开', /必做 · 管理/.test(s1));
  check('关掉的项也在里面', /吃维生素/.test(s1) && /记账/.test(s1) && /已关/.test(s1));
  await page.click('#sheet [data-act="toggleMust"][data-id="m2"]');
  await sleep(450);
  const s2 = await page.evaluate(() => document.getElementById('sheet').innerHTML);
  check('点开关后弹层自己刷新（不再是「已关」）', /必做 · 管理/.test(s2) && !/已关/.test(s2));
  await page.screenshot({ path: path.join(SHOTS, 'must-manage.png') });
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => { const s = document.getElementById('sheet'); s.classList.add('hidden'); s.innerHTML = ''; });

  log('\n== 10. 遍历全部栏目（防"删了东西把某一页搞白屏"）==');
  // 报错基线必须在点之前取 —— 之前在点之后取，于是周报的 ReferenceError 被漏过去了，
  // 最后是靠肉眼读截图才发现（教训：断言要放在动作前）
  for (const t of ['weekly', 'digest', 'companion', 'pet', 'shop', 'me', 'today']) {
    const before = errs.length;
    await page.click(`.nav-item[data-tab="${t}"]`);
    await sleep(1100);
    const html = await page.evaluate(() => document.getElementById('view').innerHTML);
    const failed = /渲染失败/.test(html);
    check(`「${t}」正常渲染`, !failed && errs.length === before && html.length > 300,
          failed ? '出现「渲染失败」卡片' : (errs.slice(before).join(' | ') || 'html ' + html.length + ' 字符'));
  }

  log('\n== 11. 周报的内容口径 ==');
  await page.click('.nav-item[data-tab="weekly"]');
  await sleep(1200);
  const wkHtml = await page.evaluate(() => document.getElementById('view').innerHTML);
  check('周报没有「每周任务」卡', !/每周任务<\/h2>/.test(wkHtml));
  check('周报出现「每日回顾」', /每日回顾/.test(wkHtml));
  const kb = await page.evaluate(() => {
    const r = document.querySelector('.kb-row[data-cat]');
    if (!r) return null;
    const bar = r.querySelector('.kt>div');
    return { cat: r.getAttribute('data-cat'),
             edge: getComputedStyle(r, '::before').backgroundImage.length,
             bar: bar ? getComputedStyle(bar).backgroundColor : '' };
  });
  check('看板行带分类标识 data-cat', !!kb, kb && kb.cat);
  if (kb) {
    check('看板行有彩色细边', kb.edge > 20, kb.edge + ' 字符');
    // 旧代码按旧 key 取色 → 现在的 fun/work/life/growth 全掉到 #8b6dff 兜底紫（真 bug）
    check('色条用的是四类色，不是兜底紫', kb.bar !== 'rgb(139, 109, 255)', kb.bar);
  }
  await page.screenshot({ path: path.join(SHOTS, 'weekly.png'), clip: { x: 0, y: 0, width: 1280, height: 900 } });

  log('\n== 12. 「一束光」真的看得见吗 ==');
  // 🔴 防回归：第一版「一束光」**规则生效了、但肉眼完全看不见**
  //    （顶部中心只比不开时亮 +20，master 原话"重启还是和原来一样的单一深色背景"）。
  //    纯 CSS 断言抓不到这种"应用了但没效果"，所以这里量**真实渲染出来的像素**。
  await page.click('.nav-item[data-tab="today"]');
  await sleep(1000);
  await page.evaluate(() => { const w = document.getElementById('bg-waves');
    if (w) { w.dataset._d = w.style.display; w.style.display = 'none'; } });
  await sleep(400);
  const clip = { x: 0, y: 0, width: 1280, height: 300 };
  const onB64 = await page.screenshot({ clip, encoding: 'base64' });
  await page.evaluate(() => document.body.removeAttribute('data-tab'));
  await sleep(500);
  const offB64 = await page.screenshot({ clip, encoding: 'base64' });
  check('开关 data-tab 会改变顶部画面（光真的渲染了）', onB64 !== offB64);
  const css = await page.evaluate(() => {
    document.body.setAttribute('data-tab', 'today');
    return { on: getComputedStyle(document.body, '::before').backgroundImage,
             after: getComputedStyle(document.body, '::after').backgroundImage };
  });
  const peak = /rgba\(2\d\d,\s*1\d\d,\s*\d\d,\s*([\d.]+)\)/.exec(css.on);
  check('光束峰值 alpha ≥ 0.5（不是一层看不见的薄雾）', !!peak && parseFloat(peak[1]) >= 0.5,
        peak ? peak[1] : css.on.slice(0, 90));
  const vig = /linear-gradient\(rgba\(0, 0, 0, ([\d.]+)\)/.exec(css.after);
  check('今日页暗角已给光让路（顶部黑 ≤ 0.15）', !!vig && parseFloat(vig[1]) <= 0.15,
        vig ? vig[1] : css.after.slice(0, 80));
  await page.evaluate(() => { const w = document.getElementById('bg-waves');
    if (w) { w.style.display = w.dataset._d || 'block'; delete w.dataset._d; } });
  await page.evaluate(() => document.body.setAttribute('data-tab', 'today'));
  await page.screenshot({ path: path.join(SHOTS, 'today.png'), clip: { x: 0, y: 0, width: 1280, height: 760 } });

  await browser.close();
  server.close();
  log('\n' + (fails ? '❌ 失败 ' + fails + ' 项' : '✅ 全部通过') + '  截图 → tools/_shots/');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('崩了:', e); process.exit(2); });
