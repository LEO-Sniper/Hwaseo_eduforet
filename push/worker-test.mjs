import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
registerHooks({resolve(specifier,context,next){
  if(specifier==='cloudflare:workers')return {url:'data:text/javascript,'+encodeURIComponent('export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }'),shortCircuit:true};
  return next(specifier,context);
}});
const {default:worker,PushRegistry}=await import('./worker.mjs');

test('Worker routes, durable initialization, scheduled polling, delivery, and unsubscribe work together',async()=>{
  const db=new DatabaseSync(':memory:');let alarm=null,init;
  const sql={exec(q,...args){const stmt=db.prepare(q);return q.startsWith('SELECT')?stmt.all(...args):(stmt.run(...args),[]);}};
  const storage={sql,transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},async setAlarm(value){alarm=value;},async deleteAlarm(){alarm=null;}};
  const ctx={storage,blockConcurrencyWhile(fn){init=fn();}};
  const origin='https://leo-sniper.github.io',env={ALLOWED_ORIGIN:origin,SITE_URL:origin+'/Hwaseo_eduforet/'};
  const registry=new PushRegistry(ctx,env);await init;
  env.PUSH={getByName:()=>registry};
  const originalFetch=globalThis.fetch,sent=[];
  const t={date:'2026-09-20',area:'84.89',price:92000,group:84,floor:'10',cancelled:false};
  let snapshot={status:'ready',updatedAt:'2026-09-23T08:00:00+09:00',trades:[t]};
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith(env.SITE_URL))return Response.json(snapshot);
    sent.push({url,options});return new Response(null,{status:201});
  };
  const call=async(path,body,customOrigin=origin)=>worker.fetch(new Request('https://push.example.com'+path,{method:body?'POST':'GET',headers:{Origin:customOrigin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{auth:'abcdefghijklmnopqrstuv'}};
  try{
    assert.equal((await call('/config',null,'https://evil.test')).status,403);
    const key=(await (await call('/config')).json()).publicKey;
    assert.equal(key.length,87);assert.equal((await call('/send',{})).status,404);
    assert.equal((await call('/subscribe',sub)).status,200);
    assert.equal((await (await call('/status',sub)).json()).subscribed,true);
    await registry.alarm();assert.equal(sent.length,0);assert.equal(alarm,null);
    snapshot={...snapshot,updatedAt:'2026-09-23T13:00:00+09:00',trades:[t,{...t,price:94000}]};
    let scheduled;await worker.scheduled({},env,{waitUntil(p){scheduled=p;}});await scheduled;assert.notEqual(alarm,null);
    await registry.alarm();assert.equal(sent.length,1);assert.equal(sent[0].options.method,'POST');assert.match(sent[0].options.headers.Authorization,/^vapid t=/);
    await registry.sync();await registry.alarm();assert.equal(sent.length,1);
    // The VAPID identity is durable, not regenerated at every worker startup.
    const again=new PushRegistry(ctx,env);await init;assert.equal(again.config().publicKey,key);
    assert.equal((await call('/unsubscribe',sub)).status,200);
    assert.equal((await (await call('/status',sub)).json()).subscribed,false);
    snapshot={...snapshot,updatedAt:'2026-09-23T18:00:00+09:00',trades:[...snapshot.trades,{...t,price:96000}]};
    await registry.sync();await registry.alarm();assert.equal(sent.length,1);
  }finally{globalThis.fetch=originalFetch;}
});
