/* ============================================================
   CyberCat — 程序化赛博小猫（Canvas 2D，无依赖）
   设计原则：它吃你已经做的事，不是新增任务。
   状态由 vitality(0-100) 驱动三档表现：蔫 / 正常 / 精神。
   猫不会死、不会枯萎——最多只是「有点想你」。
   用法:
     CyberCat.mount(el, {vitality:70, mood:'sun', onPoke:function(){...}})
     CyberCat.disposeAll()   // 视图切换前释放
   ============================================================ */
(function () {
  'use strict';

  var instances = [];

  /* 三档配色：蔫=灰蓝，正常=青，精神=青绿+琥珀核心 */
  var PAL = {
    low:  { line:'#8fa3b0', glow:'rgba(143,163,176,.45)', core:'#6b7d8a', grid:'rgba(143,163,176,.09)', scan:'rgba(143,163,176,.16)' },
    mid:  { line:'#22d3ee', glow:'rgba(34,211,238,.55)',  core:'#22d3ee', grid:'rgba(34,211,238,.10)', scan:'rgba(34,211,238,.20)' },
    high: { line:'#5eead4', glow:'rgba(94,234,212,.80)',  core:'#e0a93b', grid:'rgba(94,234,212,.12)', scan:'rgba(94,234,212,.24)' }
  };

  function tierOf(v) { return v < 40 ? 'low' : (v > 70 ? 'high' : 'mid'); }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function mount(el, opts) {
    if (!el) return null;
    opts = opts || {};

    var canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0;
    var vitality = Math.max(0, Math.min(100, opts.vitality == null ? 50 : opts.vitality));
    var tier = tierOf(vitality);
    var v = vitality / 100;

    /* 动画状态 */
    var t0 = performance.now();
    var raf = 0, running = false, disposed = false;
    var blinkAt = rand(2, 5);
    var glitchAt = rand(4, 9);
    var glitchUntil = -1;
    var hopV = 0, hopY = 0;          /* 点击弹跳 */
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var visible = true, pageVisible = !document.hidden;

    function resize() {
      var r = el.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOnce();
    }

    /* ---------- 绘制 ---------- */
    function draw(t) {
      var P = PAL[tier];
      var by = H * 0.80 + hopY;               /* 基线 */
      var cx = W / 2;
      var s = Math.min(W / 280, H / 210);      /* 统一缩放 */
      if (s > 1.25) s = 1.25;
      if (s < 0.55) s = 0.55;

      var T = tier;
      var breathSpeed = T === 'low' ? 0.85 : (T === 'high' ? 1.7 : 1.25);
      var breath = Math.sin(t * breathSpeed) * (T === 'low' ? 1.6 : 3.2);
      var tailSpeed = T === 'low' ? 0.55 : (T === 'high' ? 2.3 : 1.2);
      var tailAmp = T === 'low' ? 5 : (T === 'high' ? 20 : 12);
      var earDroop = T === 'low' ? 1 : (T === 'high' ? 0 : 0.32);
      var eyeBase = T === 'low' ? 0.34 : (T === 'high' ? 1 : 0.82);
      var corePulse = 0.5 + 0.5 * Math.sin(t * (T === 'high' ? 3.4 : 2.0));
      var headTilt = Math.sin(t * 0.6) * (T === 'low' ? 1.5 : 3);

      ctx.clearRect(0, 0, W, H);

      /* 深色底 + 网格 */
      ctx.fillStyle = '#1a1410';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = P.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var gap = 22 * s, off = (t * 6) % gap;
      for (var gx = -gap + off; gx < W + gap; gx += gap) {
        ctx.moveTo(gx, 0); ctx.lineTo(gx, H);
      }
      for (var gy = -gap + off; gy < H + gap; gy += gap) {
        ctx.moveTo(0, gy); ctx.lineTo(W, gy);
      }
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, 0);
      ctx.scale(s, s);
      ctx.translate(-140 + headTilt * 0.12, 0);   /* 以 280 宽为基准坐标 */

      var bx = 140;                    /* 局部中心 x */
      var base = by / s;               /* 局部基线 y */

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = P.glow;
      ctx.shadowBlur = T === 'high' ? 16 : (T === 'mid' ? 11 : 6);
      ctx.strokeStyle = P.line;
      ctx.fillStyle = 'rgba(26,20,16,.92)';

      /* 尾巴 */
      var tsw = Math.sin(t * tailSpeed) * tailAmp;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(bx + 40, base - 26);
      ctx.bezierCurveTo(bx + 82, base - 30 + tsw * 0.4,
                        bx + 96, base - 62 - tsw * 0.5,
                        bx + 78 + tsw * 0.35, base - 96 - tsw);
      ctx.stroke();
      /* 尾巴尖光点 */
      ctx.shadowBlur = 18;
      ctx.fillStyle = P.core;
      ctx.beginPath();
      ctx.arc(bx + 78 + tsw * 0.35, base - 96 - tsw, 3.2, 0, 6.284);
      ctx.fill();
      ctx.shadowBlur = T === 'high' ? 16 : (T === 'mid' ? 11 : 6);

      /* 身体 */
      var bodyW = 46, bodyH = 40 + breath * 0.5;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bx - bodyW, base);
      ctx.bezierCurveTo(bx - bodyW - 4, base - bodyH * 0.9, bx - bodyW * 0.55, base - bodyH - 8, bx, base - bodyH - 8);
      ctx.bezierCurveTo(bx + bodyW * 0.55, base - bodyH - 8, bx + bodyW + 4, base - bodyH * 0.9, bx + bodyW, base);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      /* 前爪 */
      ctx.lineWidth = 2.6;
      [-20, 20].forEach(function (px) {
        ctx.beginPath();
        ctx.ellipse(bx + px, base - 2, 11, 6, 0, 0, 6.284);
        ctx.fill(); ctx.stroke();
      });

      /* 胸口能量核心 */
      var cr = 8 + corePulse * (T === 'high' ? 3.4 : 2);
      ctx.shadowBlur = T === 'high' ? 26 : (T === 'mid' ? 16 : 7);
      ctx.fillStyle = P.core;
      ctx.globalAlpha = T === 'low' ? 0.5 : 0.85;
      ctx.beginPath();
      ctx.arc(bx, base - bodyH * 0.55, cr, 0, 6.284);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = T === 'high' ? 16 : (T === 'mid' ? 11 : 6);

      /* 电路纹路（身体内） */
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(bx - 26, base - 16); ctx.lineTo(bx - 12, base - 16); ctx.lineTo(bx - 6, base - 26);
      ctx.moveTo(bx + 26, base - 16); ctx.lineTo(bx + 12, base - 16); ctx.lineTo(bx + 6, base - 26);
      ctx.stroke();
      ctx.globalAlpha = 1;

      /* 头 */
      var headR = 40;
      var hy = base - bodyH - 30 - breath;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx, hy, headR, 0, 6.284);
      ctx.fill(); ctx.stroke();

      /* 耳朵（earDroop 越大越耷） */
      [[-1, -30], [1, 30]].forEach(function (e) {
        var dir = e[0], ox = e[1];
        var ex = bx + ox * 0.75;
        var ey = hy - headR * 0.72;
        var tipX = ex + dir * (10 - earDroop * 4);
        var tipY = ey - (34 - earDroop * 20);
        var outX = ex + dir * (34 - earDroop * 10);
        var outY = ey - (10 - earDroop * 16);
        ctx.beginPath();
        ctx.moveTo(ex - dir * 6, ey + 4);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(outX, outY);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        /* 耳内发光条 */
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex + dir * 4, ey - 2);
        ctx.lineTo(tipX - dir * 2, tipY + 8);
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      /* 头顶天线 */
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, hy - headR + 2);
      ctx.lineTo(bx + 2, hy - headR - 22);
      ctx.stroke();
      var antBlink = T === 'high' ? (0.55 + 0.45 * Math.sin(t * 5)) : (0.3 + 0.3 * Math.sin(t * 1.6));
      ctx.shadowBlur = 20;
      ctx.fillStyle = P.core;
      ctx.globalAlpha = antBlink;
      ctx.beginPath();
      ctx.arc(bx + 2, hy - headR - 24, 3.6, 0, 6.284);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = T === 'high' ? 16 : (T === 'mid' ? 11 : 6);

      /* 眼睛（眨眼 + 状态） */
      var blinking = (t % (blinkAt + 0.16)) < 0.16;
      var eyeOpen = blinking ? 0.08 : eyeBase;
      [-15, 15].forEach(function (ex) {
        ctx.fillStyle = T === 'low' ? P.line : '#eafcff';
        ctx.shadowBlur = T === 'low' ? 8 : 18;
        ctx.shadowColor = P.glow;
        ctx.beginPath();
        ctx.ellipse(bx + ex, hy + 2, 7.5, 9.5 * eyeOpen, 0, 0, 6.284);
        ctx.fill();
        if (!blinking && T !== 'low') {
          ctx.fillStyle = '#0b1b1f';
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.ellipse(bx + ex, hy + 2, 3.1, 5.4 * eyeOpen, 0, 0, 6.284);
          ctx.fill();
        }
        ctx.shadowBlur = T === 'high' ? 16 : (T === 'mid' ? 11 : 6);
        ctx.shadowColor = P.glow;
      });

      /* 鼻子 + 嘴 */
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - 3, hy + 16); ctx.lineTo(bx + 3, hy + 16); ctx.lineTo(bx, hy + 20);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      if (T === 'low') {
        ctx.moveTo(bx - 8, hy + 26); ctx.lineTo(bx + 8, hy + 26);
      } else {
        ctx.moveTo(bx - 9, hy + 24);
        ctx.quadraticCurveTo(bx - 4.5, hy + 29, bx, hy + 25);
        ctx.quadraticCurveTo(bx + 4.5, hy + 29, bx + 9, hy + 24);
      }
      ctx.stroke();

      /* 胡须 */
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.2;
      [[-1], [1]].forEach(function (d) {
        for (var i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(bx + d[0] * 12, hy + 14 + i * 4);
          ctx.lineTo(bx + d[0] * (40 + i * 3), hy + 8 + i * 8);
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
      ctx.restore();

      /* 扫描线 */
      var sy = ((t * 0.22) % 1) * H;
      ctx.fillStyle = P.scan;
      ctx.fillRect(0, sy, W, 1.6);

      /* 故障闪烁 */
      if (t < glitchUntil) {
        var slices = 4;
        for (var i = 0; i < slices; i++) {
          var sh = 4 + Math.random() * 10;
          var syy = Math.random() * (H - sh);
          var dx = (Math.random() - 0.5) * 26;
          try {
            ctx.drawImage(canvas, 0, syy * dpr, canvas.width, sh * dpr, dx, syy, W, sh);
          } catch (e) { /* 忽略自绘制异常 */ }
        }
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#ff2d95';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }

    function drawOnce() {
      if (disposed || !W) return;
      draw(reduce ? 0 : (performance.now() - t0) / 1000);
    }

    function frame(now) {
      if (disposed) return;
      var t = (now - t0) / 1000;
      if (t > glitchAt) { glitchUntil = t + 0.14; glitchAt = t + rand(4, 10); }
      /* 弹跳衰减 */
      hopV += (-hopY * 0.22 - hopV * 0.16);
      hopY += hopV;
      if (Math.abs(hopY) < 0.05 && Math.abs(hopV) < 0.05) { hopY = 0; hopV = 0; }
      draw(t);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || disposed || reduce) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; running = false;
    }

    /* 点击回应：弹一下 */
    function poke() {
      hopV = -3.4;
      glitchUntil = (performance.now() - t0) / 1000 + 0.1;
    }
    canvas.style.pointerEvents = 'auto';
    canvas.style.cursor = 'pointer';
    canvas.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      poke();
      if (opts.onPoke) opts.onPoke();
    });

    var ro = new ResizeObserver(resize);
    ro.observe(el);
    var io = new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && pageVisible) start(); else stop();
    }, { threshold: 0 });
    io.observe(el);
    var onVis = function () {
      pageVisible = !document.hidden;
      if (pageVisible && visible) start(); else stop();
    };
    document.addEventListener('visibilitychange', onVis);

    resize();
    if (!reduce) start();

    var inst = {
      el: el,
      poke: poke,
      setVitality: function (val) {
        vitality = Math.max(0, Math.min(100, val));
        tier = tierOf(vitality);
        v = vitality / 100;
        drawOnce();
      },
      dispose: function () {
        disposed = true;
        stop();
        try { ro.disconnect(); } catch (e) {}
        try { io.disconnect(); } catch (e) {}
        document.removeEventListener('visibilitychange', onVis);
        if (canvas.parentNode === el) el.removeChild(canvas);
      }
    };
    instances.push(inst);
    return inst;
  }

  function disposeAll() {
    instances.forEach(function (i) { try { i.dispose(); } catch (e) {} });
    instances = [];
  }

  window.CyberCat = { mount: mount, disposeAll: disposeAll, tierOf: tierOf };
})();
