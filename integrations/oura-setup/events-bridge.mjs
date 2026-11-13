import {WEBHOOK_TYPES} from './webhooks.mjs';
const enc=new TextEncoder(),DAY=86400000;
const eventName='oura.data_changed';
export class EventError extends Error{constructor(reason,code=-32602){super(reason);this.reason=reason;this.code=code;}}
const fail=reason=>{throw new EventError(reason);};
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
function secretBytes(secret){try{if(typeof secret!=='string'||!secret.startsWith('whsec_'))fail('invalid_secret');const s=secret.slice(6);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(s))fail('invalid_secret');const bytes=Uint8Array.from(atob(s),c=>c.charCodeAt(0));if(bytes.length<24||bytes.length>64)fail('invalid_secret');return bytes;}catch{fail('invalid_secret');}}
export function callbackURL(value,allowed){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||!allowed.includes(value)||u.hostname==='localhost'||u.hostname.endsWith('.localhost')||u.hostname.endsWith('.local')||u.hostname.includes(':')||/^\d+(\.\d+){3}$/.test(u.hostname))fail('callback_denied');return u.href;}catch{fail('callback_denied');}}
export async function signedHeaders(secret,id,body,subscriptionId,now){
 const key=await crypto.subtle.importKey('raw',secretBytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const timestamp=String(Math.floor(now/1000));
 const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(id+'.'+timestamp+'.'+body)))));
 return {'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+signature,'X-MCP-Subscription-Id':subscriptionId};
}
export const eventDefinition={name:eventName,description:'Oura record change metadata only. No health values; use bounded read tools when requested.',delivery:['webhook'],inputSchema:{type:'object',properties:{data_type:{type:'string',enum:WEBHOOK_TYPES},event_type:{type:'string',enum:['create','update','delete']}},required:['data_type','event_type'],additionalProperties:false},payloadSchema:{type:'object',properties:{data_type:{type:'string'},event_type:{type:'string'},event_time:{type:'string'}},required:['data_type','event_type','event_time'],additionalProperties:false}};
// All calls must be serialized by the owner Durable Object. safeFetch must validate
// DNS/public destination at connection time and preserve TLS host, not just pre-resolve.
export class EventsBridge{
 constructor({storage,seal,open,digest,random,env,now=()=>Date.now(),safeFetch,isAuthorized,allowedCallbacks=[],enabled=false,activationUntil=0}){Object.assign(this,{storage,seal,open,digest,random,env,now,safeFetch,isAuthorized,allowedCallbacks,enabled,activationUntil});}
 active(){return this.enabled&&this.activationUntil>this.now()&&typeof this.safeFetch==='function'&&typeof this.isAuthorized==='function';}
 async load(){const box=await this.storage.get('mcp_events');return box?this.open(box,this.env):{subscriptions:[],queue:[],seen:[]};}
 async save(state){await this.storage.put('mcp_events',await this.seal(state,this.env));}
 principal(p){if(!object(p)||p.owner!=='lifeos-owner'||typeof p.clientId!=='string'||!p.clientId||typeof p.connectionId!=='string'||!p.connectionId||!Number.isFinite(p.expiresAt)||p.expiresAt<=this.now())fail('unauthorized');return [p.owner,p.clientId,p.connectionId];}
 async identity(p,params){const principal=this.principal(p);if(params?.name!==eventName||!object(params.arguments)||Object.keys(params.arguments).sort().join(',')!=='data_type,event_type'||!WEBHOOK_TYPES.includes(params.arguments.data_type)||!['create','update','delete'].includes(params.arguments.event_type)||params.delivery?.mode!=='webhook')fail('invalid_subscription');const url=callbackURL(params.delivery.url,this.allowedCallbacks);return {id:await this.digest(JSON.stringify([...principal,url,eventName,params.arguments.data_type,params.arguments.event_type])),url};}
 async post(sub,payload,id){const body=JSON.stringify(payload);if(enc.encode(body).length>262144)fail('payload_too_large');callbackURL(sub.url,this.allowedCallbacks);const headers=await signedHeaders(sub.secret,id,body,sub.id,this.now());if(sub.previousSecret&&sub.rotationUntil>this.now())headers['webhook-signature']+=' '+(await signedHeaders(sub.previousSecret,id,body,sub.id,this.now()))['webhook-signature'];return this.safeFetch(sub.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers,body});}
 async subscribe(p,params){
  if(!this.active())throw new EventError('events_disabled',-32015);const {id,url}=await this.identity(p,params);if(!await this.isAuthorized(p))fail('unauthorized');secretBytes(params.delivery.secret);
  if(params.cursor!=null)fail('replay_unsupported');if(params.ttlMs!==undefined&&params.ttlMs!==null&&(!Number.isFinite(params.ttlMs)||params.ttlMs<=0))fail('invalid_ttl');
  const expiry=Math.min(this.now()+Math.min(params.ttlMs??DAY,DAY),p.expiresAt,this.activationUntil);const state=await this.load(),old=state.subscriptions.find(s=>s.id===id&&s.expires>this.now());state.subscriptions=state.subscriptions.filter(s=>s.expires>this.now());
  if(!old&&state.subscriptions.length>=8)fail('subscription_limit');
  const sub={id,url,name:eventName,arguments:{data_type:params.arguments.data_type,event_type:params.arguments.event_type},principal:{...p},secret:params.delivery.secret,expires:expiry};
  if(old&&old.secret!==sub.secret){sub.previousSecret=old.secret;sub.rotationUntil=this.now()+300000;}
  if(!old||old.verifiedUntil<=this.now()||old.secret!==sub.secret){
   const challenge=this.random();let response;try{response=await this.post(sub,{type:'verification',challenge},'verify_'+this.random());}catch{throw new EventError('timeout',-32015);}
   if(!response.ok)throw new EventError('challenge_failed',-32015);let reply;try{const reader=response.body?.getReader();let text='',size=0;if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2048){await reader.cancel();throw Error();}text+=new TextDecoder().decode(part.value,{stream:true});}reply=JSON.parse(text);}catch{throw new EventError('challenge_failed',-32015);}
   if(typeof reply.challenge!=='string'||await this.digest(reply.challenge)!==await this.digest(challenge))throw new EventError('challenge_failed',-32015);sub.verifiedUntil=this.now()+300000;
  }else sub.verifiedUntil=old.verifiedUntil;
  state.subscriptions=state.subscriptions.filter(s=>s.id!==id);state.subscriptions.push(sub);await this.save(state);await this.schedule(state);
  return {id,refreshBefore:new Date(expiry).toISOString(),cursor:null,truncated:false};
 }
 async unsubscribe(p,params){const {id}=await this.identity(p,params);const state=await this.load();state.subscriptions=state.subscriptions.filter(s=>s.id!==id);state.queue=state.queue.filter(q=>q.subscriptionId!==id);await this.save(state);await this.schedule(state);return {};}
 async ingest(event){if(!this.active())return false;const state=await this.load();state.seen=state.seen.filter(e=>e.expires>this.now());if(state.seen.some(e=>e.id===event.id))return false;
  const matching=state.subscriptions.filter(s=>s.expires>this.now()&&s.arguments.data_type===event.data_type&&s.arguments.event_type===event.event_type);
  if(state.queue.length+matching.length>256)throw new EventError('queue_full',-32015);
  for(const s of matching)state.queue.push({subscriptionId:s.id,event:{eventId:'oura_'+event.id,name:eventName,timestamp:event.event_time,data:{data_type:event.data_type,event_type:event.event_type,event_time:event.event_time},cursor:null},attempts:0,next:this.now(),expires:Math.min(s.expires,this.now()+DAY)});
  state.seen.push({id:event.id,expires:this.now()+DAY});state.seen=state.seen.slice(-512);await this.save(state);await this.schedule(state);return true;
 }
 async drain(){const state=await this.load();if(!this.active()){state.subscriptions=[];state.queue=[];state.seen=[];await this.save(state);return;}
  const valid=[];for(const s of state.subscriptions){if(s.rotationUntil<=this.now()){delete s.previousSecret;delete s.rotationUntil;}if(s.expires>this.now()&&await this.isAuthorized(s.principal))valid.push(s);}state.subscriptions=valid;state.seen=state.seen.filter(e=>e.expires>this.now());
  state.queue=state.queue.filter(q=>q.expires>this.now()&&q.attempts<6&&valid.some(s=>s.id===q.subscriptionId));await this.save(state);
  let count=0;for(const q of [...state.queue]){if(q.next>this.now()||count++>=8)continue;const sub=state.subscriptions.find(s=>s.id===q.subscriptionId);if(!sub)continue;
   // Persist attempt before I/O; crash permits at-least-once delivery with same event ID.
   q.attempts++;q.next=this.now()+Math.min(3600000,1000*2**q.attempts);await this.save(state);let status=0;try{status=(await this.post(sub,q.event,q.event.eventId)).status;}catch{}
   if(status===410){state.subscriptions=state.subscriptions.filter(s=>s.id!==sub.id);state.queue=state.queue.filter(x=>x.subscriptionId!==sub.id);}
   else if(status>=200&&status<300||status===413||status>=400&&status<500&&status!==429||q.attempts>=6)state.queue=state.queue.filter(x=>x!==q);
   await this.save(state);
  }await this.schedule(state);
 }
 async schedule(state){const times=[...state.queue.map(q=>q.next),...state.subscriptions.map(s=>s.expires),...state.seen.map(s=>s.expires)];if(!times.length)return;const next=Math.max(this.now()+1,Math.min(...times));const old=await this.storage.getAlarm?.();if(!old||old>next)await this.storage.setAlarm(next);}
}
