/* 着陆 · 树洞后端（零依赖 Node）
 * 提供匿名社区：GET /feed 读，POST /feed 发，GET /ping 探活。
 * 启动：node community-backend/server.js  （可选 PORT 环境变量）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'community.json');
function read(){ try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { posts: [] }; } }
function write(d){ fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); }

const srv = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.url === '/ping') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ ok: true })); }

  if (req.url === '/feed' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(read()));
  }

  if (req.url === '/feed' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const p = JSON.parse(body || '{}');
        const d = read();
        d.posts = d.posts || [];
        d.posts.unshift({
          body: String(p.body || '').slice(0, 500),
          nick: String(p.nick || '').slice(0, 20),
          date: new Date().toISOString().slice(0, 10)
        });
        if (d.posts.length > 500) d.posts.length = 500;
        write(d);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400); res.end('bad request'); }
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

const PORT = process.env.PORT || 8787;
srv.listen(PORT, () => console.log('着陆 树洞后端已启动 → http://localhost:' + PORT));
