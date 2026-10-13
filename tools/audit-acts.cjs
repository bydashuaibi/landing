/* 找出事件分派链里"调了已不存在的 App 方法"的分支 */
const fs = require('fs');
const P = 'C:/Users/31701/Desktop/landing/app.js';
const src = fs.readFileSync(P, 'utf8');
const lines = src.split(/\r?\n/);

// 已定义的 App 方法名
const defined = new Set();
const mDef = src.matchAll(/^\s{2}([A-Za-z_$][\w$]*):function/gm);
for (const m of mDef) defined.add(m[1]);

const missing = [];
lines.forEach((l, i) => {
  const m = l.match(/act==='([^']+)'\)\s*App\.([A-Za-z_$][\w$]*)/);
  if (m && !defined.has(m[2])) missing.push({ line: i + 1, act: m[1], fn: m[2], text: l.trim() });
});
console.log('App 方法总数:', defined.size);
console.log('\n=== 分派链里指向已删除方法的分支（' + missing.length + ' 条）===');
missing.forEach(x => console.log('  L' + x.line + '  ' + x.text));

// data-act 发射点里"没人接"的（发射了但分派链没有）
const chain = new Set();
for (const m of src.matchAll(/act==='([^']+)'/g)) chain.add(m[1]);
const emitted = new Map();
lines.forEach((l, i) => {
  for (const m of l.matchAll(/data-act="([^"]+)"/g)) {
    if (!chain.has(m[1]) && !emitted.has(m[1])) emitted.set(m[1], i + 1);
  }
});
console.log('\n=== 发射了但分派链里没有的 data-act（' + emitted.size + ' 条）===');
[...emitted].forEach(([k, v]) => console.log('  ' + k + '  (首次 L' + v + ')'));
