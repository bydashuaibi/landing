function refresh(){focusNotice.get().then(data=>{if(!data)return;for(const key of ['title','body','reason'])document.getElementById(key).textContent=data[key];document.getElementById('ack').textContent=data.button;});}
refresh();focusNotice.onLanguage(refresh);
document.getElementById('ack').onclick=()=>focusNotice.ack();
