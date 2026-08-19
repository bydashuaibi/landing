/* ============================================================
   WarpText — 原生 WebGL2 玻璃折射扭曲标题（无依赖）
   移植自 React Bits WarpText (JS + CSS variant, ogl)
   用法:
     <div class="warp-head" data-warp='{"warpStrength":0.1}'>
       <h2>标题文字</h2>   <!-- fallback: WebGL 不可用时原样显示 -->
     </div>
     WarpText.apply(root)   // 挂载 root 下所有 [data-warp]
     WarpText.disposeAll()  // 视图切换前销毁全部 GL context
   ============================================================ */
(function () {
  'use strict';

  /* ---------- shaders (GLSL ES 3.0) ---------- */
  var VERTEX = '#version 300 es\n'
    + 'in vec2 position;\n'
    + 'in vec2 uv;\n'
    + 'out vec2 vUv;\n'
    + 'void main() {\n'
    + '  vUv = uv;\n'
    + '  gl_Position = vec4(position, 0.0, 1.0);\n'
    + '}\n';

  var FRAGMENT = '#version 300 es\n'
    + 'precision highp float;\n'
    + '\n'
    + 'uniform sampler2D uTextTexture;\n'
    + 'uniform vec2 uResolution;\n'
    + 'uniform vec2 uPointer;\n'
    + 'uniform float uPointerActive;\n'
    + 'uniform float uTime;\n'
    + 'uniform float uWarpStrength;\n'
    + 'uniform float uWarpScale;\n'
    + 'uniform float uSpeed;\n'
    + 'uniform float uPointerInfluence;\n'
    + 'uniform float uPointerStrength;\n'
    + 'uniform float uRefraction;\n'
    + 'uniform float uRipple;\n'
    + 'uniform float uMotion;\n'
    + '\n'
    + 'in vec2 vUv;\n'
    + 'out vec4 fragColor;\n'
    + '\n'
    + 'float hash(vec2 p) {\n'
    + '  p = fract(p * vec2(123.34, 456.21));\n'
    + '  p += dot(p, p + 45.32);\n'
    + '  return fract(p.x * p.y);\n'
    + '}\n'
    + '\n'
    + 'float noise(vec2 p) {\n'
    + '  vec2 i = floor(p);\n'
    + '  vec2 f = fract(p);\n'
    + '  vec2 u = f * f * (3.0 - 2.0 * f);\n'
    + '  float a = hash(i);\n'
    + '  float b = hash(i + vec2(1.0, 0.0));\n'
    + '  float c = hash(i + vec2(0.0, 1.0));\n'
    + '  float d = hash(i + vec2(1.0, 1.0));\n'
    + '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n'
    + '}\n'
    + '\n'
    + 'float fbm(vec2 p) {\n'
    + '  float value = 0.0;\n'
    + '  float amplitude = 0.5;\n'
    + '  for (int i = 0; i < 4; i++) {\n'
    + '    value += amplitude * noise(p);\n'
    + '    p *= 2.02;\n'
    + '    amplitude *= 0.5;\n'
    + '  }\n'
    + '  return value;\n'
    + '}\n'
    + '\n'
    + 'vec4 sampleText(vec2 uv) {\n'
    + '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {\n'
    + '    return vec4(0.0);\n'
    + '  }\n'
    + '  return texture(uTextTexture, uv);\n'
    + '}\n'
    + '\n'
    + 'void main() {\n'
    + '  vec2 uv = vUv;\n'
    + '  float aspect = uResolution.x / max(uResolution.y, 1.0);\n'
    + '  float time = uTime * uSpeed;\n'
    + '  float scale = max(uWarpScale, 0.001);\n'
    + '\n'
    + '  vec2 drift = vec2(time * 0.055, -time * 0.045);\n'
    + '  float n1 = fbm(uv * scale * 3.1 + drift);\n'
    + '  float n2 = fbm((uv + 19.17) * scale * 3.4 - drift.yx);\n'
    + '  vec2 ambient = (vec2(n1, n2) - 0.5) * uWarpStrength * 0.045 * uMotion;\n'
    + '\n'
    + '  vec2 pointerDelta = uv - uPointer;\n'
    + '  vec2 aspectDelta = vec2(pointerDelta.x * aspect, pointerDelta.y);\n'
    + '  float dist = length(aspectDelta);\n'
    + '  float radius = max(uPointerInfluence, 0.001);\n'
    + '  float t = clamp(dist / radius, 0.0, 1.0);\n'
    + '  float lens = smoothstep(radius, 0.0, dist) * uPointerActive;\n'
    + '  float bulge = t * (1.0 - t) * (1.0 - t) * 6.75 * uPointerActive;\n'
    + '  vec2 dir = dist > 0.0001 ? vec2(aspectDelta.x / aspect, aspectDelta.y) / dist : vec2(0.0);\n'
    + '\n'
    + '  float rippleWave = sin(dist * 28.0 - time * 4.2) * 0.5 + 0.5;\n'
    + '  float rippleRing = (rippleWave - 0.5) * uRipple;\n'
    + '  vec2 pointerWarp = -dir * bulge * uPointerStrength * 0.045;\n'
    + '  pointerWarp += dir * rippleRing * bulge * uPointerStrength * 0.016;\n'
    + '\n'
    + '  vec2 displaced = uv + ambient + pointerWarp;\n'
    + '  vec2 splitDir = ambient + pointerWarp;\n'
    + '  float splitLen = length(splitDir);\n'
    + '  splitDir = splitLen > 0.00001 ? splitDir / splitLen : vec2(0.7071, 0.7071);\n'
    + '  vec2 split = splitDir * uRefraction * 0.16 * (0.35 + lens * 1.65);\n'
    + '\n'
    + '  vec4 base = sampleText(displaced);\n'
    + '  float r = sampleText(displaced + split).r;\n'
    + '  float g = base.g;\n'
    + '  float b = sampleText(displaced - split).b;\n'
    + '  float a = max(max(sampleText(displaced + split).a, base.a), sampleText(displaced - split).a);\n'
    + '\n'
    + '  vec3 color = vec3(r, g, b) + lens * base.a * 0.055;\n'
    + '  fragColor = vec4(color, a);\n'
    + '}\n';

  /* ---------- 文字纹理 (canvas 2D) ---------- */
  function measureLine(ctx, line, letterSpacing) {
    var chars = Array.from(line);
    var textWidth = chars.reduce(function (w, ch) { return w + ctx.measureText(ch).width; }, 0);
    return textWidth + Math.max(0, chars.length - 1) * letterSpacing;
  }

  function drawLine(ctx, line, x, y, letterSpacing) {
    var chars = Array.from(line);
    var cursor = x - measureLine(ctx, line, letterSpacing) / 2;
    chars.forEach(function (ch, i) {
      ctx.fillText(ch, cursor, y);
      cursor += ctx.measureText(ch).width + (i === chars.length - 1 ? 0 : letterSpacing);
    });
  }

  function buildTextCanvas(o) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(o.width * o.dpr));
    canvas.height = Math.max(1, Math.floor(o.height * o.dpr));

    var ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    ctx.clearRect(0, 0, o.width, o.height);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = o.color;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    var lines = String(o.text || '').split('\n');
    var fontSizePx = o.fontSizePx;
    var letterSpacing = o.letterSpacing;
    var lineHeight = o.lineHeight;
    var applyFont = function () {
      ctx.font = o.fontWeight + ' ' + fontSizePx + 'px ' + o.fontFamily;
    };
    applyFont();

    var maxWidth = o.width * 0.86;
    var maxHeight = o.height * 0.78;
    var widest = Math.max.apply(null, lines.map(function (l) { return measureLine(ctx, l, letterSpacing); }).concat([1]));
    var blockHeight = Math.max(lineHeight * lines.length, 1);
    var fit = Math.min(1, maxWidth / widest, maxHeight / blockHeight);

    if (fit < 1) {
      fontSizePx *= fit;
      letterSpacing *= fit;
      lineHeight *= fit;
      applyFont();
    }

    var startY = o.height / 2 - (lineHeight * (lines.length - 1)) / 2;
    lines.forEach(function (line, i) {
      drawLine(ctx, line, o.width / 2, startY + i * lineHeight, letterSpacing);
    });
    return canvas;
  }

  /* ---------- GL helpers ---------- */
  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('WarpText shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  /* ---------- 单实例 ---------- */
  function create(el, opts) {
    var fallback = el.querySelector('h1,h2,h3,.warp-fallback') || el;
    var text = (opts.text || fallback.textContent || '').trim();
    if (!text) return null;

    var cs = window.getComputedStyle(fallback);
    var props = {
      text: text,
      color: opts.color || cs.color,
      fontFamily: cs.fontFamily || 'sans-serif',
      fontWeight: cs.fontWeight || '800',
      fontSizePx: parseFloat(cs.fontSize) || 32,
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : (parseFloat(cs.letterSpacing) || 0),
      lineHeight: parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 32) * 0.9,
      warpStrength: opts.warpStrength != null ? opts.warpStrength : 0.08,
      warpScale: opts.warpScale != null ? opts.warpScale : 1.7,
      speed: opts.speed != null ? opts.speed : 0.55,
      pointerInfluence: opts.pointerInfluence != null ? opts.pointerInfluence : 0.42,
      pointerStrength: opts.pointerStrength != null ? opts.pointerStrength : 0.38,
      refraction: opts.refraction != null ? opts.refraction : 0.018,
      ripple: opts.ripple != null ? !!opts.ripple : true
    };

    /* WebGL2 context */
    var canvas = document.createElement('canvas');
    var gl;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
    } catch (e) { gl = null; }
    if (!gl) return null; /* fallback: 保留原文本 */

    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    el.appendChild(canvas);

    /* program */
    var vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) { gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext(); el.removeChild(canvas); return null; }
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('WarpText link error:', gl.getProgramInfoLog(program));
      gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
      el.removeChild(canvas);
      return null;
    }
    gl.useProgram(program);

    /* fullscreen triangle */
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    var uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW);
    var aUv = gl.getAttribLocation(program, 'uv');
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    /* texture */
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    /* uniforms */
    var U = {};
    ['uTextTexture','uResolution','uPointer','uPointerActive','uTime','uWarpStrength','uWarpScale','uSpeed','uPointerInfluence','uPointerStrength','uRefraction','uRipple','uMotion'].forEach(function (n) {
      U[n] = gl.getUniformLocation(program, n);
    });

    function syncUniforms() {
      gl.uniform1f(U.uWarpStrength, props.warpStrength);
      gl.uniform1f(U.uWarpScale, props.warpScale);
      gl.uniform1f(U.uSpeed, props.speed);
      gl.uniform1f(U.uPointerInfluence, props.pointerInfluence);
      gl.uniform1f(U.uPointerStrength, props.pointerStrength);
      gl.uniform1f(U.uRefraction, props.refraction);
      gl.uniform1f(U.uRipple, props.ripple ? 1 : 0);
    }

    var state = {
      disposed: false, contextLost: false, visible: true,
      pageVisible: !document.hidden, raf: 0,
      reduceMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    };
    var pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: 0, activeTarget: 0 };
    var startTime = performance.now();
    var resVal = new Float32Array([1, 1]);
    var ptrVal = new Float32Array([0.5, 0.5]);

    function renderOnce() {
      if (state.disposed || state.contextLost) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function rasterize() {
      if (state.disposed || state.contextLost) return;
      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var textCanvas = buildTextCanvas({
        width: rect.width, height: rect.height, dpr: dpr,
        text: props.text, color: props.color,
        fontFamily: props.fontFamily, fontWeight: props.fontWeight,
        fontSizePx: props.fontSizePx, letterSpacing: props.letterSpacing,
        lineHeight: props.lineHeight
      });
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
      renderOnce();
    }

    function resize() {
      if (state.disposed || state.contextLost) return;
      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      resVal[0] = canvas.width; resVal[1] = canvas.height;
      gl.uniform2fv(U.uResolution, resVal);
      rasterize();
    }

    function loop(now) {
      if (state.disposed || state.contextLost) return;
      var elapsed = (now - startTime) * 0.001;
      var idleX = 0.5 + Math.sin(elapsed * 0.33) * 0.12;
      var idleY = 0.5 + Math.cos(elapsed * 0.27) * 0.1;
      var targetX = pointer.activeTarget > 0 ? pointer.tx : idleX;
      var targetY = pointer.activeTarget > 0 ? pointer.ty : idleY;
      var damping = pointer.activeTarget > 0 ? 0.12 : 0.035;

      pointer.x += (targetX - pointer.x) * damping;
      pointer.y += (targetY - pointer.y) * damping;
      pointer.active += ((pointer.activeTarget > 0 ? 1 : 0.18) - pointer.active) * 0.06;

      ptrVal[0] = pointer.x; ptrVal[1] = pointer.y;
      gl.uniform2fv(U.uPointer, ptrVal);
      gl.uniform1f(U.uPointerActive, state.reduceMotion ? pointer.active * 0.35 : pointer.active);
      gl.uniform1f(U.uTime, state.reduceMotion ? 0 : elapsed);

      renderOnce();
      state.raf = requestAnimationFrame(loop);
    }

    /* events */
    function onPointerMove(e) {
      if (e.pointerType === 'touch') return;
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointer.tx = (e.clientX - rect.left) / rect.width;
      pointer.ty = 1 - (e.clientY - rect.top) / rect.height;
      pointer.activeTarget = 1;
    }
    function onPointerLeave() { pointer.activeTarget = 0; }
    function onContextLost(e) {
      e.preventDefault();
      state.contextLost = true;
      if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
      el.removeAttribute('data-warp-mounted');
    }
    function onVisibility() {
      state.pageVisible = !document.hidden;
      if (state.pageVisible && state.visible && !state.raf) state.raf = requestAnimationFrame(loop);
      if (!state.pageVisible && state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    }
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function onReducedMotion(e) {
      state.reduceMotion = e.matches;
      gl.uniform1f(U.uMotion, state.reduceMotion ? 0 : 1);
      renderOnce();
    }

    var resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(el);
    var intersectionObserver = new IntersectionObserver(function (entries) {
      var en = entries[0];
      state.visible = en.isIntersecting;
      if (state.visible && state.pageVisible && !state.raf) state.raf = requestAnimationFrame(loop);
      if (!state.visible && state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    }, { threshold: 0 });
    intersectionObserver.observe(el);

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    document.addEventListener('visibilitychange', onVisibility);
    if (mq && mq.addEventListener) mq.addEventListener('change', onReducedMotion);

    /* initial state */
    gl.uniform1i(U.uTextTexture, 0);
    gl.uniform1f(U.uMotion, state.reduceMotion ? 0 : 1);
    syncUniforms();
    resize();

    /* hide fallback text only after first successful raster */
    var firstRaster = function () {
      if (state.disposed) return;
      el.setAttribute('data-warp-mounted', '1');
    };
    var rasterTick = setInterval(function () {
      if (state.disposed || state.contextLost) { clearInterval(rasterTick); return; }
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) { clearInterval(rasterTick); resize(); firstRaster(); }
    }, 80);
    setTimeout(function () { clearInterval(rasterTick); }, 4000);

    state.raf = requestAnimationFrame(loop);

    return {
      el: el,
      destroy: function () {
        state.disposed = true;
        if (state.raf) cancelAnimationFrame(state.raf);
        clearInterval(rasterTick);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        document.removeEventListener('visibilitychange', onVisibility);
        if (mq && mq.removeEventListener) mq.removeEventListener('change', onReducedMotion);
        el.removeAttribute('data-warp-mounted');
        if (!state.contextLost) {
          try {
            gl.deleteTexture(texture);
            gl.deleteBuffer(posBuf);
            gl.deleteBuffer(uvBuf);
            gl.deleteVertexArray(vao);
            gl.deleteProgram(program);
            var lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
          } catch (e) { /* noop */ }
        }
        if (canvas.parentNode === el) el.removeChild(canvas);
      }
    };
  }

  /* ---------- 管理器 ---------- */
  var instances = [];

  function parseOpts(el) {
    var raw = el.getAttribute('data-warp');
    if (!raw || raw === 'true') return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }

  function apply(root) {
    (root || document).querySelectorAll('[data-warp]').forEach(function (el) {
      if (el.hasAttribute('data-warp-mounted') || el.querySelector('canvas')) return;
      var inst = create(el, parseOpts(el));
      if (inst) instances.push(inst);
    });
  }

  function disposeAll() {
    instances.forEach(function (i) { try { i.destroy(); } catch (e) { /* noop */ } });
    instances = [];
  }

  window.WarpText = { create: create, apply: apply, disposeAll: disposeAll };
})();
