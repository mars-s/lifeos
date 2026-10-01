import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const ownRoot=dirname(fileURLToPath(import.meta.url));
const sourceRoot=resolve(process.env.SMART_SOURCE_ROOT??ownRoot);
const output=join(ownRoot,'.test-smart.mjs');
await build({entryPoints:[join(ownRoot,'smart-test-fixture.ts')],outfile:output,bundle:true,platform:'node',format:'esm',external:['cloudflare:workers'],plugins:[{name:'isolated-production-source',setup(build){
 build.onResolve({filter:/^\.\/(owner-sync|worker|native-queue)$/},args=>args.importer.endsWith('smart-test-fixture.ts')?{path:join(sourceRoot,args.path.slice(2)+'.ts')}:undefined);
}}]});
const script=await readFile(output,'utf8'),dir=await mkdtemp(join(tmpdir(),'lifeos-smart-tests-'));
const agent='SYNTHETIC-smart-agent-at-least-32-characters',origin='https://smart-fixture.test';
const hash=text=>createHash('sha256').update(text).digest('hex');
const make=()=>new Miniflare({...convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],durableObjects:{OWNER_SYNC:{className:'SmartTestOwnerSync',useSQLite:true}},d1Databases:{DB:'smart'},bindings:{LIFEOS_OWNER_ID:'smart-owner',LIFEOS_ADAPTER_ID:'synthetic-mac',LIFEOS_AGENT_KEY_SHA256:hash(agent),LIFEOS_WRITES_ENABLED:'true',LIFEOS_CLOUD_WINS_ENABLED:'true',LIFEOS_SMART_SYNC_ENABLED:'true'}}),resourcePersistencePath:dir});
let mf=make(),db;
const request=(path,input,headers={})=>mf.dispatchFetch(origin+path,{method:input===undefined?'GET':'POST',headers:{'X-LifeOS-Agent-Key':agent,'Content-Type':'application/json','X-LifeOS-Protocol':'3',...headers},body:input===undefined?undefined:JSON.stringify(input)});
async function ok(path,input,headers={}){const response=await request(path,input,headers);const body=await response.json();assert.equal(response.status,200,`Expected success at ${path}: ${JSON.stringify(body)}`);return body;}
const value=value=>({state:'value',value});
const item=(id,title='Base',status='open',trashed=false)=>({id,kind:'todo',fields:{title:value(title),status:value(status),in_trash_list:value(trashed),notes:value('Synthetic unchanged notes '.repeat(100))}});
const list_ids=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
let sequence=0,currentItems=Array.from({length:145},(_,index)=>item('task-'+index));
function uploadBody(items=currentItems,confirmations=[],seen=0,next=sequence+1){return {sequence:next,items,manifest:{observed_at:new Date().toISOString(),zone:'Australia/Melbourne',scopes:['todo','project','area','tag'],coverage:'public-top-level-and-all-lists-v2',coverage_evidence:{consistent_passes:2,classified_records:items.length,list_ids},seen_cloud_revision:seen,receipt_confirmations:confirmations}};}
async function snapshot(items=currentItems,confirmations=[],seen=0){const body=uploadBody(items,confirmations,seen);const result=await ok('/api/native/snapshot',body);sequence=body.sequence;currentItems=items;return {body,result};}
const enqueue=(id,target,value='Desired',extra={})=>request('/__smart_test/enqueue',{id,target,field:'title',value,base_revision:1,...extra});
async function queued(id,target,value='Desired',extra={}){const response=await enqueue(id,target,value,extra);const operation=await response.json();assert.equal(response.status,200,JSON.stringify(operation));assert.ok(['queued','accepted','satisfied','skipped'].includes(operation.state));return operation;}
const operation=id=>ok('/api/native/operation',{id});
const overlays=()=>ok('/__smart_test/overlays');
const claim=id=>ok('/api/native/claim',{id,claim:'claim-'+id});
const plain=cell=>cell.state==='value'?value(cell.value):{state:cell.state};
function receipt(op,local='Base',state='applied',reason){
 const base=plain(op.payload.base),before=value(local),desired=op.payload.value;
 const classification=state==='uncertain'?'interrupted':desired===local?'same_value':local===base.value?'cloud_only':'cloud_fallback';
 return {id:op.id,claim:'claim-'+op.id,result:{state,...reason?{reason}:{}},applied_after_sequence:sequence,observed_before:before,verified_after:value(desired),merge_decision:{algorithm:'supported_fields_v1',intent_kind:op.payload.intent_kind??'explicit_set',classification,base,local:before,desired}};
}
async function changes(since=0,limit=100){return ok('/api/native/changes',{since,limit});}
async function drainChanges(since=0,limit=7){
 const events=[];let cursor=since;
 for(let pages=0;pages<1000;pages++){
  const page=await changes(cursor,limit);assert.equal(page.version,3);assert.equal(page.reset,false);
  assert.ok(page.changes.length<=limit);let previous=cursor;
  for(const change of page.changes){assert.ok(change.revision>previous);previous=change.revision;events.push(change);}
  if(page.changes.length)assert.equal(page.cursor,previous,'Cursor must name the last returned event');
  else assert.equal(page.cursor,cursor,'Empty page must not skip unseen events');
  cursor=page.cursor;if(!page.has_more)return {events,cursor,page};
  assert.ok(page.changes.length>0,'A continuing page must make progress');
 }
 throw new Error('Feed did not finish within the synthetic bound');
}
async function restart(){await mf.dispose();mf=make();db=await mf.getD1Database('DB');}
async function socket(protocol=3){const response=await request('/api/native/events',undefined,{Upgrade:'websocket','X-LifeOS-Protocol':String(protocol)});assert.equal(response.status,101);const ws=response.webSocket;ws.accept();return ws;}
function message(ws){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Expected synthetic notification')),3000);ws.addEventListener('message',event=>{clearTimeout(timer);resolve(JSON.parse(event.data));},{once:true});});}
async function closeSocket(ws){ws.close();await new Promise(resolve=>setTimeout(resolve,25));}

try{
 db=await mf.getD1Database('DB');
 for(const name of ['0000_equal_spyke.sql','0001_hard_katie_power.sql','0002_native_sync.sql','0003_event_sync.sql','0004_smart_sync.sql']){
  const sql=await readFile(join(sourceRoot,'../site/drizzle',name),'utf8');
  await db.batch(sql.split('--> statement-breakpoint').map(statement=>statement.trim()).filter(Boolean).map(statement=>db.prepare(statement)));
 }
 await test('smart protocol through real local workerd, D1 and durable owner',async t=>{
  await t.test('new native projection routes enforce agent-only authentication',async()=>{
   for(const path of ['changes','bootstrap']){
    assert.equal((await request('/api/native/'+path,{}, {'X-LifeOS-Agent-Key':'SYNTHETIC-wrong'})).status,401);
    assert.equal((await request('/api/native/'+path,{}, {Origin:origin})).status,403);
    assert.ok((await request('/api/native/'+path+'?key=SYNTHETIC-forbidden',{})).status>=400);
   }
  });
  await snapshot();
  await t.test('snapshot transactions feed projections independently of command ordinals',async()=>{
   const pending=await ok('/api/native/pending');assert.equal(pending.smart_sync_version,3);assert.equal(pending.revision,0);assert.ok(pending.feed_revision>0);
   const feed=await drainChanges(0,1);assert.ok(feed.events.some(event=>event.kind==='item'&&event.payload.item.id==='task-0'));
   assert.ok(feed.events.some(event=>event.kind==='meta'&&event.payload.sequence===1));
   assert.ok(!feed.events.some(event=>event.kind==='operation'&&event.payload.command_changed));
   assert.ok(feed.events.every(event=>event.revision<=pending.feed_revision));
   const raw=await db.prepare("SELECT fields FROM mirror_items WHERE owner='smart-owner' AND id='task-0'").first();assert.ok(!raw.fields.includes('basis_token'));
  });
  await t.test('frozen bootstrap pages retain one feed boundary across a concurrent commit',async()=>{
   const first=await ok('/api/native/bootstrap',{});assert.equal(first.version,3);assert.ok(first.has_more);assert.equal(typeof first.next_cursor,'string');
   const frozen=first.cursor,items=[...first.items];
   const changed=currentItems.map(row=>row.id==='task-144'?item(row.id,'Bootstrap changed'):row);
   await snapshot(changed);
   let next=first.next_cursor;
   while(next){const page=await ok('/api/native/bootstrap',{cursor:next});assert.equal(page.cursor,frozen);items.push(...page.items);next=page.next_cursor;}
   assert.equal(new Set(items.map(row=>row.id)).size,145);
   assert.equal(items.find(row=>row.id==='task-144').fields.title.value,'Base');
   const after=await drainChanges(frozen);assert.ok(after.events.some(event=>event.kind==='item'&&event.payload.item.id==='task-144'&&event.payload.item.fields.title.value==='Bootstrap changed'));
   assert.ok((await request('/api/native/bootstrap',{cursor:'SYNTHETIC-unbound-cursor'})).status>=400);
  });
  await t.test('retained stale revisions and recorded ABA preserve the actual caller base',async()=>{
   await snapshot(currentItems.map(row=>row.id==='task-0'?item(row.id,'Intermediate'):row));
   await snapshot(currentItems.map(row=>row.id==='task-0'?item(row.id,'Base'):row));
   const op=await queued('aba','task-0','Desired');assert.equal(op.payload.version,3);assert.equal(op.payload.conflict_policy,'smart_merge_v1');assert.equal(op.payload.base.value,'Base');assert.equal(op.payload.intent_kind,'explicit_set');
   assert.equal(op.payload.recorded_divergence,true);
   const row=await db.prepare("SELECT fields FROM mirror_items WHERE owner='smart-owner' AND id='task-0'").first();assert.equal(JSON.parse(row.fields).title.revision,3);
   const retained=await queued('stale','task-144','Stale base request');assert.equal(retained.payload.base.value,'Base');
   assert.equal((await enqueue('missing-base','task-1','Desired',{base_revision:999})).status,409);
   assert.equal((await enqueue('foreign-base','task-1','Desired',{basis_token:'SYNTHETIC-owner-unbound'})).status,409);
   assert.equal((await enqueue('valid-unknown-token','task-1','Desired',{basis_token:'f'.repeat(48)})).status,409);
  });
  await t.test('explicit reaffirmation survives while a derived empty patch cannot replace real work',async()=>{
   await snapshot(currentItems.map(row=>row.id==='task-1'?item(row.id,'Local changed'):row));
   const real=await queued('explicit-reaffirm','task-1','Base');assert.equal(real.state,'queued');assert.equal(real.payload.intent_kind,'explicit_set');
   await queued('derived-empty','task-1','Base',{intent_kind:'derived_patch'});
   const active=await overlays();assert.ok(active.some(op=>op.id==='explicit-reaffirm'));assert.ok(!active.some(op=>op.id==='derived-empty'));
   assert.equal((await operation('explicit-reaffirm')).state,'queued');
   assert.equal((await enqueue('explicit-reaffirm','task-1','Base',{intent_kind:'derived_patch'})).status,409);
   const basis=await db.prepare("SELECT token,revision FROM native_bases WHERE owner='smart-owner' AND target='task-1' AND field='title' AND source='desired' AND ordinal=?").bind(real.ordinal).first();
   assert.ok(basis);
   const successor=await queued('displayed-successor','task-1','Pending-based successor',{basis_token:basis.token,base_revision:basis.revision});
   assert.equal(successor.payload.base.value,'Base');assert.equal(successor.payload.basis.source,'desired');assert.equal(successor.payload.basis.ordinal,real.ordinal);
  });
  await t.test('legacy policy payloads remain unchanged under smart capability',async()=>{
   const legacy=await ok('/__smart_test/prepare_legacy',{id:'legacy','target':'task-2',field:'title',value:'Legacy',base_revision:1});
   assert.equal(legacy.payload.conflict_policy,'things_wins');assert.equal(legacy.payload.version,undefined);assert.equal(legacy.payload.intent_kind,undefined);
   const fetched=await operation('legacy');assert.deepEqual(fetched.payload,legacy.payload);
  });
  await t.test('fenced receipt proof is immutable and stale snapshots cannot retire it',async()=>{
   const op=await queued('proof','task-3','Proof value');await claim(op.id);
   const body=receipt(op);body.applied_after_sequence=sequence+1;
   const ack=await ok('/api/native/ack',body);assert.ok(ack.receipt_confirmation);const proof=ack.receipt_confirmation;
   assert.deepEqual(await ok('/api/native/ack',body),ack);
   assert.equal((await request('/api/native/ack',{...body,merge_decision:{...body.merge_decision,classification:'cloud_fallback'}})).status,409);
   assert.equal((await request('/api/native/ack',{...body,applied_after_sequence:body.applied_after_sequence+1})).status,409);
   const match=currentItems.map(row=>row.id==='task-3'?item(row.id,'Proof value'):row);
   await snapshot(match,[proof],op.ordinal);assert.ok((await overlays()).some(row=>row.id===op.id),'Matching proof at the pre-write sequence fence is insufficient');
   await snapshot(match,[],op.ordinal);assert.ok((await overlays()).some(row=>row.id===op.id),'Watermark alone is not receipt proof');
   const wrong={...proof,receipt_hash:'0'.repeat(64)};
   const response=await request('/api/native/snapshot',uploadBody(match,[wrong],op.ordinal));assert.ok(response.status>=400);
   assert.ok((await overlays()).some(row=>row.id===op.id));
   await snapshot(match,[proof],op.ordinal);assert.ok(!(await overlays()).some(row=>row.id===op.id));
   assert.deepEqual((await operation(op.id)).result,{state:'applied'});
  });
  await t.test('post-write mismatch moves only its own desire to review without changing receipt',async()=>{
   const op=await queued('review','task-4','Cloud value');await claim(op.id);const ack=await ok('/api/native/ack',receipt(op));
   const mismatch=currentItems.map(row=>row.id==='task-4'?item(row.id,'After write local change'):row);
   await snapshot(mismatch,[ack.receipt_confirmation],op.ordinal);
   assert.deepEqual((await operation(op.id)).result,{state:'applied'});
   const active=await overlays();assert.ok(!active.some(row=>row.id===op.id&&row.state!=='review'),'Old mismatching value must not remain an ordinary active desire');
   const feed=await drainChanges();assert.ok(feed.events.some(event=>JSON.stringify(event.payload).includes('review')),'Review disposition must be observable in the feed');
   const latest=await queued('review-successor','task-4','Latest');assert.ok((await overlays()).some(row=>row.id===latest.id));
   await snapshot(mismatch,[ack.receipt_confirmation],latest.ordinal);assert.ok((await overlays()).some(row=>row.id===latest.id),'Old proof cannot clear newer desire');
  });
  await t.test('Trash intent is a target-wide barrier and disappearance never becomes successful deletion',async()=>{
   const rename=await queued('before-trash','task-5','Rename');
   await ok('/__smart_test/prepare_smart',{id:'trash',target:'task-5',field:'in_trash_list',value:true,base_revision:1});
   const trash=await queued('trash','task-5',true,{field:'in_trash_list'});assert.equal(trash.payload.field,'in_trash_list');
   assert.ok(['superseded','skipped'].includes((await operation(rename.id)).state));
   assert.equal((await enqueue('after-trash','task-5','Forbidden')).status,409);
   const state=await operation(trash.id);assert.equal(state.target_trashed_desired,true);
   await snapshot(currentItems.filter(row=>row.id!=='task-6'));
   assert.equal((await enqueue('missing-trash','task-6',true,{field:'in_trash_list'})).status,409);
  });
  await t.test('pre-invocation supersession and interrupted setter audits cross the real ack boundary',async()=>{
   const old=await queued('skip-head','task-40');await claim(old.id);
   await queued('skip-successor','task-40','Newer');
   const skipped=await ok('/api/native/ack',{id:old.id,claim:'claim-'+old.id,result:{state:'skipped',reason:'newer_cloud_edit'},applied_after_sequence:sequence});
   assert.equal(skipped.state,'skipped');assert.equal(skipped.receipt_confirmation,undefined);
   const failed=await queued('invocation-failed','task-41');await claim(failed.id);
   const uncertain=receipt(failed,'Base','uncertain','verification_failed');
   uncertain.merge_decision.classification='cloud_only';delete uncertain.verified_after;
   const acknowledged=await ok('/api/native/ack',uncertain);assert.equal(acknowledged.state,'uncertain');
   assert.deepEqual(await ok('/api/native/ack',uncertain),acknowledged);
   assert.ok(!(await overlays()).some(row=>row.id===failed.id));
   const interrupted=await queued('old-journal-interrupted','task-42');await claim(interrupted.id);
   const olderAck={id:interrupted.id,claim:'claim-'+interrupted.id,result:{state:'uncertain',reason:'interrupted_write'},applied_after_sequence:sequence};
   assert.equal((await request('/api/native/ack',olderAck)).status,409,'An interrupted journal must synthesize a typed audit rather than omit it');
   const local={state:'unknown',reason:'verification_failed'};
   const safeAck={...olderAck,observed_before:local,merge_decision:{algorithm:'supported_fields_v1',intent_kind:'explicit_set',classification:'interrupted',base:plain(interrupted.payload.base),local,desired:interrupted.payload.value}};
   const olderReceipt=await ok('/api/native/ack',safeAck);assert.equal(olderReceipt.state,'uncertain');assert.equal(olderReceipt.receipt_confirmation,undefined);
  });
  await t.test('runnable paging does not let an executing target hide later commands',async()=>{
   const owned=await queued('foreign-owner','task-60');await claim(owned.id);
   await queued('blocked-target','task-60','Blocked');
   for(let n=0;n<23;n++)await queued('paged-'+n,'task-'+(70+n));
   const found=new Set();
   for(let pages=0;pages<10;pages++){
    const page=await ok('/api/native/pending');assert.ok(page.operations.length<=20);
    assert.ok(!page.operations.some(op=>op.id==='blocked-target'));
    const runnable=page.operations.filter(op=>op.state==='queued');if(!runnable.length)break;
    for(const op of runnable){found.add(op.id);await claim(op.id);await ok('/api/native/ack',{id:op.id,claim:'claim-'+op.id,result:{state:'skipped',reason:'newer_cloud_edit'},applied_after_sequence:sequence});}
   }
   for(let n=0;n<23;n++)assert.ok(found.has('paged-'+n));
   assert.equal((await operation('blocked-target')).state,'queued');
  });
  await t.test('every semantic mutation survives D1 response loss and coordinator restart',async()=>{
   for(const kind of ['enqueue','claim','ack','snapshot']){
    const id='loss-'+kind,target='task-'+({enqueue:20,claim:21,ack:22,snapshot:23}[kind]);
    let op;if(kind==='claim'||kind==='ack'){op=await queued(id,target);if(kind==='ack')await claim(id);}
    const before=(await ok('/api/native/pending')).feed_revision;
    await ok('/__smart_test/fault',{kind,remaining:1,after_commit:true});
    let input,path;
    if(kind==='enqueue'){path='/__smart_test/enqueue';input={id,target,field:'title',value:'Loss desired',base_revision:1};}
    if(kind==='claim'){path='/api/native/claim';input={id,claim:'claim-'+id};}
    if(kind==='ack'){path='/api/native/ack';input=receipt(op);}
    if(kind==='snapshot'){path='/api/native/snapshot';input=uploadBody(currentItems.map(row=>row.id===target?item(row.id,'Loss committed'):row));}
    await request(path,input);
    const fault=await ok('/__smart_test/inspect');assert.equal(fault.fault.remaining,0,`Fault hook must actually fire for ${kind}`);
    const committed=(await ok('/api/native/pending')).feed_revision;assert.ok(committed>before,`D1 state/feed must commit atomically for ${kind}`);
    await restart();await ok('/__smart_test/tick');await ok(path,input);
    if(kind==='snapshot'){sequence=input.sequence;currentItems=input.items;}
    assert.equal((await ok('/api/native/pending')).feed_revision,committed,`Replay must not duplicate ${kind} events`);
    const ws=await socket();const caught=await message(ws);assert.equal(caught.version,3);assert.ok(caught.revision>=committed);ws.send(JSON.stringify({version:3,ack:caught.revision}));await closeSocket(ws);
   }
  });
  await t.test('protocol versions keep feed cursor and operation ordinal distinct',async()=>{
   const state=await ok('/api/native/pending');assert.ok(state.feed_revision>state.revision);
   const smart=await socket(3),smartMessage=await message(smart);assert.equal(smartMessage.version,3);assert.equal(smartMessage.revision,state.feed_revision);smart.send(JSON.stringify({version:3,ack:smartMessage.revision}));await closeSocket(smart);
   const legacy=await socket(2),legacyMessage=await message(legacy);assert.equal(legacyMessage.version,1);assert.equal(legacyMessage.revision,state.revision);legacy.send(JSON.stringify({version:1,ack:legacyMessage.revision}));await closeSocket(legacy);
   await ok('/__smart_test/tick');assert.equal((await ok('/__smart_test/inspect')).alarm,null);
  });
  await t.test('Unicode operation transport is bounded without truncating bases or retained vectors',async()=>{
   const base='漢'.repeat(4000),desired='文'.repeat(4000);
   const targets=Array.from({length:20},(_,n)=>item('unicode-'+n,base));
   await snapshot([...currentItems,...targets,item('oversized-base','漢'.repeat(4001))]);
   const accepted=[];
   for(const target of targets){
    const row=await db.prepare("SELECT fields FROM mirror_items WHERE owner='smart-owner' AND id=?").bind(target.id).first();
    const revision=JSON.parse(row.fields).title.revision;
    const op=await queued('unicode-op-'+target.id,target.id,desired,{base_revision:revision});
    assert.deepEqual(Object.keys(op.payload.basis.target_fields).sort(),['in_trash_list','status','title']);
    assert.equal(op.payload.base.value,base);assert.equal(op.payload.value,desired);accepted.push(op);
   }
   const retained=await db.prepare("SELECT * FROM native_bases WHERE owner='smart-owner' AND target='unicode-0' AND field='title' AND source='desired' AND ordinal=?").bind(accepted[0].ordinal).first();
   assert.ok(retained);assert.ok(!JSON.parse(retained.target_fields).notes);
   const successor=await queued('unicode-pending-successor','unicode-0',base,{basis_token:retained.token,base_revision:retained.revision});
   assert.deepEqual(Object.keys(successor.payload.basis.target_fields).sort(),['in_trash_list','status','title']);
   assert.equal(successor.payload.base.value,desired);
   const effectiveToken='e'.repeat(48);
   await db.prepare('INSERT INTO native_bases(token,owner,target,field,revision,sequence,source,ordinal,cell,target_fields,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(effectiveToken,'smart-owner','unicode-1','title',retained.revision,sequence,'effective',accepted[1].ordinal,retained.cell,JSON.stringify({...JSON.parse(retained.target_fields),notes:value('Synthetic private-shaped unrelated notes')}),new Date().toISOString()).run();
   const effective=await queued('unicode-effective-successor','unicode-1',base,{basis_token:effectiveToken,base_revision:retained.revision});
   assert.deepEqual(Object.keys(effective.payload.basis.target_fields).sort(),['in_trash_list','status','title']);
   const response=await request('/api/native/pending');assert.equal(response.status,200);
   const bytes=await response.arrayBuffer();assert.ok(bytes.byteLength<256*1024);
   const page=JSON.parse(new TextDecoder().decode(bytes));assert.ok(page.operations.length>0&&page.operations.length<=20);
   t.diagnostic(`Unicode pending response: ${bytes.byteLength} bytes, ${page.operations.length} complete operations`);
   const runnable=(await db.prepare("SELECT id FROM native_operations o WHERE owner='smart-owner' AND state='queued' AND NOT EXISTS(SELECT 1 FROM native_operations held WHERE held.owner=o.owner AND held.state='executing' AND json_extract(held.payload,'$.target')=json_extract(o.payload,'$.target')) ORDER BY ordinal").all()).results.map(row=>row.id);
   const returned=page.operations.filter(op=>op.state==='queued').map(op=>op.id);assert.deepEqual(returned,runnable.slice(0,returned.length));
   assert.ok(returned.length>0);
   for(const op of page.operations){const full=await operation(op.id);assert.deepEqual(op.payload,full.payload);}
   const tooLong=await db.prepare("SELECT fields FROM mirror_items WHERE owner='smart-owner' AND id='oversized-base'").first();
   assert.equal((await enqueue('oversized-base-command','oversized-base',desired,{base_revision:JSON.parse(tooLong.fields).title.revision})).status,409);
   assert.equal(await db.prepare("SELECT id FROM native_operations WHERE owner='smart-owner' AND id='oversized-base-command'").first(),null);
  });
 });
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});await rm(output,{force:true});}
