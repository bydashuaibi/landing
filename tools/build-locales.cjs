'use strict';
const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..'),catalog={};
for(const row of fs.readFileSync(path.join(root,'locales-data.tsv'),'utf8').split(/\r?\n/)){
  if(!row||row.startsWith('#'))continue;
  const fields=row.split('|');if(fields.length!==3||fields.some(x=>!x.trim()))throw Error('Invalid locale row: '+row);
  const [source,en,ja]=fields.map(x=>x.replace(/\\n/g,'\n'));
  catalog[source]={'zh-CN':source.replace(/着陆/g,'学迹'),en,ja};
}
fs.writeFileSync(path.join(root,'locales.js'),'(function(root,data){if(typeof module==="object"&&module.exports)module.exports=data;else root.StudyTrailMessages=data;})(typeof globalThis!=="undefined"?globalThis:this,'+JSON.stringify(catalog,null,2)+');\n');
console.log('Built '+Object.keys(catalog).length+' trilingual messages.');
