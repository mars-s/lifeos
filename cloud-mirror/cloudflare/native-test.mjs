import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

await build({entryPoints:['mcp-entry.ts'],outfile:'.test-native.mjs',bundle:true,platform:'node',format:'esm',external:['cloudflare:workers']});
const dir=await mkdtemp(join(tmpdir(),'native-sync-fixture-'));
const origin='https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev',resource=origin+'/mcp';
const agent='SYNTHETIC-native-agent-at-least-32-characters',sync='SYNTHETIC-old-upload-at-least-32-characters';
const hash=s=>createHash('sha256').update(s).digest('hex');
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:await readFile('.test-native.mjs','utf8'),compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],kvNamespaces:['OAUTH_KV'],d1Databases:{DB:'native'},bindings:{LIFEOS_OWNER_ID:'fixture-owner',LIFEOS_ADAPTER_ID:'fixture-mac',LIFEOS_GITHUB_OWNER_ID:'42',GITHUB_CLIENT_ID:'SYNTHETIC-client',GITHUB_CLIENT_SECRET:'SYNTHETIC-secret',LIFEOS_AGENT_KEY_SHA256:hash(agent),LIFEOS_SYNC_KEY_SHA256:hash(sync),LIFEOS_WRITES_ENABLED:'true'},outboundService:async req=>new URL(req.url).hostname==='api.github.com'?Response.json({id:42}):Response.json({access_token:'SYNTHETIC-upstream',token_type:'bearer',scope:''})}),resourcePersistencePath:dir});
async function native(path,body,key=agent,extra={}) {return mf.dispatchFetch(origin+'/api/native/'+path,{method:body?'POST':'GET',headers:{'X-LifeOS-Agent-Key':key,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});}
const lists=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
const item=(id,title='Fixture title')=>({id,kind:'todo',fields:{title:{state:'value',value:title},status:{state:'value',value:'open'},in_trash_list:{state:'value',value:false}}});
async function snapshot(sequence,items){return native('snapshot',{sequence,items,manifest:{observed_at:new Date().toISOString(),zone:'Australia/Melbourne',scopes:['todo','project','area','tag'],coverage:'public-top-level-and-all-lists-v2',coverage_evidence:{consistent_passes:2,classified_records:items.length,list_ids:lists}}});}
async function connect(scope){
 const cookies=new Map();
 async function req(path,body,headers={}){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',redirect:'manual',headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},body});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],p=pair.indexOf('=');cookies.set(pair.slice(0,p),pair.slice(p+1));}return r;}
 const reg=await req('/oauth/register',JSON.stringify({client_name:'Synthetic native test',redirect_uris:['https://chatgpt.com/connector/oauth/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}),{'Content-Type':'application/json'});
 const client=(await reg.json()).client_id,verifier='SYNTHETIC-fixture-verifier-at-least-forty-three-characters';
 const page=await req('/authorize?'+new URLSearchParams({response_type:'code',client_id:client,redirect_uri:'https://chatgpt.com/connector/oauth/callback',scope,state:'fixture',resource,code_challenge: createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}));assert.equal(page.status,200);const html=await page.text();
 if(scope.includes('things:write'))assert.match(html,/Things wins/);
 const upstream=await req('/authorize',new URLSearchParams({handle:html.match(/name="handle" value="([^"]+)"/)[1],decision:'allow'}),{Origin:origin});assert.equal(upstream.status,302);
 const callback=await req('/callback?'+new URLSearchParams({code:'fixture-code',state:new URL(upstream.headers.get('location')).searchParams.get('state')}));
 const code=new URL(callback.headers.get('location')).searchParams.get('code');
 const token=await req('/oauth/token',new URLSearchParams({grant_type:'authorization_code',client_id:client,code,redirect_uri:'https://chatgpt.com/connector/oauth/callback',code_verifier:verifier,resource}));assert.equal(token.status,200);const access=await token.json();
 const sdk=new Client({name:'Native fixture',version:'1'});await sdk.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+access.access_token}},fetch:(url,init)=>mf.dispatchFetch(url,init)}));
 return {sdk,access,client,req};
}
try {
 const db=await mf.getD1Database('DB');
 for(const name of ['0000_equal_spyke.sql','0001_hard_katie_power.sql','0002_native_sync.sql'])await db.batch((await readFile('../site/drizzle/'+name,'utf8')).split('--> statement-breakpoint').map(s=>db.prepare(s.trim())));
 await test('native queue, authenticated grants and complete snapshot transport',async t=>{
  await t.test('old upload key cannot claim native operations; browsers and arbitrary routes denied',async()=>{
   assert.equal((await native('pending',undefined,sync)).status,401);
   assert.equal((await native('pending',undefined,agent,{Origin:origin})).status,403);
   assert.equal((await native('execute',{script:'anything'})).status,404);
   assert.equal((await snapshot(1,[item('task')])).status,200);
  });
  const read=await connect('things:read offline_access'),write=await connect('things:read things:write offline_access');
  try {
   await t.test('read grants remain read-only after activation and cannot expand on refresh',async()=>{
    const tools=(await read.sdk.listTools()).tools;
    assert.deepEqual(tools.map(t=>t.name),['read_things_mirror','queue_things_trash','queue_things_edit']);
    assert.deepEqual(tools.find(t=>t.name==='queue_things_edit')._meta.securitySchemes,[{type:'oauth2',scopes:['things:read','things:write']}]);
    assert.equal((await read.sdk.callTool({name:'queue_things_edit',arguments:{}})).isError,true);
    const refresh=await read.req('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:read.client,refresh_token:read.access.refresh_token,scope:'things:read things:write offline_access',resource}));
    if(refresh.status===200)assert.ok(!(await refresh.json()).scope.split(' ').includes('things:write'));
    else assert.equal(refresh.status,400);
    assert.deepEqual((await write.sdk.listTools()).tools.map(t=>t.name),['read_things_mirror','queue_things_trash','queue_things_edit']);
   });
   const edit=async(operation_id,value,field='title',base_revision=1)=>write.sdk.callTool({name:'queue_things_edit',arguments:{operation_id,target:'task',field,value,base_revision}});
   await t.test('durable retry, latest queued title, pending overlay and ID immutability',async()=>{
    assert.equal((await edit('one','New title')).isError,undefined);
    assert.equal((await edit('one','New title')).isError,undefined);
    assert.equal((await edit('one','Different content')).isError,true);
    await edit('two','Newest title');
    const page=JSON.parse((await write.sdk.callTool({name:'read_things_mirror',arguments:{}})).content[0].text);
    assert.equal(page.confirmed[0].fields.title.value,'Fixture title');
    assert.equal(page.effective[0].fields.title.value,'Newest title');assert.equal(page.effective[0].verification,'pending');
    assert.equal(page.pending_overlay.length,1);assert.equal(page.pending_overlay[0].fields.title,'Newest title');
    assert.equal(page.native_operations.find(o=>o.id==='one').state,'superseded');
    assert.equal((await edit('bad','open','status')).isError,true);
   });
   await t.test('single claim, immutable receipt, receipt retry and local priority',async()=>{
    assert.equal((await native('claim',{id:'two',claim:'claim-two'})).status,200);
    assert.equal((await native('claim',{id:'two',claim:'stolen'})).status,409);
    await edit('three','After executing title');
    assert.equal((await native('claim',{id:'three',claim:'claim-three'})).status,409);
    const receipt={id:'two',claim:'claim-two',result:{state:'skipped',reason:'things_changed'}};
    assert.equal((await native('ack',receipt)).status,200);assert.equal((await native('ack',receipt)).status,200);
    assert.equal((await native('ack',{...receipt,result:{state:'applied'}})).status,409);
    assert.equal((await native('claim',{id:'three',claim:'claim-three'})).status,200);
    assert.equal((await native('ack',{id:'three',claim:'claim-three',result:{state:'uncertain',reason:'interrupted_write'}})).status,200);
   });
   await t.test('source changes produce recorded skips; snapshots preserve queue and paging',async()=>{
    assert.equal((await snapshot(2,[item('task','Local edit'),...Array.from({length:104},(_,n)=>item('fixture-'+n))])).status,200);
    const stale=JSON.parse((await edit('stale','Old-base cloud edit')).content[0].text);assert.equal(stale.operation.state,'skipped');
    const completion=JSON.parse((await edit('complete','completed','status')).content[0].text);assert.equal(completion.operation.state,'queued');
    const page=JSON.parse((await write.sdk.callTool({name:'read_things_mirror',arguments:{}})).content[0].text);assert.equal(page.confirmed.length,100);assert.equal(page.next_cursor,100);assert.equal(page.pending_overlay.length,1);
    assert.equal((await native('ack',{id:'complete',claim:'invented',result:{state:'applied'}})).status,409);
    assert.equal((await native('claim',{id:'complete',claim:'verified-fixture'})).status,200);
    assert.equal((await native('ack',{id:'complete',claim:'verified-fixture',result:{state:'satisfied'}})).status,200);
    const retry=JSON.parse((await edit('complete','completed','status')).content[0].text);
    assert.equal(retry.applied,true);assert.equal(retry.operation.state,'satisfied');
   });
   await t.test('recoverable Trash queue requires write consent and has a verified retry receipt',async()=>{
    const args={operation_id:'trash-fixture',target:'task',base_revision:1};
    const denied=await read.sdk.callTool({name:'queue_things_trash',arguments:args});
    assert.equal(denied.isError,true);assert.match(denied._meta['mcp/www_authenticate'][0],/insufficient_scope/);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM native_operations WHERE id='trash-fixture'").first()).count,0);
    const queued=JSON.parse((await write.sdk.callTool({name:'queue_things_trash',arguments:args})).content[0].text);
    assert.equal(queued.operation.state,'queued');assert.equal(queued.operation.payload.value,true);
    const page=JSON.parse((await read.sdk.callTool({name:'read_things_mirror',arguments:{cursor:100}})).content[0].text);
    assert.equal(page.capabilities.connection_can_write,false);
    assert.equal(page.effective.find(i=>i.id==='task').fields.in_trash_list.value,true);
    assert.equal((await native('claim',{id:'trash-fixture',claim:'trash-claim'})).status,200);
    assert.equal((await native('ack',{id:'trash-fixture',claim:'trash-claim',result:{state:'applied'}})).status,200);
    const retry=JSON.parse((await write.sdk.callTool({name:'queue_things_trash',arguments:args})).content[0].text);
    assert.equal(retry.applied,true);assert.equal(retry.recoverable,true);
   });
  }finally{await read.sdk.close();await write.sdk.close();}
 });
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});await rm('.test-native.mjs',{force:true});}
