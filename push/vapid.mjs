// RFC 8292. The notification has fixed text, so RFC 8030 pushes need no payload.
const encoder=new TextEncoder();
export function encode64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
export function decode64(value) {
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
export async function generateKeys() {
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  return {publicKey:encode64(await crypto.subtle.exportKey('raw',pair.publicKey)),
    privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey)};
}
export async function authorization(endpoint,keys,subject,now=Date.now()) {
  const head=encode64(encoder.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const body=encode64(encoder.encode(JSON.stringify({aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+3600,sub:subject})));
  const input=head+'.'+body;
  const key=await crypto.subtle.importKey('jwk',keys.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(input));
  return `vapid t=${input}.${encode64(sig)}, k=${keys.publicKey}`;
}
export function validateSubscription(body) {
  const endpoint=body?.endpoint, auth=body?.keys?.auth;
  if (typeof endpoint!=='string' || endpoint.length>4096 || !/^[A-Za-z0-9_-]{22}$/.test(auth||'')) throw new Error('Invalid subscription');
  const u=new URL(endpoint);
  const host=u.hostname;
  const allowed=host==='fcm.googleapis.com' || host==='updates.push.services.mozilla.com' ||
    host.endsWith('.push.services.mozilla.com') || host==='web.push.apple.com' ||
    host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  if (!allowed || u.protocol!=='https:' || u.port || u.username || u.password || u.hash) throw new Error('Invalid push endpoint');
  return {endpoint:u.href,auth};
}
export async function proofFor(auth) {
  return encode64(await crypto.subtle.digest('SHA-256',encoder.encode(auth)));
}
export async function sendPush(endpoint,keys,subject,request=fetch) {
  const response=await request(endpoint,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),
    headers:{Authorization:await authorization(endpoint,keys,subject),TTL:'86400',Urgency:'normal',Topic:'eduforet-new-trades'}});
  await response.body?.cancel();
  return response.status;
}
