/* Petdex Uika: native 192 × 208 frames, never cut apart or stretch the character. */
(function () {
  'use strict';
  var instances=[],counts=[6,8,8,4,5,8,6,6,6],serial=0;
  function model(asset){var m={id:asset.id,fw:asset.frameWidth||192,fh:asset.frameHeight||208,image:new Image()};m.image.src=asset.image;return m;}
  var current=model({id:'uika',image:'assets/pet/petdex/uika/spritesheet.webp',frameWidth:192,frameHeight:208});
  function applySkin(asset){var rev=++serial,next=model(asset);function ready(){if(rev!==serial)return;current=next;instances.forEach(function(i){i.syncVisibility();});window.dispatchEvent(new CustomEvent('pet-skin-changed',{detail:{id:next.id,name:asset.name}}));}
    if(next.image.complete&&next.image.naturalWidth)ready();else next.image.addEventListener('load',ready,{once:true});
  }
  if(window.petSkins){petSkins.onActive(applySkin);petSkins.state().then(function(s){if(s)return petSkins.asset(s.active);}).then(function(a){if(a&&serial===0)applySkin(a);}).catch(function(){/* Keep the built-in skin available offline. */});}

  function mount(el, opts) {
    opts = opts || {};
    var override=opts.skin?model(opts.skin):null;
    function loaded(){sync();}
    if(override)override.image.addEventListener('load',loaded);
    var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    canvas.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated';
    canvas.setAttribute('aria-hidden', 'true'); canvas.dataset.rig = 'petdex-atlas';
    el.appendChild(canvas);
    var media = matchMedia('(prefers-reduced-motion: reduce)'), state = {}, gear = opts.gear || {}, fx = null, startAt = performance.now(), raf = 0, disposed = false, visible = true, lastTick = 0, head = !!opts.headOnly;
    function gentle() { return media.matches || state.gentle; }
    function pose(now) {
      if (fx && now >= fx.until) { fx = null; delete canvas.dataset.motion; }
      if (fx) return fx.row;
      return state.sleeping ? 5 : state.daze ? 8 : state.focus ? 6 : 0;
    }
    function draw(now) {
      if (disposed) return;
      now = now || performance.now();
      var skin=override||current,sheet=skin.image;canvas.dataset.skin=skin.id;
      var row = pose(now), tick = gentle() ? 0 : Math.floor((now - (fx ? fx.at : startAt)) / (row === 0 ? 180 : 125));
      var frame = row === 5 ? Math.min(counts[row]-1, tick) : tick % counts[row];
      canvas.dataset.row = String(row); canvas.dataset.frame = String(frame);
      canvas.dataset.focus = String(!!state.focus); canvas.dataset.gentle = String(!!gentle());
      canvas.dataset.gear = JSON.stringify(gear);
      ctx.clearRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingEnabled = false;
      if (!sheet.complete || !sheet.naturalWidth) return;
      var sw = skin.fw, sh = head ? Math.round(skin.fh*112/208) : skin.fh, scale = Math.min(canvas.width/sw, canvas.height/sh);
      var w = Math.round(sw*scale), h = Math.round(sh*scale);
      ctx.drawImage(sheet,frame*skin.fw,row*skin.fh,sw,sh,Math.round((canvas.width-w)/2),canvas.height-h,w,h);
      // Keep the accessories already owned in the original save, above the untouched atlas.
      if (skin.id==='uika' && [0,3,6,8].indexOf(row)>=0 && gear) {
        ctx.save();ctx.translate(Math.round((canvas.width-w)/2),canvas.height-h);ctx.scale(scale,scale);
        if(gear.head==='crown'){ctx.fillStyle='#e9bd53';ctx.strokeStyle='#715736';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(76,16);ctx.lineTo(73,3);ctx.lineTo(85,9);ctx.lineTo(96,0);ctx.lineTo(106,9);ctx.lineTo(118,3);ctx.lineTo(115,16);ctx.closePath();ctx.fill();ctx.stroke();}
        if(gear.face==='glasses'){ctx.fillStyle='#2c2939';ctx.fillRect(73,67,19,11);ctx.fillRect(98,67,19,11);ctx.fillRect(91,70,8,3);ctx.fillStyle='#8fa9bc';ctx.fillRect(76,69,7,2);ctx.fillRect(101,69,7,2);}
        if(gear.neck==='scarf'){ctx.fillStyle='#bd6a63';ctx.fillRect(81,99,29,7);ctx.fillRect(101,105,7,22);ctx.fillStyle='#e3aaa0';ctx.fillRect(82,100,27,2);}
        if(gear.head==='ribbon'){ctx.fillStyle='#a75269';ctx.fillRect(108,25,12,13);ctx.fillRect(124,24,12,13);ctx.fillRect(118,28,9,9);ctx.fillStyle='#e7a3b0';ctx.fillRect(111,27,5,7);ctx.fillRect(128,27,5,6);}
        if(gear.head==='beret'){ctx.fillStyle='#765c55';ctx.fillRect(67,18,62,10);ctx.fillRect(74,11,49,9);ctx.fillRect(88,7,25,6);ctx.fillRect(99,3,5,5);ctx.fillStyle='#b18e78';ctx.fillRect(78,14,27,3);}
        if(gear.head==='headphones'){ctx.strokeStyle='#6d6a5b';ctx.lineWidth=5;ctx.beginPath();ctx.arc(96,54,36,Math.PI,0);ctx.stroke();ctx.fillStyle='#efe4bd';ctx.fillRect(57,49,13,26);ctx.fillRect(123,49,13,26);ctx.fillStyle='#9e9477';ctx.fillRect(60,52,4,20);ctx.fillRect(129,52,4,20);}
        if(gear.head==='starclip'){ctx.fillStyle='#9b763c';ctx.fillRect(118,35,17,5);ctx.fillStyle='#f6cf69';ctx.fillRect(124,27,5,21);ctx.fillRect(116,35,21,5);ctx.fillRect(120,31,13,13);ctx.fillStyle='#fff2bd';ctx.fillRect(123,33,5,5);}
        ctx.restore();
      }
      if(fx){ctx.save();ctx.translate(Math.round((canvas.width-w)/2),canvas.height-h);ctx.scale(scale,scale);var bob=tick%3*2;
        if(fx.name==='music'){ctx.fillStyle='#8a709b';ctx.fillRect(35,45-bob,4,20);ctx.fillRect(25,61-bob,12,7);ctx.fillRect(35,45-bob,12,4);ctx.fillRect(148,70+bob,4,20);ctx.fillRect(138,86+bob,12,7);ctx.fillRect(148,70+bob,12,4);}
        if(fx.name==='camera'||fx.name==='hop'){ctx.fillStyle='#e9b64d';[[35,38],[150,52]].forEach(function(a){ctx.fillRect(a[0],a[1]-bob,4,16);ctx.fillRect(a[0]-6,a[1]+6-bob,16,4);});}
        if(fx.name==='laser'){ctx.fillStyle='#db766a';ctx.fillRect(25+tick%9*16,189,6,4);}
        if(fx.name==='sketch'){ctx.fillStyle='#e4c789';ctx.fillRect(142,140,23,28);ctx.fillStyle='#fdf5dc';ctx.fillRect(145,143,17,22);ctx.fillStyle='#799483';ctx.fillRect(148,148,10,2);ctx.fillRect(148,154,7,2);}
        ctx.restore();}
    }
    function stop() { cancelAnimationFrame(raf); raf=0; }
    function loop(now) { raf=0; if(disposed || !visible || document.hidden || gentle()) return; if(now-lastTick>=80){draw(now);lastTick=now;}raf=requestAnimationFrame(loop); }
    function sync() {
      if(disposed)return;
      var r=el.getBoundingClientRect(); visible=el.isConnected && r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth;
      if(gentle()){fx=null;delete canvas.dataset.motion;}
      stop();draw();if(visible && !document.hidden && !gentle())raf=requestAnimationFrame(loop);
    }
    function resize(){var r=el.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*dpr));canvas.height=Math.max(1,Math.round(r.height*dpr));sync();}
    var ro=new ResizeObserver(resize);ro.observe(el);
    var io=new IntersectionObserver(sync);io.observe(el);
    document.addEventListener('visibilitychange',sync);media.addEventListener('change',sync);current.image.addEventListener('load',sync);
    function play(name,dur){if(gentle())return;var row=/walk|run|laser/.test(name)?1:/wave|hello|camera/.test(name)?3:/highfive|celebr|hop|lift|encourage|happy/.test(name)?4:/hug|pat|chin|poke|music/.test(name)?8:/study|read|sketch/.test(name)?6:4;fx={name:name,row:row,at:performance.now(),until:performance.now()+Math.max(300,Math.min(15000,(Number(dur)||1.8)*1000))};canvas.dataset.motion=name;sync();}
    var inst={el:el,syncVisibility:sync,poke:function(){if(!fx||performance.now()>=fx.until)play('pat',1.5);},play:play,setVitality:function(){},setGear:function(g){gear=g||{};draw();},setHungry:function(){},setHeadOnly:function(b){head=!!b;draw();},setState:function(o){var was=state.sleeping;Object.assign(state,o||{});if(was!==state.sleeping)startAt=performance.now();sync();},dispose:function(){disposed=true;stop();ro.disconnect();io.disconnect();document.removeEventListener('visibilitychange',sync);media.removeEventListener('change',sync);current.image.removeEventListener('load',sync);if(override)override.image.removeEventListener('load',loaded);canvas.remove();instances=instances.filter(function(i){return i!==inst;});}};
    instances.push(inst);resize();return inst;
  }
  window.PetdexSprite={mount:mount,applySkin:applySkin,disposeAll:function(){instances.slice().forEach(function(i){i.dispose();});}};
})();
