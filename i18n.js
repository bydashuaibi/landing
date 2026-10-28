(function(){
  'use strict';
  let selected;
  try{selected=window.studyTrailLocale?studyTrailLocale.get():localStorage.getItem('studytrail.language');}catch(e){}
  selected=StudyTrailLocaleCore.normalize(selected||navigator.language);
  const api=StudyTrailLocaleCore.create(StudyTrailMessages,()=>selected);
  window.I18n=api;
  function rememberDrafts(){
    const values={};document.querySelectorAll('input[id],textarea[id],select[id]').forEach(el=>{
      if(el.type==='password'||/key|token|password|secret|captcha|^jw_/i.test(el.id)||el.closest('[data-language-picker]'))return;
      values[el.id]={value:el.value,checked:el.checked};
    });
    const state={values,tab:document.body.dataset.tab,scroll:scrollY};
    try{sessionStorage.setItem('studytrail.localeDraft',JSON.stringify(state));}catch(e){}
  }
  async function setLanguage(value){
    const next=api.normalize(value);if(next===selected)return;
    rememberDrafts();
    if(window.studyTrailLocale)await studyTrailLocale.set(next);
    else{localStorage.setItem('studytrail.language',next);location.reload();}
  }
  api.setLanguage=setLanguage;
  if(window.studyTrailLocale)studyTrailLocale.onChange(value=>{if(api.normalize(value)!==selected){rememberDrafts();selected=api.normalize(value);location.reload();}});
  window.addEventListener('storage',e=>{if(e.key==='studytrail.language'&&api.normalize(e.newValue)!==selected){rememberDrafts();location.reload();}});
  function staticCopy(root){
    // Initial document only: dynamic text is localized at its authored source, before user data is inserted.
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode())if(!node.parentElement.closest('script,style,textarea,[data-no-translate]'))node.data=api.t(node.data);
    root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el=>{for(const key of ['placeholder','title','aria-label'])if(el.hasAttribute(key))el.setAttribute(key,api.t(el.getAttribute(key)));});
  }
  staticCopy(document.documentElement);document.documentElement.lang=selected;document.title=api.t(document.title);
  const style=document.createElement('style');style.textContent='.language-picker{display:inline-flex;align-items:center;gap:7px;flex-wrap:nowrap;font-size:11px;color:inherit;max-width:100%}.language-picker select{font:inherit;max-width:150px;border:1px solid #91a77d;background:#eef4e2;color:#26492e;border-radius:18px;padding:6px 9px}.language-picker option{background:#eef4e2}#controls>.language-picker{margin-top:9px;font-size:10px}.sidebar-bottom>.language-picker{margin-bottom:14px;display:flex}html[lang=en] .sidebar .logo-text,html[lang=ja] .sidebar .logo-text{font-size:23px}html[lang=en] .ds-hero h1,html[lang=ja] .ds-hero h1{font-size:clamp(32px,3.8vw,65px);line-height:1.16}html[lang=en] .sage-desktop-link{white-space:normal}html[lang=en] .pp-grid,html[lang=ja] .pp-grid{word-break:normal}';document.head.appendChild(style);
  function mount(){
    const target=document.querySelector('.topbar .actions,.sidebar-bottom,#controls,header nav');if(!target)return;
    const label=document.createElement('label');label.className='language-picker';label.dataset.languagePicker='';
    const caption=document.createElement('span');caption.textContent=selected==='ja'?'言語':selected==='en'?'Language':'语言';
    const select=document.createElement('select');select.setAttribute('aria-label',caption.textContent);select.id='appLanguage';
    for(const [value,text]of [['zh-CN','简体中文'],['ja','日本語'],['en','English']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.appendChild(option);}select.value=selected;
    select.onchange=async()=>{select.disabled=true;try{await setLanguage(select.value);}catch(e){select.value=selected;select.disabled=false;const msg=api.t('语言切换失败，请重试。');if(window.Landing)Landing.toast(msg);else alert(msg);}};
    label.append(caption,select);target.appendChild(label);
    let draft;try{draft=JSON.parse(sessionStorage.getItem('studytrail.localeDraft')||'null');sessionStorage.removeItem('studytrail.localeDraft');}catch(e){}
    if(draft){if(draft.tab&&window.Landing)Landing.tab(draft.tab);Object.entries(draft.values||{}).forEach(([id,data])=>{const el=document.getElementById(id);if(el){el.value=data.value;if(el.type==='checkbox')el.checked=data.checked;}});scrollTo(0,draft.scroll||0);}
    document.dispatchEvent(new CustomEvent('studytrail:locale-ready'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0),{once:true});else mount();
})();
