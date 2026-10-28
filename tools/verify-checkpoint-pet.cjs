'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { _electron: electron } = require('C:/Users/31701/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const qa = path.join(root, 'verification-checkpoint-pet');
fs.mkdirSync(qa, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-checkpoint-pet-qa-'));
fs.mkdirSync(path.join(profile, 'data'), { recursive: true });
fs.writeFileSync(path.join(profile, 'data', 'prefs.json'), JSON.stringify({ activity: { enabled: false, ask: false }, closeAction: 'quit', desktopPet: {enabled:false} }));
const harness = path.join(profile, 'main.cjs');
const targetMain = process.env.LANDING_QA_ASAR === '1' ? path.join(root, 'app.asar', 'main.js') : path.join(root, '_stage', 'main.js');
fs.writeFileSync(harness, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(targetMain)});`);
// Packaged Electron ignores an app-path argument. Give QA its own resources/app and data directory.
const runtime = path.join(profile, 'runtime');
fs.mkdirSync(path.join(runtime, 'resources', 'app'), { recursive: true });
for (const entry of fs.readdirSync(path.join(root, '着陆'), { withFileTypes: true })) {
  if (entry.isFile()) fs.linkSync(path.join(root, '着陆', entry.name), path.join(runtime, entry.name));
  else if (entry.name === 'locales') fs.symlinkSync(path.join(root, '着陆', entry.name), path.join(runtime, entry.name), 'junction');
}
fs.writeFileSync(path.join(runtime, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'landing-discipline-qa', main: 'main.cjs' }));
fs.copyFileSync(harness, path.join(runtime, 'resources', 'app', 'main.cjs'));
const results = [], errors = [], requests = [];
let app, page, mockServer, mockBase, mode = 'ok';
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('landing.v2')));
const click = (action, suffix = '') => page.locator(`[data-ds="${action}"]${suffix}`).first().click();
async function test(name, fn) { await fn(); results.push(name); console.log('PASS ' + name); }
async function fixture() {
  await app.evaluate(async ({BrowserWindow, screen}) => {
    const main = BrowserWindow.getAllWindows()[0], bounds = screen.getDisplayMatching(main.getBounds()).bounds;
    if (global.__qaFixture && !global.__qaFixture.isDestroyed()) global.__qaFixture.destroy();
    const win = new BrowserWindow({ ...bounds, frame: false, show: false, skipTaskbar: true, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:0;background:#16283d;color:#f5f9ff;font:30px sans-serif"><main style="padding:10vh 8vw"><h1>PyTorch — Tensor shape</h1><p>Lesson 6 · reshape and dimensions</p><pre>import torch\nx = torch.arange(12).reshape(3,4)\nprint(x.shape)  # torch.Size([3, 4])</pre><p style="margin-top:18vh">01:02:35 / 01:40:00</p><div style="height:8px;background:#7dc6ea;width:62%"></div></main></body>'));
    global.__qaFixture = win; win.showInactive(); main.show(); main.focus();
  });
}
async function destroyFixture() { await app.evaluate(() => { if (global.__qaFixture && !global.__qaFixture.isDestroyed()) global.__qaFixture.destroy(); }); }
async function screenshot() {
  await fixture();
  await click('captureProgress', '[data-track="pytorch"]');
  await page.locator('#lc-form').waitFor();
  await destroyFixture();
}
async function recognize() {
  await page.locator('[data-lc="recognize"]').click();
  await page.waitForFunction(() => { const b = document.querySelector('[data-lc="recognize"]'); return b && !b.disabled; });
}
async function run() {
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: path.join(runtime, 'electron.exe'), args: ['--hidden'], env, timeout: 30000 });
  assert.equal(await app.evaluate(({app}) => app.getPath('userData')), profile);
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({BrowserWindow}) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setBackgroundThrottling(false); w.show(); });
  await page.waitForFunction(() => window.Landing && window.LearningCheckpoint && window.Pet);
  await page.route('https://**/*', r => r.abort());
  const http = require('http');
  mockServer = http.createServer((req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','*');
    if(req.method==='OPTIONS') { res.writeHead(204); res.end(); return; }
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      requests.push(JSON.parse(body));
      if(mode==='error') { res.writeHead(400);res.end('This model does not support image input');return; }
      const result = mode==='unknown' ? {title:'<img src=x onerror="window.qaInjected=1">',position:'not visible',topic:'张量维度',next:'接着当前画面运行 reshape 例子',url:'javascript:alert(1)',uncertainty:'看不见时间点'} : {title:'PyTorch 入门 · 第 6 节',position:'1:02:35',topic:'Tensor 的 shape 与 reshape',next:'从 reshape(3, 4) 继续，运行代码确认维度',url:'https://www.bilibili.com/video/BVqa?p=6',uncertainty:'请核对课程分 P 与当前时间'};
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
    });
  });
  await new Promise(resolve=>mockServer.listen(0,'127.0.0.1',resolve));
  mockBase='http://127.0.0.1:'+mockServer.address().port+'/v1';
  await test('pet returns to home, survives rendering and tab changes without duplicate canvases', async () => {
    assert.equal(await page.locator('#ds-pet-host #petWidget').count(), 1);
    assert.equal(await page.locator('#ds-pet-host canvas').isVisible(), true);
    await page.evaluate(() => { Landing.state().pet.name='原来的伙伴'; Landing.state().pet.fish=42; Landing.save(); Landing.render(); Landing.render(); });
    assert.equal(await page.locator('#petWidget').count(),1);
    await page.evaluate(() => Landing.tab('pet'));
    assert.equal(await page.locator('body > #petWidget').count(),1);
    await page.evaluate(() => Landing.tab('today'));
    assert.equal(await page.locator('#ds-pet-host #petWidget canvas').count(),1);
    assert.equal((await state()).pet.name,'原来的伙伴'); assert.equal((await state()).pet.fish,42);
  });
  await test('new pet actions visibly animate the existing sprite and cooldown prevents repeated rewards', async () => {
    const before = (await state()).pet.intimacy;
    const canvas = page.locator('#ds-pet-host canvas');
    const still = await canvas.screenshot();
    await click('petAction','[data-pet-action="wave"]');
    assert.equal(await canvas.getAttribute('data-motion'),'wave');
    await page.waitForTimeout(100); assert.notDeepEqual(await canvas.screenshot(),still);
    const once = (await state()).pet.intimacy; assert.equal(once,before+1);
    await click('petAction','[data-pet-action="wave"]'); assert.equal((await state()).pet.intimacy,once);
    await click('petAction','[data-pet-action="highfive"]'); assert.equal(await canvas.getAttribute('data-motion'),'highfive');
    await click('petAction','[data-pet-action="hug"]'); assert.equal(await canvas.getAttribute('data-motion'),'hug');
    await click('petAction','[data-pet-action="study"]'); assert.equal((await state()).pet.studyMode,true); assert.equal(await canvas.getAttribute('data-focus'),'true');
    await page.screenshot({path:path.join(qa,'pet-home.png'),fullPage:true});
    await click('petAction','[data-pet-action="study"]'); assert.equal((await state()).pet.studyMode,false);
    await page.evaluate(() => { Pet.hide(); Landing.render(); });
    assert.equal(await page.locator('#petWidget').isVisible(),false);
    await click('petShow'); assert.equal(await page.locator('#petWidget').isVisible(),true);
  });
  await test('capture takes two real desktop frames, hides Landing, previews locally, and does not upload automatically', async () => {
    const badDisplay = await page.evaluate(() => window.landing.learning.capture('__disconnected__'));
    assert(badDisplay.error.includes('屏幕已断开'));
    await screenshot();
    assert.equal(await page.locator('[data-lc="frame"]').count(),2);
    const src = await page.locator('#lc-preview').getAttribute('src'); assert(src.startsWith('data:image/jpeg;base64,')); assert(src.length>10000);
    assert.equal(await page.locator('[data-lc="recognize"]').isDisabled(),true);
    assert.equal(requests.length,0); assert.equal((await state()).discipline.learning.tracks[1].resume,undefined);
    await page.screenshot({path:path.join(qa,'capture-preview.png'),fullPage:true});
    await page.locator('[data-lc="cancel"]').click();
    assert.equal((await state()).discipline.learning.tracks[1].resume,undefined);
  });
  await test('timer ending during checkpoint editing preserves the screenshot and unsaved input', async () => {
    await click('prepare','[data-track="python"]'); await click('learnStart');
    await screenshot(); await page.locator('#lc-next').fill('这个正在编辑的断点不能丢');
    await page.evaluate(()=>{Landing.state().timer.endsAt=Date.now()-100;Landing.save();});
    await page.waitForFunction(()=>Landing.state().timer.finished);
    assert.equal(await page.locator('#lc-next').inputValue(),'这个正在编辑的断点不能丢');
    assert.equal(await page.locator('#lc-form').count(),1);
    await page.locator('[data-lc="cancel"]').click(); await click('settle'); await click('confirm');
    assert.equal((await state()).timer,null);
  });
  await test('vision sends only the two previewed frames and result stays editable until confirmed', async () => {
    await page.evaluate(base => { Object.assign(Landing.state().settings,{aiBaseUrl:base,aiKey:'qa-test-only',aiModel:'qa-vision'}); Landing.state().discipline.learning.tracks[1].url='https://www.bilibili.com/video/BVqa?p=6'; Landing.save(); }, mockBase);
    await screenshot(); await recognize();
    assert.equal(requests.length,1); assert.equal(requests[0].messages[1].content.filter(c=>c.type==='image_url').length,2);
    assert.equal(requests[0].max_tokens,1200);
    assert.equal(await page.locator('#lc-position').inputValue(),'1:02:35', await page.locator('#lc-status').textContent());
    assert.equal((await state()).discipline.learning.tracks[1].resume,undefined);
    await page.locator('#lc-next').fill('从 reshape(3, 4) 继续，先打印 shape 验证');
    await page.locator('#lc-form button[type="submit"]').click();
    const t=(await state()).discipline.learning.tracks[1];
    assert.equal(t.resume.positionSeconds,3755); assert.equal(t.resume.next,'从 reshape(3, 4) 继续，先打印 shape 验证');
    assert(t.resume.thumbnail.length<200000); assert.equal(t.captures.length,1); assert.equal(t.resume.frames,undefined);
    const url = await page.evaluate(() => LearningCheckpoint.resumeURL(Landing.state().discipline.learning.tracks[1]));
    assert.equal(new URL(url).searchParams.get('t'),'3750'); assert.equal(new URL(url).searchParams.get('p'),'6');
    await page.reload(); await page.waitForFunction(() => window.Landing && window.LearningCheckpoint);
    assert.equal((await state()).discipline.learning.tracks[1].resume.positionSeconds,3755);
    assert((await page.locator('.lc-resume-summary').textContent()).includes('1:02:35'));
    await click('captureHistory','[data-track="pytorch"]');
    assert.equal(await page.locator('.lc-history-item img').count(),1);
    await page.getByRole('button', {name:'关闭弹窗',exact:true}).click();
  });
  await test('vision failure retains screenshots and permits retry, manual editing, and invalid time correction', async () => {
    mode='error'; await screenshot(); await recognize();
    assert((await page.locator('#lc-status').textContent()).includes('识别没成功'));
    assert.equal(await page.locator('#lc-next').isEnabled(),true);
    await page.locator('#lc-next').fill('失败后手动记录，继续看当前例子'); await page.locator('#lc-position').fill('99:99');
    await page.locator('#lc-form button[type="submit"]').click(); assert.equal(await page.locator('#lc-form').count(),1);
    assert((await page.locator('#lc-status').textContent()).includes('时间请填'));
    mode='ok'; await recognize(); assert.equal(await page.locator('#lc-position').inputValue(),'1:02:35');
    await page.locator('[data-lc="cancel"]').click();
    assert.equal((await state()).discipline.learning.tracks[1].captures.length,1);
  });
  await test('unknown positions remain unknown, unsafe model URLs are discarded, and generated HTML stays text', async () => {
    mode='unknown'; await page.evaluate(() => { Landing.state().discipline.learning.tracks[1].url=''; Landing.save(); });
    await screenshot(); await recognize();
    assert.equal(await page.locator('#lc-position').inputValue(),''); assert.equal(await page.locator('#lc-url').inputValue(),'');
    await page.locator('#lc-form button[type="submit"]').click();
    const t=(await state()).discipline.learning.tracks[1]; assert.equal(t.resume.positionSeconds,null); assert.equal(t.url,'');
    assert.equal(await page.locator('.lc-resume-summary img').count(),0); assert.equal(await page.evaluate(()=>window.qaInjected),undefined);
    await click('captureHistory','[data-track="pytorch"]');
    await page.locator('[data-lc="restore"]').nth(1).click();
    assert.equal((await state()).discipline.learning.tracks[1].resume.positionSeconds,3755);
    await click('captureHistory','[data-track="pytorch"]'); await page.locator('[data-lc="delete"]').first().click();
    assert.equal((await state()).discipline.learning.tracks[1].captures.length,1);
    await page.getByRole('button', {name:'关闭弹窗',exact:true}).click();
  });
  await test('retaking invalidates pending preview, saved history stays bounded, and manual screenshot works without AI', async () => {
    await page.evaluate(() => { const s=Landing.state(),t=s.discipline.learning.tracks[1],base=t.captures[0]; t.captures=Array.from({length:8},(_,i)=>({...base,id:'qa-old-'+i})); s.settings.aiKey=''; Landing.save(); });
    await screenshot();
    await fixture(); await page.locator('[data-lc="retake"]').click(); await page.locator('#lc-form').waitFor(); await destroyFixture();
    await page.locator('#lc-title').fill('手动保存的学习画面'); await page.locator('#lc-next').fill('回到这个例子继续验证');
    const savedBefore = (await state()).discipline.learning.tracks[1].resume.id;
    await page.evaluate(() => { window.qaSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'landing.v2') throw new DOMException('Quota full','QuotaExceededError'); return window.qaSetItem.call(this,key,value); }; });
    await page.locator('#lc-form button[type="submit"]').click();
    assert((await page.locator('#lc-status').textContent()).includes('本地空间不足'));
    assert.equal(await page.locator('#lc-next').inputValue(),'回到这个例子继续验证');
    assert.equal(await page.evaluate(()=>Landing.state().discipline.learning.tracks[1].resume.id),savedBefore);
    await page.evaluate(() => { Storage.prototype.setItem = window.qaSetItem; delete window.qaSetItem; });
    await page.locator('#lc-form button[type="submit"]').click();
    const t=(await state()).discipline.learning.tracks[1]; assert.equal(t.captures.length,8); assert.equal(t.resume.recognized,false);
    assert.equal(t.resume.title,'手动保存的学习画面'); assert.equal(t.resume.positionSeconds,null);
    assert.equal(await page.locator('#ds-pet-host canvas').isVisible(),true);
  });
  await test('focus automatically enables quiet companion mode and pausing removes it', async () => {
    await click('prepare','[data-track="pytorch"]'); await click('learnStart');
    assert.equal(await page.locator('#ds-pet-host canvas').getAttribute('data-focus'),'true');
    await click('pause'); assert.equal(await page.locator('#ds-pet-host canvas').getAttribute('data-focus'),'false');
    await click('settle'); await click('confirm');
    assert.equal((await state()).pet.fish,42);
  });
  await test('pet details animate the large sprite and responsive preview and home do not overflow', async () => {
    await page.evaluate(() => { Landing.state().pet.cd.wave=0; Landing.tab('pet'); });
    await page.locator('#petPage [data-pact="act"][data-id="wave"]').click();
    assert.equal(await page.locator('#pgCat canvas').getAttribute('data-motion'),'wave');
    await page.evaluate(() => Landing.tab('today'));
    await page.setViewportSize({width:540,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(qa,'home-narrow.png'),fullPage:true});
    await screenshot(); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(qa,'preview-narrow.png'),fullPage:true});
    await page.locator('[data-lc="cancel"]').click(); assert.deepEqual(errors,[]);
  });
}
run().then(async () => {
  fs.writeFileSync(path.join(qa,'result.json'),JSON.stringify({status:'passed',checks:results,rendererErrors:errors,vision:'Local mocked endpoint; real desktop capture; no screenshot sent externally',profile},null,2));
  await app.close(); if(mockServer) mockServer.close(); console.log('Verified '+results.length+' checkpoint/pet workflows.');
}).catch(async error => {
  console.error(error); fs.writeFileSync(path.join(qa,'result.json'),JSON.stringify({status:'failed',checks:results,error:error.stack,rendererErrors:errors,profile},null,2));
  if(page) await page.screenshot({path:path.join(qa,'failure.png'),fullPage:true}).catch(()=>{});
  if(app) await app.close().catch(()=>{}); if(mockServer) mockServer.close(); process.exitCode=1;
});
