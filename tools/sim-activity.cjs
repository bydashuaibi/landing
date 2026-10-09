/* 用虚拟数据看「应用使用时间」长什么样（不会碰他的真实数据：全程独立的 user-data 目录）
   用法：node tools/sim-activity.cjs
   做两件事：
     A. 造「虚拟的一天」（16 个时段 / 12 个应用 / 含空档与系统壳窗口）→ 截图到 %TEMP%
     B. 边界：空日志 / 单条 / 6 小时大空洞 / 时间戳乱序 / 3000 条上限
   ⚠️ 依赖 puppeteer-core + 本机 Edge；只在开发机上跑。 */
/* 虚拟数据模拟测试
   A) 「真实的一天」：14 个时段 / 12 个应用 / 含空档 → 截图 + 断言
   B) 边界：空日志 / 单条 / 6 小时大空洞 / 时间戳乱序 / 3000 条上限
   用法：node sim.cjs
*/
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');

const EXE = 'C:/Users/31701/Desktop/着陆/着陆.exe';
const UD = 'C:/Users/31701/AppData/Local/Temp/sim-ud';
const OUT = 'C:/Users/31701/AppData/Local/Temp/';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };
const ymd = (d) => { const z = (n) => ('0' + n).slice(-2); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
const M = 60000;

/* ============ 虚拟的一天（以"现在"结尾，往前排）============ */
function dayPlan() {
  return [
    ['WeChat', '微信', 30, 'social'],
    ['Code.exe', 'app.js - landing - Visual Studio Code', 70, 'work'],
    ['chrome', '黑马程序员｜C++教程从0到1入门编程', 25, 'study'],
    ['Code.exe', 'pet.js - landing - Visual Studio Code', 60, 'work'],
    ['WeChat', '微信', 25, 'social'],
    ['ApplicationFrameHost', '设置', 5, 'other'],
    ['Idle', '', 30, 'other'],                       /* 去吃饭，没人用 */
    ['java', 'Minecraft 1.20.1 - 单人游戏', 75, 'fun'],
    ['chrome', '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili', 35, 'fun'],
    ['devenv', 'landing.sln - Microsoft Visual Studio', 60, 'work'],
    ['WeChat', '微信', 30, 'social'],
    ['chrome', '算法导论 第2讲 讲解 - 哔哩哔哩', 40, 'study'],
    ['Idle', '', 40, 'other'],                       /* 晚饭 */
    ['java', 'Minecraft 1.20.1 - 单人游戏', 85, 'fun'],
    ['cloudmusic', '网易云音乐', 25, 'fun'],
    ['Typora.exe', '日记.md - Typora', 35, 'growth'],
  ];
}

function genDay() {
  const now = Date.now();
  const plan = dayPlan();
  const total = plan.reduce((a, x) => a + x[2], 0);
  const samples = [];
  let cursor = now - total * M;                     /* 从 total 分钟前开始 */
  for (const [proc, title, mins, cat] of plan) {
    for (let i = 0; i < mins; i++) samples.push({ at: cursor + i * M, proc: proc, title: title, cat: cat });
    cursor += mins * M;
  }
  return { samples, total, plan };
}

function writeLog(samples) {
  const dir = path.join(UD, 'activity');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'log-' + ymd(new Date()) + '.json'),
    JSON.stringify({ date: ymd(new Date()), samples: samples, shots: 0, bytes: 0, last: null }), 'utf8');
}

