import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
await build({entryPoints:['mcp-entry.ts'],outfile:'.test-mcp.mjs',bundle:true,platform:'node',format:'esm',loader:{'.html':'text'},external:['cloudflare:workers']});
const origin='https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev',resource=origin+'/mcp';
const dir=await mkdtemp(join(tmpdir(),'lifeos-mcp-fixture-'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const allLocalNames=JSON.parse(await readFile('local-tool-contracts.json','utf8')).map(tool=>tool.name);
// Note tools are listed only for grants with the notes scopes.
const isNoteTool=name=>/^notes_|^promote_notes_/.test(name);
const localNames=allLocalNames.filter(name=>!isNoteTool(name)),noteNames=allLocalNames.filter(isNoteTool);
let userId=42,upstreamScope='',upstreamCalls=0;
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:await readFile('.test-mcp.mjs','utf8'),compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],kvNamespaces:['OAUTH_KV'],d1Databases:{DB:'fixture'},bindings:{LIFEOS_OWNER_ID:'fixture-owner',LIFEOS_ADAPTER_ID:'fixture-mac',LIFEOS_GITHUB_OWNER_ID:'42',GITHUB_CLIENT_ID:'SYNTHETIC-client',GITHUB_CLIENT_SECRET:'SYNTHETIC-secret',LIFEOS_SYNC_KEY_SHA256:hash('SYNTHETIC-sync-fixture-only-at-least-32-characters'),LIFEOS_READ_KEY_SHA256:hash('SYNTHETIC-read-fixture-only-at-least-32-characters')},outboundService:async req=>{
  upstreamCalls++;const url=new URL(req.url);
  if(url.href==='https://github.com/login/oauth/access_token') {const body=await req.formData();assert.equal(body.get('client_id'),'SYNTHETIC-client');assert.ok(body.get('code_verifier'));return Response.json({access_token:'SYNTHETIC-upstream',token_type:'bearer',scope:upstreamScope});}
  if(url.href==='https://api.github.com/user')return Response.json({id:userId});
  throw new Error('Unexpected outbound fixture request');
}}),resourcePersistencePath:dir});
const cookies=new Map();
async function request(path,{method='GET',body,headers={},cookie=true}={}) {
  const r=await mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(cookie?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...headers},body});
  for(const c of r.headers.getSetCookie()){const [pair]=c.split(';'),p=pair.indexOf('=');cookies.set(pair.slice(0,p),pair.slice(p+1));}
  return r;
}
let clientId;const verifier='SYNTHETIC-pkce-verifier-long-enough-at-least-forty-three';
const pkce=createHash('sha256').update(verifier).digest('base64url');
async function consent(extra={}) {
  const args=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:'https://chatgpt.com/connector/oauth/callback',scope:'things:read offline_access',state:'fixture-client-state',code_challenge:pkce,code_challenge_method:'S256',resource,...extra});
  const r=await request('/authorize?'+args);return {r,html:await r.text()};
}
const handle=html=>html.match(/name="handle" value="([^"]+)"/)[1];
async function start() {
  const {r,html}=await consent();assert.equal(r.status,200);
  const next=await request('/authorize',{method:'POST',body:new URLSearchParams({handle:handle(html),decision:'allow'}),headers:{Origin:origin}});assert.equal(next.status,200);
  assert.equal(next.headers.get('location'),null);
  assert.match(next.headers.get('content-security-policy'),/form-action 'none'/);
  const continuation=await next.text();assert.match(continuation,/Continue to GitHub/);
  const target=new URL(continuation.match(/href="([^"]+)"/)[1].replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))));assert.equal(target.origin,'https://github.com');assert.equal(target.searchParams.get('scope'),'');assert.equal(target.searchParams.get('code_challenge_method'),'S256');
  return '/callback?'+new URLSearchParams({code:'SYNTHETIC-code',state:target.searchParams.get('state')});
}
try {
 const db=await mf.getD1Database('DB');
 for(const file of ['0000_equal_spyke.sql','0001_hard_katie_power.sql'])await db.batch((await readFile('../site/drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>db.prepare(s.trim())));
 await db.batch(Array.from({length:205},(_,n)=>db.prepare('INSERT INTO mirror_items VALUES(?,?,?,?,?,?)').bind('fixture-owner','fixture-'+n,'todo',JSON.stringify({title:{state:'value',value:'Synthetic task',revision:1},recurrence:{state:'unsupported'}}),0,'2026-10-01T00:00:00Z')));
 await db.prepare('INSERT INTO mirror_items VALUES(?,?,?,?,?,?)').bind('different-owner','private-other-owner','todo','{}',0,'2026-10-01T00:00:00Z').run();
 await test('read-only MCP OAuth on workerd/D1/KV with synthetic GitHub',async t=>{
  await t.test('discovery, static key denial and scope/redirect validation',async()=>{
   const denied=await request('/mcp',{headers:{Authorization:'Bearer SYNTHETIC-sync-fixture-only-at-least-32-characters','oai-authenticated-user-id':'fixture-owner'}});assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/oauth-protected-resource/);
   const metadata=await request('/.well-known/oauth-protected-resource/mcp');assert.equal(metadata.status,200);assert.equal((await metadata.json()).resource,resource);
   const registered=await request('/oauth/register',{method:'POST',body:JSON.stringify({client_name:'<img src=x onerror=alert(1)>',redirect_uris:['https://chatgpt.com/connector/oauth/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}),headers:{'Content-Type':'application/json'}});assert.equal(registered.status,201);clientId=(await registered.json()).client_id;
   assert.equal((await consent({redirect_uri:'https://attacker.invalid/callback'})).r.status,400);
   assert.equal((await consent({scope:'things:write'})).r.status,400);
   assert.equal((await consent({code_challenge_method:'plain'})).r.status,400);
  });
  await t.test('escaped consent, CSRF/session binding, deny, replay',async()=>{
   const {r,html}=await consent();assert.equal(r.status,200);assert.ok(html.includes('&#60;img'));assert.ok(!html.includes('<img'));
   const policy=r.headers.get('content-security-policy');
   assert.match(policy,/frame-ancestors 'none'/);
   const destinations=policy.split(';').find(d=>d.trim().startsWith('form-action')).trim().split(/\s+/).slice(1);
   // Both successful sign-in and Deny must survive Chromium's redirect checks.
   assert.deepEqual(destinations,["'self'",'https://github.com','https://chatgpt.com']);
   assert.match(policy,/default-src 'none'/);assert.match(policy,/base-uri 'none'/);
   const form=new URLSearchParams({handle:handle(html),decision:'allow'});
   const noConsentCookie=await request('/authorize',{method:'POST',body:form,headers:{Origin:origin},cookie:false});assert.equal(noConsentCookie.status,400);
   assert.deepEqual(await noConsentCookie.json(),{error:'Sign-in could not be completed. Restart the connection.',stage:'consent_session',reason:'browser_session_missing'});
   assert.equal((await request('/authorize',{method:'POST',body:form,headers:{Origin:'https://attacker.invalid'}})).status,403);
   const denial=await request('/authorize',{method:'POST',body:new URLSearchParams({handle:handle(html),decision:'deny'}),headers:{Origin:origin}});assert.equal(denial.status,302);assert.match(denial.headers.get('location'),/access_denied/);
   assert.equal((await request('/authorize',{method:'POST',body:form,headers:{Origin:origin}})).status,400);
   assert.equal(upstreamCalls,0);
   const callback=await start(),noCallbackCookie=await request(callback,{cookie:false});assert.equal(noCallbackCookie.status,400);
   assert.deepEqual(await noCallbackCookie.json(),{error:'Sign-in could not be completed. Restart the connection.',stage:'callback_session',reason:'browser_session_missing'});
  });
  await t.test('wrong GitHub owner and overbroad upstream grants denied',async()=>{
   userId=43;let r=await request(await start());assert.match(r.headers.get('location'),/access_denied/);
   userId=42;upstreamScope='repo';r=await request(await start());assert.match(r.headers.get('location'),/access_denied/);upstreamScope='';
  });
  await t.test('PKCE exchange, owner-scoped SDK reads, paging, no write tools, refresh',async()=>{
   const callback=await start(),r=await request(callback);assert.equal(r.status,302);const redirect=new URL(r.headers.get('location'));assert.equal(redirect.origin,'https://chatgpt.com');const code=redirect.searchParams.get('code');assert.ok(code);
   assert.equal((await request(callback)).status,400);
   const token=await request('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:'https://chatgpt.com/connector/oauth/callback',code_verifier:verifier,resource})});assert.equal(token.status,200);const access=await token.json();assert.ok(access.access_token);assert.ok(access.refresh_token);
   const sdk=new Client({name:'Fixture dot',version:'1.0.0'}),transport=new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+access.access_token}},fetch:(url,init)=>mf.dispatchFetch(url,init)});
   await sdk.connect(transport);
   assert.match(sdk.getInstructions(),/use create_requested_task directly/);
   assert.match(sdk.getInstructions(),/do not prepare a proposal or ask for a second LifeOS approval/);
   assert.match(sdk.getInstructions(),/Never bypass platform permissions/);
   const tools=await sdk.listTools();assert.deepEqual(tools.tools.map(t=>t.name),['render_day_plan','render_week_plan','render_brain_dump_canvas',...localNames,'get_lifeos_capabilities','read_things_mirror']);
   assert.equal(noteNames.length,10);assert.ok(tools.tools.every(t=>!isNoteTool(t.name)));assert.equal(tools.tools.find(tool=>tool.name==='read_things_mirror').annotations.readOnlyHint,true);
   const capabilities=(await sdk.callTool({name:'get_lifeos_capabilities',arguments:{}})).structuredContent;
   assert.equal(capabilities.local_tools_available,false);
   assert.equal(capabilities.connection_can_write,false);
   assert.equal(capabilities.raw_capture_storage,'Mac only');
   assert.equal(capabilities.connection_can_use_local_tools,false);
   assert.ok(localNames.includes('apply_approved_proposal'));
   const direct=tools.tools.find(tool=>tool.name==='create_requested_task');
   assert.ok(direct);assert.equal(direct.annotations.readOnlyHint,false);
   assert.equal(direct.annotations.destructiveHint,false);assert.equal(direct.annotations.idempotentHint,true);
   assert.equal(direct._meta?.ui?.resourceUri,undefined);
   assert.ok(localNames.includes('read_requested_task'));
   for(const name of ['update_requested_task','trash_requested_task']){
     const tool=tools.tools.find(tool=>tool.name===name);
     assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,false);
     assert.equal(tool.annotations.idempotentHint,true);
     assert.equal(tool._meta?.ui?.resourceUri,undefined);
   }
   assert.equal(tools.tools.find(tool=>tool.name==='trash_requested_task').annotations.destructiveHint,true);
   // App-only: listed for the card host, hidden from the model by visibility.
   const modelVisible=tools.tools.filter(t=>(t._meta?.ui?.visibility??['model']).includes('model')).map(t=>t.name);
   for(const name of ['approve_proposal','reject_proposal']){
     assert.ok(!modelVisible.includes(name));
     const tool=tools.tools.find(t=>t.name===name);assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool._meta['openai/visibility'],'private');
   }
   assert.ok(modelVisible.includes('render_proposal_review'));assert.ok(modelVisible.includes('apply_approved_proposal'));
   const blocked=await sdk.callTool({name:'get_brain_dump',arguments:{capture_id:'synthetic'}});assert.equal(blocked.isError,true);assert.match(blocked._meta['mcp/www_authenticate'][0],/lifeos:local/);
   const resources=await sdk.listResources();assert.equal(resources.resources.length,6);
   assert.ok(resources.resources.some(r=>r.uri==='ui://lifeos/cloud-proposal-review-v2.html'));assert.ok(resources.resources.some(r=>r.uri==='ui://lifeos/cloud-proposal-review-v1.html'));
   for(const tool of tools.tools.filter(t=>['render_day_plan','render_week_plan','render_brain_dump_canvas'].includes(t.name))){
     const uri=tool._meta.ui.resourceUri;assert.equal(tool._meta['openai/outputTemplate'],uri);
     const resource=(await sdk.readResource({uri})).contents[0];
     assert.equal(resource.mimeType,'text/html;profile=mcp-app');assert.match(resource.text,/window\.openai/);
     assert.deepEqual(resource._meta.ui.csp.connectDomains,[]);
   }
   const plan={day_start:'2026-10-02T09:00:00+10:00',day_end:'2026-10-02T17:00:00+10:00',blocks:[{task_id:'synthetic-task',title:'Synthetic preview',start:'2026-10-02T10:00:00+10:00',end:'2026-10-02T11:00:00+10:00',duration_minutes:60,calendar_id:'synthetic-calendar'}]};
   const preview=await sdk.callTool({name:'render_day_plan',arguments:{plan}});assert.equal(preview.isError,undefined);
   const directDay=await sdk.callTool({name:'render_day_plan',arguments:plan});assert.equal(directDay.isError,undefined);
   const exactDay=await sdk.callTool({name:'render_day_plan',arguments:{preview:plan,blocks:plan.blocks,unscheduled:[],things_changes:[],calendar_changes:[],proposal_ready:true,mutates_external_systems:false}});assert.equal(exactDay.isError,undefined);assert.deepEqual(exactDay.structuredContent.blocks,preview.structuredContent.blocks);
   assert.equal(preview.structuredContent.can_prepare_proposal,false);assert.equal(preview.structuredContent.proposal_ready,false);
   assert.equal(preview.structuredContent.mutates_external_systems,false);
   assert.equal((await sdk.callTool({name:'render_day_plan',arguments:{plan:{...plan,blocks:[{...plan.blocks[0],duration_minutes:45}]}}})).isError,true);
   assert.equal((await sdk.callTool({name:'render_day_plan',arguments:{plan:{...plan,day_start:'2026-10-02T09:00:00'}}})).isError,true);
   assert.equal((await sdk.callTool({name:'render_day_plan',arguments:{plan:{...plan,mutates_external_systems:true}}})).isError,true);
   const canvas={title:'Synthetic meeting',nodes:[{id:'tasks',kind:'tasks',title:'My tasks'}]};
   const debrief=await sdk.callTool({name:'render_brain_dump_canvas',arguments:{canvas}});assert.equal(debrief.isError,undefined);assert.equal(debrief.structuredContent.can_prepare_proposal,false);
   assert.equal((await sdk.callTool({name:'render_brain_dump_canvas',arguments:{canvas:{...canvas,nodes:[...canvas.nodes,...canvas.nodes]}}})).isError,true);
   assert.equal((await sdk.callTool({name:'render_brain_dump_canvas',arguments:{canvas:{...canvas,nodes:[{id:'bad',kind:'tasks',title:'Invalid',javascript:'alert(1)'}]}}})).isError,true);
   const week={range_start:plan.day_start,range_end:plan.day_end,days:[plan]};
   const weekly=await sdk.callTool({name:'render_week_plan',arguments:{plan:week}});assert.equal(weekly.isError,undefined);assert.equal(weekly.structuredContent.can_prepare_proposal,false);
   const exactWeek=await sdk.callTool({name:'render_week_plan',arguments:{preview:week,things_changes:[],calendar_changes:[],proposal_ready:true,mutates_external_systems:false}});assert.equal(exactWeek.isError,undefined);assert.deepEqual(exactWeek.structuredContent.days,weekly.structuredContent.days);
   assert.equal((await sdk.callTool({name:'render_week_plan',arguments:{plan:{...week,days:[plan,plan]}}})).isError,true);
   assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM mirror_items').first('n'),206);
   let cursor=0,ids=[];do {const page=await sdk.callTool({name:'read_things_mirror',arguments:{cursor}});assert.equal(page.isError,undefined);const state=JSON.parse(page.content[0].text);ids.push(...state.confirmed.map(i=>i.id));assert.equal(state.total_items,205);cursor=state.next_cursor;}while(cursor!==null);assert.equal(ids.length,205);assert.ok(!ids.includes('private-other-owner'));
   assert.equal((await sdk.callTool({name:'approve',arguments:{}})).isError,true);
   await sdk.close();
   assert.equal((await request('/mcp',{headers:{Authorization:'Bearer '+access.access_token,Origin:'https://attacker.invalid'}})).status,403);
   const refresh=await request('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:clientId,refresh_token:access.refresh_token,resource})});assert.equal(refresh.status,200);assert.ok((await refresh.json()).access_token);
   assert.equal((await request('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:clientId,refresh_token:access.refresh_token,resource:'https://attacker.invalid/mcp'})})).status,400);
   assert.equal((await request('/oauth/register',{method:'POST',body:' '.repeat(65537),headers:{'Content-Type':'application/json'}})).status,413);
   assert.equal((await request('/oauth/token',{method:'POST',body:new URLSearchParams({client_id:clientId,token:access.access_token,token_type_hint:'access_token'})})).status,200);
   assert.equal((await request('/mcp',{headers:{Authorization:'Bearer '+access.access_token}})).status,401);
   // The provider revokes a grant when a used authorization code is replayed.
   const replay=await request('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:'https://chatgpt.com/connector/oauth/callback',code_verifier:verifier,resource})});assert.equal(replay.status,400);
  });
  await t.test('wrong PKCE verifier cannot exchange a code',async()=>{
   const r=await request(await start()),code=new URL(r.headers.get('location')).searchParams.get('code');
   const token=await request('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:'https://chatgpt.com/connector/oauth/callback',code_verifier:'SYNTHETIC-wrong-verifier-at-least-forty-three-characters',resource})});assert.equal(token.status,400);assert.equal((await token.json()).error,'invalid_grant');
  });
  await t.test('unconfigured OAuth remains closed and legacy health is independent',async()=>{
   const closed=new Miniflare({...convertV4MiniflareOptions({modules:true,script:await readFile('.test-mcp.mjs','utf8'),compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'closed'},bindings:{LIFEOS_OWNER_ID:'fixture-owner',LIFEOS_ADAPTER_ID:'fixture-mac'}})});
   try {assert.equal((await closed.dispatchFetch(resource)).status,503);assert.equal((await closed.dispatchFetch(origin+'/health')).status,200);assert.equal((await closed.dispatchFetch(origin+'/state')).status,401);}finally{await closed.dispose();}
  });
 });
}finally {await mf.dispose();await rm(dir,{recursive:true,force:true});await rm('.test-mcp.mjs',{force:true});}
