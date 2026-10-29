/* Pixel click ripples stay available without WebGL and sleep between clicks. */
(function(){
  'use strict';
  function init(){
    if(window.CFB_DISABLED || document.querySelector('.click-fx'))return;
    var canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    if(!ctx)return;
    canvas.className='click-fx';canvas.setAttribute('aria-hidden','true');canvas.dataset.active='false';
    Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'9999'});
    document.body.appendChild(canvas);
    var media=matchMedia('(prefers-reduced-motion: reduce)'),clicks=[],raf=0,ratio=1,color='#3b614a';
    function clear(){cancelAnimationFrame(raf);raf=0;clicks=[];ctx.clearRect(0,0,innerWidth,innerHeight);canvas.dataset.active='false';}
    function resize(){ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);clear();}
    function frame(now){
      raf=0;ctx.clearRect(0,0,innerWidth,innerHeight);clicks=clicks.filter(function(c){return now-c.at<720;});
      clicks.forEach(function(c){
        var t=(now-c.at)/720,ease=1-Math.pow(1-t,2),size=t<.55?4:3;
        ctx.fillStyle=color;
        for(var ring=0;ring<2;ring++){
          var radius=5+ease*(ring?31:54);ctx.globalAlpha=Math.pow(1-t,1.7)*(ring ? .38 : .72);
          for(var i=0;i<20;i++){var angle=i*Math.PI/10;ctx.fillRect(Math.round(c.x+Math.cos(angle)*radius-size/2),Math.round(c.y+Math.sin(angle)*radius-size/2),size,size);}
        }
      });
      ctx.globalAlpha=1;canvas.dataset.active=String(!!clicks.length);
      if(clicks.length)raf=requestAnimationFrame(frame);
    }
    window.addEventListener('pointerdown',function(e){
      if(e.button!==0 || e.isPrimary===false || media.matches || window.CFB_DISABLED)return;
      color=getComputedStyle(document.documentElement).getPropertyValue('--terracotta').trim()||'#3b614a';
      clicks.push({x:e.clientX,y:e.clientY,at:performance.now()});if(clicks.length>8)clicks.shift();
      canvas.dataset.active='true';if(!raf)raf=requestAnimationFrame(frame);
    },{capture:true,passive:true});
    document.addEventListener('visibilitychange',function(){if(document.hidden)clear();});
    media.addEventListener('change',clear);window.addEventListener('resize',resize);resize();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
