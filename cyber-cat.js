/* ============================================================
   CyberCat — 程序化赛博小猫（Canvas 2D，无依赖）
   设计原则：它吃你已经做的事，不是新增任务。
   状态由 vitality(0-100) 驱动三档表现：蔫 / 正常 / 精神。
   猫不会死、不会枯萎——最多只是「有点想你」。
   用法:
     CyberCat.mount(el, {vitality:70, mood:'sun', onPoke:function(){...}})
     CyberCat.disposeAll()   // 视图切换前释放
   ============================================================ */
/* ============================================================
   Sprite 模式：如果 assets/pet/ 下有图片，就直接用它当猫，
   而不是程序化绘制。
   ------------------------------------------------------------
   为什么要有这个：程序化画出来的猫再怎么调也很难"就是那一只"。
   放一张 PNG 进去，挂件就显示那张图，形状/神态完全由你决定。

   约定（文件名固定，贴图放 resources/app/assets/pet/）：
     cat.png        默认状态
     cat-happy.png  活力高（可选，缺省回落到 cat.png）
     cat-hungry.png 饿了（可选）
     cat-sleep.png  睡觉（可选）
   图片建议：正方形、透明背景、猫居中、留一点边距。
   ============================================================ */
var SPRITE_DIR = 'assets/pet/';
var SPRITE_STATES = ['happy', 'hungry', 'sleep'];

/* 缓存：路径 -> {img, ok, tries}；ok=false 表示还没加载成功，draw 会隔帧重试 */
var spriteCache = {};

/* hasSprite：undefined=还没探明，true=有贴图，false=没有（用程序化那只猫）
   为什么要这个：贴图是异步加载的。以前第一帧还没拿到图就回落到程序化绘制的猫，
   于是启动瞬间先闪一下「丑猫」，图解码完才切成贴图——用户看到的就是「怎么先是那只猫」。
   现在探测完成前不画任何替身，宁可空一帧，也不要显示错的形象。 */
var hasSprite;

function tryLoadSprite(baseName) {
  var rec = spriteCache[baseName];
  if (rec && rec.ok) return rec;
  if (!rec) {
    rec = { img: null, ok: false, tries: 0, done: false };
    spriteCache[baseName] = rec;
    startSpriteLoad(baseName, rec);       /* 首次就开始加载 */
    return rec;
  }
  /* 还没好：每 60 帧重试一次，避免每帧都新建 Image */
  rec.tries = (rec.tries || 0) + 1;
  if (rec.tries % 60 === 0) startSpriteLoad(baseName, rec);
  return rec;
}

function startSpriteLoad(baseName, rec) {
  try {
    var im = new Image();
    im.onload = function () {
      rec.img = im; rec.ok = true; rec.done = true;
      if (baseName === 'cat') hasSprite = true;
    };
    im.onerror = function () {
      rec.ok = false;
      /* 基础贴图确认没有 -> 明确判定「无贴图」，此后一直走程序化绘制 */
      if (baseName === 'cat') { rec.done = true; hasSprite = false; }
    };
    im.src = SPRITE_DIR + baseName + '.png';
  } catch (e) {
    rec.ok = false;
    if (baseName === 'cat') { rec.done = true; hasSprite = false; }
  }
}

/* 模块加载时就开始探测基础贴图，这样 pet.js 建挂件时多半已经就绪，
   第一帧直接画贴图，不会有任何闪动。 */
