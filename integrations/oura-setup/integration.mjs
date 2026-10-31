import {eventDefinition,EventError} from './events-bridge.mjs';
import {inspectWebhook,recordWebhook,webhookFreshness} from './webhooks.mjs';
export const ORIGIN='https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev';
export const CALLBACK=ORIGIN+'/oura/callback';
export const OURA_ISSUER='https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous';
// Oura API authentication docs specify this endpoint for new developer clients too.
export const OURA_TOKEN_ENDPOINT='https://api.ouraring.com/oauth/token';
export const OURA_SCOPES=['personal','daily','heartrate','workout','tag','session','spo2'];
// Exact aliases published in Oura's issuer scopes_supported; no general prefix stripping.
export function validatedScopes(value){
 if(value===undefined)return undefined;
 if(typeof value!=='string')throw Error('scope_format');
 const aliases=new Map(OURA_SCOPES.flatMap(scope=>[[scope,scope],['extapi:'+scope,scope]]));
 const scopes=value.split(/\s+/).filter(Boolean);
 if(scopes.some(scope=>!aliases.has(scope)))throw Error('scope_unknown');
 return [...new Set(scopes.map(scope=>aliases.get(scope)))];
}
const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const digest=async s=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))));
export const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
export const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{...headers,...extra}});
export const page=(content,status=200,extra={})=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LifeOS connection</title><body><main><h1>LifeOS personal connection</h1>${content}<p><a href="/oura">LifeOS</a> · <a href="/oura/privacy">Privacy</a></p></main></body></html>`,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8',...extra}});
export const ready=env=>env.OURA_ENABLED==='true'&&!!env.OURA_CLIENT_ID&&!!env.OURA_CLIENT_SECRET&&/^[A-Za-z0-9_-]{43}$/.test(env.TOKEN_ENCRYPTION_KEY||'')&&/^[A-Za-z0-9_-]{43}$/.test(env.OWNER_KEY_HASH||'')&&!!env.OURA_VAULT;
export async function forwardVault(request,env,trusted=false,connectionId=null,principal=null){const h=new Headers(request.headers);h.delete('x-lifeos-internal');h.delete('x-lifeos-connection');h.delete('x-lifeos-event-principal');if(trusted){h.set('x-lifeos-internal',env.TOKEN_ENCRYPTION_KEY);h.delete('origin');if(connectionId)h.set('x-lifeos-connection',connectionId);if(principal)h.set('x-lifeos-event-principal',JSON.stringify(principal));}return env.OURA_VAULT.get(env.OURA_VAULT.idFromName('owner')).fetch(new Request(request,{headers:h}));}
export async function authorized(request,env){const value=request.headers.get('authorization')||'';if(!value.startsWith('Bearer ')||value.length>520)return false;return (await digest(value.slice(7)))===env.OWNER_KEY_HASH;}
async function key(env){return crypto.subtle.importKey('raw',unb64(env.TOKEN_ENCRYPTION_KEY),'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(value,env){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(ORIGIN)},await key(env),enc.encode(JSON.stringify(value)));return {iv:b64(iv),data:b64(new Uint8Array(data))};}
export async function open(box,env){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(box.iv),additionalData:enc.encode(ORIGIN)},await key(env),unb64(box.data))));}
async function readLimited(stream,limit){if(!stream)return '';const reader=stream.getReader(),parts=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('size');}parts.push(value);}const all=new Uint8Array(size);let i=0;for(const p of parts){all.set(p,i);i+=p.length;}return new TextDecoder().decode(all);}
const cookieName='__Host-lifeos-oura';
const cookie=value=>`${cookieName}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${value?600:0}`;
const browserCookie=request=>(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
const collections=['daily_sleep','daily_activity','daily_readiness','daily_cardiovascular_age','daily_resilience','daily_spo2','daily_stress','enhanced_tag','heartrate','personal_info','rest_mode_period','session','sleep','sleep_time','tag','vO2_max','workout'];
const tools=collections.map(kind=>({name:'read_'+kind.toLowerCase(),description:`Read the owner's Oura ${kind} health records. Sensitive personal data; only return to the owner's authorized client. One bounded page, no storage. Heart rate is limited to one calendar day.`,inputSchema:kind==='personal_info'?{type:'object',properties:{},additionalProperties:false}:{type:'object',properties:{start_date:{type:'string',description:'YYYY-MM-DD'},end_date:{type:'string',description:'YYYY-MM-DD, at most 30 days after start; same day for heart rate'},next_token:{type:'string',maxLength:2048}},required:['start_date','end_date'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}}));
export function validDates(args){if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['start_date','end_date','next_token'].includes(k)))return false;for(const key of ['start_date','end_date']){if(!/^\d{4}-\d{2}-\d{2}$/.test(args[key]||''))return false;const d=new Date(args[key]+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==args[key])return false;}const days=(Date.parse(args.end_date)-Date.parse(args.start_date))/86400000;return days>=0&&days<=30&&(!('next_token'in args)||(typeof args.next_token==='string'&&args.next_token.length<=2048));}
// One owner and one object. Serial execution prevents concurrent single-use refreshes.
// No health responses are persisted. All credentials and PKCE transactions are encrypted.
export class OuraVault {
 constructor(state,env){this.storage=state.storage;this.env=env;this.queue=Promise.resolve();this.eventsBridge=null;}
 fetch(request){const run=this.queue.then(()=>this.handle(request));this.queue=run.catch(()=>{});return run.catch(()=>json({error:'Request failed safely; reconnect if needed.'},502));}
 async alarm(){const run=this.queue.then(async()=>{if(this.eventsBridge)await this.eventsBridge.drain();const box=await this.storage.get('pending');if(box&&(await open(box,this.env)).expires<=Date.now())await this.storage.delete('pending');const updates=await this.storage.get('webhook_metadata');if(updates){const live=(await open(updates,this.env)).filter(e=>e.expires>Date.now());if(live.length){await this.storage.put('webhook_metadata',await seal(live,this.env));const next=Math.min(...live.map(e=>e.expires)),current=await this.storage.getAlarm?.();if(!current||current>next)await this.storage.setAlarm(next);}else await this.storage.delete('webhook_metadata');}});this.queue=run.catch(()=>{});return run;}
 async request(url,init){return fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(10000)});}
 async token(form){
  form.set('client_id',this.env.OURA_CLIENT_ID);form.set('client_secret',this.env.OURA_CLIENT_SECRET);
  const r=await this.request(OURA_TOKEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
  if(!r.ok){
   // Retain only fixed diagnostic categories, never provider descriptions or raw bodies.
   let category='other';const type=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   if(type==='application/json'||type==='application/problem+json'){
    category='json';try{const failure=JSON.parse(await readLimited(r.body,32768));const allowed=['invalid_request','invalid_client','invalid_grant','unauthorized_client','access_denied','unsupported_response_type','invalid_scope','invalid_token','unsupported_grant_type','server_error','temporarily_unavailable'];if(allowed.includes(failure?.error))category=failure.error;}catch{category='invalid_json';}
   }else if(type==='text/html')category='html';
   const error=Error('token_http_'+r.status);error.tokenCategory=category;throw error;
  }const data=JSON.parse(await readLimited(r.body,32768));
  if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>8192||typeof data.refresh_token!=='string'||!data.refresh_token||data.refresh_token.length>8192||String(data.token_type).toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw Error('token_response');
  const scopes=validatedScopes(data.scope);
  return {access:data.access_token,refresh:data.refresh_token,scopes,expires:Date.now()+Math.min(data.expires_in,31536000)*1000};
 }
 async handle(request){
  const url=new URL(request.url),path=url.pathname;
  if(!ready(this.env))return json({error:'Integration is not configured.'},503);
  if(url.origin!==ORIGIN)return json({error:'Host denied.'},403);
  const requestOrigin=request.headers.get('origin');if(requestOrigin&&requestOrigin!==ORIGIN)return json({error:'Origin denied.'},403);
  if(path==='/oura/webhook'){const result=await inspectWebhook(request,this.env,{digest});if(result.event){if(this.eventsBridge)await this.eventsBridge.ingest(result.event);await recordWebhook(this.storage,result.event,{seal,open,env:this.env});const alarm=await this.storage.getAlarm?.();if(!alarm||alarm>Date.now()+86400000)await this.storage.setAlarm(Date.now()+86400000);}return json(result.challenge?{challenge:result.challenge}:{accepted:result.status===200},result.status);}
  if(path==='/oura/callback')return this.callback(request,url);
  if(path==='/oura/connect'&&request.method==='GET')return page('<p>Connect only your own account. This requests these health-read scopes: personal, daily, heartrate, workout, tag, session and spo2. Email and write permissions are excluded. Once connected, a client holding your owner key can request these records through this independent MCP wrapper. Review the privacy notice first.</p><form action="/oura/connect" method="post" enctype="multipart/form-data"><label>Owner access key <input type="password" name="key" autocomplete="off" maxlength="512"></label><p>Or select your private owner-key file: <input type="file" name="owner_file" accept=".txt"></p><p><label><input type="checkbox" name="consent" value="yes" required> I approve this personal data flow.</label></p><button>Continue to Oura consent</button></form>',200,{'Referrer-Policy':'same-origin','Content-Security-Policy':headers['Content-Security-Policy']});
  if(path==='/oura/connect'&&request.method==='POST'){
   if(requestOrigin!==ORIGIN||!['application/x-www-form-urlencoded','multipart/form-data'].some(t=>request.headers.get('content-type')?.startsWith(t)))return json({error:'Same-origin form required.'},403);
   const contentType=request.headers.get('content-type');const bytes=await readLimited(request.body,8192);const form=await new Request(request.url,{method:'POST',headers:{'Content-Type':contentType},body:bytes}).formData();const file=form.get('owner_file');const supplied=String(form.get('key')||'')||(file&&typeof file.text==='function'?(await file.text()).trim():'');if(form.get('consent')!=='yes'||await digest(supplied)!==this.env.OWNER_KEY_HASH)return json({error:'Owner authorization required.'},401);
   if(await this.storage.get('tokens'))return page('<p>Already connected. Disconnect before replacing this connection.</p>',409);
   const state=random(),browser=random(),verifier=random();await this.storage.put('pending',await seal({state, browser:await digest(browser),verifier,expires:Date.now()+600000},this.env));await this.storage.setAlarm(Date.now()+600000);
   const dest=new URL('https://developer.ouraring.com/authorize');dest.search=new URLSearchParams({response_type:'code',client_id:this.env.OURA_CLIENT_ID,redirect_uri:CALLBACK,scope:OURA_SCOPES.join(' '),state,code_challenge:await digest(verifier),code_challenge_method:'S256'}).toString();
   return page('<p>Your owner key was verified. Continue to Oura to review and approve access. This connection expires after ten minutes.</p><p><a rel="noreferrer" href="'+dest.href.replaceAll('&','&amp;').replaceAll('\"','&quot;')+'">Continue to Oura</a></p>',200,{'Set-Cookie':cookie(browser)});
  }
  if(request.headers.get('x-lifeos-internal')!==this.env.TOKEN_ENCRYPTION_KEY&&!await authorized(request,this.env))return json({error:'Owner bearer authorization required.'},401,{'WWW-Authenticate':'Bearer realm="LifeOS personal MCP"'});
  if(path==='/oura/disconnect'&&request.method==='POST'){await this.storage.deleteAll();return json({disconnected:true,provider_grant:'Also revoke the application in Oura account settings. Local deletion does not revoke the provider grant.'});}
  if(path==='/oura/status'&&request.method==='GET'){const box=await this.storage.get('tokens');return json({connected:!!box,connection_id:box?(await open(box,this.env)).connectionId:null});}
  if(path==='/mcp'){if(request.headers.get('x-lifeos-internal')===this.env.TOKEN_ENCRYPTION_KEY){const box=await this.storage.get('tokens');if(!box||request.headers.get('x-lifeos-connection')!==(await open(box,this.env)).connectionId)return json({error:'Connection changed. Reauthorize the client.'},401);}return this.mcp(request);}
  return json({error:'Not found.'},404);
 }
 async callback(request,url){
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  const fail=(reason)=>page('<p>Connection could not complete ('+reason+'). Start a fresh connection; do not reload this callback.</p>',400,{'Set-Cookie':cookie('')});
  if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length>1)return fail('invalid callback parameters');
  if(url.searchParams.getAll('iss').length>1||(url.searchParams.has('iss')&&url.searchParams.get('iss')!==OURA_ISSUER))return fail('unexpected authorization issuer');
  const box=await this.storage.get('pending');if(!box)return fail('transaction missing or already used');const pending=await open(box,this.env);
  if(pending.expires<Date.now()){await this.storage.delete('pending');return fail('transaction expired');}
  if(url.searchParams.get('state')!==pending.state)return fail('state mismatch');
  if(await digest(browserCookie(request))!==pending.browser)return fail('browser cookie missing or mismatched');
  // Consume before exchange, including denial, and never retry an uncertain code exchange.
  await this.storage.delete('pending');const updates=await this.storage.get('webhook_metadata');if(updates){const entries=await open(updates,this.env);if(entries.length)await this.storage.setAlarm(Math.min(...entries.map(e=>e.expires)));}else await this.storage.deleteAlarm();
  const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||code.length>4096)return fail('authorization denied or code missing');
  try{const result=await this.token(new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:CALLBACK,code_verifier:pending.verifier}));result.connectionId=random();await this.storage.put('tokens',await seal(result,this.env));return new Response(null,{status:303,headers:{...headers,Location:ORIGIN+'/oura/connected','Set-Cookie':cookie('')}});}catch(error){const reason=/^token_http_[0-9]{3}$/.test(error.message)?'token endpoint HTTP '+error.message.slice(11)+(error.tokenCategory?' / '+error.tokenCategory:''):error.message==='token_response'?'token response format invalid':error.message==='scope_format'?'unsupported scope response format':error.message==='scope_unknown'?'unrecognized or unrequested returned scopes':'token exchange or storage unavailable';return fail(reason);}
 }
 async read(kind,args){
  if(!collections.includes(kind))throw Error('endpoint');
  const now=Date.now();let budget=await this.storage.get('budget')||{start:now,count:0,cooldown:0};if(budget.cooldown>now)throw Error('rate');if(now-budget.start>=60000)budget={start:now,count:0,cooldown:budget.cooldown};if(budget.count>=30)throw Error('rate');budget.count++;await this.storage.put('budget',budget);
  const box=await this.storage.get('tokens');if(!box)throw Error('connect');let tokens=await open(box,this.env);
  if(tokens.expires<Date.now()+60000){
   // Remove the single-use refresh token before sending it. An ambiguous network
   // outcome requires reconnection, rather than risking re-use of an invalid token.
   const connectionId=tokens.connectionId;await this.storage.delete('tokens');tokens=await this.token(new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh}));tokens.connectionId=connectionId;await this.storage.put('tokens',await seal(tokens,this.env));
  }
  const url=new URL('https://api.ouraring.com/v2/usercollection/'+kind);const params={...args};if(kind==='heartrate'){params.start_datetime=args.start_date+'T00:00:00Z';params.end_datetime=args.end_date+'T23:59:59Z';delete params.start_date;delete params.end_date;}url.search=new URLSearchParams(params).toString();
  const r=await this.request(url.href,{headers:{Authorization:'Bearer '+tokens.access,Accept:'application/json'}});
  if(r.status===429){const raw=r.headers.get('Retry-After');const seconds=raw&&/^\d+$/.test(raw)?Number(raw):NaN;const until=Number.isFinite(seconds)?Date.now()+seconds*1000:Date.parse(raw||'');budget.cooldown=Math.max(Date.now()+60000,Number.isFinite(until)?until:0);await this.storage.put('budget',budget);throw Error('rate');}
  if(r.status===401){await this.storage.delete('tokens');throw Error('connect');}if(!r.ok)throw Error('upstream');
  const data=JSON.parse(await readLimited(r.body,524288));if(kind==='personal_info'){const health={};for(const k of ['age','weight','height','biological_sex'])if(data[k]!==undefined)health[k]=data[k];return {source:'Oura API',data:health};}if(!Array.isArray(data.data)||!(data.next_token==null||typeof data.next_token==='string'))throw Error('schema');
  return {source:'Oura API',data:data.data,next_token:data.next_token??null};
 }
 async mcp(request){
  if(request.method!=='POST')return json({error:'Only POST is supported; no event stream.'},405,{Allow:'POST'});
  const version=request.headers.get('MCP-Protocol-Version');if(version&&!['2025-03-26','2025-06-18','2026-07-28'].includes(version))return json({error:'Unsupported protocol version.'},400);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required.'},415);
  let msg;try{msg=JSON.parse(await readLimited(request.body,8192));}catch{return json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid or oversized JSON.'}},400);}
  if(!msg||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||('id'in msg&&!(typeof msg.id==='string'||typeof msg.id==='number'||msg.id===null)))return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request.'}},400);
  if(!('id'in msg))return msg.method==='notifications/initialized'||msg.method==='notifications/cancelled'?new Response(null,{status:202,headers}):json({error:'Unknown notification.'},400);
  const reply=result=>json({jsonrpc:'2.0',id:msg.id,result:version==='2026-07-28'?{resultType:'complete',...result}:result});const error=(code,message)=>json({jsonrpc:'2.0',id:msg.id,error:{code,message}});
  if(msg.method==='server/discover')return json({jsonrpc:'2.0',id:msg.id,result:{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{},...(this.eventsBridge?.active()?{events:{}}:{})}}});
  if(msg.method.startsWith('events/')){
   if(version!=='2026-07-28')return error(-32602,'MCP Events requires protocol 2026-07-28.');
   if(!this.eventsBridge?.active())return error(-32015,'Events are not activated.');
   if(request.headers.get('x-lifeos-internal')!==this.env.TOKEN_ENCRYPTION_KEY)return error(-32602,'Client OAuth required.');
   let principal;try{principal=JSON.parse(request.headers.get('x-lifeos-event-principal')||'null');this.eventsBridge.principal(principal);if(!await this.eventsBridge.isAuthorized(principal))return error(-32602,'Client access expired.');}catch{return error(-32602,'Verified client identity required.');}
   try{if(msg.method==='events/list')return reply({events:[eventDefinition]});if(msg.method==='events/subscribe')return reply(await this.eventsBridge.subscribe(principal,msg.params));if(msg.method==='events/unsubscribe')return reply(await this.eventsBridge.unsubscribe(principal,msg.params));return error(-32601,'Unknown event method.');}catch(e){return json({jsonrpc:'2.0',id:msg.id,error:{code:e instanceof EventError?e.code:-32015,message:'Event request failed safely.',data:{reason:e instanceof EventError?e.reason:'unavailable'}}});}
  }
  if(msg.method==='initialize')return reply({protocolVersion:['2025-03-26','2025-06-18'].includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'LifeOS personal health wrapper',version:'0.1.0'},instructions:'Independent personal integration, not Oura official MCP. Read only. Sensitive health records must remain within the owner-authorized client.'});
  if(msg.method==='tools/call'&&msg.params?.name==='read_update_status'){const args=msg.params.arguments;if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)return error(-32602,'No arguments accepted.');return reply({content:[{type:'text',text:JSON.stringify(await webhookFreshness(this.storage,{open,env:this.env}))}]});}
  if(msg.method==='ping')return reply({});if(msg.method==='tools/list')return reply({tools:[...tools,{name:'read_update_status',description:'Read authenticated webhook freshness metadata, not health records. Notifications do not guarantee freshness.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}]});
  if(msg.method!=='tools/call')return error(-32601,'Method not found.');
  const name=msg.params?.name,args=msg.params?.arguments;const index=tools.findIndex(t=>t.name===name),kind=collections[index];const valid=kind==='personal_info'?args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===0:validDates(args)&&(kind!=='heartrate'||args.start_date===args.end_date);if(index<0||!valid)return error(-32602,'Unknown tool or invalid date range. Maximum 30 days.');
  try{const result=await this.read(kind,args);return reply({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result});}
  catch{return reply({content:[{type:'text',text:'Read unavailable. Check connection, granted health scopes, and provider rate limits. Do not automatically retry.'}],isError:true});}
 }
}
