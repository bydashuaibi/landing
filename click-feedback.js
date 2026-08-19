/* ============================================================
   ClickFeedback — 全局像素点击反馈 (原生 WebGL2, 无依赖)
   移植自 React Bits PixelBlast 的 bayer-dithering + 点击涟漪核心。
   做成全屏透明 overlay：平时完全透明、零开销；任意位置点击即在
   落点炸开一圈像素波纹，约 1.3s 内扩散淡出，给强确认感。
   ============================================================ */
(function () {
  'use strict';

  var MAX = 10;
  var LIFE = 1.3; // 单次涟漪寿命（秒）

  /* 颜色：自动读主题陶土色，失败回退 */
  function parseColor(v) {
    if (!v) return null;
    v = v.trim();
    if (v.charAt(0) === '#') {
      var h = v.slice(1);
      if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
      if (h.length !== 6) return null;
      return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
    }
    var m = v.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(',').map(function (s) { return parseFloat(s); });
      return [p[0] / 255, p[1] / 255, p[2] / 255];
    }
    return null;
  }
  function themeColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--terracotta');
    return parseColor(v) || [0.753, 0.439, 0.235];
  }

  /* shader (GLSL ES 3.0) */
  var VERT = '#version 300 es\n'
    + 'in vec2 position;\n'
    + 'void main(){ gl_Position = vec4(position, 0.0, 1.0); }\n';

  var FRAG = '#version 300 es\n'
    + 'precision highp float;\n'
    + 'uniform vec2 uResolution;\n'
    + 'uniform float uTime;\n'
    + 'uniform vec3 uColor;\n'
    + 'uniform float uPixelSize;\n'
    + 'uniform int uShapeType;\n'
    + 'uniform float uRippleSpeed;\n'
    + 'uniform float uRippleThickness;\n'
    + 'uniform float uRippleIntensity;\n'
    + 'uniform float uLife;\n'
    + 'uniform vec2 uClickPos[' + MAX + '];\n'
    + 'uniform float uClickTimes[' + MAX + '];\n'
    + 'out vec4 fragColor;\n'
    + '\n'
    + 'float Bayer2(vec2 a){ a = floor(a); return fract(a.x/2.0 + a.y*a.y*0.75); }\n'
    + '#define Bayer4(a) (Bayer2(0.5*(a))*0.25 + Bayer2(a))\n'
    + '#define Bayer8(a) (Bayer4(0.5*(a))*0.25 + Bayer2(a))\n'
    + '\n'
    + 'float shapeMask(vec2 p, int t){\n'
    + '  if(t == 1) return step(length(p - 0.5), 0.55);\n'
    + '  if(t == 3) return step(abs(p.x - 0.5) + abs(p.y - 0.5), 0.5);\n'
    + '  if(t == 2) return step(p.y, 1.0 - abs(p.x - 0.5) * 2.0);\n'
    + '  return 1.0;\n'
    + '}\n'
    + '\n'
    + 'void main(){\n'
    + '  float aspect = uResolution.x / uResolution.y;\n'
    + '  vec2 uv = gl_FragCoord.xy / uResolution;\n'
    + '  uv.x *= aspect;\n'
    + '  float ring = 0.0;\n'
    + '  for(int i = 0; i < ' + MAX + '; i++){\n'
    + '    vec2 pos = uClickPos[i];\n'
    + '    if(pos.x < -0.5) continue;\n'
    + '    float t = uTime - uClickTimes[i];\n'
    + '    if(t < 0.0 || t > uLife) continue;\n'
    + '    vec2 cpos = vec2(pos.x * aspect, pos.y);\n'
    + '    float r = distance(uv, cpos);\n'
    + '    float waveR = uRippleSpeed * t;\n'
    + '    float d = (r - waveR) / uRippleThickness;\n'
    + '    float ringI = exp(-d*d) * exp(-t / uLife * 3.0);\n'
    + '    ring = max(ring, ringI * uRippleIntensity);\n'
    + '    float d2 = (r - waveR * 0.55) / uRippleThickness;\n'
    + '    float ring2 = exp(-d2*d2) * exp(-t / uLife * 3.0) * 0.5;\n'
    + '    ring = max(ring, ring2 * uRippleIntensity);\n'
    + '  }\n'
    + '  if(ring <= 0.002){ fragColor = vec4(0.0); return; }\n'
    + '  vec2 localUV = fract(gl_FragCoord.xy / uPixelSize);\n'
    + '  float bayer = Bayer8(gl_FragCoord.xy / uPixelSize) - 0.5;\n'
    + '  float alpha = step(bayer, ring - 0.5);\n'
    + '  float shape = shapeMask(localUV, uShapeType);\n'
    + '  float M = alpha * shape * clamp(ring, 0.0, 1.0);\n'
    + '  fragColor = vec4(uColor, M);\n'
    + '}\n';

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('ClickFeedback shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function init() {
    if (window.CFB_DISABLED) return;
    var canvas = document.createElement('canvas');
    canvas.className = 'click-fx';
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '9999', display: 'block'
    });
    document.body.appendChild(canvas);

    var gl;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
    } catch (e) { gl = null; }
    if (!gl) { canvas.parentNode && canvas.parentNode.removeChild(canvas); return; }

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.parentNode && canvas.parentNode.removeChild(canvas); return; }
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('ClickFeedback link error:', gl.getProgramInfoLog(prog));
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

    var U = {};
    ['uResolution', 'uTime', 'uColor', 'uPixelSize', 'uShapeType', 'uRippleSpeed',
      'uRippleThickness', 'uRippleIntensity', 'uLife', 'uClickPos', 'uClickTimes'].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });

    var color = themeColor();
    gl.uniform3fv(U.uColor, color);
    gl.uniform1i(U.uShapeType, 1);          // circle
    gl.uniform1f(U.uRippleSpeed, 0.7);
    gl.uniform1f(U.uRippleThickness, 0.11);
    gl.uniform1f(U.uRippleIntensity, 1.35);
    gl.uniform1f(U.uLife, LIFE);

    var posArr = new Float32Array(MAX * 2);
    var timeArr = new Float32Array(MAX);
    for (var i = 0; i < MAX; i++) posArr[i * 2] = -1;
    gl.uniform2fv(U.uClickPos, posArr);
    gl.uniform1fv(U.uClickTimes, timeArr);

    var clicks = [];
    var startTime = performance.now();
    var running = false, raf = 0, dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uResolution, canvas.width, canvas.height);
      gl.uniform1f(U.uPixelSize, 5.0 * dpr);
    }

    function frame(now) {
      var t = (now - startTime) / 1000;
      clicks = clicks.filter(function (c) { return t - c.time <= LIFE + 0.3; });
      for (var i = 0; i < MAX; i++) {
        var c = clicks[i];
        if (c) { posArr[i * 2] = c.x; posArr[i * 2 + 1] = c.y; timeArr[i] = c.time; }
        else { posArr[i * 2] = -1; posArr[i * 2 + 1] = -1; timeArr[i] = 0; }
      }
      gl.uniform2fv(U.uClickPos, posArr);
      gl.uniform1fv(U.uClickTimes, timeArr);
      gl.uniform1f(U.uTime, t);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (clicks.length === 0) {
        running = false; raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true; raf = requestAnimationFrame(frame);
    }

    window.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('.click-fx')) return;
      var x = e.clientX / window.innerWidth;
      var y = 1 - e.clientY / window.innerHeight;
      clicks.push({ x: x, y: y, time: (performance.now() - startTime) / 1000 });
      if (clicks.length > MAX) clicks.shift();
      start();
    }, { passive: true });

    window.addEventListener('resize', resize);
    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
