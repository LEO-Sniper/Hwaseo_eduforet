import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initDatabase,applySnapshot,addSubscription,removeSubscription,readMeta,deliveryResult} from './core.mjs';
import {generateKeys,authorization,decode64,validateSubscription,proofFor,sendPush} from './vapid.mjs';
function database(){
  const db=new DatabaseSync(':memory:');
  const sql={exec(q,...args){const stmt=db.prepare(q);return /^(SELECT|WITH)/.test(q)?stmt.all(...args):(stmt.run(...args),[]);}};
  const storage={sql,transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
  initDatabase(sql);return storage;
}
const trade={date:'2026-09-18',area:'59.98',group:59,price:80900,floor:'20',cancelled:false};
const newer={...trade,date:'2026-09-20',price:83000};
const snapshot=(trades,day=23)=>({status:'ready',updatedAt:`2026-09-${day}T08:00:00+09:00`,trades});
const endpoint='https://fcm.googleapis.com/fcm/send/example';
const jobs=storage=>[...storage.sql.exec('SELECT * FROM deliveries')];
test('baseline silent, one batch per update, repeat/restart and rolled-back snapshot silent',()=>{
  const s=database();addSubscription(s,endpoint,'secret');
  assert.equal(applySnapshot(s,snapshot([trade])).baseline,true);assert.equal(jobs(s).length,0);
  assert.equal(applySnapshot(s,snapshot([trade,newer],24)).newTrades,1);assert.equal(jobs(s).length,1);
  initDatabase(s.sql);
  assert.equal(applySnapshot(s,snapshot([trade,newer],24)).newTrades,0);
  assert.equal(applySnapshot(s,snapshot([trade],23)).newTrades,0);assert.equal(jobs(s).length,1);
});
test('cancellation, restored status, disappearance/reappearance, registration/N changes do not alert',()=>{
  const s=database();addSubscription(s,endpoint,'secret');applySnapshot(s,snapshot([trade]));
  assert.equal(applySnapshot(s,snapshot([{...trade,cancelled:true}],24)).newTrades,0);
  assert.equal(applySnapshot(s,snapshot([{...trade,registeredAt:'new',firstSeenAt:'new'}],25)).newTrades,0);
  applySnapshot(s,snapshot([],26));assert.equal(applySnapshot(s,snapshot([trade],27)).newTrades,0);
  assert.equal(jobs(s).length,0);
});
test('duplicate public fields count as extra sales; canceled additions do not',()=>{
  const s=database();applySnapshot(s,snapshot([trade]));
  assert.equal(applySnapshot(s,snapshot([trade,{...trade}],24)).newTrades,1);
  assert.equal(applySnapshot(s,snapshot([trade,{...trade},{...trade,cancelled:true}],25)).newTrades,0);
});
test('new canceled trade alone is silent; late-reported older active contract not missed',()=>{
  const s=database();applySnapshot(s,snapshot([trade]));
  assert.equal(applySnapshot(s,snapshot([trade,{...newer,cancelled:true}],24)).newTrades,0);
  assert.equal(applySnapshot(s,snapshot([trade,{...newer,date:'2026-08-01'}],25)).newTrades,1);
});
test('bad snapshot does not advance state or enqueue notifications',()=>{
  const s=database();applySnapshot(s,snapshot([trade]));
  assert.throws(()=>applySnapshot(s,{status:'error',updatedAt:'2026-09-24',trades:[]}));
  assert.throws(()=>applySnapshot(s,snapshot([{...newer,price:NaN}],24)));
  assert.equal(readMeta(s.sql,'updatedAt'),snapshot([]).updatedAt);assert.equal(jobs(s).length,0);
});
test('subscriptions persist, duplicate subscribe is idempotent, unsubscribe removes pending deliveries',()=>{
  const s=database();applySnapshot(s,snapshot([trade]));
  addSubscription(s,endpoint,'secret');addSubscription(s,endpoint,'secret');
  applySnapshot(s,snapshot([trade,newer],24));assert.equal(jobs(s).length,1);
  assert.throws(()=>removeSubscription(s,endpoint,'wrong'));assert.equal(jobs(s).length,1);
  assert.throws(()=>addSubscription(s,endpoint,'wrong'));
  removeSubscription(s,endpoint,'secret');assert.equal(jobs(s).length,0);
  assert.equal([...s.sql.exec('SELECT * FROM subscriptions')].length,0);
});
test('successful send dedupes; 503 retries; 410 deletes expired subscriptions',()=>{
  const s=database();addSubscription(s,endpoint,'secret');applySnapshot(s,snapshot([trade]));applySnapshot(s,snapshot([trade,newer],24),1000);
  deliveryResult(s.sql,jobs(s)[0],503,2000);assert.equal(jobs(s)[0].attempts,1);assert.equal(jobs(s)[0].due,62000);
  deliveryResult(s.sql,jobs(s)[0],201,3000);assert.equal(jobs(s).length,0);
  applySnapshot(s,snapshot([trade,newer,{...newer,price:90000}],25),4000);
  deliveryResult(s.sql,jobs(s)[0],410,5000);assert.equal(jobs(s).length,0);assert.equal([...s.sql.exec('SELECT * FROM subscriptions')].length,0);
});
test('VAPID token is a valid ES256 signature with correct audience and expiry',async()=>{
  const keys=await generateKeys();assert.equal(decode64(keys.publicKey).length,65);
  const token=await authorization(endpoint,keys,'https://leo-sniper.github.io/Hwaseo_eduforet/',1700000000000);
  const jwt=token.split('t=')[1].split(',')[0], [h,b,s]=jwt.split('.');
  const claims=JSON.parse(new TextDecoder().decode(decode64(b)));
  assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.exp,1700003600);
  const publicKey=await crypto.subtle.importKey('raw',decode64(keys.publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,decode64(s),new TextEncoder().encode(h+'.'+b)),true);
  const status=await sendPush(endpoint,keys,'https://leo-sniper.github.io/',async(url,opts)=>{
    assert.equal(url,endpoint);assert.equal(opts.redirect,'manual');assert.equal(opts.headers.TTL,'86400');assert.equal(opts.body,undefined);return new Response(null,{status:201});
  });assert.equal(status,201);
});
test('endpoint validation blocks SSRF, hostile suffixes, credentials, and ports',async()=>{
  const auth='abcdefghijklmnopqrstuv', body={endpoint,keys:{auth}};
  assert.equal(validateSubscription(body).endpoint,endpoint);
  for(const bad of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://u:p@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x','https://fcm.googleapis.com/x#bad'])
    assert.throws(()=>validateSubscription({...body,endpoint:bad}));
  assert.equal(await proofFor(auth),await proofFor(auth));
  assert.notEqual(await proofFor(auth),await proofFor('different'));
});
