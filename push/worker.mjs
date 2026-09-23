import {DurableObject} from 'cloudflare:workers';
import {initDatabase,readMeta,writeMeta,applySnapshot,addSubscription,removeSubscription,deliveryResult} from './core.mjs';
import {generateKeys,validateSubscription,proofFor,sendPush} from './vapid.mjs';

function logFailure(stage,error) {
  // Keep operational errors, but never log request bodies, subscription URLs or keys.
  const detail=String(error?.message||'Unknown error')
    .replace(/https?:\/\/[^\s"'<>]+/g,'[url]')
    .replace(/[A-Za-z0-9_+\/=-]{40,}/g,'[redacted]').slice(0,400);
  console.error(JSON.stringify({event:'push_error',stage,name:error?.name||'Error',detail}));
}


export class PushRegistry extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env); this.syncing=null;
    ctx.blockConcurrencyWhile(async()=>{
      initDatabase(ctx.storage.sql);
      const raw=readMeta(ctx.storage.sql,'vapid');
      this.keys=raw?JSON.parse(raw):await generateKeys();
      if (!raw) writeMeta(ctx.storage.sql,'vapid',JSON.stringify(this.keys));
    });
  }
  config() {return {publicKey:this.keys.publicKey};}
  async sync() {
    if (this.syncing) return this.syncing;
    this.syncing=this.refresh().catch(error=>{logFailure('snapshot_sync',error);throw error;}).finally(()=>{this.syncing=null;});
    return this.syncing;
  }
  async refresh() {
    const url=new URL('data/trades.json',this.env.SITE_URL);
    url.searchParams.set('push_check',String(Math.floor(Date.now()/300000)));
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Accept':'application/json','Cache-Control':'no-cache'}});
    if (!response.ok) throw new Error('Published snapshot HTTP '+response.status);
    const text=await response.text();
    if (text.length>2000000) throw new Error('Snapshot too large');
    // Arm the alarm BEFORE the atomic outbox write so a process crash cannot strand it.
    await this.ctx.storage.setAlarm(Date.now()+1000);
    const result=applySnapshot(this.ctx.storage,JSON.parse(text));
    console.log(JSON.stringify({event:'snapshot',...result}));
    return result;
  }
  async subscribe(body) {
    const {endpoint,auth}=validateSubscription(body), proof=await proofFor(auth);
    // Establish the baseline before accepting the first subscription.
    if (!readMeta(this.ctx.storage.sql,'updatedAt')) await this.sync();
    addSubscription(this.ctx.storage,endpoint,proof);
    return {subscribed:true};
  }
  async unsubscribe(body) {
    const {endpoint,auth}=validateSubscription(body);
    removeSubscription(this.ctx.storage,endpoint,await proofFor(auth));
    return {subscribed:false};
  }
  async status(body) {
    const {endpoint,auth}=validateSubscription(body), proof=await proofFor(auth);
    const record=[...this.ctx.storage.sql.exec('SELECT proof FROM subscriptions WHERE endpoint=?',endpoint)][0];
    return {subscribed:record?.proof===proof};
  }
  async alarm() {
    const sql=this.ctx.storage.sql;
    // Recovery alarm precedes network requests; successful sends remove only their own batch.
    await this.ctx.storage.setAlarm(Date.now()+60000);
    const rows=[...sql.exec('SELECT endpoint,batch,attempts,created FROM deliveries WHERE due<=? ORDER BY due LIMIT 15',Date.now())];
    await Promise.all(rows.map(async row=>{
      if (![...sql.exec('SELECT endpoint FROM subscriptions WHERE endpoint=?',row.endpoint)].length) {
        sql.exec('DELETE FROM deliveries WHERE endpoint=?',row.endpoint);return;
      }
      let status=0;
      try {status=await sendPush(row.endpoint,this.keys,this.env.SITE_URL);} catch(error) {logFailure('push_delivery',error);}
      deliveryResult(sql,row,status);
      console.log(JSON.stringify({event:'push',status}));
    }));
    const next=[...sql.exec('SELECT MIN(due) AS due FROM deliveries')][0]?.due;
    if (next!==null && next!==undefined) await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,next));
    else await this.ctx.storage.deleteAlarm();
  }
}
export default {
  async scheduled(_event,env,ctx) {
    ctx.waitUntil(env.PUSH.getByName('eduforet-push-v1').sync());
  },
  async fetch(request,env) {
    const origin=request.headers.get('Origin');
    const headers={'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN,'Vary':'Origin','Cache-Control':'no-store'};
    if (origin!==env.ALLOWED_ORIGIN) return new Response('Forbidden',{status:403});
    const path=new URL(request.url).pathname;
    if (!['/config','/subscribe','/unsubscribe','/status'].includes(path)) return new Response('Not found',{status:404,headers});
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'}});
    const registry=env.PUSH.getByName('eduforet-push-v1');
    try {
      if (path==='/config' && request.method==='GET') return Response.json(await registry.config(),{headers});
      if (request.method!=='POST' || path==='/config') return new Response('Method not allowed',{status:405,headers});
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return new Response('JSON required',{status:415,headers});
      if (Number(request.headers.get('Content-Length'))>6000) return new Response('Too large',{status:413,headers});
      const reader=request.body?.getReader();
      if (!reader) return new Response('Body required',{status:400,headers});
      let size=0,parts=[];
      while (true) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>6000){await reader.cancel();return new Response('Too large',{status:413,headers});}parts.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
      let body;try {body=JSON.parse(new TextDecoder().decode(bytes));validateSubscription(body);}catch{return new Response('Invalid subscription',{status:400,headers});}
      const result=path==='/subscribe'?await registry.subscribe(body):path==='/unsubscribe'?await registry.unsubscribe(body):await registry.status(body);
      return Response.json(result,{headers});
    } catch(error) {
      logFailure(path.slice(1),error);
      return Response.json({error:'알림 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',code:'PUSH_'+path.slice(1).toUpperCase()+'_FAILED'},{status:503,headers});
    }
  }
};
