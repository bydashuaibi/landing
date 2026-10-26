/* Petdex Uika: native 192 × 208 frames, never cut apart or stretch the character. */
(function () {
  'use strict';
  var sheet = new Image(), instances = [], counts = [6,8,8,4,5,8,6,6,6];
  sheet.src = 'assets/pet/petdex/uika/spritesheet.webp';
  function mount(el, opts) {
    opts = opts || {};
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
      var row = pose(now), tick = gentle() ? 0 : Math.floor((now - (fx ? fx.at : startAt)) / (row === 0 ? 180 : 125));
      var frame = row === 5 ? Math.min(counts[row]-1, tick) : tick % counts[row];
      canvas.dataset.row = String(row); canvas.dataset.frame = String(frame);
      canvas.dataset.focus = String(!!state.focus); canvas.dataset.gentle = String(!!gentle());
      ctx.clearRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingEnabled = false;
      if (!sheet.complete || !sheet.naturalWidth) return;
      var sw = 192, sh = head ? 112 : 208, scale = Math.min(canvas.width/sw, canvas.height/sh);
      var w = Math.round(sw*scale), h = Math.round(sh*scale);
      ctx.drawImage(sheet,frame*192,row*208,sw,sh,Math.round((canvas.width-w)/2),canvas.height-h,w,h);
      // Keep the accessories already owned in the original save, above the untouched atlas.
      if ([0,3,6,8].indexOf(row)>=0 && gear) {
        ctx.save();ctx.translate(Math.round((canvas.width-w)/2),canvas.height-h);ctx.scale(scale,scale);
        if(gear.head==='crown'){ctx.fillStyle='#e9bd53';ctx.strokeStyle='#715736';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(76,16);ctx.lineTo(73,3);ctx.lineTo(85,9);ctx.lineTo(96,0);ctx.lineTo(106,9);ctx.lineTo(118,3);ctx.lineTo(115,16);ctx.closePath();ctx.fill();ctx.stroke();}
        if(gear.face==='glasses'){ctx.fillStyle='#2c2939';ctx.fillRect(73,67,19,11);ctx.fillRect(98,67,19,11);ctx.fillRect(91,70,8,3);ctx.fillStyle='#8fa9bc';ctx.fillRect(76,69,7,2);ctx.fillRect(101,69,7,2);}
        if(gear.neck==='scarf'){ctx.fillStyle='#bd6a63';ctx.fillRect(81,99,29,7);ctx.fillRect(101,105,7,22);ctx.fillStyle='#e3aaa0';ctx.fillRect(82,100,27,2);}
        ctx.restore();
      }
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
    document.addEventListener('visibilitychange',sync);media.addEventListener('change',sync);sheet.addEventListener('load',sync);
    function play(name,dur){if(gentle())return;var row=/walk|run/.test(name)?1:/wave|hello/.test(name)?3:/highfive|celebr|hop|lift|encourage|happy/.test(name)?4:/hug|pat|chin|poke/.test(name)?8:/study|read/.test(name)?6:4;fx={row:row,at:performance.now(),until:performance.now()+Math.max(300,Math.min(15000,(Number(dur)||1.8)*1000))};canvas.dataset.motion=name;sync();}
    var inst={el:el,syncVisibility:sync,poke:function(){if(!fx||performance.now()>=fx.until)play('pat',1.5);},play:play,setVitality:function(){},setGear:function(g){gear=g||{};draw();},setHungry:function(){},setHeadOnly:function(b){head=!!b;draw();},setState:function(o){var was=state.sleeping;Object.assign(state,o||{});if(was!==state.sleeping)startAt=performance.now();sync();},dispose:function(){disposed=true;stop();ro.disconnect();io.disconnect();document.removeEventListener('visibilitychange',sync);media.removeEventListener('change',sync);sheet.removeEventListener('load',sync);canvas.remove();instances=instances.filter(function(i){return i!==inst;});}};
    instances.push(inst);resize();return inst;
  }
  window.PetdexSprite={mount:mount,disposeAll:function(){instances.slice().forEach(function(i){i.dispose();});}};
})();
