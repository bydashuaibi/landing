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
        // One native pixel per cell: a dark contour, shaded fabric and a small seam highlight.
        function pixels(rows,x,y,palette){rows.forEach(function(line,dy){for(var dx=0;dx<line.length;dx++){var color=palette[line[dx]];if(color){ctx.fillStyle=color;ctx.fillRect(x+dx,y+dy,1,1);}}});}
        var fabric={o:'#694353',d:'#98516a',m:'#c77c91',h:'#efb5bd',w:'#f8d7ce'};
        if(gear.head==='ribbon')pixels([
          '.oooo..........oooo.',
          'oddddo........oddddo',
          'odhhmdo......odmh hdo'.replace(' ',''),
          'odhwmmdoooooodmmhhdo',
          'odmmmdodmhhmdodmmmdo',
          '.odmmdodmhhmdodmmdo.',
          '..oddoodmmmmdooddo..',
          '...oo..oddmdo..oo...',
          '.....oddmooddo......',
          '.....odmdo.dmdo.....',
          '....odmmdo.dmmdo....',
          '....odmdo...dmdo....',
          '....oddo.....ddo....',
          '.....oo.......o.....'
        ],115,29,fabric);
        if(gear.head==='crown')pixels([
          '.................oo.................',
          '....oo..........ohho..........oo....',
          '...ohho........ohhhho........ohho...',
          '...ohhho......ohhhhhho......ohhho...',
          '...odhhho....ohhhwhhhho....ohhhdo...',
          '....odhhho..ohhhwwwhhhho..ohhhdo....',
          '....odhhhhoodhhhwwwhhhdoodhhhdo....',
          '....odhhhhddhhhhhhhhhhhddhhhhdo....',
          '.....odhhhhhhhhhhhhhhhhhhhhdo.....',
          '.....odhhhhhhhhhpphhhhhhhhhdo.....',
          '.....odhhhhhhhhpppphhhhhhhhdo.....',
          '.....odhhhhhhhhhpphhhhhhhhhdo.....',
          '.....oddddddddddddddddddddddo.....',
          '......ooooooooooooooooooooo.......'
        ],78,1,{o:'#725a3d',d:'#b88d46',h:'#e9c86b',w:'#fff1b5',p:'#b66e79'});
        if(gear.face==='glasses'){
          ctx.fillStyle='#39343d';ctx.fillRect(72,66,20,2);ctx.fillRect(98,66,20,2);ctx.fillRect(72,68,2,9);ctx.fillRect(90,68,2,9);ctx.fillRect(98,68,2,9);ctx.fillRect(116,68,2,9);ctx.fillRect(74,77,16,2);ctx.fillRect(100,77,16,2);ctx.fillRect(92,69,6,2);
          ctx.fillStyle='#505c67';ctx.fillRect(74,68,16,9);ctx.fillRect(100,68,16,9);ctx.fillStyle='#b6c6c1';ctx.fillRect(77,69,5,1);ctx.fillRect(103,69,5,1);ctx.fillStyle='#7b8a92';ctx.fillRect(75,71,2,4);ctx.fillRect(101,71,2,4);
        }
        if(gear.neck==='scarf'){
          ctx.fillStyle='#724751';ctx.fillRect(81,98,28,2);ctx.fillRect(79,100,32,5);ctx.fillRect(82,105,27,2);ctx.fillRect(100,106,9,21);
          ctx.fillStyle='#c27d80';ctx.fillRect(81,100,28,4);ctx.fillRect(102,107,5,18);ctx.fillStyle='#efb7ad';ctx.fillRect(84,100,20,1);ctx.fillRect(102,108,1,14);ctx.fillStyle='#9b606e';[111,117,123].forEach(function(y){ctx.fillRect(102,y,5,1);});ctx.fillStyle='#d69b97';[101,104,107].forEach(function(x){ctx.fillRect(x,126,1,3);});
        }
        if(gear.head==='beret'){
          ctx.fillStyle='#584c4e';ctx.fillRect(80,12,39,2);ctx.fillRect(73,14,52,3);ctx.fillRect(68,17,62,7);ctx.fillRect(72,24,54,3);ctx.fillRect(98,7,3,5);
          ctx.fillStyle='#997c72';ctx.fillRect(77,15,44,2);ctx.fillRect(71,18,56,5);ctx.fillStyle='#b99a80';ctx.fillRect(83,16,22,2);ctx.fillRect(75,18,9,2);ctx.fillStyle='#705e5b';ctx.fillRect(74,24,50,1);ctx.fillStyle='#d5b486';ctx.fillRect(116,20,3,3);
        }
        if(gear.head==='headphones'){
          ctx.strokeStyle='#656054';ctx.lineWidth=3;ctx.beginPath();ctx.arc(96,54,35,Math.PI,0);ctx.stroke();ctx.strokeStyle='#e9dfbb';ctx.lineWidth=2;ctx.beginPath();ctx.arc(96,54,32,Math.PI,0);ctx.stroke();
          [59,124].forEach(function(x){ctx.fillStyle='#676052';ctx.fillRect(x,52,10,21);ctx.fillRect(x-1,55,12,15);ctx.fillStyle='#e9dfbd';ctx.fillRect(x+1,53,7,19);ctx.fillStyle='#c9b993';ctx.fillRect(x+2,55,5,15);ctx.fillStyle='#f8edcf';ctx.fillRect(x+2,55,1,12);ctx.fillStyle='#9e947a';ctx.fillRect(x+8,57,1,11);});
        }
        if(gear.head==='starclip')pixels([
          '.......oo.......',
          '......ohho......',
          '......ohho......',
          '..ooooohhooooo..',
          '.odhhhhhhhhhhdo.',
          '..odhhwwhhhdo...',
          '...odhw hhd o...'.replace(/ /g,''),
          '....ohhhhhh o...'.replace(' ',''),
          '...ohhhddhhho...',
          '...ohhdo odhho..'.replace(' ',''),
          '..ohdo....odho..',
          '..ooo......ooo..'
        ],119,30,{o:'#846337',d:'#b49248',h:'#eed178',w:'#fff3b9'});
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
