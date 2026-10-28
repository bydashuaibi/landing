'use strict';
// Only JSON metadata and a decoded image leave a skin archive. No pack code runs.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const LIMIT=24*1024*1024,IMAGE_LIMIT=32*1024*1024;
const HOME='https://petdex.dev/collections/franchise-bang-dream';
function archiveFiles(buf){
  if(!Buffer.isBuffer(buf)||buf.length>LIMIT)throw Error('皮肤包不能超过 24 MB');
  let end=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50&&i+22+buf.readUInt16LE(i+20)===buf.length){end=i;break;}
  if(end<0)throw Error('这不是有效的 ZIP 皮肤包');
  if(buf.readUInt16LE(end+4)||buf.readUInt16LE(end+6))throw Error('不支持分卷 ZIP');
  const count=buf.readUInt16LE(end+10),out=new Map();let at=buf.readUInt32LE(end+16);
  if(count>200||count===65535)throw Error('皮肤包文件过多');
  for(let n=0;n<count;n++){
    if(at+46>end||buf.readUInt32LE(at)!==0x02014b50)throw Error('ZIP 目录损坏');
    const flags=buf.readUInt16LE(at+8),method=buf.readUInt16LE(at+10),size=buf.readUInt32LE(at+24),compressed=buf.readUInt32LE(at+20),nl=buf.readUInt16LE(at+28),extra=buf.readUInt16LE(at+30),comment=buf.readUInt16LE(at+32),offset=buf.readUInt32LE(at+42);
    if(at+46+nl+extra+comment>end)throw Error('ZIP 目录不完整');
    const name=buf.subarray(at+46,at+46+nl).toString('utf8').replace(/\\/g,'/');at+=46+nl+extra+comment;
    if(name.startsWith('/')||name.includes('\0')||name.split('/').some(x=>x==='..'||x.includes(':')))throw Error('皮肤包含有不安全的文件路径');
    if(!/(?:^|\/)pet\.json$|\.(?:webp|png)$/i.test(name))continue;
    if(flags&1||![0,8].includes(method)||size>IMAGE_LIMIT||compressed>LIMIT||offset+30>buf.length||buf.readUInt32LE(offset)!==0x04034b50)throw Error('皮肤文件格式或大小不支持');
    const start=offset+30+buf.readUInt16LE(offset+26)+buf.readUInt16LE(offset+28);
    if(start+compressed>buf.length)throw Error('皮肤文件不完整');
    const raw=buf.subarray(start,start+compressed),data=method===8?zlib.inflateRawSync(raw,{maxOutputLength:IMAGE_LIMIT}):Buffer.from(raw);
    if(data.length!==size||out.has(name))throw Error('皮肤文件重复或长度错误');out.set(name,data);
  }
  return out;
}
function imageSize(b){
  if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR')return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
    const chunk=b.toString('ascii',12,16);
    if(chunk==='VP8X')return {width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};
    if(chunk==='VP8 '&&b[23]===0x9d&&b[24]===1&&b[25]===0x2a)return {width:b.readUInt16LE(26)&16383,height:b.readUInt16LE(28)&16383};
    if(chunk==='VP8L'&&b[20]===0x2f)return {width:1+((b[22]&63)<<8|b[21]),height:1+((b[24]&15)<<10|b[23]<<2|b[22]>>6)};
  }
  throw Error('图片头部不是支持的 PNG 或 WebP');
}
function parsePack(buf){
  const files=archiveFiles(buf),manifests=[...files.keys()].filter(k=>/(?:^|\/)pet\.json$/i.test(k));
  if(manifests.length!==1)throw Error('ZIP 中需要有一份 pet.json 和对应的 spritesheet 图片');
  const manifest=manifests[0];if(files.get(manifest).length>65536)throw Error('pet.json 太大');
  let meta;try{meta=JSON.parse(files.get(manifest).toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('pet.json 不是有效的 JSON');}
  const imagePath=String(meta.spritesheetPath||'spritesheet.webp').replace(/\\/g,'/');
  if(imagePath.startsWith('/')||imagePath.split('/').some(k=>k==='..'||k.includes(':'))||!/^.+\.(webp|png)$/i.test(imagePath))throw Error('皮肤图片必须是包内的 PNG 或 WebP');
  const key=path.posix.join(path.posix.dirname(manifest),imagePath),image=files.get(key);
  if(!image)throw Error('找不到 pet.json 指定的图片');
  const size=imageSize(image);
  if(size.width%8||size.height%9||size.width/8<16||size.width/8>512||size.height/9<16||size.height/9>512)throw Error('目前支持 Petdex / Codex 标准 8 列 × 9 行动态图集（每帧 16～512 像素）');
  return {id:'skin-'+crypto.createHash('sha256').update(image).update(files.get(manifest)).digest('hex').slice(0,24),name:String(meta.displayName||meta.id||'新伙伴').slice(0,60),description:String(meta.description||'从 Petdex 导入的伙伴').slice(0,300),image,ext:path.extname(imagePath).toLowerCase(),frameWidth:size.width/8,frameHeight:size.height/9};
}
function petdexURL(value,asset=false){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;return asset?u.hostname==='assets.petdex.dev'&&/^\/pets\/[^/]+\/[^?]+\.zip$/i.test(u.pathname):u.hostname==='petdex.dev';}catch{return false;}}
module.exports=function setup({getMain,getDesktop,showDesktop,desktopStatus,i18n}){
  const {app,BrowserWindow,WebContentsView,ipcMain,dialog,net,session,shell}=require('electron');
  const root=path.join(app.getPath('userData'),'data','pet-skins'),dbFile=path.join(root,'skins.json');let win=null,browser=null,mode='web',busy=false,lastStatus='',statusKind='info',lastImported=null;
  fs.mkdirSync(root,{recursive:true});
  let db={active:'uika',skins:[]};try{const d=JSON.parse(fs.readFileSync(dbFile,'utf8'));if(Array.isArray(d.skins))db={active:d.active,skins:d.skins.filter(x=>/^skin-[a-f0-9]{24}$/.test(x.id))};}catch{}
  const builtin={id:'uika',name:'Uika · 初华',description:'内置的初华像素伙伴',builtin:true,frameWidth:192,frameHeight:208,source:HOME};
  db.skins=db.skins.filter(s=>['.png','.webp'].includes(s.ext)&&fs.existsSync(path.join(root,s.id,'image'+s.ext)));
  if(db.active!=='uika'&&!db.skins.some(s=>s.id===db.active))db.active='uika';
  const windows=()=>[getMain(),...(getDesktop?getDesktop():[]),win].filter(w=>w&&!w.isDestroyed());
  const trusted=e=>windows().some(w=>w.webContents===e.sender);
  const manager=e=>win&&!win.isDestroyed()&&win.webContents===e.sender;
  const save=()=>{fs.writeFileSync(dbFile+'.next',JSON.stringify(db));fs.renameSync(dbFile+'.next',dbFile);};
  const state=()=>({active:db.active,skins:[builtin,...db.skins],busy,status:lastStatus,statusKind,lastImported,mode,desktop:desktopStatus?desktopStatus():{enabled:false,visible:false}});
  function asset(id){
    const m=id==='uika'?builtin:db.skins.find(x=>x.id===id);if(!m)throw Error('没有找到这个皮肤');
    if(id==='uika')return {...builtin,image:'assets/pet/petdex/uika/spritesheet.webp'};
    const bytes=fs.readFileSync(path.join(root,id,'image'+m.ext));
    return {...m,image:'data:image/'+(m.ext==='.png'?'png':'webp')+';base64,'+bytes.toString('base64')};
  }
  function notify(message,kind='info'){if(message!==undefined){lastStatus=message;statusKind=kind;}if(win&&!win.isDestroyed())win.webContents.send('skins:state',state());}
  function broadcast(){let selected;try{selected=asset(db.active);}catch{db.active='uika';save();selected=asset('uika');notify('上次的皮肤文件不可用，已恢复初华。','error');}windows().forEach(w=>w.webContents.send('skins:active',selected));}
  function apply(id){asset(id);db.active=id;save();if(showDesktop)showDesktop();broadcast();notify('换好了，伙伴已经来到桌面。属性、物品和回忆都保留着。','success');return state();}
  async function install(bytes,source){
    const p=parsePack(bytes);
    if(!win||win.isDestroyed())throw Error('请重新打开换肤窗口后再导入');
    const data='data:image/'+(p.ext==='.png'?'png':'webp')+';base64,'+p.image.toString('base64');
    const decoded=await win.webContents.executeJavaScript('new Promise(resolve=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=()=>resolve(null);image.src='+JSON.stringify(data)+';})');
    if(!decoded||decoded[0]!==p.frameWidth*8||decoded[1]!==p.frameHeight*9)throw Error('皮肤图片无法解码，请重新下载完整的 ZIP');
    if(!db.skins.some(x=>x.id===p.id)){
      if(db.skins.length>=40)throw Error('最多保存 40 个皮肤');
      const dir=path.join(root,p.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'image'+p.ext),p.image);
      const {image,...meta}=p;db.skins.push({...meta,source,addedAt:Date.now()});save();
    }
    lastImported=p.id;notify('「'+p.name+'」已加入皮肤库。预览后点“换上这个”。','success');return state();
  }
  async function work(fn){if(busy)return state();busy=true;notify('正在读取皮肤包…');try{await fn();}catch(e){notify(e.message||'这次导入没有成功，请重试或导入本地 ZIP。','error');}finally{busy=false;notify();}return state();}
  async function download(url){
    if(!petdexURL(url,true)){notify('请使用 Petdex 官方资源包链接，或点击网站里的下载。','error');return state();}
    return work(async()=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);try{
      let next=url,response;
      for(let i=0;i<4;i++){response=await net.fetch(next,{signal:controller.signal,redirect:'manual'});if(response.status>=300&&response.status<400){const loc=new URL(response.headers.get('location'),next).href;if(!petdexURL(loc,true))throw Error('资源包跳转到了不支持的地址');next=loc;continue;}break;}
      if(!response||!response.ok)throw Error('Petdex 下载暂时不可用，请稍后重试或导入下载好的 ZIP。');
      if(Number(response.headers.get('content-length'))>LIMIT)throw Error('皮肤包超过 24 MB');
      const chunks=[];let length=0;const reader=response.body.getReader();
      while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>LIMIT){await reader.cancel();throw Error('皮肤包超过 24 MB');}chunks.push(Buffer.from(value));}
      return install(Buffer.concat(chunks),url);
    }finally{clearTimeout(timeout);}});
  }
  function layout(){if(!win||!browser)return;const [w,h]=win.getContentSize();browser.setBounds(mode==='web'?{x:320,y:112,width:Math.max(1,w-320),height:Math.max(1,h-112)}:{x:0,y:h+10,width:1,height:1});}
  function browse(raw){const url=petdexURL(raw)?raw:HOME;mode='web';layout();notify('正在打开 Petdex…');browser.webContents.loadURL(url).catch(()=>notify('Petdex 暂时没连上。可点“重试”，或导入已经下载的 ZIP。','error'));return state();}
  function open(){
    if(win&&!win.isDestroyed()){win.show();win.focus();return true;}
    win=new BrowserWindow({width:1200,height:800,minWidth:880,minHeight:650,title:i18n?i18n.t('换个伙伴外观 · 着陆'):'StudyTrail · Skins',backgroundColor:'#cbcfb8',parent:getMain(),show:false,webPreferences:{preload:path.join(__dirname,'pet-skins-window-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const remote=session.fromPartition('persist:landing-petdex');remote.setPermissionRequestHandler((_w,_p,cb)=>cb(false));remote.setPermissionCheckHandler(()=>false);
    browser=new WebContentsView({webPreferences:{session:remote,contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});win.contentView.addChildView(browser);
    const wc=browser.webContents;
    wc.setWindowOpenHandler(({url})=>{if(petdexURL(url,true))download(url);else if(petdexURL(url))browse(url);return {action:'deny'};});
    const navigate=(e,url)=>{if(petdexURL(url,true)){e.preventDefault();download(url);}else if(!petdexURL(url))e.preventDefault();};wc.on('will-navigate',navigate);wc.on('will-redirect',navigate);
    const downloaded=(e,item,contents)=>{if(contents!==wc)return;e.preventDefault();download(item.getURL());};remote.on('will-download',downloaded);
    wc.on('did-finish-load',()=>notify('在 Petdex 找到喜欢的角色，点下载即可导入。'));wc.on('did-fail-load',(_e,code,_desc,_url,main)=>{if(main&&code!==-3)notify('Petdex 暂时没连上。可重试，或导入本地 ZIP。','error');});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==win.webContents.getURL())e.preventDefault();});
    win.on('resize',layout);win.once('ready-to-show',()=>{win.show();layout();browse(HOME);});
    win.on('closed',()=>{remote.removeListener('will-download',downloaded);if(!wc.isDestroyed())wc.close();browser=null;win=null;});
    win.loadFile(path.join(__dirname,'pet-skins-window.html'));return true;
  }
  ipcMain.handle('skins:open',e=>trusted(e)?open():false);
  ipcMain.handle('skins:state',e=>trusted(e)?state():null);
  ipcMain.handle('skins:asset',(e,id)=>trusted(e)?asset(String(id)):null);
  ipcMain.handle('skins:apply',(e,id)=>manager(e)?apply(String(id)):null);
  ipcMain.handle('skins:desktop',e=>{if(!manager(e))return null;if(showDesktop)showDesktop();notify('已显示到桌面，可以收起主窗口，让伙伴继续陪你。','success');return state();});
  ipcMain.handle('skins:mode',(e,m)=>{if(!manager(e))return null;mode=m==='library'?'library':'web';layout();notify();return state();});
  ipcMain.handle('skins:browse',(e,url)=>manager(e)?browse(String(url||HOME)):null);
  ipcMain.handle('skins:download',(e,url)=>manager(e)?download(String(url)):null);
  ipcMain.handle('skins:external',e=>{if(manager(e))shell.openExternal(HOME);});
  ipcMain.handle('skins:import',async e=>{
    if(!manager(e)||busy)return state();
    const picked=await dialog.showOpenDialog(win,{title:'导入 Petdex 皮肤 ZIP',filters:[{name:'Petdex 皮肤包',extensions:['zip']}],properties:['openFile']});
    if(picked.canceled)return state();return work(async()=>{const file=picked.filePaths[0];if(fs.statSync(file).size>LIMIT)throw Error('皮肤包不能超过 24 MB');return install(fs.readFileSync(file),'本地导入');});
  });
  return {open,getWindows:()=>win&&!win.isDestroyed()?[win]:[],state,asset};
};
module.exports.parsePack=parsePack;module.exports.archiveFiles=archiveFiles;module.exports.petdexURL=petdexURL;
