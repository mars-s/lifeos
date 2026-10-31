// Protocol: Oura V2 OpenAPI webhook guide. Inactive until explicitly configured.
const encoder=new TextEncoder();
export const WEBHOOK_TYPES=['daily_sleep','daily_readiness','daily_activity','daily_spo2','daily_stress','sleep','sleep_time','rest_mode_period','workout','session','tag','enhanced_tag'];
const events=['create','update','delete'];
export const webhookReady=env=>env.OURA_WEBHOOK_ENABLED==='true'&&!!env.OURA_WEBHOOK_VERIFY_TOKEN&&!!env.OURA_WEBHOOK_OWNER_ID_HASH&&!!env.OURA_CLIENT_SECRET;
export async function inspectWebhook(request,env,{digest,now=Date.now()}){
 if(!webhookReady(env))return {status:503};
 if(request.method==='GET'){
  const p=new URL(request.url).searchParams;
  if(p.getAll('verification_token').length!==1||p.getAll('challenge').length!==1||!p.get('challenge')||p.get('challenge').length>256)return {status:400};
  if(await digest(p.get('verification_token'))!==await digest(env.OURA_WEBHOOK_VERIFY_TOKEN))return {status:401};
  return {status:200,challenge:p.get('challenge')};
 }
 if(request.method!=='POST')return {status:405};
 const stamp=request.headers.get('x-oura-timestamp')||'',signature=request.headers.get('x-oura-signature')||'';
 if(!/^\d{10}$/.test(stamp)||Math.abs(now-Number(stamp)*1000)>300000||! /^[a-fA-F0-9]{64}$/.test(signature))return {status:401};
 const reader=request.body?.getReader();let size=0;const chunks=[];
 if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return {status:413};}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return {status:400};}
 // Oura documents HMAC over timestamp + JSON.stringify(parsed body).
 const key=await crypto.subtle.importKey('raw',encoder.encode(env.OURA_CLIENT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const sig=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));
 if(!await crypto.subtle.verify('HMAC',key,sig,encoder.encode(stamp+JSON.stringify(body))))return {status:401};
 if(!body||typeof body!=='object'||Array.isArray(body)||!WEBHOOK_TYPES.includes(body.data_type)||!events.includes(body.event_type)||typeof body.object_id!=='string'||!body.object_id||body.object_id.length>256||typeof body.user_id!=='string'||body.user_id.length>256||typeof body.event_time!=='string'||!Number.isFinite(Date.parse(body.event_time))||Date.parse(body.event_time)>now+300000)return {status:400};
 if(await digest(body.user_id)!==env.OURA_WEBHOOK_OWNER_ID_HASH)return {status:403};
 const eventTime=new Date(body.event_time).toISOString();
 return {status:200,event:{id:await digest(JSON.stringify([body.user_id,body.data_type,body.event_type,body.object_id,eventTime])),data_type:body.data_type,event_type:body.event_type,event_time:eventTime,received_at:new Date(now).toISOString(),expires:now+86400000}};
}
// Only encrypted freshness metadata and irreversible dedup IDs persist, never object/user IDs or health payloads.
export async function recordWebhook(storage,event,{seal,open,env,now=Date.now()}){
 const box=await storage.get('webhook_metadata');const entries=box?(await open(box,env)).filter(e=>e.expires>now):[];
 if(entries.some(e=>e.id===event.id))return false;
 entries.push(event);await storage.put('webhook_metadata',await seal(entries.slice(-128),env));return true;
}
export async function webhookFreshness(storage,{open,env,now=Date.now()}){
 const box=await storage.get('webhook_metadata');const entries=box?(await open(box,env)).filter(e=>e.expires>now):[];
 const latest={};for(const e of entries)if(!latest[e.data_type]||e.event_time>latest[e.data_type].event_time)latest[e.data_type]={event_type:e.event_type,event_time:e.event_time,received_at:e.received_at};
 return {enabled:webhookReady(env),observed_updates:latest,retention_hours:24,meaning:'Notification times only; absence of an event does not prove data is current. No automatic health fetch or chat alert.'};
}
