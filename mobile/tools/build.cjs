'use strict';
const fs=require('fs'),path=require('path'),{buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..'),repo=path.resolve(root,'..'),out=path.join(root,'www');
fs.mkdirSync(out,{recursive:true});
for(const name of ['locales.js','i18n-core.js','ledger-core.js','ledger-exchange.js','ledger.js','ledger.css','petdex-sprite.js'])fs.copyFileSync(path.join(repo,name),path.join(out,name));
for(const name of ['index.html','mobile.css'])fs.copyFileSync(path.join(root,'src',name),path.join(out,name));
const pet='assets/pet/petdex/uika';fs.mkdirSync(path.join(out,pet),{recursive:true});fs.copyFileSync(path.join(repo,pet,'spritesheet.webp'),path.join(out,pet,'spritesheet.webp'));
buildSync({entryPoints:[path.join(root,'src/main.js')],bundle:true,format:'iife',outfile:path.join(out,'mobile.js'),minify:false});
console.log('Built offline mobile web assets. No desktop IPC or floating pet included.');
