import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const script=fs.readFileSync(new URL('../site/push.js',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../site/sw.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup({active=false,denied=false,fail=false,ios=false}={}){
  const events={},node={innerHTML:'',title:'',disabled:false,attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},addEventListener(k,v){events[k]=v;}};
  const message={hidden:true,textContent:''}, requests=[];
  let current=active?subscription():null, subscribed=active;
  function subscription(){return {endpoint:'https://fcm.googleapis.com/x',options:{},toJSON(){return {endpoint:this.endpoint,keys:{auth:'abcdefghijklmnopqrstuv'}};},async unsubscribe(){current=null;return true;}};}
  const registration={pushManager:{async getSubscription(){return current;},async subscribe(){current=subscription();return current;}}};
  const notifications={permission:denied?'denied':'default',async requestPermission(){this.permission='granted';requests.push('permission');return 'granted';}};
  const context={document:{getElementById:id=>id==='push-toggle'?node:message,addEventListener(){}},
    navigator:{userAgent:ios?'iPhone':'Android',platform:'Linux',serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)}},
    window:{PushManager(){},Notification:notifications,isSecureContext:true},Notification:notifications,
    matchMedia:()=>({matches:false}),URL,AbortSignal,Uint8Array,atob,
    fetch:async(input,options)=>{
      requests.push(input);
      if(input==='push-config.json')return Response.json({endpoint:'https://push.example.com'});
      if(input.endsWith('/config'))return Response.json({publicKey:'B'+'A'.repeat(86)});
      if(input.endsWith('/status'))return Response.json({subscribed});
      if(fail)return new Response(null,{status:503});
      if(input.endsWith('/subscribe'))subscribed=true;
      if(input.endsWith('/unsubscribe'))subscribed=false;
      return Response.json({subscribed});
    }};
  vm.runInNewContext(script,context);
  return {node,message,requests,click:()=>events.click()};
}
test('UI subscribe -> unsubscribe and restored persisted state',async()=>{
  const x=setup();await flush();await x.click();
  assert.equal(x.node.attrs['aria-pressed'],'true');assert.match(x.node.attrs['aria-label'],/해지/);
  assert.match(x.message.textContent,/신청했습니다/);
  await x.click();assert.equal(x.node.attrs['aria-pressed'],'false');assert.match(x.message.textContent,/해지했습니다/);
  const restored=setup({active:true});await flush();assert.equal(restored.node.attrs['aria-pressed'],'true');
});
test('denied permission, iPhone install guidance, server failure never imply success',async()=>{
  const denied=setup({denied:true});await flush();await denied.click();assert.match(denied.message.textContent,/차단/);assert.equal(denied.node.attrs['aria-pressed'],'false');
  const ios=setup({ios:true});await flush();await ios.click();assert.match(ios.message.textContent,/홈 화면/);assert.equal(ios.requests.length,0);
  const failed=setup({fail:true});await flush();await failed.click();assert.equal(failed.node.attrs['aria-pressed'],'false');assert.match(failed.message.textContent,/연결하지 못/);
});
test('service worker shows exact fixed message and clicks focus/navigate site',async()=>{
  const events={},shown=[],opened=[],scope='https://leo-sniper.github.io/Hwaseo_eduforet/';
  const self={registration:{scope,showNotification:async(...args)=>shown.push(args)},addEventListener:(k,v)=>events[k]=v,
    clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened.push(url)},skipWaiting:async()=>{}};
  vm.runInNewContext(sw,{self,URL});
  let work;events.push({waitUntil:p=>{work=p;}});await work;
  assert.equal(shown[0][0],'신규 실거래가가 등록되었습니다.');
  let closed=false;events.notificationclick({notification:{close(){closed=true;}},waitUntil:p=>{work=p;}});await work;
  assert.equal(closed,true);assert.deepEqual(opened,[scope]);
  let focused=false,navigated='';self.clients.matchAll=async()=>[{url:scope+'?old',navigate:async url=>{navigated=url;},focus:async()=>{focused=true;}}];
  events.notificationclick({notification:{close(){}},waitUntil:p=>{work=p;}});await work;assert.equal(focused,true);assert.equal(navigated,scope);assert.equal(opened.length,1);
});
