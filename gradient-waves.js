/* ============================================================
   GradientWaves — 原生 WebGL2 暖色渐变波浪背景（无依赖）
   移植自 React Bits GradientWaves (JS + CSS variant, ogl)
   全屏 fixed 底层：卡其暖色波浪场，远处淡出成雾，带轻微胶片颗粒。
   用法：在 <body> 放 <div id="bg-waves"></div>，本脚本自动初始化。
   性能：raymarch 步数 60、dpr 上限 1.25，不可见/切后台自动停帧。
   ============================================================ */
(function () {
  'use strict';

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return [1, 1, 1];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }

  var VERT = '#version 300 es\n'
    + 'in vec2 position;\n'
    + 'void main(){ gl_Position = vec4(position, 0.0, 1.0); }\n';

  var FRAG = '#version 300 es\n'
    + 'precision highp float;\n'
    + 'uniform vec2 iResolution;\n'
    + 'uniform float iTime;\n'
    + 'uniform float uSpeed;\n'
    + 'uniform float uAmplitude;\n'
    + 'uniform float uWaveScale;\n'
    + 'uniform float uWaveRatio;\n'
    + 'uniform float uSwell;\n'
    + 'uniform float uTurbulence;\n'
    + 'uniform float uTilt;\n'
    + 'uniform float uZoom;\n'
    + 'uniform float uHeight;\n'
    + 'uniform float uFogDepth;\n'
    + 'uniform float uSteps;\n'
    + 'uniform float uBrightness;\n'
    + 'uniform float uOpacity;\n'
    + 'uniform float uGrain;\n'
    + 'uniform float uGrainIntensity;\n'
    + 'uniform vec2 uMouse;\n'
    + 'uniform float uParallax;\n'
    + 'uniform bool uEnableMouse;\n'
    + 'uniform vec3 uHorizonColor;\n'
    + 'uniform vec3 uWaveColor;\n'
    + 'uniform vec3 uCrestColor;\n'
    + 'out vec4 fragColor;\n'
    + '\n'
    + 'const float MAX_DIST = 20000.0;\n'
    + '\n'
    + 'float hash21(vec2 p){\n'
    + '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);\n'
    + '  p3 += dot(p3, p3.yzx + 33.33);\n'
    + '  return fract((p3.x + p3.y) * p3.z);\n'
    + '}\n'
    + '\n'
    + 'float plasma(vec3 r, vec2 freq, vec4 tc){\n'
    + '  float mx = r.x + tc.x;\n'
    + '  mx += uSwell * sin((r.y + mx) / 20.0 + tc.y);\n'
    + '  float my = r.y - tc.z;\n'
    + '  my += uTurbulence * cos(r.x / 23.0 + tc.w);\n'
    + '  return r.z - (sin(mx * freq.x) * uAmplitude + sin(my * freq.y) * uAmplitude + uHeight);\n'
    + '}\n'
    + '\n'
    + 'float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc){\n'
    + '  float dist = 0.0;\n'
    + '  for (int i = 0; i < 128; i++){\n'
    + '    if (float(i) >= uSteps) break;\n'
    + '    float dscene = plasma(pos + dist * dir, freq, tc);\n'
    + '    if (abs(dscene) < 0.1) break;\n'
    + '    dist += 0.9 * dscene;\n'
    + '    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;\n'
    + '  }\n'
    + '  return dist;\n'
    + '}\n'
    + '\n'
    + 'void main(){\n'
    + '  float T = iTime * uSpeed;\n'
    + '  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);\n'
    + '  vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);\n'
    + '  float c, s;\n'
    + '  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);\n'
    + '  vec3 cam = vec3(0.0, 0.0, 30.0);\n'
    + '  vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;\n'
    + '  uv.x *= iResolution.x / iResolution.y;\n'
    + '  uv.y *= -1.0;\n'
    + '  vec3 dir = vec3(0.0, 0.0, -1.0);\n'
    + '  float ulen = length(uv);\n'
    + '  float xrot = vfov * ulen;\n'
    + '  c = cos(xrot); s = sin(xrot);\n'
    + '  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;\n'
    + '  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);\n'
    + '  c = nuv.x; s = nuv.y;\n'
    + '  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;\n'
    + '  c = cos(uTilt); s = sin(uTilt);\n'
    + '  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;\n'
    + '  if (uEnableMouse) {\n'
    + '    float yaw = (uMouse.x - 0.5) * uParallax * 0.4;\n'
    + '    float pitch = (uMouse.y - 0.5) * uParallax * 0.4;\n'
    + '    c = cos(yaw); s = sin(yaw);\n'
    + '    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;\n'
    + '    c = cos(pitch); s = sin(pitch);\n'
    + '    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;\n'
    + '  }\n'
    + '  float dist = raymarch(cam, dir, freq, tc);\n'
    + '  vec3 pos = cam + dist * dir;\n'
    + '  float t = clamp(uFogDepth / max(dist, 0.001), 0.0, 1.0);\n'
    + '  vec3 body = mix(uWaveColor, uCrestColor, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));\n'
    + '  vec3 col = mix(uHorizonColor, body, t);\n'
    + '  col *= uBrightness;\n'
    + '  col = clamp(col, 0.0, 1.0);\n'
    + '  float alpha = clamp(t, 0.0, 1.0) * uOpacity;\n'
    + '  if (uGrain > 0.5) {\n'
    + '    float g = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);\n'
    + '    alpha += (g - 0.5) * uGrainIntensity;\n'
    + '  }\n'
    + '  alpha = clamp(alpha, 0.0, 1.0);\n'
    + '  fragColor = vec4(col * alpha, alpha);\n'
    + '}\n';

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('GradientWaves shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function init() {
    var host = document.getElementById('bg-waves');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bg-waves';
      document.body.insertBefore(host, document.body.firstChild);
    }

    var canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.appendChild(canvas);

    var gl;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        powerPreference: 'low-power'
      });
    } catch (e) { gl = null; }
    if (!gl) return; /* 回退：保留 CSS 暖色渐变 */

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.parentNode && canvas.parentNode.removeChild(canvas); return; }
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('GradientWaves link error:', gl.getProgramInfoLog(prog));
      canvas.parentNode && canvas.parentNode.removeChild(canvas); return;
    }
    gl.useProgram(prog);

    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    /* 预乘 alpha 混合：远处淡出后透出底层暖色 */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    var U = {};
    ['iResolution', 'iTime', 'uSpeed', 'uAmplitude', 'uWaveScale', 'uWaveRatio', 'uSwell',
      'uTurbulence', 'uTilt', 'uZoom', 'uHeight', 'uFogDepth', 'uSteps', 'uBrightness',
      'uOpacity', 'uGrain', 'uGrainIntensity', 'uMouse', 'uParallax', 'uEnableMouse',
      'uHorizonColor', 'uWaveColor', 'uCrestColor'].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });

    /* ---- 卡其暖色配色 ---- */
    gl.uniform3fv(U.uHorizonColor, hexToRgb('#e9d6b4'));   /* 远处暖雾 */
    gl.uniform3fv(U.uWaveColor, hexToRgb('#c2a878'));      /* 卡其波体 */
    gl.uniform3fv(U.uCrestColor, hexToRgb('#f7eddc'));     /* 波峰高光 */

    /* ---- 背景参数：慢、柔、省电 ---- */
    gl.uniform1f(U.uSpeed, 0.25);
    gl.uniform1f(U.uAmplitude, 2.0);
    gl.uniform1f(U.uWaveScale, 0.6);
    gl.uniform1f(U.uWaveRatio, 0.9);
    gl.uniform1f(U.uSwell, 30.0);
    gl.uniform1f(U.uTurbulence, 18.0);
    gl.uniform1f(U.uTilt, 1.06);
    gl.uniform1f(U.uZoom, 1.0);
    gl.uniform1f(U.uHeight, 5.5);
    gl.uniform1f(U.uFogDepth, 12.0);
    gl.uniform1f(U.uSteps, 60.0);        /* low=40 / medium=70 之间折中 */
    gl.uniform1f(U.uBrightness, 1.02);
    gl.uniform1f(U.uOpacity, 0.88);
    gl.uniform1f(U.uGrain, 1.0);
    gl.uniform1f(U.uGrainIntensity, 0.045);
    gl.uniform1f(U.uParallax, 0.35);
    gl.uniform1i(U.uEnableMouse, 1);

    var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    var raf = 0, running = false, startTime = performance.now();
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* 鼠标视差：背景层 pointer-events:none，所以在 window 上取坐标 */
    var cur = [0.5, 0.5], tgt = [0.5, 0.5];
    window.addEventListener('pointermove', function (e) {
      tgt[0] = e.clientX / Math.max(1, window.innerWidth);
      tgt[1] = 1.0 - e.clientY / Math.max(1, window.innerHeight);
    }, { passive: true });

    function resize() {
      var w = Math.max(1, Math.floor(host.clientWidth || window.innerWidth));
      var h = Math.max(1, Math.floor(host.clientHeight || window.innerHeight));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.iResolution, canvas.width, canvas.height);
    }

    function render(t) {
      gl.uniform1f(U.iTime, t);
      cur[0] += 0.05 * (tgt[0] - cur[0]);
      cur[1] += 0.05 * (tgt[1] - cur[1]);
      gl.uniform2f(U.uMouse, cur[0], cur[1]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      render((now - startTime) * 0.001);
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!running && !reduce) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; running = false; }

    var ro = new ResizeObserver(function () { resize(); if (reduce) render(0); });
    ro.observe(host);
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !document.hidden) start(); else stop();
    }, { threshold: 0 });
    io.observe(host);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    resize();
    if (reduce) render(0); else start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
