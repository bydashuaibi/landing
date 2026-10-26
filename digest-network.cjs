'use strict';
const http = require('http');
const https = require('https');

function source(config) {
  const provider = config.provider || 'github';
  if (!['github', 'enterprise', 'gitlab'].includes(provider)) throw new Error('不支持的数据源');
  const base = provider === 'github' ? 'https://api.github.com' : String(config.base || '').trim().replace(/\/+$/, '');
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) throw new Error('服务地址不能包含账号、密码或查询参数');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('请使用 HTTPS 服务地址（本机服务可用 HTTP）');
  const suffix = provider === 'enterprise' ? '/api/v3' : provider === 'gitlab' ? '/api/v4' : '';
  let pathname = url.pathname.replace(/\/+$/, '');
  if (suffix && !pathname.endsWith(suffix)) pathname += suffix;
  url.pathname = pathname || '/';
  const normalized = url.href.replace(/\/+$/, '');
  return {provider, base: normalized, key: provider + ':' + normalized};
}

function request(config, params, token, transport) {
  const src = source(config);
  const url = new URL(src.base + (src.provider === 'gitlab' ? '/projects' : '/search/repositories'));
  const allowed = src.provider === 'gitlab' ? ['search','topic','order_by','sort','per_page','archived','simple'] : ['q','sort','order','per_page'];
  allowed.forEach(key => { if (params[key] != null) url.searchParams.set(key, String(params[key]).slice(0, 500)); });
  url.searchParams.set('per_page', '12');
  const headers = {'Accept': 'application/json', 'User-Agent': 'Landing-Digest'};
  if (token) headers[src.provider === 'gitlab' ? 'PRIVATE-TOKEN' : 'Authorization'] = src.provider === 'gitlab' ? token : 'Bearer ' + token;
  if (transport) return (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await transport(url.href, {headers, signal:controller.signal, redirect:'manual', credentials:'omit'});
      const reader = response.body && response.body.getReader();
      let bytes=0; const chunks=[];
      if (reader) while (true) {
        const {done,value}=await reader.read(); if(done) break;
        bytes+=value.length;
        if(bytes>3*1024*1024) { await reader.cancel(); throw new Error('响应内容过大'); }
        chunks.push(Buffer.from(value));
      }
      let body; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { body=null; }
      return {status:response.status,body,remaining:response.headers.get('x-ratelimit-remaining'),reset:response.headers.get('x-ratelimit-reset'),retryAfter:response.headers.get('retry-after')};
    } catch (_) { throw new Error('无法连接数据源，请检查地址、网络或证书'); }
    finally { clearTimeout(timer); }
  })();
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url, {headers}, res => {
      let bytes = 0; const chunks = [];
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 3 * 1024 * 1024) req.destroy(new Error('响应内容过大')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { body = null; }
        // Deliberately do not follow redirects with credentials.
        resolve({status: res.statusCode, body, remaining: res.headers['x-ratelimit-remaining'], reset: res.headers['x-ratelimit-reset'], retryAfter: res.headers['retry-after']});
      });
    });
    const deadline = setTimeout(() => req.destroy(new Error('连接超时，请稍后重试')), 15000);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', () => reject(new Error('无法连接数据源，请检查地址、网络或证书')));
  });
}
module.exports = {source, request};
