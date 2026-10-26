'use strict';
const assert=require('assert/strict'),http=require('http');
const {source,request}=require('../digest-network.cjs');
(async()=>{
 const seen=[];
 const server=http.createServer((req,res)=>{seen.push({url:req.url,headers:req.headers});if(req.url.includes('search=redirect')){res.writeHead(302,{location:'https://example.invalid'});res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.startsWith('/api/v4')?[]:{items:[]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal(source({provider:'enterprise',base:base+'/api/v3/'}).base,base+'/api/v3');
  assert.equal(source({provider:'gitlab',base:base+'/nested'}).base,base+'/nested/api/v4');
  assert.throws(()=>source({provider:'gitlab',base:'http://private.example'}),/HTTPS/);
  assert.throws(()=>source({provider:'enterprise',base:'https://user:secret@private.example'}),/密码/);
  assert.throws(()=>source({provider:'gitlab',base:'file:///etc'}),/HTTPS/);
  assert.equal(source({provider:'github',base:'https://evil.invalid'}).base,'https://api.github.com');
  let r=await request({provider:'enterprise',base},{q:'topic:python',per_page:500,unknown:'no'},'enterprise-secret');
  assert.equal(r.status,200);assert.match(seen[0].url,/\/api\/v3\/search\/repositories/);assert.match(seen[0].url,/per_page=12/);assert.ok(!seen[0].url.includes('secret'));assert.ok(!seen[0].url.includes('unknown'));assert.equal(seen[0].headers.authorization,'Bearer enterprise-secret');
  r=await request({provider:'gitlab',base},{search:'private word'},'gitlab-secret');
  assert.deepEqual(r.body,[]);assert.match(seen[1].url,/\/api\/v4\/projects/);assert.equal(seen[1].headers['private-token'],'gitlab-secret');assert.equal(seen[1].headers.authorization,undefined);
  r=await request({provider:'gitlab',base},{search:'redirect'},'secret');assert.equal(r.status,302);assert.equal(seen.length,3);
  const calls=[];r=await request({provider:'github'},{q:'topic:python'},'public-secret',async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({items:[]}),{status:200});});
  assert.equal(r.status,200);assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[0].options.credentials,'omit');assert.match(calls[0].url,/^https:\/\/api.github.com\//);
  console.log('PASS: source validation, API paths, token isolation, redirects, bounded queries and native transport.');
 } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