/* ============ 启动 / 读快照 ============ */
let proc = null, browser = null, page = null;
async function launch(port) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  proc = spawn(EXE, ['--user-data-dir=' + UD, '--remote-debugging-port=' + port], { env, stdio: 'ignore' });
  browser = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port, defaultViewport: null }); break; } catch (e) { }
  }
  if (!browser) throw new Error('应用没起来');
  page = (await browser.pages()).find(p => /index\.html|app\.asar/.test(p.url()));
  if (!page) { await new Promise(r => setTimeout(r, 3000)); page = (await browser.pages()).find(p => /index\.html|app\.asar/.test(p.url())); }
  await new Promise(r => setTimeout(r, 3200));
  await page.setViewport({ width: 1280, height: 1000 });
  await page.evaluate(() => {
    const q = window.Pet.state(); q.lastGreet = window.Landing.today(); q.widget.quiet = true;
    window.Landing.save();
    const w = document.getElementById('petWidget'); if (w) w.style.display = 'none';
  });
}
async function kill() {
  try { browser.disconnect(); } catch (e) { }
  try { proc.kill(); } catch (e) { }
  await new Promise(r => setTimeout(r, 1600));
}
const snap = () => page.evaluate(async () => await window.landing.activity.get());

(async () => {
  fs.rmSync(UD, { recursive: true, force: true });

  /* ============ A. 虚拟的一天 ============ */
  const { samples, total, plan } = genDay();
  writeLog(samples);
  console.log('=== A. 虚拟的一天 ===');
  console.log('  %d 个时段 / %d 条采样 / 共 %d 分钟', plan.length, samples.length, total);
  await launch(9430);

  const s = await snap();
  const appMap = {};
  (s.byApp || []).forEach(x => { appMap[x.proc] = Math.round((x.ms || 0) / M); });
  console.log('  总 ' + s.totalMin + ' 分钟　byCatMin=' + JSON.stringify(s.byCatMin));
  console.log('  byApp=' + JSON.stringify(appMap));
  ok('总时长 ≈ 670 分钟（±6）', Math.abs((s.totalMin || 0) - total) <= 6, s.totalMin);
  ok('Code.exe ≈ 130 分钟', Math.abs((appMap['Code.exe'] || 0) - 130) <= 3, appMap);
  ok('java ≈ 160 分钟', Math.abs((appMap['java'] || 0) - 160) <= 3, appMap);
  ok('WeChat ≈ 85 分钟', Math.abs((appMap['WeChat'] || 0) - 85) <= 3, appMap);
  ok('Idle ≈ 70 分钟', Math.abs((appMap['Idle'] || 0) - 70) <= 3, appMap);
  ok('分类齐全（5 类都有）',
     ['fun', 'work', 'study', 'social'].every(k => (s.byCatMin[k] || 0) > 0), s.byCatMin);
  ok('学习充电 ≈ 65 分钟（中文标题读得懂才会归到这里）',
     Math.abs((s.byCatMin.study || 0) - 65) <= 4, s.byCatMin);
  ok('byApp 按分钟降序', (s.byApp || []).every((x, i, a) => i === 0 || x.ms <= a[i - 1].ms));

  await page.evaluate(() => window.Landing.tab('today'));
  await new Promise(r => setTimeout(r, 1300));
  const card = await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('#view .card')).find(x => /今天在干什么/.test(x.innerText));
    return c ? { txt: c.innerText.replace(/\s+/g, ' '), rows: Array.from(c.querySelectorAll('.app-row')).map(r => r.innerText.replace(/\s+/g, ' ')) } : null;
  });
  console.log('  卡片：' + (card ? card.txt.slice(0, 130) : 'null'));
  console.log('  Top5：' + JSON.stringify(card && card.rows));
  ok('卡片在 + 有总时长', !!(card && /今天记录/.test(card.txt)));
  ok('Top5 是 5 条', !!(card && card.rows.length === 5), card && card.rows.length);
  ok('Top5 里**不再**出现「没在用程序」', !!(card && !card.rows.some(r => /没在用程序/.test(r))), card && card.rows);
  ok('友好名生效（VS Code / 微信 / 网易云音乐 至少两个）',
     !!(card && card.rows.filter(r => /VS Code|微信|网易云音乐|Chrome/.test(r)).length >= 2), card && card.rows);

  await page.evaluate(() => { const b = document.querySelector('[data-act="actRank"]'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 800));
  const sheet = await page.evaluate(() => {
    const el = document.querySelector('.sheet');
    return el ? { txt: el.innerText.replace(/\s+/g, ' '), rows: el.querySelectorAll('.app-row').length } : null;
  });
  ok('抽屉只列 7 个真应用（Idle/壳进程不算）', !!(sheet && sheet.rows === 7), sheet && sheet.rows);
  ok('抽屉里有「另有」那一行（系统窗口 + 没在用程序）',
     !!(sheet && /另有/.test(sheet.txt) && /没在用程序/.test(sheet.txt) && /系统窗口/.test(sheet.txt)), sheet && sheet.txt.slice(-220));
  await page.evaluate(() => { const b = document.querySelector('[data-act="closeSheet"]'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 400));

  await page.bringToFront();
  await new Promise(r => setTimeout(r, 400));
  await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('#view .card')).find(x => /今天在干什么/.test(x.innerText));
    if (c) c.scrollIntoView({ block: 'center' });
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: OUT + '模拟-一天-今日卡.png' });
  await page.evaluate(() => { const b = document.querySelector('[data-act="actRank"]'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 900));
  await page.screenshot({ path: OUT + '模拟-一天-完整排行.png' });
  console.log('  截图 ok');
  await kill();

  /* ============ B. 边界 ============ */
  console.log('\n=== B. 边界情况 ===');
  const cases = [
    { name: '空日志（0 条）', gen: () => [], check: (s) => s.totalMin === 0 },
    { name: '只有 1 条采样', gen: () => [{ at: Date.now() - 30000, proc: 'Code.exe', title: 'x', cat: 'work' }],
      check: (s) => s.totalMin >= 0 && s.totalMin <= 2 && !isNaN(s.totalMin) },
    { name: '6 小时大空洞（只该算 2 分钟）', gen: () => ([
        { at: Date.now() - 6 * 3600 * 1000, proc: 'java', title: 'Minecraft', cat: 'fun' },
        { at: Date.now() - 2 * 60000, proc: 'Idle', title: '', cat: 'other' }]),
      check: (s) => s.totalMin <= 4 && s.totalMin >= 1 },
    { name: '时间戳乱序（不许出负数/NaN）', gen: () => {
        const t = Date.now() - 600000;
        return [{ at: t + 300000, proc: 'a.exe', title: '', cat: 'work' },
                { at: t, proc: 'b.exe', title: '', cat: 'fun' },
                { at: t + 120000, proc: 'c.exe', title: '', cat: 'fun' }];
      },
      check: (s) => (!isNaN(s.totalMin) && s.totalMin >= 0 && s.totalMin < 600) },
    { name: '3000 条上限（50 个应用）', gen: () => {
        const t = Date.now() - 3000 * 60000, out = [];
        for (let i = 0; i < 3000; i++) out.push({ at: t + i * 60000, proc: 'app' + (i % 50) + '.exe', title: '', cat: 'work' });
        return out;
      },
      check: (s) => (s.byApp || []).length === 40 && s.totalMin > 2000 && s.totalMin < 3001 },
  ];
  let port = 9431;
  for (const c of cases) {
    fs.rmSync(UD, { recursive: true, force: true });
    const data = c.gen();
    writeLog(data);
    await launch(port++);
    const s2 = await snap();
    let good = false, extra = '';
    try { good = !!c.check(s2); } catch (e) { extra = e.message; }
    console.log('  ' + c.name + ' → count=' + s2.count + ' totalMin=' + s2.totalMin
      + ' byApp=' + (s2.byApp || []).length);
    ok(c.name, good, extra || { count: s2.count, totalMin: s2.totalMin });
    /* 顺便确认界面不炸 */
    const ui = await page.evaluate(() => {
      try { window.Landing.tab('today'); return document.getElementById('view').innerHTML.length; } catch (e) { return -1; }
    });
    ok('  ↳ 今日页不炸', ui > 200, ui);
    await kill();
  }

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.stack); try { browser.disconnect(); } catch (x) { } try { proc.kill(); } catch (x) { } process.exit(2); });
