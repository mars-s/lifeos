import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

await build({entryPoints:['event-test-fixture.ts'],outfile:'.test-events.mjs',bundle:true,platform:'node',format:'esm',external:['cloudflare:workers']});
const dir=await mkdtemp(join(tmpdir(),'lifeos-events-'));
const agent='SYNTHETIC-native-agent-at-least-32-characters';
const hash=s=>createHash('sha256').update(s).digest('hex');
const script=await readFile('.test-events.mjs','utf8');
const make=()=>new Miniflare({...convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],durableObjects:{OWNER_SYNC:{className:'TestOwnerSync',useSQLite:true}},d1Databases:{DB:'events'},bindings:{LIFEOS_OWNER_ID:'owner',LIFEOS_ADAPTER_ID:'fixture-mac',LIFEOS_AGENT_KEY_SHA256:hash(agent),LIFEOS_WRITES_ENABLED:'true',LIFEOS_CLOUD_WINS_ENABLED:'true'}}),resourcePersistencePath:dir});
let mf=make(),db;
const request=(path,input,extra={})=>mf.dispatchFetch('https://fixture.test'+path,{method:input===undefined?'GET':'POST',headers:{'X-LifeOS-Agent-Key':agent,'Content-Type':'application/json',...extra},body:input===undefined?undefined:JSON.stringify(input)});
const json=async(path,input)=>(await request(path,input)).json();
const enqueue=(id,target,value='Cloud title')=>request('/__test/enqueue',{id,target,field:'title',value,base_revision:1});
const item=(id,title='Local title')=>({id,kind:'todo',fields:{title:{state:'value',value:title},status:{state:'value',value:'open'},in_trash_list:{state:'value',value:false}}});
const list_ids=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
const snapshot=(sequence,items,seen_cloud_revision)=>request('/api/native/snapshot',{sequence,items,manifest:{observed_at:new Date().toISOString(),zone:'Australia/Melbourne',scopes:['todo','project','area','tag'],coverage:'public-top-level-and-all-lists-v2',coverage_evidence:{consistent_passes:2,classified_records:items.length,list_ids},seen_cloud_revision}});
const claim=id=>request('/api/native/claim',{id,claim:'claim-'+id});
const ack=(id,fence=1,overrides={})=>request('/api/native/ack',{id,claim:'claim-'+id,result:{state:'applied'},applied_after_sequence:fence,observed_before:{state:'value',value:'Local title'},verified_after:{state:'value',value:'Cloud title'},...overrides});
async function socket(){
  const response=await request('/api/native/events',undefined,{Upgrade:'websocket'});assert.equal(response.status,101);
  const ws=response.webSocket;ws.accept();return ws;
}
const message=ws=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Notification missing')),2000);ws.addEventListener('message',e=>{clearTimeout(timer);resolve(JSON.parse(e.data));},{once:true});});
try{
 db=await mf.getD1Database('DB');
 for(const name of ['0000_equal_spyke.sql','0001_hard_katie_power.sql','0002_native_sync.sql','0003_event_sync.sql'])await db.batch((await readFile('../site/drizzle/'+name,'utf8')).split('--> statement-breakpoint').map(s=>db.prepare(s.trim())));
 await test('event coordinator and causal overlays on local workerd',async t=>{
  const items=Array.from({length:45},(_,n)=>item('task-'+n));
  assert.equal((await snapshot(1,items,0)).status,200);
  await t.test('authenticated upgrades reject wrong role, Origin and URL credentials',async()=>{
   assert.equal((await request('/api/native/events',undefined,{Upgrade:'websocket','X-LifeOS-Agent-Key':'wrong'})).status,401);
   assert.equal((await request('/api/native/events',undefined,{Upgrade:'websocket',Origin:'https://fixture.test'})).status,403);
   assert.equal((await request('/api/native/events?key=forbidden',undefined,{Upgrade:'websocket'})).status,400);
  });
  await t.test('D1 response loss survives restart and preserves acceptance FIFO',async()=>{
   await json('/__test/configure',{count:1,after:true});
   const a=await enqueue('fifo-A','task-0','A');assert.equal((await a.json()).state,'accepted');
   const before=await json('/__test/inspect');assert.equal(before.intents.length,1);assert.equal(before.watermark,0);assert.ok(before.alarm);
   await mf.dispose();mf=make();db=await mf.getD1Database('DB');
   const b=await enqueue('fifo-B','task-0','B');assert.equal((await b.json()).state,'queued');
   const operations=(await db.prepare("SELECT id,ordinal,state FROM native_operations WHERE owner='owner' ORDER BY ordinal").all()).results;
   assert.deepEqual(operations.map(o=>o.id),['fifo-A','fifo-B']);assert.ok(operations[0].ordinal<operations[1].ordinal);assert.equal(operations[0].state,'superseded');
   const after=await json('/__test/inspect');assert.equal(after.intents.length,0);assert.equal(after.watermark,operations[1].ordinal);assert.equal(after.alarm,null);
   assert.equal((await enqueue('fifo-A','task-0','Different')).status,409);
  });
  await t.test('unknown head cannot be overtaken, invalid request cannot wedge FIFO',async()=>{
   await json('/__test/configure',{count:2,after:false});
   assert.equal((await (await enqueue('blocked-A','task-1','A')).json()).state,'accepted');
   assert.equal((await (await enqueue('blocked-B','task-1','B')).json()).state,'accepted');
   assert.deepEqual((await json('/__test/inspect')).intents.map(i=>i.id),['blocked-A','blocked-B']);
   assert.equal((await enqueue('invalid','task-1','')).status,409);
   assert.equal((await enqueue('valid','task-1','Valid')).status,200);
   const ops=(await db.prepare("SELECT id FROM native_operations WHERE id IN ('blocked-A','blocked-B','valid') ORDER BY ordinal").all()).results;assert.deepEqual(ops.map(o=>o.id),['blocked-A','blocked-B','valid']);
  });
  await t.test('early absent readback and changed target do not reject a prepared ambiguous intent',async()=>{
   await json('/__test/configure',{count:1,after:2});
   assert.equal((await (await enqueue('delayed-A','task-40','A')).json()).state,'accepted');
   assert.equal(await db.prepare("SELECT id FROM native_operations WHERE id='delayed-A'").first(),null);
   await db.prepare("UPDATE mirror_items SET deleted=1 WHERE id='task-40'").run();
   const b=await (await enqueue('delayed-B','task-41','B')).json();assert.equal(b.state,'queued');
   const a=await json('/api/native/operation',{id:'delayed-A'});assert.equal(a.state,'skipped');assert.ok(a.ordinal<b.ordinal);
   await json('/__test/release',{});
   assert.deepEqual(await json('/api/native/operation',{id:'delayed-A'}),a);
   assert.equal((await json('/__test/inspect')).intents.length,0);
  });
  await t.test('concurrent same-ID changed-content request cannot share an accepted outcome',async()=>{
   const results=await Promise.all([enqueue('concurrent-ID','task-42','A'),enqueue('concurrent-ID','task-42','B')]);
   assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
   const op=await json('/api/native/operation',{id:'concurrent-ID'});assert.ok(['A','B'].includes(op.payload.value));
  });
  await t.test('reconnect catches committed watermark, ack removes delivery alarm',async()=>{
   const ws=await socket();const first=await message(ws);assert.equal(first.version,1);assert.ok(first.revision>0);
   ws.send(JSON.stringify({version:1,ack:first.revision}));
   const notified=message(ws);await enqueue('socket-edit','task-2');const hint=await notified;assert.ok(hint.revision>first.revision);
   ws.send(JSON.stringify({version:1,ack:hint.revision}));
   await json('/__test/tick');assert.equal((await json('/__test/inspect')).alarm,null);
   ws.close();const next=await socket(),catchup=await message(next);assert.equal(catchup.revision,hint.revision);next.send(JSON.stringify({version:1,ack:catchup.revision}));next.close();
  });
  await t.test('delivery retries close unhealthy sockets while unresolved enqueue recovery stays armed',async()=>{
   const ws=await socket();await message(ws);
   for(let n=0;n<4;n++)await json('/__test/tick');
   const disconnected=await json('/__test/inspect');assert.equal(disconnected.sockets,0);assert.equal(disconnected.alarm,null);
   await json('/__test/configure',{count:2,after:false});
   assert.equal((await (await enqueue('alarm-recovery','task-43')).json()).state,'accepted');
   await json('/__test/tick');assert.ok((await json('/__test/inspect')).alarm);
   await json('/__test/tick');const recovered=await json('/__test/inspect');assert.equal(recovered.intents.length,0);assert.equal(recovered.alarm,null);
  });
  await t.test('complete overlays exceed execution page and blocked targets cannot starve later work',async()=>{
   for(let n=3;n<24;n++){await enqueue('old-'+n,'task-'+n);assert.equal((await claim('old-'+n)).status,200);await enqueue('new-'+n,'task-'+n);}
   await enqueue('runnable','task-30');
   const pending=await json('/api/native/pending');assert.equal(pending.operations.length,20);assert.ok(pending.operations.some(o=>o.id==='runnable'));assert.ok(!pending.operations.some(o=>o.id.startsWith('new-')));
   const overlays=await json('/__test/overlays');assert.ok(overlays.length>20);assert.equal(overlays.filter(o=>o.id.startsWith('new-')).length,21);
  });
  await t.test('receipt result and causal metadata are independently immutable',async()=>{
   await enqueue('fence','task-31');assert.equal((await claim('fence')).status,200);
   assert.equal((await request('/api/native/ack',{id:'fence',claim:'claim-fence',result:{state:'applied'}})).status,409);
   assert.equal((await ack('fence')).status,200);assert.equal((await ack('fence')).status,200);
   assert.equal((await ack('fence',2)).status,409);
   assert.equal((await ack('fence',1,{result:{state:'satisfied'}})).status,409);
   const saved=await json('/api/native/operation',{id:'fence'});assert.deepEqual(saved.result,{state:'applied'});assert.equal(saved.payload.version,2);assert.equal(saved.payload.conflict_policy,'cloud_wins');
   assert.equal((await json('/api/native/pending')).overlaysNeedConfirmation,true);
   await assert.rejects(db.prepare("UPDATE native_receipt_audit SET metadata='{}' WHERE operation_id='fence'").run());
   await assert.rejects(db.prepare("UPDATE native_operations SET updated_at='different' WHERE id='fence'").run());
  });
  await t.test('new desired revision fences interrupted recovery without changing original payload',async()=>{
   await enqueue('recovery-old','task-44','Old request');await claim('recovery-old');
   await enqueue('recovery-new','task-44','New request');
   const old=await json('/api/native/operation',{id:'recovery-old'});assert.equal(old.state,'executing');assert.equal(old.payload.value,'Old request');assert.ok(old.current_desired_revision>old.ordinal);
   assert.equal((await ack('recovery-old',1,{result:{state:'skipped',reason:'newer_cloud_edit'}})).status,200);
   assert.ok((await json('/api/native/pending')).operations.some(o=>o.id==='recovery-new'));
   assert.ok((await json('/__test/overlays')).some(o=>o.id==='recovery-new'));
  });
  await t.test('late snapshot, unseen revision and mismatch cannot retire desired overlay',async()=>{
   const revision=(await json('/api/native/pending')).revision;
   // A snapshot read before the setter can still have a current cloud basis.
   await enqueue('late','task-32');await claim('late');assert.equal((await ack('late',2)).status,200);
   const matching=items.map(i=>i.id==='task-31'||i.id==='task-32'?item(i.id,'Cloud title'):i);
   assert.equal((await snapshot(2,matching,revision+1)).status,200);
   let overlays=await json('/__test/overlays');assert.ok(!overlays.some(o=>o.id==='fence'));assert.ok(overlays.some(o=>o.id==='late'));
   assert.equal((await snapshot(3,matching,0)).status,200);assert.ok((await json('/__test/overlays')).some(o=>o.id==='late'));
   assert.equal((await snapshot(4,items,revision+1)).status,200);assert.ok((await json('/__test/overlays')).some(o=>o.id==='late'));
   assert.equal((await snapshot(5,matching,revision+1)).status,200);assert.ok(!(await json('/__test/overlays')).some(o=>o.id==='late'));
   // A same-value later desired revision needs its own receipt and fence.
   await enqueue('newer','task-32');assert.ok((await json('/__test/overlays')).some(o=>o.id==='newer'));
   assert.equal((await snapshot(6,matching,revision+2)).status,200);assert.ok((await json('/__test/overlays')).some(o=>o.id==='newer'));
  });
 });
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});await rm('.test-events.mjs',{force:true});}
