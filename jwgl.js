/* 正方教务系统客户端（中国民航大学 jwgl.cauc.edu.cn）
 *
 * 为什么必须跑在主进程：渲染进程的 CSP 是 `connect-src 'self' https:`，
 * 而教务系统是 **http** 站点 —— 渲染进程根本连不上（2026-09-18 踩过）。
 *
 * 登录流程（对着学校自己的 /js/globalweb/login/login.js 复刻）：
 *   1. GET  /xtgl/login_slogin.html                 → JSESSIONID + csrftoken
 *   2. GET  /kaptcha?time=<ms>                      → 验证码图片（学校确实开着，实测过）
 *   3. GET  /xtgl/login_getPublicKey.html?time=<ms> → {modulus, exponent}，base64
 *   4. mm = base64( RSA_PKCS1v15(密码) )
 *      页面原话：
 *        var rsaKey = new RSAKey();
 *        rsaKey.setPublic(b64tohex(modulus), b64tohex(exponent));
 *        var enPassword = hex2b64(rsaKey.encrypt($("#mm").val()));
 *      先把 modulus/exponent 由 base64 转 hex 喂进去，再把密文由 hex 转回 base64 提交。
 *      两步转换刚好抵消 —— 等价于「对原始字节做 PKCS#1 v1.5 加密，结果转 base64」。
 *   5. POST /xtgl/login_slogin.html （登录页里所有隐藏字段原样带上 + yhm/mm/yzm）
 *
 * ⚠️ 第 1 步和第 5 步之间**不能重新 GET 登录页**：那会换掉 JSESSIONID，验证码随之作废。
 *    所以拆成 openLogin()（开会话 + 取验证码）和 submitLogin()（只提交）。
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://jwgl.cauc.edu.cn';
const LOGIN_URL = BASE + '/xtgl/login_slogin.html';
const MENU_URL = BASE + '/xtgl/index_initMenu.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class JwglClient {
  constructor() {
    this.cookies = {};
    this._loginForm = null;
  }

  _cookieHeader() {
    const ks = Object.keys(this.cookies);
    return ks.length ? ks.map((k) => k + '=' + this.cookies[k]).join('; ') : '';
  }

  _absorbCookies(res) {
    (res.headers['set-cookie'] || []).forEach((line) => {
      const m = /^([^=;]+)=([^;]*)/.exec(line);
      if (m) this.cookies[m[1].trim()] = m[2];
    });
  }

  request(path, opts) {
    opts = opts || {};
    const url = /^https?:/.test(path) ? path : BASE + path;
    const u = new URL(url);
    return new Promise((resolve, reject) => {
      const headers = Object.assign({
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Connection: 'close'
      }, opts.headers || {});
      const ck = this._cookieHeader();
      if (ck) headers.Cookie = ck;

      let body = opts.body;
      if (body && typeof body === 'object') {
        body = new URLSearchParams(body).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      if (body != null) headers['Content-Length'] = Buffer.byteLength(body);

      const req = http.request({
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: opts.method || (body != null ? 'POST' : 'GET'),
        headers
      }, (res) => {
        this._absorbCookies(res);
        if (opts.binary) {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({
            status: res.statusCode,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
            location: res.headers.location || ''
          }));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          location: res.headers.location || ''
        }));
      });
      req.on('error', reject);
      req.setTimeout(opts.timeout || 15000, () => req.destroy(new Error('请求超时')));
      if (body != null) req.write(body);
      req.end();
    });
  }

  /* 把登录页里所有 input 的 name/value 抽出来（含全部隐藏字段），提交时原样带上 */
  static parseForm(html) {
    const out = {};
    const re = /<input\b[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0];
      const nm = /\bname\s*=\s*"([^"]*)"/i.exec(tag);
      if (!nm || !nm[1]) continue;
      const vl = /\bvalue\s*=\s*"([^"]*)"/i.exec(tag);
      out[nm[1]] = vl ? vl[1] : '';
    }
    return out;
  }

  /* 等价于学校前端那套 b64tohex → RSAKey.encrypt → hex2b64 */
  encryptPassword(password, modulusB64, exponentB64) {
    const n = Buffer.from(modulusB64, 'base64');
    const e = Buffer.from(exponentB64, 'base64');
    const key = crypto.createPublicKey({
      key: { kty: 'RSA', n: b64url(n), e: b64url(e) },
      format: 'jwk'
    });
    return crypto.publicEncrypt(
      { key, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(password, 'utf8')
    ).toString('base64');
  }

  /* 验证码图片 → data URL（直接给渲染进程 <img src> 用） */
  async getCaptchaImage() {
    const r = await this.request('/kaptcha?time=' + Date.now(), {
      binary: true,
      headers: { Referer: LOGIN_URL }
    });
    if (r.status !== 200 || !r.buffer || !r.buffer.length) throw new Error('验证码图片取不到');
    const mime = (r.headers['content-type'] || 'image/jpeg').split(';')[0];
    return 'data:' + mime + ';base64,' + r.buffer.toString('base64');
  }

  /* 第一步：开一个会话，拿登录页表单 + 验证码（此后不能重新 GET 登录页） */
  async openLogin() {
    const lp = await this.request('/xtgl/login_slogin.html');
    if (lp.status !== 200) throw new Error('登录页打不开（HTTP ' + lp.status + '）');
    this._loginForm = JwglClient.parseForm(lp.body);
    if (!this._loginForm.csrftoken) throw new Error('登录页里没有 csrftoken，无法提交');
    const captcha = await this.getCaptchaImage();
    return { captcha: captcha };
  }

  /* 第二步：提交。captcha 传空表示学校当前不要验证码 */
  async submitLogin(username, password, captcha) {
    const form = Object.assign({}, this._loginForm || {});
    if (!form.csrftoken) throw new Error('登录会话已失效，请重新获取验证码');

    const pkRes = await this.request(
      '/xtgl/login_getPublicKey.html?time=' + Date.now(),
      { headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: LOGIN_URL } }
    );
    let pk = null;
    try { pk = JSON.parse(pkRes.body); } catch (e) { /* 下面统一报错 */ }
    if (!pk || !pk.modulus || !pk.exponent) throw new Error('拿不到加密公钥（学校接口变了？）');

    form.yhm = username;
    form.mm = this.encryptPassword(password, pk.modulus, pk.exponent);
    form.yzm = captcha || '';
    form.language = form.language || 'zh_CN';

    const r = await this.request('/xtgl/login_slogin.html', {
      method: 'POST',
      body: form,
      headers: { Referer: LOGIN_URL, Origin: BASE, 'Upgrade-Insecure-Requests': '1' }
    });

    const redirected = /index_initMenu/i.test(r.location) || /index_initMenu/i.test(r.body);
    if (!redirected) {
      const text = stripTags(r.body);
      const tip = /(验证码[^。；;，]{0,16}|用户名或密码[^。；;，]{0,20}|密码错误|账号[^。；;，]{0,20}|用户不存在)/.exec(text);
      return {
        ok: false,
        error: tip ? tip[0] : '登录失败（返回的不是首页）',
        needCaptcha: /验证码/.test(text)
      };
    }

    /* 再确认一次：菜单页打得开才算真登录成功 */
    const menu = await this.request('/xtgl/index_initMenu.html');
    if (menu.status !== 200 || /login_slogin/i.test(menu.body)) {
      return { ok: false, error: '会话没建立起来（被踢回登录页了）' };
    }
    return { ok: true, menuHtml: menu.body };
  }

  /* 会话是否还有效（不需要凭据） */
  async isLoggedIn() {
    try {
      const menu = await this.request('/xtgl/index_initMenu.html');
      return menu.status === 200 && !/login_slogin/i.test(menu.body);
    } catch (e) {
      return false;
    }
  }

  /* 从菜单页里找课表入口，找不到就按已知路径试 */
  _scheduleCandidates(menuHtml) {
    const list = [];
    const hits = String(menuHtml || '').match(/\/kbcx\/[A-Za-z0-9_]+\.html[^"'\s\\]*/g) || [];
    hits.forEach((u) => { if (list.indexOf(u) < 0) list.push(u); });
    /* 扫菜单拿到的排最前（那是本校真实入口）；下面是主流部署形态兜底。
       注意本校登录页是 /xtgl/...（**不带 /jwglxt 前缀**），所以无前缀候选放前面。 */
    [
      '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
      '/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151',
      '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
      '/jwglxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151'
    ].forEach((u) => { if (list.indexOf(u) < 0) list.push(u); });
    return list;
  }

  /* xnm = 学年（2026 表示 2026-2027 学年）；xqm = 3 第一学期 / 12 第二学期 / 16 第三学期 */
  async fetchSchedule(xnm, xqm) {
    const menu = await this.request('/xtgl/index_initMenu.html');
    if (/login_slogin/i.test(menu.body) || menu.status === 302) {
      return { ok: false, error: '未登录或会话已过期', expired: true };
    }

    /* ⚠️ 正方有个隐蔽要求：查询前**必须先 GET 一次功能首页**，服务端会把
       gnmkdm（功能编号）注册进本次会话；跳过这步直接 POST，很多版本会回空或报错。
       这步失败了不要紧，继续往下试。 */
    try {
      await this.request('/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default');
    } catch (e) { /* 注册失败不致命，后面 POST 照样试 */ }

    const tried = [];
    for (const url of this._scheduleCandidates(menu.body)) {
      let r;
      try {
        r = await this.request(url, {
          method: 'POST',
          /* ⚠️ kzlx=ck（查看）和 xsdm=（空）是正方新版课表接口要的参数，漏了可能回空数据 */
          body: { xnm: String(xnm || ''), xqm: String(xqm || ''), kzlx: 'ck', xsdm: '' },
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer: BASE + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default'
          }
        });
      } catch (e) {
        tried.push({ url: url, error: String(e.message || e) });
        continue;
      }
      /* ⚠️ 901 不是标准 HTTP 码，是本校服务端的特殊响应，实测含义明确：
         未登录时，凡是带 X-Requested-With 的 AJAX 请求一律回 901（不带则 302 踢登录页）。
         所以它**不代表路径错**，而是「这次请求的会话没被认」。直接判定会话失效。 */
      if (r.status === 901) {
        tried.push({ url: url, status: 901, note: '会话未被认可（901）' });
        return { ok: false, error: '会话已失效，请重新登录', expired: true, tried: tried };
      }
      let json = null;
      try { json = JSON.parse(r.body); } catch (e) { /* 不是 JSON */ }
      tried.push({
        url: url,
        status: r.status,
        length: r.body.length,
        json: !!json,
        kbCount: (json && json.kbList) ? json.kbList.length : undefined,
        head: json ? undefined : stripTags(r.body).slice(0, 100)
      });
      /* 判据放宽：只要回了 JSON 且带 kbList 就算接口对了 —— 哪怕这次 0 条，
         也说明是学期参数不对，而不是路径不对（这两件事排查方向完全不同）。 */
      if (json && json.kbList) {
        return { ok: true, url: url, raw: json, tried: tried };
      }
    }
    return { ok: false, error: '没找到能返回课表的接口', tried: tried };
  }
}

module.exports = { JwglClient, BASE, MENU_URL };