tryLoadSprite('cat');

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

  /* 颜色压暗（挂件模式用：浅色背景上要能看清本体） */
  function shadeHex(hex, k) {
    var h = (hex || '#888888').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return 'rgb(' + Math.round(r * k) + ',' + Math.round(g * k) + ',' + Math.round(b * k) + ')';
  }

  /* 圆角矩形（老内核没有 ctx.roundRect 时回退） */
  function rr(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

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

    /* 挂件模式：透明底、无网格/扫描线/故障，只留一只猫；可带配饰 */
    var bare = !!opts.bare;
    var hungry = !!opts.hungry;
    /* 贴图模式下只画头部（收起成小圆点时用） */
    var spriteHeadOnly = !!opts.headOnly;
    var gear = { neck:null, face:null, head:null };
    setGear(opts.gear);

    function setGear(g) {
      gear = { neck:null, face:null, head:null };
      if (!g) return;
      if (typeof g === 'string') { gear.neck = g; return; }
      Object.keys(gear).forEach(function (k) { if (g[k]) gear[k] = g[k]; });
    }

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

    /* ---------- 挂件模式：白色毛绒小猫（参考布偶手绘：绒毛边 + 闭眼笑 + 腮红 + 丝带） ---------- */
    /* 坐标以「脚底中心」为原点 (0,0)，向上为负，U 为缩放单位。 */
    var fx = { name: null, t0: 0, dur: 0 };          /* 一次性动作动画 */
    var st = { sleeping: false, daze: false };       /* 持续状态 */

    function playFx(name, dur) {
      fx.name = name; fx.dur = dur || 1.1;
      fx.t0 = (performance.now() - t0) / 1000;
      if (!running && !reduce) start();
      if (reduce) { fx.name = null; drawOnce(); }
    }

    /* 毛绒边缘路径：用正弦抖动把椭圆变成一圈绒毛 */
    function fuzzPath(cx, cy, rx, ry, bumps, amp, phase) {
      var N = bumps * 6;
      ctx.beginPath();
      for (var i = 0; i <= N; i++) {
        var a = (i / N) * 6.283185;
        var k = 1 + amp * Math.sin(a * bumps + (phase || 0));
        var x = cx + Math.cos(a) * rx * k;
        var y = cy + Math.sin(a) * ry * k;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    function drawCute(t) {
      /* 单帧最大缩放（按参考图比例：连毛带发大约 156 宽 x 168 高） */
      var U = Math.min(W / 158, H / 172);
      var cx = W / 2;
      var by = H * 0.905 + hopY;

      var T = tier;
      var droopy = hungry;
      var OUT = '#b3a89c';                              /* 浅暖灰描边：参考图的描边很浅，旧的深棕描边显脏 */
      var breath = Math.sin(t * (T === 'low' ? 0.9 : 1.5)) * 0.012;

      /* 动作动画参数 */
      var fy = 0, fscaleY = 1, frot = 0, ftilt = 0;
      if (fx.name) {
        var e = t - fx.t0;
        if (e > fx.dur) { fx.name = null; }
        else {
          var p = e / fx.dur;
          if (fx.name === 'hop') {
            fy = -Math.abs(Math.sin(p * Math.PI * 2)) * 24 * U * (1 - p * 0.25);
            fscaleY = 1 + Math.abs(Math.sin(p * Math.PI * 2)) * 0.05;
          } else if (fx.name === 'lift') {
            var k = p < 0.45 ? (p / 0.45) : (1 - (p - 0.45) / 0.55);
            fy = -26 * U * k;
            frot = Math.sin(p * Math.PI * 2) * 0.07;
          } else if (fx.name === 'spin') {
            frot = p * 6.283185;
            fy = -Math.abs(Math.sin(p * Math.PI)) * 10 * U;
          } else if (fx.name === 'chin') {
            ftilt = Math.sin(p * Math.PI * 3) * 0.055;
            fy = -Math.sin(p * Math.PI) * 5 * U;
          } else if (fx.name === 'call') {
            frot = Math.sin(p * Math.PI * 6) * 0.05;
            fy = -Math.abs(Math.sin(p * Math.PI * 2)) * 5 * U;
          }
        }
      }

      ctx.clearRect(0, 0, W, H);

      /* 背后柔光 */
      var glow = ctx.createRadialGradient(cx, by - 60 * U, 2 * U, cx, by - 60 * U, 84 * U);
      glow.addColorStop(0, 'rgba(255,255,255,.82)');
      glow.addColorStop(0.55, 'rgba(255,253,248,.34)');
      glow.addColorStop(1, 'rgba(255,253,248,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, by - 60 * U, 84 * U, 0, 6.2832);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, by + fy);
      ctx.scale(1 + breath, (1 + breath) * fscaleY);
      ctx.rotate(frot);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      var cream = (function () {
        var g = ctx.createLinearGradient(0, -110 * U, 0, 2 * U);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.72, '#fbf9f5');
        g.addColorStop(1, '#efebe3');
        return g;
      })();

      /* ================= 尾巴（最底层，收在身体和垂发后面） ================= */
      var sway = Math.sin(t * (T === 'low' ? 0.7 : (T === 'high' ? 2.0 : 1.2))) * (T === 'low' ? 1.5 : 3) * U;
      ctx.save();
      ctx.translate(20 * U, -20 * U + sway * 0.4);
      ctx.rotate(0.78 + sway * 0.012);
      ctx.beginPath();                                   /* 收尖的蓬松尾 */
      ctx.moveTo(0, 6 * U);
      ctx.quadraticCurveTo(10 * U, 4 * U, 12 * U, -7 * U);
      ctx.quadraticCurveTo(9 * U, -16 * U, 1 * U, -18 * U);
      ctx.quadraticCurveTo(-7 * U, -16 * U, -6 * U, -5 * U);
      ctx.quadraticCurveTo(-5 * U, 4 * U, 0, 6 * U);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 1.9 * U;
      ctx.stroke();
      ctx.restore();

      /* ================= 两侧长垂发（先画，身体和头压在上面） ================= */
      /* 参考图里这是两绺从耳后垂下来的长发：贴着身子往下、末端收成小尖，
         不该像两根等宽的香肠。外缘 40U、中间最宽，末端收到 29U 并往外飘一点。 */
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2.1 * U;
      [-1, 1].forEach(function (d) {
        var lw = sway * 0.6 * d;                 /* 发梢随呼吸轻摆 */
        ctx.beginPath();
        ctx.moveTo(d * 23 * U, -74 * U);
        ctx.bezierCurveTo(d * 35 * U, -68 * U, d * 41 * U + lw, -46 * U, d * 38 * U + lw, -25 * U);
        ctx.quadraticCurveTo(d * 36 * U + lw * 1.6, -11 * U, d * 29 * U + lw * 1.8, -7 * U);  /* 收尖并外飘 */
        ctx.quadraticCurveTo(d * 24 * U + lw, -10 * U, d * 22 * U, -26 * U);
        ctx.quadraticCurveTo(d * 20 * U, -54 * U, d * 17 * U, -73 * U);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();
      });

      /* ================= 身体（矮而圆的一团） ================= */
      fuzzPath(0, -25 * U, 26 * U, 22 * U, 12, 0.05, t * 0.35);
      ctx.fillStyle = cream;
      ctx.fill();
      ctx.stroke();

      /* ================= 前爪：三只，带粉色肉垫 ================= */
      [-14, 0, 14].forEach(function (dx, i2) {
        var px = dx * U, py = -8.5 * U + (i2 === 1 ? 0 : 1.1 * U);
        var rw = (i2 === 1 ? 10 * U : 9 * U), rh = 8 * U;
        ctx.beginPath();
        ctx.ellipse(px, py, rw, rh, 0, 0, 6.2832);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 1.9 * U;
        ctx.stroke();
        /* 脚趾分缝 */
        ctx.strokeStyle = 'rgba(179,168,156,.62)';
        ctx.lineWidth = 1.1 * U;
        [-0.34, 0.34].forEach(function (g) {
          ctx.beginPath();
          ctx.moveTo(px + g * rw, py - rh * 0.75);
          ctx.lineTo(px + g * rw * 0.78, py + rh * 0.28);
          ctx.stroke();
        });
        /* 粉色肉垫 */
        ctx.beginPath();
        ctx.ellipse(px, py + rh * 0.30, rw * 0.34, rh * 0.26, 0, 0, 6.2832);
        ctx.fillStyle = 'rgba(240,190,196,.62)';
        ctx.fill();
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 1.9 * U;
      });

      /* ================= 耳朵（细窄直立，位置偏上） ================= */
      var earDrop = droopy ? 0.42 : 0;
      [-1, 1].forEach(function (d) {
        ctx.beginPath();
        ctx.moveTo(d * 5 * U, -70 * U);
        ctx.quadraticCurveTo(d * 8 * U, -88 * U, d * (16 + earDrop * 4) * U, -94 * U + earDrop * 14 * U);
        ctx.quadraticCurveTo(d * 24 * U, -84 * U, d * 24 * U, -68 * U);
        ctx.quadraticCurveTo(d * 14 * U, -63 * U, d * 5 * U, -70 * U);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 2.1 * U;
        ctx.stroke();
        /* 耳内淡粉 */
        ctx.beginPath();
        ctx.moveTo(d * 9 * U, -71 * U);
        ctx.quadraticCurveTo(d * 11 * U, -84 * U, d * (16 + earDrop * 3) * U, -88 * U + earDrop * 10 * U);
        ctx.quadraticCurveTo(d * 20.5 * U, -80 * U, d * 20.5 * U, -69 * U);
        ctx.quadraticCurveTo(d * 14 * U, -65 * U, d * 9 * U, -71 * U);
        ctx.closePath();
        ctx.fillStyle = 'rgba(243,199,208,.72)';
        ctx.fill();
      });

      /* ================= 头（宽而略扁的一团） ================= */
      var HY = -56 * U, HR = 27 * U;
      ctx.save();
      ctx.rotate(ftilt);
      var hgr = ctx.createRadialGradient(-8 * U, HY - 12 * U, 3 * U, 0, HY + 6 * U, HR * 1.35);
      hgr.addColorStop(0, '#ffffff');
      hgr.addColorStop(1, '#f8f5f0');
      fuzzPath(0, HY, HR, HR * 0.94, 11, 0.05, t * 0.4);
      ctx.fillStyle = hgr;
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2.1 * U;
      ctx.stroke();

      /* ---- 额头刘海：参考图是一排很浅的小尖，不是明显波浪 ----
         原来的波峰到 8U 太夸张，像戴了个花边帽，压到 4.4U 并收窄。 */
      var fr = HY - HR * 0.60;
      ctx.beginPath();
      ctx.moveTo(-14 * U, fr + 1.4 * U);
      ctx.quadraticCurveTo(-11.5 * U, fr + 4.6 * U, -9.5 * U, fr + 1.8 * U);
      ctx.quadraticCurveTo(-6 * U, fr + 5 * U, -3.5 * U, fr + 1.4 * U);
      ctx.quadraticCurveTo(-0.5 * U, fr + 5 * U, 2.5 * U, fr + 1.4 * U);
      ctx.quadraticCurveTo(5.5 * U, fr + 5 * U, 8.5 * U, fr + 1.8 * U);
      ctx.quadraticCurveTo(12 * U, fr + 4.6 * U, 14 * U, fr + 1.4 * U);
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 1.6 * U;
      ctx.stroke();

      /* ---- 呆毛：头顶一小撮，短、细、往上翘 ---- */
      ctx.beginPath();
      ctx.moveTo(1.5 * U, fr - 3 * U);
      ctx.quadraticCurveTo(5 * U, fr - 12 * U, -2 * U, fr - 16 * U);
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2 * U;
      ctx.stroke();

      /* ================= 脸 ================= */
      /* 参考图的猫是「安详」的表情：两道短而厚的深色眼缝，微微下弯。
         试过 6 种眼型对比后选了这一种（上弧像在笑、下弧像困，一字缝最贴）。 */
      var ex = 8.6 * U, ey = HY + 1 * U;
      var sleeping = st.sleeping, dazing = st.daze;
      var blinkCycle = blinkAt + 0.14;
      var blinking = (((t + 1.7) % blinkCycle) < 0.14) && t > 0.05;

      /* 偶尔睁眼看你一下（活力高时），其余时候都是那道安详的眼缝 */
      if (blinking || (T === 'high' && !sleeping && !dazing && (((t * 0.37) % 7) > 5.6))) {
        var irisR = (T === 'high' ? 3.2 : 2.9) * U;
        [-1, 1].forEach(function (d) {
          var ix = d * ex, iy = ey;
          ctx.beginPath();
          ctx.ellipse(ix, iy, irisR, irisR * 1.15, 0, 0, 6.2832);
          ctx.fillStyle = '#5b5049';
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(ix, iy + 0.3 * U, irisR * 0.55, irisR * 0.62, 0, 0, 6.2832);
          ctx.fillStyle = '#2c2521';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(ix + 1.1 * U, iy - 1.3 * U, 1.05 * U, 0, 6.2832);
          ctx.fillStyle = 'rgba(255,255,255,.97)';
          ctx.fill();
        });
      } else {
        ctx.strokeStyle = '#6b6058';
        ctx.lineWidth = 2.5 * U;
        ctx.lineCap = 'round';
        [-1, 1].forEach(function (d) {
          var sag = droopy ? 1.1 * U : 0;
          ctx.beginPath();
          ctx.moveTo(d * (ex - 2.7 * U), ey + 0.1 * U + sag * 0.5);
          ctx.quadraticCurveTo(d * ex, ey + 1.0 * U + sag, d * (ex + 2.7 * U), ey + 0.1 * U + sag);
          ctx.stroke();
        });
        ctx.lineCap = 'butt';
      }

      /* 腮红：淡粉，位置在眼外下方 */
      ctx.fillStyle = 'rgba(242,178,186,.45)';
      [-1, 1].forEach(function (d) {
        ctx.beginPath();
        ctx.ellipse(d * 15.5 * U, HY + 8.5 * U, 4.2 * U, 2.6 * U, 0, 0, 6.2832);
        ctx.fill();
      });

      /* 鼻子 + 嘴：一小横一点 + 小 w */
      var noseY = HY + 6 * U;
      ctx.fillStyle = 'rgba(214,150,160,.85)';
      ctx.beginPath();
      ctx.ellipse(0, noseY, 1.3 * U, 0.9 * U, 0, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = '#6b6058';
      ctx.lineWidth = 1.4 * U;
      ctx.beginPath();
      ctx.moveTo(0, noseY + 0.9 * U);
      ctx.lineTo(0, noseY + 1.7 * U);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2.4 * U, noseY + 1.7 * U);
      ctx.quadraticCurveTo(-1.2 * U, noseY + 3.5 * U, 0, noseY + 2.2 * U);
      ctx.quadraticCurveTo(1.2 * U, noseY + 3.5 * U, 2.4 * U, noseY + 1.7 * U);
      ctx.stroke();

      ctx.restore();   /* 结束头部倾斜 */

      /* ================= 耳侧饰物：金环 + 蓝丝带蝴蝶结 ================= */
      /* 参考图里环贴在耳根外侧、比耳朵矮一点，蝴蝶结和飘带在环后面垂下来 */
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2.1 * U;
      [-1, 1].forEach(function (d) {
        /* 原来 gx=24U 太靠里，环压在脸颊上；移到耳朵外缘 (26U,-70U) */
        var gx = d * 26 * U, gy = -70 * U;

        /* 丝带飘带（在环后面）——收窄，避免超出画布被裁掉一半 */
        ctx.beginPath();
        ctx.moveTo(gx + d * 1.5 * U, gy + 3 * U);
        ctx.quadraticCurveTo(gx + d * 9 * U, gy + 11 * U, gx + d * 6 * U, gy + 23 * U);
        ctx.quadraticCurveTo(gx + d * 4.5 * U, gy + 29 * U, gx + d * 2.5 * U, gy + 24 * U);
        ctx.quadraticCurveTo(gx + d * 1.2 * U, gy + 13 * U, gx - d * 1.6 * U, gy + 5 * U);
        ctx.closePath();
        ctx.fillStyle = '#c8e0f0';
        ctx.fill();
        ctx.strokeStyle = 'rgba(150,186,210,.85)';
        ctx.lineWidth = 1.2 * U;
        ctx.stroke();

        /* 蝴蝶结两耳：跨度和纵向偏移都收小，免得贴边被裁 */
        ctx.fillStyle = '#d6e9f5';
        ctx.strokeStyle = 'rgba(150,186,210,.9)';
        ctx.lineWidth = 1.2 * U;
        [-1, 1].forEach(function (s) {
          ctx.beginPath();
          ctx.moveTo(gx, gy - 0.5 * U);
          ctx.quadraticCurveTo(gx + d * s * 6.2 * U, gy - 5.5 * U, gx + d * s * 5.6 * U, gy + 1 * U);
          ctx.quadraticCurveTo(gx + d * s * 4.8 * U, gy + 5.5 * U, gx, gy + 2.5 * U);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });

        /* 金色圆环 + 高光 */
        ctx.beginPath();
        ctx.arc(gx, gy, 5.2 * U, 0, 6.2832);
        ctx.fillStyle = '#e3c47c';
        ctx.fill();
        ctx.strokeStyle = '#b8933f';
        ctx.lineWidth = 1.5 * U;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(gx - d * 1.2 * U, gy - 1.2 * U, 1.6 * U, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,255,255,.72)';
        ctx.fill();

        ctx.strokeStyle = OUT;
        ctx.lineWidth = 2.1 * U;
      });

      /* ================= 状态特效 ================= */
      if (sleeping) {
        ctx.fillStyle = 'rgba(139,127,114,.75)';
        ctx.font = 'bold ' + (10 * U) + 'px Inter, sans-serif';
        var zt = (t * 0.45) % 1;
        [0, 1, 2].forEach(function (k) {
          var zz = (zt + k * 0.33) % 1;
          ctx.globalAlpha = 1 - zz;
          ctx.fillText('z', 24 * U + zz * 12 * U, -74 * U - zz * 26 * U);
        });
        ctx.globalAlpha = 1;
      }
      if (dazing) {
        ctx.fillStyle = 'rgba(139,127,114,.6)';
        ctx.font = 'bold ' + (12 * U) + 'px Inter, sans-serif';
        var dcount = Math.floor(t * 1.6) % 3;
        ctx.fillText('...'.slice(0, dcount + 1), 20 * U, -84 * U);
      }
      if (T === 'high' && !droopy) {
        var tw2 = 0.55 + 0.45 * Math.sin(t * 3.2);
        ctx.globalAlpha = tw2 * 0.9;
        ctx.fillStyle = '#e9c14a';
        [[30, -84], [35, -76]].forEach(function (sp, si) {
          var sx = sp[0] * U, sy = sp[1] * U, r2 = (si ? 1.4 : 2.1) * U;
          ctx.beginPath();
          ctx.moveTo(sx, sy - r2 * 2.1);
          ctx.quadraticCurveTo(sx + r2 * 0.5, sy - r2 * 0.5, sx + r2 * 2.1, sy);
          ctx.quadraticCurveTo(sx + r2 * 0.5, sy + r2 * 0.5, sx, sy + r2 * 2.1);
          ctx.quadraticCurveTo(sx - r2 * 0.5, sy + r2 * 0.5, sx - r2 * 2.1, sy);
          ctx.quadraticCurveTo(sx - r2 * 0.5, sy - r2 * 0.5, sx, sy - r2 * 2.1);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    /* ---------- 贴图渲染 ----------
       按状态挑图片：睡觉 > 饿 > 精神好 > 默认。
       图片按「contain」放进画布，底下补一层柔和椭圆阴影，免得看着像浮在空中。

       返回值三态：
         true  已画（贴图或「故意留白」）
         false 明确没有贴图 -> 调用方去画程序化的猫
       关键：贴图还在加载时也要返回 true（画布留白），
       否则第一帧会先画程序化的猫、图好了再切换，看起来就是「先闪一只丑猫」。 */
    function drawSprite(t) {
      var want = st.sleeping ? 'sleep' : (hungry ? 'hungry' : (tier === 'high' ? 'happy' : ''));
      var rec = null;
      if (want) {
        var cand = tryLoadSprite('cat-' + want);
        if (cand.ok) rec = cand;
      }
      var base = tryLoadSprite('cat');
      if (!rec && base.ok) rec = base;

      if (!rec) {
        /* 还没探明有没有贴图：什么都不画，别拿程序化的猫顶上——
           否则第一帧先闪一只猫、图好了再切换。
           注意只有「还在加载」才留白；「确认加载失败」要立刻回落，不能一直空着。 */
        if (base.done) return false;          /* 确定没有贴图 -> 程序化绘制 */
        ctx.clearRect(0, 0, W, H);
        return true;                          /* 仍未知 -> 留白等图 */
      }

      var img = rec.img;
      var iw = img.naturalWidth || img.width;
      var ih = img.naturalHeight || img.height;
      if (!iw || !ih) return false;

      ctx.clearRect(0, 0, W, H);

      var dw, dh, dx, dy;
      if (spriteHeadOnly) {
        /* 收起态：画布是小方块，整只立绘塞进去会小到看不清，
           所以只取头部（上半部分）并铺满，像一个头像。 */
        var cropH = ih * 0.46;                       /* 头顶到胸口 */
        var cropW = Math.min(iw, cropH * (W / H));   /* 按画布比例裁，避免变形 */
        var sx = (iw - cropW) / 2;
        var sy = ih * 0.015;
        dh = H; dw = W; dx = 0; dy = 0;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, cropW, cropH, dx, dy, dw, dh);
        ctx.restore();
        return true;
      }

      /* contain + 留 4% 边距 */
      var pad = 0.04;
      var k = Math.min((W * (1 - pad * 2)) / iw, (H * (1 - pad * 2)) / ih);
      dw = iw * k; dh = ih * k;
      dx = (W - dw) / 2;
      dy = (H - dh) / 2;

      /* 呼吸：整张图轻微缩放，比逐帧重画便宜，也不破坏原图 */
      var br = 1 + Math.sin(t * (tier === 'low' ? 0.9 : 1.5)) * 0.012;

      /* 地面阴影 */
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#4a3a28';
      ctx.beginPath();
      ctx.ellipse(W / 2, dy + dh * 0.995, dw * 0.30, dh * 0.030, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(W / 2, dy + dh / 2);
      ctx.scale(br, br);
      ctx.translate(-W / 2, -(dy + dh / 2));
      /* 贴图是照片/插画，放大时用高质量插值，别出现锯齿 */
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, dx, dy + hopY, dw, dh);
      ctx.restore();

      /* 睡觉时补 Z，饿的时候补个提示点，保持"它在回应你"的感觉 */
      if (st.sleeping) {
        ctx.save();
        ctx.fillStyle = 'rgba(139,127,114,.75)';
        ctx.font = 'bold 10px Inter, sans-serif';
        var zt = (t * 0.45) % 1;
        [0, 1, 2].forEach(function (i) {
          var zz = (zt + i * 0.33) % 1;
          ctx.globalAlpha = 1 - zz;
          ctx.fillText('z', dx + dw * 0.82 + zz * 12, dy + dh * 0.30 - zz * 26);
        });
        ctx.restore();
      }
      return true;
    }

    function draw(t) {
      if (bare) {
        /* 有贴图就用贴图，没有才回落到程序化画的猫 */
        if (drawSprite(t)) return;
        drawCute(t);
        return;
      }
      var P = PAL[tier];
      var by = H * 0.80 + hopY;               /* 基线 */
      var cx = W / 2;
      var s = Math.min(W / 280, H / 210);      /* 统一缩放 */
      if (s > 1.25) s = 1.25;
      var minS = bare ? 0.16 : 0.55;
      if (s < minS) s = minS;

      var T = tier;
      var breathSpeed = T === 'low' ? 0.85 : (T === 'high' ? 1.7 : 1.25);
      var breath = Math.sin(t * breathSpeed) * (T === 'low' ? 1.6 : 3.2);
      var tailSpeed = T === 'low' ? 0.55 : (T === 'high' ? 2.3 : 1.2);
      var tailAmp = T === 'low' ? 5 : (T === 'high' ? 20 : 12);
      var earDroop = T === 'low' ? 1 : (T === 'high' ? 0 : 0.32);
      var eyeBase = T === 'low' ? 0.34 : (T === 'high' ? 1 : 0.82);
      var corePulse = 0.5 + 0.5 * Math.sin(t * (T === 'high' ? 3.4 : 2.0));
      var headTilt = Math.sin(t * 0.6) * (T === 'low' ? 1.5 : 3);

      /* 饿了：耷拉一点、慢一点、核心变暗（但不惩罚、不掉亲密度） */
      if (hungry) {
        earDroop = Math.max(earDroop, 0.7);
        eyeBase = Math.min(eyeBase, 0.5);
        tailAmp *= 0.5;
        corePulse *= 0.45;
      }

      ctx.clearRect(0, 0, W, H);

      if (!bare) {
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
      } else {
        /* 挂件模式：透明底 + 一圈暖光，把猫托出来 */
        var gr = ctx.createRadialGradient(W / 2, H * 0.72, 2, W / 2, H * 0.72, Math.max(W, H) * 0.62);
        gr.addColorStop(0, 'rgba(255,252,246,.34)');
        gr.addColorStop(0.55, 'rgba(246,236,220,.16)');
        gr.addColorStop(1, 'rgba(246,236,220,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.ellipse(W / 2, H * 0.74, W * 0.42, H * 0.30, 0, 0, 6.284);
        ctx.fill();
      }

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
      /* 本体色：大舞台沿用核心色；挂件模式压暗一档，浅色背景上才看得清 */
      var bodyFill = bare ? shadeHex(P.core, 0.62) : P.core;

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
      ctx.fillStyle = bodyFill;
      ctx.beginPath();
      ctx.moveTo(bx - bodyW, base);
      ctx.bezierCurveTo(bx - bodyW - 4, base - bodyH * 0.9, bx - bodyW * 0.55, base - bodyH - 8, bx, base - bodyH - 8);
      ctx.bezierCurveTo(bx + bodyW * 0.55, base - bodyH - 8, bx + bodyW + 4, base - bodyH * 0.9, bx + bodyW, base);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      /* 前爪 */
      ctx.lineWidth = 2.6;
      ctx.fillStyle = bodyFill;
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
      ctx.fillStyle = bodyFill;
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

      /* 头顶天线（戴王冠时收起） */
      if (!gear.head) {
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
      }

      /* 眼睛（眨眼 + 状态） */
      var blinking = (((t + 1.7) % (blinkAt + 0.16)) < 0.16) && t > 0.05;  /* 相位偏移：静止帧(t=0)时不要永远闭眼 */
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

      /* ---- 配饰（商城里买的装扮） ---- */
      if (gear.face) {                       /* 墨镜 */
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(26,20,16,.4)';
        ctx.lineWidth = 2;
        ctx.strokeStyle = P.line;
        [-15, 15].forEach(function (ex) {
          rr(ctx, bx + ex - 11.5, hy - 5, 23, 15, 6);
          ctx.fillStyle = 'rgba(24,20,17,.94)';
          ctx.fill(); ctx.stroke();
        });
        ctx.beginPath();
        ctx.moveTo(bx - 4, hy + 2); ctx.lineTo(bx + 4, hy + 2);
        ctx.stroke();
        ctx.globalAlpha = 0.42;
        ctx.beginPath();
        ctx.moveTo(bx - 19, hy + 6); ctx.lineTo(bx - 9, hy - 2);
        ctx.moveTo(bx + 11, hy + 6); ctx.lineTo(bx + 21, hy - 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (gear.neck) {                       /* 围巾 */
        var nk = base - bodyH + 6;
        ctx.shadowBlur = 7;
        ctx.shadowColor = 'rgba(192,85,63,.45)';
        ctx.strokeStyle = '#c0553f';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(bx - 31, nk - 6);
        ctx.quadraticCurveTo(bx, nk + 13, bx + 31, nk - 6);
        ctx.stroke();
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(bx + 19, nk + 3);
        ctx.lineTo(bx + 27, nk + 42);
        ctx.stroke();
      }

      if (gear.head) {                       /* 小王冠 */
        var cy0 = hy - headR - 4;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(224,169,59,.6)';
        ctx.beginPath();
        ctx.moveTo(bx - 19, cy0 + 12);
        ctx.lineTo(bx - 19, cy0 - 7);
        ctx.lineTo(bx - 9, cy0 + 2);
        ctx.lineTo(bx, cy0 - 13);
        ctx.lineTo(bx + 9, cy0 + 2);
        ctx.lineTo(bx + 19, cy0 - 7);
        ctx.lineTo(bx + 19, cy0 + 12);
        ctx.closePath();
        ctx.fillStyle = 'rgba(224,169,59,.94)';
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(255,255,255,.6)';
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';

      ctx.restore();

      /* 扫描线 + 故障闪烁（挂件模式不要，免得小尺寸下糊成一团） */
      if (!bare) {
        var sy = ((t * 0.22) % 1) * H;
        ctx.fillStyle = P.scan;
        ctx.fillRect(0, sy, W, 1.6);

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
      setGear: function (g) { setGear(g); drawOnce(); },
      setHungry: function (h) { hungry = !!h; drawOnce(); },
      /* 贴图模式下切换「只画头部」（收起态用） */
      setHeadOnly: function (b) { spriteHeadOnly = !!b; drawOnce(); },
      play: function (name, dur) { playFx(name, dur); },
      setState: function (o) {
        if (o && o.sleeping !== undefined) st.sleeping = !!o.sleeping;
        if (o && o.daze !== undefined) st.daze = !!o.daze;
        if (!running && !reduce) start();
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
