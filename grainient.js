/* ============================================================
   Grainient — 原生 WebGL2 暖色颗粒背景（无依赖）
   移植自 React Bits Grainient (JS + CSS variant, ogl)
   做成全屏 fixed 底层：暖色卡其渐变 + 细颗粒质感，持续缓慢流动；
   尊重 prefers-reduced-motion（静态渲染一帧）；dpr 限 ≤1.5 省电。
   用法：在 <body> 任意处放 <div id="bg-grain"></div>，本脚本自动初始化。
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
    + 'uniform float uTimeSpeed;\n'
    + 'uniform float uColorBalance;\n'
    + 'uniform float uWarpStrength;\n'
    + 'uniform float uWarpFrequency;\n'
    + 'uniform float uWarpSpeed;\n'
    + 'uniform float uWarpAmplitude;\n'
    + 'uniform float uBlendAngle;\n'
    + 'uniform float uBlendSoftness;\n'
    + 'uniform float uRotationAmount;\n'
    + 'uniform float uNoiseScale;\n'
    + 'uniform float uGrainAmount;\n'
    + 'uniform float uGrainScale;\n'
    + 'uniform float uGrainAnimated;\n'
    + 'uniform float uContrast;\n'
    + 'uniform float uGamma;\n'
    + 'uniform float uSaturation;\n'
    + 'uniform vec2 uCenterOffset;\n'
    + 'uniform float uZoom;\n'
    + 'uniform vec3 uColor1;\n'
    + 'uniform vec3 uColor2;\n'
    + 'uniform vec3 uColor3;\n'
    + 'out vec4 fragColor;\n'
    + '#define S(a,b,t) smoothstep(a,b,t)\n'
    + 'mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}\n'
    + 'vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}\n'
    + 'float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}\n'
    + 'void mainImage(out vec4 o, vec2 C){\n'
    + '  float t=iTime*uTimeSpeed;\n'
    + '  vec2 uv=C/iResolution.xy;\n'
    + '  float ratio=iResolution.x/iResolution.y;\n'
    + '  vec2 tuv=uv-0.5+uCenterOffset;\n'
    + '  tuv/=max(uZoom,0.001);\n'
    + '  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);\n'
    + '  tuv.y*=1.0/ratio;\n'
    + '  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));\n'
    + '  tuv.y*=ratio;\n'
    + '  float frequency=uWarpFrequency;\n'
    + '  float ws=max(uWarpStrength,0.001);\n'
    + '  float amplitude=uWarpAmplitude/ws;\n'
    + '  float warpTime=t*uWarpSpeed;\n'
    + '  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;\n'
    + '  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);\n'
    + '  vec3 colLav=uColor1;\n'
    + '  vec3 colOrg=uColor2;\n'
    + '  vec3 colDark=uColor3;\n'
    + '  float b=uColorBalance;\n'
    + '  float s=max(uBlendSoftness,0.0);\n'
    + '  mat2 blendRot=Rot(radians(uBlendAngle));\n'
    + '  float blendX=(tuv*blendRot).x;\n'
    + '  float edge0=-0.3-b-s;\n'
    + '  float edge1=0.2-b+s;\n'
    + '  float v0=0.5-b+s;\n'
    + '  float v1=-0.3-b-s;\n'
    + '  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));\n'
    + '  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));\n'
    + '  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));\n'
    + '  vec2 grainUv=uv*max(uGrainScale,0.001);\n'
    + '  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);}\n'
    + '  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);\n'
    + '  col+=(grain-0.5)*uGrainAmount;\n'
    + '  col=(col-0.5)*uContrast+0.5;\n'
    + '  float luma=dot(col,vec3(0.2126,0.7152,0.0722));\n'
    + '  col=mix(vec3(luma),col,uSaturation);\n'
    + '  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));\n'
    + '  col=clamp(col,0.0,1.0);\n'
    + '  o=vec4(col,1.0);\n'
    + '}\n'
    + 'void main(){ vec4 o=vec4(0.0); mainImage(o,gl_FragCoord.xy); fragColor=o; }\n';

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('Grainient shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function init() {
    var host = document.getElementById('bg-grain');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bg-grain';
      document.body.insertBefore(host, document.body.firstChild);
    }

    var canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.appendChild(canvas);

    var gl;
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
    } catch (e) { gl = null; }
    if (!gl) return; /* fallback: 保留 CSS 暖色渐变 */

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.parentNode && canvas.parentNode.removeChild(canvas); return; }
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('Grainient link error:', gl.getProgramInfoLog(prog));
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
    ['iResolution', 'iTime', 'uTimeSpeed', 'uColorBalance', 'uWarpStrength', 'uWarpFrequency',
      'uWarpSpeed', 'uWarpAmplitude', 'uBlendAngle', 'uBlendSoftness', 'uRotationAmount',
      'uNoiseScale', 'uGrainAmount', 'uGrainScale', 'uGrainAnimated', 'uContrast', 'uGamma',
      'uSaturation', 'uCenterOffset', 'uZoom', 'uColor1', 'uColor2', 'uColor3'].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });

    /* 暖色卡其配色 */
    gl.uniform1f(U.uTimeSpeed, 0.15);
    gl.uniform1f(U.uColorBalance, 0.0);
    gl.uniform1f(U.uWarpStrength, 0.6);
    gl.uniform1f(U.uWarpFrequency, 3.0);
    gl.uniform1f(U.uWarpSpeed, 1.2);
    gl.uniform1f(U.uWarpAmplitude, 60.0);
    gl.uniform1f(U.uBlendAngle, 30.0);
    gl.uniform1f(U.uBlendSoftness, 0.18);
    gl.uniform1f(U.uRotationAmount, 220.0);
    gl.uniform1f(U.uNoiseScale, 1.6);
    gl.uniform1f(U.uGrainAmount, 0.07);
    gl.uniform1f(U.uGrainScale, 1.4);
    gl.uniform1f(U.uGrainAnimated, 0.0);
    gl.uniform1f(U.uContrast, 1.05);
    gl.uniform1f(U.uGamma, 1.0);
    gl.uniform1f(U.uSaturation, 1.05);
    gl.uniform2f(U.uCenterOffset, 0.0, 0.0);
    gl.uniform1f(U.uZoom, 0.92);
    gl.uniform3fv(U.uColor1, hexToRgb('#f3e0bf'));
    gl.uniform3fv(U.uColor2, hexToRgb('#c97f44'));
    gl.uniform3fv(U.uColor3, hexToRgb('#7a5d3e'));

    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var raf = 0, running = false, startTime = performance.now();
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    function resize() {
      var w = Math.max(1, Math.floor(host.clientWidth || window.innerWidth));
      var h = Math.max(1, Math.floor(host.clientHeight || window.innerHeight));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.iResolution, canvas.width, canvas.height);
    }

    function frame(now) {
      gl.uniform1f(U.iTime, (now - startTime) * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (reduceMotion) { running = false; raf = 0; return; }
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running || reduceMotion) return;
      running = true; raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; running = false;
    }

    var ro = new ResizeObserver(function () { resize(); if (reduceMotion) gl.uniform1f(U.iTime, 0), gl.drawArrays(gl.TRIANGLES, 0, 3); });
    ro.observe(host);
    var onVis = function () {
      if (document.hidden) stop(); else start();
    };
    document.addEventListener('visibilitychange', onVis);

    resize();
    if (reduceMotion) {
      gl.uniform1f(U.iTime, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      start();
    }

    window.__grainientStop = stop;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
