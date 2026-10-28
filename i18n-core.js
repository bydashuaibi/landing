/* One source-language catalogue, shared by renderers and Electron menus. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.StudyTrailLocaleCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function normalize(value){return /^ja/i.test(value)?'ja':/^en/i.test(value)?'en':'zh-CN';}
  function create(catalog,getLocale){
    const keys=Object.keys(catalog).filter(k=>k.length>1).sort((a,b)=>b.length-a.length);
    const escaped=keys.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    const pattern=new RegExp(escaped.join('|'),'g');
    function locale(){return normalize(typeof getLocale==='function'?getLocale():getLocale);}
    function t(source){
      if(typeof source!=='string')return source;
      const language=locale();
      if(catalog[source]&&catalog[source][language])return catalog[source][language];
      const trimmed=source.trim();
      if(catalog[trimmed]&&catalog[trimmed][language])return source.replace(trimmed,catalog[trimmed][language]);
      // Translate authored string literals only. User input never passes through this function.
      const translate=part=>catalog[part]&&catalog[part][language]||part;
      if(language==='zh-CN')return source.replace(/着陆/g,'学迹');
      return source.replace(pattern,translate);
    }
    function html(source){
      // Preserve option values, IDs, URLs and data attributes used by business logic.
      const protectedParts=[];
      const safe=source.replace(/\b(value|id|class|href|src|style|data-[\w-]+)=("[^"]*"|'[^']*')/g,value=>'\u0001'+(protectedParts.push(value)-1)+'\u0002');
      return safe.split(/(<[^>]*>|[<>])/g).map(t).join('').replace(/\u0001(\d+)\u0002/g,(_m,i)=>protectedParts[+i]);
    }
    function original(text){for(const key of keys){if(Object.values(catalog[key]).includes(text))return key;}return text;}
    function weekdays(mondayFirst){const days=Array.from({length:7},(_,i)=>new Intl.DateTimeFormat(locale(),{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,4+i))));return mondayFirst?days.slice(1).concat(days[0]):days;}
    function date(value,options){return new Intl.DateTimeFormat(locale(),options||{month:'short',day:'numeric',weekday:'short'}).format(value||new Date());}
    return {t,html,original,locale,normalize,weekdays,date,brand:()=>locale()==='ja'?'学びのあと':locale()==='en'?'StudyTrail':'学迹'};
  }
  return {create,normalize};
});
