import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
await build({entryPoints:['tests/entry.ts'],outfile:'tests/.generated.mjs',bundle:true,platform:'node',format:'esm'});
const {DemoStore,demoAPI}=await import('./.generated.mjs');
const sql=await readFile('drizzle/0000_equal_spyke.sql','utf8');
const dir=await mkdtemp(join(tmpdir(),'lifeos-site-fixture-'));
const make=()=>new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture only")}}',d1Databases:{DB:'lifeos-synthetic-test'},d1Persist:dir});
let mf=make(),db=await mf.getD1Database('DB');
const input=(id,t,title='Reviewed title')=>({id,target:t.id,title,base_title_rev:t.title_rev,zone:'Europe/London'});
const request=(action,body,owner='fixture-owner')=>new Request('https://demo.test/api/demo/'+action,{method:body===undefined?'GET':'POST',headers:{...(owner?{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':owner+'@example.test'}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
try {
 await db.batch(sql.split('--> statement-breakpoint').map(s=>db.prepare(s.trim())));
 await test('synthetic Worker API with real local D1',async t=>{
  await t.test('anonymous and identity-less service denied',async()=>{
   for(const action of ['state','approve','seed'])assert.equal((await demoAPI(request(action,action==='state'?undefined:{},null),db)).status,401);
   const r=request('approve',{},null);r.headers.set('OAI-Sites-Authorization','Bearer fixture-value-only');assert.equal((await demoAPI(r,db)).status,401);
  });
  await t.test('snapshot seed is idempotent',async()=>{
   const s=new DemoStore(db,'seed');await s.seed();await s.seed();assert.equal((await new DemoStore(db,'seed').state()).confirmed.length,2);
  });
  await t.test('draft never executes and exact approval is required',async()=>{
   const s=new DemoStore(db,'draft');await s.seed();const before=(await s.state()).confirmed[0],op=await s.propose(input('draft-1',before));await s.reconnect();assert.equal((await s.get(op.id)).state,'draft');assert.equal((await s.state()).confirmed[0].title,before.title);await assert.rejects(()=>s.decide(op.id,'wrong',true));
  });
  await t.test('pending overlay then applied once with before/after audit',async()=>{
   const s=new DemoStore(db,'apply');await s.seed();const before=(await s.state()).confirmed[0],op=await s.propose(input('apply-1',before));await s.decide(op.id,op.revision,true);await s.decide(op.id,op.revision,true);assert.equal((await s.state()).confirmed[0].title,before.title);assert.equal((await s.get(op.id)).state,'queued');await s.reconnect();const state=await s.state();assert.equal((await s.get(op.id)).state,'applied');assert.equal(state.confirmed[0].title,'Reviewed title');assert.equal(state.audit_count,3);await s.reconnect();assert.equal((await s.state()).confirmed[0].title_rev,state.confirmed[0].title_rev);assert.equal((await s.state()).audit_count,3);
  });
  await t.test('duplicate proposal stable; changed payload denied',async()=>{
   const s=new DemoStore(db,'duplicate');await s.seed();const body=input('same',(await s.state()).confirmed[0]),op=await s.propose(body);assert.equal((await s.propose(body)).revision,op.revision);await assert.rejects(()=>s.propose({...body,title:'Changed payload'}));
  });
  await t.test('same-field mock conflict preserves new title',async()=>{
   const s=new DemoStore(db,'conflict');await s.seed();const task=(await s.state()).confirmed[0],op=await s.propose(input('conflict-1',task));await s.decide(op.id,op.revision,true);await s.conflict(task.id);await s.reconnect();assert.equal((await s.get(op.id)).state,'conflict');assert.match((await s.state()).confirmed[0].title,/changed on mock iPhone/);
  });
  await t.test('unrelated source notes survive title patch',async()=>{
   const s=new DemoStore(db,'unrelated');await s.seed();const task=(await s.state()).confirmed[0],op=await s.propose(input('notes-1',task));await s.decide(op.id,op.revision,true);await db.prepare("UPDATE mock_tasks SET notes='New mock notes' WHERE owner=? AND id=?").bind('unrelated',task.id).run();await s.reconnect();assert.equal((await s.get(op.id)).state,'applied');assert.equal((await s.state()).confirmed[0].notes,'New mock notes');
  });
  await t.test('reject stays final',async()=>{
   const s=new DemoStore(db,'reject');await s.seed();const task=(await s.state()).confirmed[0],op=await s.propose(input('reject-1',task));await s.decide(op.id,op.revision,false);await assert.rejects(()=>s.decide(op.id,op.revision,true));await s.reconnect();assert.equal((await s.get(op.id)).state,'rejected');assert.equal((await s.state()).confirmed[0].title,task.title);
  });
  await t.test('cross-owner data and approval denied',async()=>{
   const s=new DemoStore(db,'a');await s.seed();const op=await s.propose(input('isolated',(await s.state()).confirmed[0])),other=new DemoStore(db,'b');assert.equal((await other.state()).operations.length,0);await assert.rejects(()=>other.decide(op.id,op.revision,true));assert.equal((await demoAPI(request('approve',{id:op.id,revision:op.revision},'b'),db)).status,404);
  });
  await t.test('cross-origin requests denied; command endpoint absent',async()=>{
   const r=request('seed',{});r.headers.set('origin','https://attacker.test');assert.equal((await demoAPI(r,db)).status,403);assert.equal((await demoAPI(request('exec',{command:'not executed'}),db)).status,404);
  });
  await t.test('immutable content/audit; D1 batch rollback',async()=>{
   await assert.rejects(()=>db.prepare("UPDATE operations SET content='{}' WHERE owner='apply'").run());await assert.rejects(()=>db.prepare("DELETE FROM audit WHERE owner='apply'").run());const before=await db.prepare("SELECT title FROM mock_tasks WHERE owner='apply' AND id='demo-flight'").first();await assert.rejects(()=>db.batch([db.prepare("UPDATE mock_tasks SET title='should roll back' WHERE owner='apply' AND id='demo-flight'"),db.prepare("DELETE FROM audit WHERE owner='apply'")]));assert.deepEqual(await db.prepare("SELECT title FROM mock_tasks WHERE owner='apply' AND id='demo-flight'").first(),before);
  });
  await t.test('records and audit survive full local runtime restart',async()=>{
   const before=await new DemoStore(db,'apply').state();await mf.dispose();mf=make();db=await mf.getD1Database('DB');const after=await new DemoStore(db,'apply').state();assert.deepEqual(after.confirmed,before.confirmed);assert.deepEqual(after.operations,before.operations);assert.equal(after.audit_count,before.audit_count);
  });
 });
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
