'use strict';
// No fetch handler/cache: live transaction data continues to load from GitHub Pages.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  event.waitUntil(self.registration.showNotification('신규 실거래가가 등록되었습니다.',{
    icon:new URL('push-icon-192.png',self.registration.scope).href,
    badge:new URL('push-badge.png',self.registration.scope).href,
    tag:'eduforet-new-trades',renotify:true,
    data:{url:self.registration.scope}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=self.registration.scope;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(client.url.startsWith(target)){
        await client.navigate(target);await client.focus();return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
// Some browsers rotate push endpoints. Renew without asking again when permission remains granted.
self.addEventListener('pushsubscriptionchange',event=>{
  event.waitUntil((async()=>{
    if(Notification.permission!=='granted')return;
    const configResponse=await fetch(new URL('push-config.json',self.registration.scope),{cache:'no-store'});
    if(!configResponse.ok)throw new Error('Push configuration unavailable');
    const {endpoint}=await configResponse.json(), base=endpoint.replace(/\/$/,'');
    if(new URL(base).protocol!=='https:')throw new Error('Invalid endpoint');
    const config=await fetch(base+'/config',{cache:'no-store'});
    if(!config.ok)throw new Error('Push configuration unavailable');
    const {publicKey}=await config.json();
    const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const replacement=event.newSubscription || await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    const saved=await fetch(base+'/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(replacement.toJSON())});
    if(!saved.ok)throw new Error('Push renewal failed');
    if(event.oldSubscription && event.oldSubscription.endpoint!==replacement.endpoint){
      await fetch(base+'/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event.oldSubscription.toJSON())});
    }
  })());
});
