'use strict';
// Author-time migration: localize static literals before interpolating user content.
const fs=require('fs'),path=require('path'),vm=require('vm'),root=path.resolve(__dirname,'..');
const m={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{exports:m.exports,module:m});
const acorn=m.exports,core=require('../i18n-core.js'),catalog=require('../locales.js'),english=core.create(catalog,'en'),japanese=core.create(catalog,'ja');
const files=process.argv.slice(2).length?process.argv.slice(2):['app.js','ask.js','discipline.js','study-buddy.js','learning-checkpoint.js','pet.js','digest.js','market.js','pet-adventure.js','sage-studio.js','ui-polish.js','desktop-pet-ui.js','desktop-pet-settings.js','pet-skins-window.js','desktop-pet-bridge.js','main.js','desktop-pet.cjs'];
let total=0;
for(const file of files){let source=fs.readFileSync(path.join(root,file),'utf8'),changes=[];
  function walk(node,parent,key){if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='I18n')return;
    // These labels are persisted category identifiers. Translate at the display boundary.
    if(file==='digest.js'&&node.type==='Property'&&node.key.name==='label')return;
    if(node.type==='Literal'&&typeof node.value==='string'&&/[\u3400-\u9fff]/.test(node.value)){
      if(parent&&((parent.type==='Property'&&key==='key'&&!parent.computed)||(parent.type==='ExpressionStatement'&&parent.directive)))return;
      const method=/<\/?[a-z]|[a-z-]+="/i.test(node.value)?'html':'t';
      if(english[method](node.value)!==node.value||japanese[method](node.value)!==node.value||node.value.includes('着陆'))changes.push({start:node.start,end:node.end,text:'I18n.'+method+'('+source.slice(node.start,node.end)+')'});
    }
    for(const [field,value]of Object.entries(node)){if(field==='raw'||field==='regex')continue;if(Array.isArray(value))value.forEach(x=>walk(x,node,field));else if(value&&typeof value==='object')walk(value,node,field);}
  }
  walk(acorn.parse(source,{ecmaVersion:'latest'}));for(const c of changes.sort((a,b)=>b.start-a.start))source=source.slice(0,c.start)+c.text+source.slice(c.end);
  fs.writeFileSync(path.join(root,file),source);total+=changes.length;
}
console.log('Localized '+total+' authored source strings.');
