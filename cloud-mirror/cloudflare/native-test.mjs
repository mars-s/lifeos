import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

await build({entryPoints:['mcp-entry.ts'],outfile:'.test-native.mjs',bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire('/');"},loader:{'.html':'text','.css':'text'},external:['cloudflare:workers']});
const dir=await mkdtemp(join(tmpdir(),'native-sync-fixture-'));
const origin='https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev',resource=origin+'/mcp';
const agent='SYNTHETIC-native-agent-at-least-32-characters',sync='SYNTHETIC-old-upload-at-least-32-characters';
const hash=s=>createHash('sha256').update(s).digest('hex');
const allLocalNames=JSON.parse(await readFile('local-tool-contracts.json','utf8')).map(tool=>tool.name);
// Note tools are listed only for grants with the notes scopes.
const isNoteTool=name=>/^notes_|^promote_notes_/.test(name);
const thingsTools=['queue_things_create','queue_things_update','queue_things_move','queue_things_status','queue_things_restore','queue_things_batch','read_things_operations'];
const localNames=allLocalNames.filter(name=>!isNoteTool(name)),noteNames=allLocalNames.filter(isNoteTool);
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:await readFile('.test-native.mjs','utf8'),compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],durableObjects:{OWNER_SYNC:{className:'OwnerSync',useSQLite:true},OAUTH_TX:{className:'OAuthTransactions',useSQLite:true}},kvNamespaces:['OAUTH_KV'],d1Databases:{DB:'native'},bindings:{LIFEOS_OWNER_ID:'fixture-owner',LIFEOS_ADAPTER_ID:'fixture-mac',LIFEOS_GITHUB_OWNER_ID:'42',GITHUB_CLIENT_ID:'SYNTHETIC-client',GITHUB_CLIENT_SECRET:'SYNTHETIC-secret',LIFEOS_AGENT_KEY_SHA256:hash(agent),LIFEOS_SYNC_KEY_SHA256:hash(sync),LIFEOS_WRITES_ENABLED:'true'},outboundService:async req=>new URL(req.url).hostname==='api.github.com'?Response.json({id:42}):Response.json({access_token:'SYNTHETIC-upstream',token_type:'bearer',scope:''})}),resourcePersistencePath:dir});
async function native(path,body,key=agent,extra={}) {return mf.dispatchFetch(origin+'/api/native/'+path,{method:body?'POST':'GET',headers:{'X-LifeOS-Agent-Key':key,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});}
const lists=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
const item=(id,title='Fixture title')=>({id,kind:'todo',fields:{title:{state:'value',value:title},status:{state:'value',value:'open'},in_trash_list:{state:'value',value:false}}});
async function snapshot(sequence,items){return native('snapshot',{sequence,items,manifest:{observed_at:new Date().toISOString(),zone:'Australia/Melbourne',scopes:['todo','project','area','tag'],coverage:'public-top-level-and-all-lists-v2',coverage_evidence:{consistent_passes:2,classified_records:items.length,list_ids:lists}}});}
// Every table of every SQLite file Miniflare persisted (D1, KV and Durable Object storage),
// plus all raw bytes, so a test can prove a call stored nothing anywhere.
async function storage(){
 const tables={},bytes=[];
 for(const entry of await readdir(dir,{recursive:true,withFileTypes:true})){
  if(!entry.isFile())continue;const path=join(entry.parentPath,entry.name),data=await readFile(path);bytes.push(data);
  if(!data.subarray(0,15).equals(Buffer.from('SQLite format 3')))continue;
  const db=new DatabaseSync(path,{readOnly:true});
  // Durable Object metadata holds alarm times in nanoseconds, beyond a safe JavaScript number.
  try{for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()){const rows=db.prepare(`SELECT * FROM "${name}"`);rows.setReadBigInts(true);tables[path+':'+name]=rows.all();}}finally{db.close();}
 }
 return {tables:JSON.stringify(tables,(_,v)=>typeof v==='bigint'?v.toString():v),text:Buffer.concat(bytes).toString('latin1')};
}
async function connect(scope,includeWrites=false,includeLocal=false,extra={}){
 const cookies=new Map();
 async function req(path,body,headers={}){const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',redirect:'manual',headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},body});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],p=pair.indexOf('=');cookies.set(pair.slice(0,p),pair.slice(p+1));}return r;}
 const reg=await req('/oauth/register',JSON.stringify({client_name:'Synthetic native test',redirect_uris:['https://chatgpt.com/connector/oauth/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}),{'Content-Type':'application/json'});
 const client=(await reg.json()).client_id,verifier='SYNTHETIC-fixture-verifier-at-least-forty-three-characters';
 const page=await req('/authorize?'+new URLSearchParams({response_type:'code',client_id:client,redirect_uri:'https://chatgpt.com/connector/oauth/callback',scope,state:'fixture',resource,code_challenge: createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}));assert.equal(page.status,200);const html=await page.text();
 if(scope.includes('things:write'))assert.match(html,/Things wins/);
 if(includeWrites)assert.match(html,/name="queued_writes"/);
 // Match the browser's hidden input when a write scope is already requested.
 const upstream=await req('/authorize',new URLSearchParams({handle:html.match(/name="handle" value="([^"]+)"/)[1],decision:'allow',...(includeWrites||scope.split(' ').includes('things:write')?{queued_writes:'allow'}:{}),...(includeLocal?{local_tools:'allow'}:{}),...extra}),{Origin:origin});assert.equal(upstream.status,200);
 const continuation=await upstream.text(),github=new URL(continuation.match(/href="([^"]+)"/)[1].replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))));assert.equal(github.origin,'https://github.com');
 const callback=await req('/callback?'+new URLSearchParams({code:'fixture-code',state:github.searchParams.get('state')}));
 const code=new URL(callback.headers.get('location')).searchParams.get('code');
 const token=await req('/oauth/token',new URLSearchParams({grant_type:'authorization_code',client_id:client,code,redirect_uri:'https://chatgpt.com/connector/oauth/callback',code_verifier:verifier,resource}));assert.equal(token.status,200);const access=await token.json();
 const sdk=new Client({name:'Native fixture',version:'1'});await sdk.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+access.access_token}},fetch:(url,init)=>mf.dispatchFetch(url,init)}));
 return {sdk,access,client,req};
}
try {
 const db=await mf.getD1Database('DB');
 for(const name of ['0000_equal_spyke.sql','0001_hard_katie_power.sql','0002_native_sync.sql','0003_event_sync.sql','0004_smart_sync.sql','0005_things_ops.sql'])await db.batch((await readFile('../site/drizzle/'+name,'utf8')).split('--> statement-breakpoint').map(s=>db.prepare(s.trim())));
 await test('native queue, authenticated grants and complete snapshot transport',async t=>{
  await t.test('old upload key cannot claim native operations; browsers and arbitrary routes denied',async()=>{
   assert.equal((await native('pending',undefined,sync)).status,401);
   assert.equal((await native('pending',undefined,agent,{Origin:origin})).status,403);
   assert.equal((await native('execute',{script:'anything'})).status,404);
   assert.equal((await snapshot(1,[item('task')])).status,200);
  });
  const read=await connect('things:read offline_access'),write=await connect('things:read things:write offline_access');
  try {
   await t.test('local tools require new consent and use transient native delivery only',async()=>{
    const local=await connect('things:read offline_access',false,true);
    assert.ok(local.access.scope.split(' ').includes('lifeos:local'));
    assert.ok(!local.access.scope.split(' ').includes('things:write'));
    assert.ok(!read.access.scope.split(' ').includes('lifeos:local'));
    try {
     const offline=await local.sdk.callTool({name:'get_brain_dump',arguments:{capture_id:'fixture-local'}});
     assert.equal(offline.isError,true);assert.match(offline.content[0].text,/Nothing was queued/);
     const response=await native('events',undefined,agent,{Upgrade:'websocket','X-LifeOS-Protocol':'3'});
     assert.equal(response.status,101);const socket=response.webSocket;
     const messages=[],waiters=[];
     socket.addEventListener('message',event=>{
      const value=JSON.parse(event.data);
      if(value.type==='local_tool_request'){const waiter=waiters.shift();if(waiter)waiter(value);else messages.push(value);}
      else if(Number.isInteger(value.revision))socket.send(JSON.stringify({version:3,ack:value.revision}));
     });
     socket.accept();socket.send(JSON.stringify({version:3,type:'local_tools',enabled:true}));
     let ready=false;for(let n=0;n<30;n++){ready=(await local.sdk.callTool({name:'get_lifeos_capabilities',arguments:{}})).structuredContent.local_tools_connected;if(ready)break;await new Promise(resolve=>setTimeout(resolve,10));}
     assert.equal(ready,true);
     const take=()=>messages.length?Promise.resolve(messages.shift()):new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Synthetic native request not delivered')),5000);
      waiters.push(value=>{clearTimeout(timer);resolve(value);});
     });
     const blocked=await read.sdk.callTool({name:'get_brain_dump',arguments:{capture_id:'fixture-local'}});assert.equal(blocked.isError,true);assert.equal(messages.length,0);
     const noWrite=await local.sdk.callTool({name:'apply_approved_proposal',arguments:{proposal_id:'fixture',revision_hash:'exact'}});assert.equal(noWrite.isError,true);assert.equal(messages.length,0);
     const noCreate=await local.sdk.callTool({name:'create_requested_task',arguments:{request_id:'synthetic-task',title:'Synthetic task'}});assert.equal(noCreate.isError,true);assert.equal(messages.length,0);
     for(const name of ['update_requested_task','trash_requested_task']){
      const args={request_id:'blocked-change',task_id:'fixture-task',expected_source_hash:'fixture-hash',...(name==='update_requested_task'?{fields:{title:'Changed'}}:{})};
      const denied=await local.sdk.callTool({name,arguments:args});
      assert.equal(denied.isError,true);assert.equal(messages.length,0);
     }
     const raw='SYNTHETIC-RAW-LOCAL-ONLY-TRANSCRIPT';
     const operationCount=await db.prepare('SELECT COUNT(*) AS n FROM native_operations').first('n');
     const call=local.sdk.callTool({name:'capture_brain_dump',arguments:{raw_text:raw,idempotency_key:'synthetic-local-key'}});
     const message=await take();assert.equal(message.tool,'capture_brain_dump');assert.equal(message.arguments.raw_text,raw);
     // lifeos:local without notes:write: the Mac is told not to write the capture into Anytype.
     assert.deepEqual(message.arguments._lifeos_grant,{notes_write:false});
     assert.equal((await local.sdk.callTool({name:'get_brain_dump',arguments:{capture_id:'another'}})).isError,true);
     socket.send(JSON.stringify({version:3,type:'local_tool_result',id:message.id,result:{content:[{type:'text',text:'Captured locally'}],structuredContent:{capture_id:'fixture-local',source_hash:'fixture-hash'},isError:false}}));
     const result=await call;assert.equal(result.structuredContent.capture_id,'fixture-local');
     // A client cannot claim notes:write itself: the forged key is refused before delivery.
     const forged=await local.sdk.callTool({name:'capture_brain_dump',arguments:{raw_text:raw,idempotency_key:'forged',_lifeos_grant:{notes_write:true}}});
     assert.equal(forged.isError,true);assert.equal(messages.length,0);
     // The review card's approval ticket rides in result _meta from the Mac to the card.
     const rendering=local.sdk.callTool({name:'render_proposal_review',arguments:{proposal:{proposal_id:'p',revision_number:1,revision_hash:'h',state:'draft',source_snapshots:[],things_changes:[],calendar_changes:[],created_at:'2026-10-10T09:00:00+11:00',approved_revision_hash:null,failure_detail:null}}});
     const render=await take();assert.equal(render.tool,'render_proposal_review');
     socket.send(JSON.stringify({version:3,type:'local_tool_result',id:render.id,result:{content:[{type:'text',text:'{}'}],structuredContent:{proposal_id:'p',revision_hash:'h'},_meta:{'lifeos/approval_ticket':'SYNTHETIC-TICKET'},isError:false}}));
     assert.equal((await rendering)._meta['lifeos/approval_ticket'],'SYNTHETIC-TICKET');
     assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM native_operations').first('n'),operationCount);
     const direct=await connect('things:read things:write offline_access',true,true);
     try {
      assert.equal((await direct.sdk.callTool({name:'get_lifeos_capabilities',arguments:{}})).structuredContent.local_task_creation_available,true);
      const args={request_id:'synthetic-direct-task',title:'Call James',notes:'Call after 8pm.',when:'2026-10-09'};
      const create=direct.sdk.callTool({name:'create_requested_task',arguments:args});
      const delivery=await take();assert.equal(delivery.tool,'create_requested_task');
      assert.deepEqual(delivery.arguments,{...args,_lifeos_grant:{notes_write:false}});
      socket.send(JSON.stringify({version:3,type:'local_tool_result',id:delivery.id,result:{content:[{type:'text',text:'Synthetic verified task'}],structuredContent:{saved:true,state:'applied',requires_lifeos_approval:false,receipt:{synthetic:true}},isError:false}}));
      const saved=await create;assert.equal(saved.structuredContent.saved,true);assert.equal(saved.structuredContent.requires_lifeos_approval,false);
      for(const name of ['read_requested_task','update_requested_task','trash_requested_task']){
       const changeArgs={task_id:'fixture-task',...(name==='read_requested_task'?{}:{request_id:'synthetic-'+name,expected_source_hash:'fixture-hash'}),...(name==='update_requested_task'?{fields:{title:'Edited synthetic task'}}:{})};
       const call=direct.sdk.callTool({name,arguments:changeArgs});
       const delivered=await take();assert.equal(delivered.tool,name);assert.deepEqual(delivered.arguments,{...changeArgs,_lifeos_grant:{notes_write:false}});
       socket.send(JSON.stringify({version:3,type:'local_tool_result',id:delivered.id,result:{content:[{type:'text',text:'Synthetic CRUD receipt'}],structuredContent:{saved:true,receipt:{synthetic:true}},isError:false}}));
       assert.equal((await call).isError,false);
      }
      assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM native_operations').first('n'),operationCount);
     } finally {await direct.sdk.close();}
     for(const table of ['native_operations','native_changes','mirror_items']){
      const rows=(await db.prepare(`SELECT * FROM ${table}`).all()).results;assert.ok(!JSON.stringify(rows).includes(raw));
     }
     // Notes: only grants with the notes scopes see note tools, and a note call stores nothing.
     assert.ok((await local.sdk.listTools()).tools.every(t=>!isNoteTool(t.name)));
     const reader=await connect('things:read offline_access',false,true,{notes:'allow'});
     const writer=await connect('things:read offline_access',false,true,{notes:'allow',notes_write:'allow'});
     try {
      assert.ok(reader.access.scope.split(' ').includes('notes'));assert.ok(!reader.access.scope.split(' ').includes('notes:write'));
      assert.ok(writer.access.scope.split(' ').includes('notes:write'));
      const readable=(await reader.sdk.listTools()).tools.map(t=>t.name).filter(isNoteTool);
      assert.deepEqual(readable.sort(),['notes_list_types','notes_read','notes_search','notes_today']);
      assert.deepEqual((await writer.sdk.listTools()).tools.map(t=>t.name).filter(isNoteTool).sort(),[...noteNames].sort());
      assert.equal((await reader.sdk.callTool({name:'notes_add',arguments:{request_id:'x',name:'x',by:'chatgpt'}})).isError,true);assert.equal(messages.length,0);
      const secret='SYNTHETIC-NOTE-TEXT-NEVER-STORED',before=await storage();
      // The snapshot really covers D1 (native_operations), DO storage (intents) and KV (entries).
      for(const table of [/:native_operations"/,/:intents"/,/:_mf_entries"/])assert.match(before.tables,table);
      const searching=reader.sdk.callTool({name:'notes_search',arguments:{query:secret}});
      const asked=await take();assert.equal(asked.tool,'notes_search');assert.deepEqual(asked.arguments,{query:secret,limit:20,_lifeos_grant:{notes_write:false}});
      socket.send(JSON.stringify({version:3,type:'local_tool_result',id:asked.id,result:{content:[{type:'text',text:secret}],structuredContent:{results:[{id:7,line:secret}],count:1,content_is_untrusted:true},isError:false}}));
      assert.equal((await searching).structuredContent.results[0].line,secret);
      const adding=writer.sdk.callTool({name:'notes_add',arguments:{request_id:'synthetic-note',name:secret,by:'chatgpt'}});
      const added=await take();assert.equal(added.tool,'notes_add');assert.deepEqual(added.arguments._lifeos_grant,{notes_write:true});
      socket.send(JSON.stringify({version:3,type:'local_tool_result',id:added.id,result:{content:[{type:'text',text:'saved'}],structuredContent:{saved:true,node_id:'8'},isError:false}}));
      assert.equal((await adding).structuredContent.saved,true);
      const after=await storage();
      assert.equal(after.tables,before.tables,'D1, KV and Durable Object tables are unchanged');
      assert.ok(!after.text.includes(secret),'note text is not in any persisted file');
     } finally {await reader.sdk.close();await writer.sdk.close();}
     const lost=local.sdk.callTool({name:'get_brain_dump',arguments:{capture_id:'fixture-local'}});await take();socket.close(1000,'synthetic disconnect');
     const unknown=await lost;assert.equal(unknown.isError,true);assert.match(unknown.content[0].text,/outcome may be unknown/);
    }finally{await local.sdk.close();}
   });
   await t.test('owner can explicitly add queued writes when a client initially requests reading',async()=>{
    const offered=await connect('things:read offline_access',true);
    try {
     assert.ok(offered.access.scope.split(' ').includes('things:write'));
     const page=JSON.parse((await offered.sdk.callTool({name:'read_things_mirror',arguments:{}})).content[0].text);
     assert.equal(page.capabilities.connection_can_write,true);
    }finally{await offered.sdk.close();}
   });
   await t.test('read grants remain read-only after activation and cannot expand on refresh',async()=>{
    const tools=(await read.sdk.listTools()).tools;
    assert.deepEqual(tools.map(t=>t.name),['render_day_plan','render_week_plan','render_brain_dump_canvas',...localNames,'create_artifact','read_artifact','list_artifacts','share_artifact','list_artifact_shares','revoke_artifact_share','get_lifeos_capabilities','read_things_mirror','queue_things_trash','queue_things_edit',...thingsTools]);
    assert.deepEqual(tools.find(t=>t.name==='queue_things_edit')._meta.securitySchemes,[{type:'oauth2',scopes:['things:read','things:write']}]);
    assert.equal((await read.sdk.callTool({name:'queue_things_edit',arguments:{}})).isError,true);
    const refresh=await read.req('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:read.client,refresh_token:read.access.refresh_token,scope:'things:read things:write offline_access',resource}));
    if(refresh.status===200)assert.ok(!(await refresh.json()).scope.split(' ').includes('things:write'));
    else assert.equal(refresh.status,400);
    assert.deepEqual((await write.sdk.listTools()).tools.map(t=>t.name),['render_day_plan','render_week_plan','render_brain_dump_canvas',...localNames,'create_artifact','read_artifact','list_artifacts','share_artifact','list_artifact_shares','revoke_artifact_share','get_lifeos_capabilities','read_things_mirror','queue_things_trash','queue_things_edit',...thingsTools]);
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
   // Offline Things operations (payload version 4) under the default things_wins policy.
   const mac={'X-LifeOS-Things-Ops':'1'},v=value=>({state:'value',value});
   const tool=async(name,args)=>{const r=await write.sdk.callTool({name,arguments:args});return {r,body:r.structuredContent,text:r.content[0].text};};
   const pendingOps=async(headers=mac)=>(await (await native('pending',undefined,agent,headers)).json()).operations;
   const claimOp=(id,headers=mac)=>native('claim',{id,claim:'c-'+id},agent,headers);
   const ackOp=(id,result,audit={})=>native('ack',{id,claim:'c-'+id,result,applied_after_sequence:3,...audit});
   const rich=(id,kind,fields)=>({id,kind,fields});
   const todo=(id,extra={})=>rich(id,'todo',{title:v('Alpha'),notes:v('Old notes'),activation_date:{state:'absent'},deadline:v('2026-11-01'),tags:v(['Errand']),status:v('open'),in_trash_list:v(false),area_id:{state:'absent'},project_id:v('proj-a'),heading_id:{state:'unsupported'},checklist:{state:'unsupported'},...extra});
   const richItems=[todo('todo-a'),todo('todo-b',{title:v('Bravo')}),todo('done-a',{status:v('completed')}),todo('trashed-a',{in_trash_list:v(true)}),
    rich('proj-a','project',{title:v('Garden'),notes:v(''),status:v('open'),in_trash_list:v(false),area_id:v('area-a'),deadline:{state:'absent'},activation_date:{state:'absent'},tags:v([])}),
    rich('area-a','area',{title:v('Home'),tags:v([])}),rich('tag-a','tag',{title:v('Errand'),parent_tag_id:{state:'absent'}})];
   const richSnapshot=(sequence,items)=>native('snapshot',{sequence,items,manifest:{observed_at:new Date().toISOString(),zone:'Australia/Melbourne',scopes:['todo','project','area','tag'],coverage:'public-top-level-and-all-lists-v2',coverage_evidence:{consistent_passes:2,classified_records:items.filter(i=>['todo','project'].includes(i.kind)).length,list_ids:lists}}});
   const mirror=async(cursor=0)=>JSON.parse((await write.sdk.callTool({name:'read_things_mirror',arguments:{cursor}})).content[0].text);
   const find=async(id,key='effective')=>{for(let cursor=0;cursor!==null;){const page=await mirror(cursor),hit=page[key].find(i=>i.id===id);if(hit)return hit;cursor=page.next_cursor;}};
   await t.test('things ops: mirror exposes rich fields, catalogue and field support',async()=>{
    assert.equal((await richSnapshot(3,richItems)).status,200);
    const page=await mirror();
    const a=await find('todo-a','confirmed');
    for(const field of ['notes','activation_date','deadline','tags','status','area_id','project_id','in_trash_list'])assert.ok(a.fields[field],field);
    assert.equal(a.fields.notes.revision,1);assert.equal((await find('done-a','confirmed')).fields.status.value,'completed');
    assert.deepEqual(page.catalog.areas,[{id:'area-a',title:'Home'}]);
    assert.deepEqual(page.catalog.projects,[{id:'proj-a',title:'Garden',area_id:'area-a',status:'open',in_trash:false}]);
    assert.deepEqual(page.catalog.tags,[{id:'tag-a',title:'Errand',parent_tag_id:null}]);
    assert.equal(page.catalog.field_support.notes,'reported');assert.equal(page.catalog.field_support.checklist,'not_reported_by_mac');
    assert.deepEqual(page.catalog.field_support.current_mac_writes,{checklist:'unsupported_by_things',when_evening:'unsupported_by_things',heading_container:'container_unavailable',restore:'inbox_only'});
    const descriptions=new Map((await write.sdk.listTools()).tools.map(t=>[t.name,t.description]));
    for(const name of ['queue_things_create','queue_things_update','queue_things_move','queue_things_batch','queue_things_restore']){
     assert.match(descriptions.get(name),/unsupported_by_things/);assert.match(descriptions.get(name),/container_unavailable/);assert.match(descriptions.get(name),/Inbox/);
    }
    assert.ok(page.capabilities.supported_writes.includes('batch'));
   });
   await t.test('things ops: create with temp id, dependants wait, receipt maps the real id',async()=>{
    const {body}=await tool('queue_things_batch',{operations:[
     {op:'create',operation_id:'create-call',kind:'todo',temp_id:'tmp-call',fields:{title:'Call James',notes:'After 8pm',when:'today',deadline:'2026-11-03',tags:['Errand'],checklist:[{title:'Find number'}]},container:{type:'project',id:'proj-a'}},
     {op:'update',operation_id:'rename-call',target:'tmp-call',fields:{title:'Call James back'}},
     {op:'set_status',operation_id:'complete-call',target:'tmp-call',status:'completed'}]});
    assert.deepEqual(body.results.map(r=>[r.operation_id,r.state]),[['create-call','queued'],['rename-call','queued'],['complete-call','queued']]);
    assert.deepEqual(body.results[1].waiting_for,['create-call']);
    const create=body.operations[0];assert.equal(create.payload.version,4);assert.equal(create.payload.op,'create');assert.deepEqual(create.payload.verify,['checklist','container','deadline','notes','tags','title','when']);
    assert.deepEqual(create.payload.fields.checklist,[{title:'Find number',completed:false}]);
    // The effective view shows the pending create under its temporary id with later edits applied.
    const page=await mirror(),pending=page.effective.find(i=>i.id==='tmp-call');
    assert.equal(pending.fields.title.value,'Call James back');assert.equal(pending.fields.status.value,'completed');assert.equal(pending.fields.project_id.value,'proj-a');assert.equal(pending.verification,'pending');
    assert.deepEqual(page.temp_ids.find(t=>t.temp_id==='tmp-call'),{temp_id:'tmp-call',operation_id:'create-call',kind:'todo',real_id:null,resolved_at:null,state:'queued'});
    // Only the create is runnable; its dependants cannot be claimed early.
    const runnable=(await pendingOps()).map(o=>o.id);assert.ok(runnable.includes('create-call'));assert.ok(!runnable.includes('rename-call'));
    assert.equal((await claimOp('rename-call')).status,409);
    assert.equal((await claimOp('create-call')).status,200);
    const verified={title:v('Call James'),notes:v('After 8pm'),when:v('today'),deadline:v('2026-11-03'),tags:v(['errand']),checklist:{state:'unsupported'},container:v({type:'project',id:'proj-a'})};
    // Receipt validation: every changed field must read back, and creates must report a real ID.
    assert.equal((await ackOp('create-call',{state:'applied',created_id:'RealCall1'},{verified_after:{...verified,title:v('Wrong')}})).status,409);
    assert.equal((await ackOp('create-call',{state:'applied'},{verified_after:verified})).status,409);
    assert.equal((await ackOp('create-call',{state:'applied',created_id:'tmp-forged'},{verified_after:verified})).status,409);
    const {checklist,...partial}=verified;assert.equal((await ackOp('create-call',{state:'applied',created_id:'RealCall1'},{verified_after:partial})).status,409);
    assert.equal((await native('ack',{id:'create-call',claim:'c-create-call',result:{state:'applied',created_id:'RealCall1'},verified_after:verified})).status,409,'A Things receipt needs a causal fence');
    const ack=await ackOp('create-call',{state:'applied',created_id:'RealCall1'},{verified_after:verified});assert.equal(ack.status,200);
    assert.equal((await ackOp('create-call',{state:'applied',created_id:'RealCall1'},{verified_after:verified})).status,200,'Receipt retry is idempotent');
    const status=(await tool('read_things_operations',{operation_ids:['create-call','rename-call','missing-op']})).body.operations;
    assert.equal(status[0].created_id,'RealCall1');assert.deepEqual(status[0].unverified_fields,['checklist']);
    assert.deepEqual(status[1].waiting_for,[]);assert.deepEqual(status[1].resolved_refs,{'tmp-call':'RealCall1'});assert.equal(status[2].state,'not_found');
    const next=await pendingOps(),rename=next.find(o=>o.id==='rename-call');
    assert.deepEqual(rename.resolved_refs,{'tmp-call':'RealCall1'});assert.equal(rename.payload.target,'tmp-call');
    assert.equal((await claimOp('rename-call')).status,200);
    assert.equal((await ackOp('rename-call',{state:'applied'},{verified_after:{title:v('Call James')}})).status,409);
    assert.equal((await ackOp('rename-call',{state:'applied'},{observed_before:{title:v('Call James')},verified_after:{title:v('Call James back')}})).status,200);
    // A later request can reference the temp id as a container once known.
    const later=await tool('queue_things_create',{operation_id:'create-sub',temp_id:'tmp-sub',kind:'project',title:'Sub project',container:{type:'area',id:'area-a'}});
    assert.equal(later.body.results[0].state,'queued');
    const page2=await mirror();assert.equal(page2.temp_ids.find(t=>t.temp_id==='tmp-call').real_id,'RealCall1');
   });
   await t.test('things ops: update fields, base revision checks, move, status and Trash rules',async()=>{
    const fields={title:'Alpha 2',notes:'New notes',when:'2026-11-05',deadline:null,tags:['Errand','Home']};
    const wrongKeys=await tool('queue_things_update',{operation_id:'upd-a',target:'todo-a',fields,base_revisions:{title:1}});
    assert.equal(wrongKeys.r.isError,true);assert.match(wrongKeys.text,/Nothing in this request was queued.*base_revisions must name exactly: activation_date, deadline, notes, tags, title/);
    const stale=await tool('queue_things_update',{operation_id:'upd-a',target:'todo-a',fields,base_revisions:{title:2,notes:1,activation_date:1,deadline:1,tags:1}});
    assert.equal(stale.r.isError,true);assert.match(stale.text,/Things changed since it was read/);
    const base_revisions={title:1,notes:1,activation_date:1,deadline:1,tags:1};
    const ok=await tool('queue_things_update',{operation_id:'upd-a',target:'todo-a',fields,base_revisions});
    assert.equal(ok.body.results[0].state,'queued');
    const payload=ok.body.operations[0].payload;assert.deepEqual(payload.base.deadline,v('2026-11-01'));assert.deepEqual(payload.base_revisions,base_revisions);
    // Idempotency: same request returns the same operation; different content is refused.
    const again=await tool('queue_things_update',{operation_id:'upd-a',target:'todo-a',fields,base_revisions});assert.equal(again.body.operations[0].ordinal,ok.body.operations[0].ordinal);
    const reused=await tool('queue_things_update',{operation_id:'upd-a',target:'todo-a',fields:{...fields,title:'Other'},base_revisions});assert.equal(reused.r.isError,true);assert.match(reused.text,/already used for a different request/);
    assert.equal((await tool('queue_things_update',{operation_id:'chk-a',target:'todo-a',fields:{checklist:[{title:'x'}]},base_revisions:{checklist:1}})).r.isError,true,'Checklist edits wait for a Mac that reports checklists');
    const effective=await find('todo-a');
    assert.equal(effective.fields.notes.value,'New notes');assert.equal(effective.fields.deadline.state,'absent');assert.equal(effective.fields.activation_date.value,'2026-11-05');assert.equal(effective.fields.notes.revision,1);
    assert.equal((await claimOp('upd-a')).status,200);
    const verified={title:v('Alpha 2'),notes:v('New notes'),when:v('2026-11-05'),deadline:{state:'absent'},tags:v(['home','Errand'])};
    assert.equal((await ackOp('upd-a',{state:'applied'},{verified_after:{...verified,deadline:v('2026-11-01')}})).status,409);
    assert.equal((await ackOp('upd-a',{state:'applied'},{verified_after:verified,merge_decision:{algorithm:'things_fields_v1',fields:{title:'cloud_only'}}})).status,409,'Merge decisions belong to smart policy receipts');
    assert.equal((await ackOp('upd-a',{state:'applied'},{verified_after:verified})).status,200);
    const move=await tool('queue_things_move',{operation_id:'move-a',target:'todo-a',container:{type:'area',id:'area-a'},base_revisions:{area_id:1,project_id:1,heading_id:1}});
    assert.equal(move.body.results[0].state,'queued');
    assert.equal((await tool('queue_things_move',{operation_id:'move-bad',target:'todo-a',container:{type:'project',id:'area-a'},base_revisions:{area_id:1,project_id:1,heading_id:1}})).r.isError,true);
    assert.equal((await tool('queue_things_move',{operation_id:'move-proj',target:'proj-a',container:{type:'inbox'},base_revisions:{area_id:1}})).r.isError,true,'Projects cannot go to the Inbox');
    assert.equal((await tool('queue_things_move',{operation_id:'move-proj',target:'proj-a',container:{type:'none'},base_revisions:{area_id:1}})).body.results[0].state,'queued');
    assert.equal((await tool('queue_things_move',{operation_id:'move-inbox',target:'todo-b',container:{type:'inbox'},base_revisions:{area_id:1,project_id:1,heading_id:1}})).body.results[0].state,'queued');
    assert.equal((await tool('queue_things_move',{operation_id:'move-heading',target:'done-a',container:{type:'heading',project:'proj-a',title:'Later'},base_revisions:{area_id:1,project_id:1,heading_id:1}})).body.results[0].state,'queued');
    assert.equal((await claimOp('move-a')).status,200);
    assert.equal((await ackOp('move-a',{state:'applied'},{verified_after:{container:v({type:'area',id:'area-a'})}})).status,200);
    assert.equal((await claimOp('move-heading')).status,200);
    assert.equal((await ackOp('move-heading',{state:'applied'},{verified_after:{container:{state:'unsupported'}}})).status,200,'Heading placement cannot be read back');
    for(const [id,target,status] of [['reopen-done','done-a','open'],['cancel-proj','proj-a','canceled'],['complete-b','todo-b','completed']]){
     const r=await tool('queue_things_status',{operation_id:id,target,status,base_revisions:{status:1}});assert.equal(r.body.results[0].state,'queued',id);
    }
    assert.equal((await claimOp('reopen-done')).status,200);
    assert.equal((await ackOp('reopen-done',{state:'applied'},{verified_after:{status:v('completed')}})).status,409);
    assert.equal((await ackOp('reopen-done',{state:'applied'},{verified_after:{status:v('open')}})).status,200);
    // Trash and restore are to-do only, and a pending Trash blocks further edits.
    assert.equal((await tool('queue_things_batch',{operations:[{op:'trash',operation_id:'trash-proj',target:'proj-a',base_revisions:{in_trash_list:1}}]})).r.isError,true);
    assert.equal((await tool('queue_things_batch',{operations:[{op:'trash',operation_id:'trash-b',target:'todo-b',base_revisions:{in_trash_list:1}}]})).body.results[0].state,'queued');
    const blocked=await tool('queue_things_update',{operation_id:'after-trash',target:'todo-b',fields:{title:'No'},base_revisions:{title:1}});assert.equal(blocked.r.isError,true);assert.match(blocked.text,/Restore it first/);
    assert.equal((await tool('queue_things_restore',{operation_id:'restore-a',target:'todo-a',base_revisions:{in_trash_list:1}})).r.isError,true,'Only items in Trash can be restored');
    const restore=await tool('queue_things_restore',{operation_id:'restore-t',target:'trashed-a',base_revisions:{in_trash_list:1}});assert.equal(restore.body.results[0].state,'queued');
    assert.equal((await find('trashed-a')).fields.in_trash_list.value,false);
    assert.equal((await claimOp('restore-t')).status,200);
    assert.equal((await ackOp('restore-t',{state:'failed',reason:'unsupported_by_things'})).status,200,'An honest failed restore is a valid receipt');
   });
   await t.test('things ops: batch is all-or-nothing and failed creates release their dependants',async()=>{
    const count=async()=>(await db.prepare("SELECT COUNT(*) AS n FROM native_operations WHERE id IN ('batch-ok','batch-bad')").first()).n;
    const bad=await tool('queue_things_batch',{operations:[{op:'create',operation_id:'batch-ok',kind:'todo',temp_id:'tmp-batch',fields:{title:'Valid'}},{op:'update',operation_id:'batch-bad',target:'missing-item',fields:{title:'x'}}]});
    assert.equal(bad.r.isError,true);assert.match(bad.text,/Operation 2: this item is missing/);assert.equal(await count(),0);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM native_temp_ids WHERE temp_id='tmp-batch'").first('n'),0);
    assert.equal((await tool('queue_things_batch',{operations:[{op:'update',operation_id:'forward-ref',target:'tmp-later',fields:{title:'x'}},{op:'create',operation_id:'later',kind:'todo',temp_id:'tmp-later',fields:{title:'x'}}]})).r.isError,true,'References must point to earlier creates');
    assert.equal((await tool('queue_things_create',{operation_id:'dupe-temp',temp_id:'tmp-call',title:'Reuse'})).r.isError,true,'A temporary id belongs to one create');
    const ok=await tool('queue_things_batch',{operations:[{op:'create',operation_id:'fail-proj',kind:'project',temp_id:'tmp-fail',fields:{title:'Doomed'}},{op:'create',operation_id:'fail-child',kind:'todo',temp_id:'tmp-child',fields:{title:'Child'},container:{type:'project',id:'tmp-fail'}},{op:'update',operation_id:'fail-edit',target:'tmp-child',fields:{notes:'x'}}]});
    assert.deepEqual(ok.body.results.map(r=>r.state),['queued','queued','queued']);
    assert.deepEqual(ok.body.results[1].waiting_for,['fail-proj']);
    assert.equal((await claimOp('fail-proj')).status,200);
    assert.equal((await ackOp('fail-proj',{state:'failed',reason:'automation_denied'})).status,200);
    const status=(await tool('read_things_operations',{operation_ids:['fail-child','fail-edit']})).body.operations;
    assert.deepEqual(status.map(s=>[s.state,s.result.reason]),[['skipped','dependency_unresolved'],['skipped','dependency_unresolved']]);
    assert.equal((await tool('queue_things_update',{operation_id:'too-late',target:'tmp-fail',fields:{title:'x'}})).r.isError,true);
   });
   await t.test('things ops: old Macs neither see nor claim version 4 operations',async()=>{
    const old=await pendingOps({});assert.ok(old.every(o=>o.payload.version!==4));
    const fresh=await pendingOps();assert.ok(fresh.some(o=>o.payload.version===4));
    const id=fresh.find(o=>o.payload.version===4&&o.state==='queued').id;
    assert.equal((await claimOp(id,{})).status,409);
    assert.equal((await db.prepare('SELECT state FROM native_operations WHERE id=?').bind(id).first('state')),'queued');
    assert.equal((await (await native('pending',undefined,agent,mac)).json()).things_ops_version,1);
   });
   await t.test('things ops: a later snapshot confirms applied operations and retires overlays',async()=>{
    assert.ok((await mirror()).effective.some(i=>i.id==='tmp-call'||i.temp_id==='tmp-call'));
    const before=await (await native('pending',undefined,agent,mac)).json();assert.equal(before.overlaysNeedConfirmation,true);
    const confirmed=[...richItems.filter(i=>i.id!=='todo-a'),todo('todo-a',{title:v('Alpha 2'),notes:v('New notes'),activation_date:v('2026-11-05'),deadline:{state:'absent'},tags:v(['Errand','Home']),area_id:v('area-a'),project_id:{state:'absent'}}),todo('RealCall1',{title:v('Call James back')})];
    assert.equal((await richSnapshot(4,confirmed)).status,200);
    const page=await mirror();
    assert.ok(!page.effective.some(i=>i.id==='tmp-call'),'Confirmed create no longer appears under its temp id');
    assert.equal((await find('RealCall1')).fields.title.value,'Call James back');
    assert.equal((await find('todo-a','confirmed')).fields.notes.revision,2);
    assert.ok(!page.pending_overlay.some(o=>o.id==='upd-a'));
    assert.ok(page.pending_overlay.some(o=>o.id==='complete-call'),'Unapplied dependant stays pending');
   });
   await t.test('things ops: uploads may add a heading scope and headings join the catalogue',async()=>{
    const items=[...richItems,rich('head-a','heading',{title:v('Later'),project_id:v('proj-a')})];
    const body={sequence:5,items,manifest:{observed_at:new Date().toISOString(),zone:'Australia/Melbourne',scopes:['todo','project','area','tag','heading'],coverage:'public-top-level-and-all-lists-v2',coverage_evidence:{consistent_passes:2,classified_records:items.filter(i=>['todo','project'].includes(i.kind)).length,list_ids:lists}}};
    assert.equal((await native('snapshot',{...body,manifest:{...body.manifest,scopes:['todo','project','area','heading']}})).status,409,'Required scopes stay mandatory');
    assert.equal((await native('snapshot',body)).status,200);
    assert.deepEqual((await mirror()).catalog.headings,[{id:'head-a',title:'Later',project_id:'proj-a'}]);
   });
  }finally{await read.sdk.close();await write.sdk.close();}
 });
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});await rm('.test-native.mjs',{force:true});}
