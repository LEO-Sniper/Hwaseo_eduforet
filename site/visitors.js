/* Counts are persisted by the shared service, never fabricated in localStorage. */
(() => {
  const total=document.getElementById('visitors-total'), daily=document.getElementById('visitors-today'), status=document.getElementById('visitor-status');
  if(!total||!daily||!status)return;
  let endpoint='', visitorId=null, busy=false;
  try {
    visitorId=localStorage.getItem('eduforet-visitor-id');
    if(!/^[a-f0-9-]{36}$/.test(visitorId||'')) {
      visitorId=crypto.randomUUID();localStorage.setItem('eduforet-visitor-id',visitorId);
    }
  }catch{visitorId=null;}
  async function refresh(){
    if(!endpoint||busy||document.hidden)return;
    busy=true;
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(endpoint+(visitorId?'/visit':'/count'),{
        method:visitorId?'POST':'GET',mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal,
        ...(visitorId?{headers:{'Content-Type':'application/json'},body:JSON.stringify({visitorId})}:{})
      });
      if(!response.ok)throw Error('counter response');
      const data=await response.json();
      if(!Number.isSafeInteger(data.total)||!Number.isSafeInteger(data.today)||data.total<0||data.today<0)throw Error('counter format');
      total.textContent=data.total.toLocaleString('ko-KR');daily.textContent=data.today.toLocaleString('ko-KR');
      status.textContent=visitorId?'':'이 브라우저는 조회만 가능';
    }catch{status.textContent='집계 확인 지연';}
    finally{clearTimeout(timer);busy=false;}
  }
  fetch('visitor-config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(config=>{
    if(!config.endpoint){status.textContent='집계 연결 대기';return;}
    const url=new URL(config.endpoint);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();
    endpoint=url.href.replace(/\/$/,'');refresh();
    setInterval(refresh,5*60*1000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
  }).catch(()=>{status.textContent='집계 연결 확인 필요';});
})();
