'use strict';
(() => {
  const button=document.getElementById('push-toggle'), message=document.getElementById('push-message');
  const bell='<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>';
  const bellOff='<path d="m3 3 18 18M10.6 2.2A6 6 0 0 1 18 8c0 2.4.4 4 .9 5.2M6.2 6.2A6 6 0 0 0 6 8c0 7-3 7-3 9h14M10 21h4"/>';
  let registration, endpoint='', publicKey='', subscribed=false, busy=false, available=false;
  const supported='serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  function say(text) {message.textContent=text;message.hidden=!text;}
  function draw(active) {
    subscribed=active;
    button.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${active?bellOff:bell}</svg>`;
    button.setAttribute('aria-pressed',String(active));
    button.setAttribute('aria-label',active?'신규 실거래가 알림 해지':'신규 실거래가 알림 신청');
    button.title=active?'알림을 받고 있습니다 · 누르면 해지':'신규 실거래가 알림 신청';
    button.classList.toggle('subscribed',active);
  }
  async function api(path,subscription) {
    const response=await fetch(endpoint+path,{method:subscription?'POST':'GET',mode:'cors',cache:'no-store',signal:AbortSignal.timeout(20000),
      ...(subscription?{headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription.toJSON())}:{})});
    if(!response.ok)throw new Error('알림 서버에 연결하지 못했습니다. 잠시 후 다시 눌러 주세요.');
    return response.json();
  }
  function decodeKey(value) {return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
  async function initialize() {
    if(!supported || (ios&&!standalone))return;
    const response=await fetch('push-config.json',{cache:'no-store'});
    if(!response.ok)throw new Error('알림 설정을 불러오지 못했습니다.');
    const config=await response.json(), url=new URL(config.endpoint);
    if(url.protocol!=='https:')throw new Error('알림 서버 설정을 확인해 주세요.');
    endpoint=url.href.replace(/\/$/,'');
    registration=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});
    registration=await navigator.serviceWorker.ready;
    ({publicKey}=await api('/config'));
    if(!/^[A-Za-z0-9_-]{87}$/.test(publicKey))throw new Error('알림 서버 설정을 확인해 주세요.');
    const current=await registration.pushManager.getSubscription();
    if(current)draw((await api('/status',current)).subscribed);
    else draw(false);
    available=true;
  }
  draw(false);
  let startup=initialize().catch(()=>{available=false;});
  button.addEventListener('click',async()=>{
    if(busy)return;
    if(ios&&!standalone){say('아이폰은 Safari에서 공유 → 홈 화면에 추가한 뒤, 홈 화면의 앱을 열어 알림을 신청해 주세요. iOS 16.4 이상이 필요합니다.');return;}
    if(!supported){say('이 브라우저에서는 알림을 지원하지 않습니다. Android는 Chrome으로 열어 주세요.');return;}
    if(!available){
      say('알림 연결을 확인하고 있습니다. 잠시 후 버튼을 다시 눌러 주세요.');
      busy=true;button.disabled=true;
      try{await startup;if(!available)await initialize();say('알림 버튼을 다시 누르면 신청할 수 있습니다.');}
      catch{say('알림 서버에 연결하지 못했습니다. 잠시 후 다시 눌러 주세요.');}
      finally{busy=false;button.disabled=false;}return;
    }
    if(!subscribed && Notification.permission==='denied'){
      say('알림이 차단되어 있습니다. 브라우저 또는 휴대폰의 이 사이트 알림 설정을 허용한 뒤 다시 눌러 주세요.');return;
    }
    // Permission prompt must begin synchronously in this user gesture (especially iOS).
    const permission=!subscribed && Notification.permission!=='granted'?Notification.requestPermission():Promise.resolve(Notification.permission);
    busy=true;button.disabled=true;button.setAttribute('aria-busy','true');
    try{
      if(subscribed){
        const current=await registration.pushManager.getSubscription();
        if(current){await api('/unsubscribe',current);await current.unsubscribe().catch(()=>{});}
        draw(false);say('신규 실거래가 알림을 해지했습니다.');
      }else{
        if(await permission!=='granted'){say('알림이 허용되지 않았습니다. 원하실 때 다시 신청할 수 있습니다.');return;}
        let current=await registration.pushManager.getSubscription();
        if(current){
          const old=current.options.applicationServerKey;
          const expected=decodeKey(publicKey);
          if(old && (old.byteLength!==expected.length || new Uint8Array(old).some((v,i)=>v!==expected[i]))){await current.unsubscribe();current=null;}
        }
        let created=false;
        if(!current){current=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(publicKey)});created=true;}
        try{await api('/subscribe',current);}catch(error){if(created)await current.unsubscribe().catch(()=>{});throw error;}
        draw(true);say('알림을 신청했습니다. 새 실거래가가 등록되면 알려드릴게요.');
      }
    }catch(error){say(error.name==='NotAllowedError'?'휴대폰과 브라우저의 알림 허용 설정을 확인해 주세요.':error.message || '알림 설정을 변경하지 못했습니다. 다시 시도해 주세요.');}
    finally{busy=false;button.disabled=false;button.removeAttribute('aria-busy');}
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && available && !busy){
      registration.pushManager.getSubscription().then(async sub=>{
        const active=sub && Notification.permission==='granted'?(await api('/status',sub)).subscribed:false;
        if(!busy)draw(active);
      }).catch(()=>{});
    }
  });
})();
