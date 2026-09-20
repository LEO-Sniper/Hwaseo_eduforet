import { DurableObject } from 'cloudflare:workers';
import { initDatabase,readCounts,recordVisit,koreaDay } from './core.mjs';
export class VisitorCounter extends DurableObject {
  constructor(ctx,env){super(ctx,env);initDatabase(ctx.storage.sql);}
  count(){return readCounts(this.ctx.storage.sql,koreaDay());}
  visit(visitor){return recordVisit(this.ctx.storage,visitor);}
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin'), allowed=env.ALLOWED_ORIGIN;
    if(origin!==allowed)return new Response('Forbidden',{status:403});
    const headers={'Access-Control-Allow-Origin':allowed,'Vary':'Origin','Cache-Control':'no-store'};
    const path=new URL(request.url).pathname;
    if(!['/visit','/count'].includes(path))return new Response('Not found',{status:404,headers});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'}});
    const counter=env.VISITORS.getByName('hwaseo-eduforet-v1');
    try{
      let result;
      if(request.method==='GET'&&path==='/count')result=await counter.count();
      else if(request.method==='POST'&&path==='/visit'){
        if(!request.headers.get('Content-Type')?.startsWith('application/json'))return new Response('JSON required',{status:415,headers});
        if(Number(request.headers.get('Content-Length'))>256)return new Response('Too large',{status:413,headers});
        const raw=await request.text();
        if(raw.length>256)return new Response('Too large',{status:413,headers});
        let body;try{body=JSON.parse(raw)}catch{return new Response('Invalid JSON',{status:400,headers})}
        if(!/^[a-f0-9-]{36}$/.test(body?.visitorId||''))return new Response('Invalid ID',{status:400,headers});
        const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.visitorId)));
        const hash=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
        result=await counter.visit(hash);
      }else return new Response('Method not allowed',{status:405,headers});
      return Response.json(result,{headers});
    }catch{return Response.json({error:'Counter temporarily unavailable'},{status:503,headers});}
  }
};
