import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
await build({entryPoints:['tests/entry.ts'],outfile:'tests/.mirror-generated.mjs',bundle:true,platform:'node',format:'esm'});
const {MirrorStore,mirrorAPI,fingerprint}=await import('./.mirror-generated.mjs');
const dir=await mkdtemp(join(tmpdir(),'lifeos-mirror-fixture-'));
const make=()=>new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture only")}}',d1Databases:{DB:'mirror-fixture'},d1Persist:dir});
let mf=make(),db=await mf.getD1Database('DB');
const value=v=>({state:'value',value:v});
const item=(id='task',title='Original',kind='todo')=>({id,kind,fields:{title:value(title),notes:value('Fixture only'),recurrence:{state:'unsupported'},future_vendor_field:value({opaque:42})}});
async function stage(store,seq,pages,scopes=['todo']) {
 const manifest={observed_at:'2026-09-30T00:00:00+00:00',zone:'Europe/London',scopes,count:pages.flat().length,page_hashes:await Promise.all(pages.map(fingerprint)),coverage:'fixture-public-collections'};
 await store.begin({sequence:seq,manifest});for(let n=0;n<pages.length;n++)await store.page({sequence:seq,page:n,items:pages[n]});return manifest;
}
async function upload(store,seq,items=[item()],scopes=['todo']) {await stage(store,seq,[items],scopes);await store.commit(seq);}
async function propose(store,id='op',fields={title:'Proposed'},planning=false) {
 const state=await store.state(),task=state.confirmed[0],key=Object.keys(fields)[0];
 return store.propose({id,target:task.id,fields,base_revisions:planning?{}:{[key]:task.fields[key].revision},zone:'Europe/London',...(planning?{planning:true,plan_revision:state.plans.find(p=>p.id===task.id)?.revision??0}:{})});
}
const key='public-fixture-sync-key-at-least-32-characters';
const keyHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const config={enabled:'true',owner:'service-owner',adapter:'single-fixture-mac',keyHash};
function req(action,body,service=false,identity=true) {return new Request('https://fixture.test/api/'+(service?'sync':'mirror')+'/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...service?{'X-LifeOS-Sync-Key':key}:identity?{'oai-authenticated-user-id':'browser-owner','oai-authenticated-user-email':'owner@example.test'}:{}},body:body===undefined?undefined:JSON.stringify(body)});}
try {
 for(const migration of ['0000_equal_spyke.sql','0001_hard_katie_power.sql'])await db.batch((await readFile('drizzle/'+migration,'utf8')).split('--> statement-breakpoint').map(s=>db.prepare(s.trim())));
 await test('generic mirror using real local D1',async t=>{
  await t.test('partial pages do not replace confirmed snapshot',async()=>{
   const s=new MirrorStore(db,'pages');await upload(s,1);const pages=[[item('a')],[item('b')]],m={observed_at:'2026-09-30T00:00:01Z',zone:'UTC',scopes:['todo'],count:2,page_hashes:await Promise.all(pages.map(fingerprint)),coverage:'fixture'};
   await s.begin({sequence:2,manifest:m});await s.page({sequence:2,page:0,items:pages[0]});await assert.rejects(()=>s.commit(2));assert.equal((await s.state()).confirmed[0].id,'task');await s.page({sequence:2,page:1,items:pages[1]});await s.commit(2);assert.equal((await s.state()).confirmed.filter(i=>!i.deleted).length,2);assert.equal((await s.state()).confirmed.find(i=>i.id==='task').deleted,1);
  });
  await t.test('duplicate complete upload replay and altered manifest denied',async()=>{
   const s=new MirrorStore(db,'replay');await upload(s,1);assert.equal((await s.commit(1)).duplicate,true);await stage(s,1,[[item()]]);await assert.rejects(()=>stage(s,1,[[item('task','Different')]]));await upload(s,2);await assert.rejects(()=>stage(s,1,[[item()]]));
  });
  await t.test('owner snapshot paging exposes all records and explicit cursors',async()=>{
   const s=new MirrorStore(db,'owner-pages'),items=Array.from({length:205},(_,n)=>item(String(n).padStart(3,'0')));await stage(s,1,[items.slice(0,100),items.slice(100,200),items.slice(200)]);await s.commit(1);const a=await s.state(),b=await s.state(a.next_cursor),c=await s.state(b.next_cursor);assert.deepEqual([a.confirmed.length,b.confirmed.length,c.confirmed.length],[100,100,5]);assert.equal(c.next_cursor,null);assert.equal(a.total_items,205);assert.equal(new Set([...a.confirmed,...b.confirmed,...c.confirmed].map(i=>i.id)).size,205);
  });
  await t.test('unknown, unsupported and omitted fields preserve prior data',async()=>{
   const s=new MirrorStore(db,'unknown');await upload(s,1);await upload(s,2,[{id:'task',kind:'todo',fields:{title:{state:'unknown'},notes:{state:'absent'},checklist:{state:'unsupported'}}}]);const task=(await s.state()).confirmed[0];assert.deepEqual(task.fields.title.last_known,value('Original'));assert.equal(task.fields.notes.state,'absent');assert.deepEqual(task.fields.future_vendor_field.value,{opaque:42});assert.equal(task.fields.checklist.state,'unsupported');await assert.rejects(()=>propose(s));
  });
  await t.test('empty string is a value; ABA and unsupported field edits rejected',async()=>{
   const s=new MirrorStore(db,'revision');await upload(s,1,[item('task','')]);const initial=(await s.state()).confirmed[0];await upload(s,2,[item('task','Changed')]);await upload(s,3,[item('task','')]);assert.equal((await s.state()).confirmed[0].fields.title.revision,3);await assert.rejects(()=>s.propose({id:'stale',target:'task',fields:{title:'New'},base_revisions:{title:initial.fields.title.revision},zone:'UTC'}));await assert.rejects(()=>propose(s,'check',{recurrence:'weekly'}));
  });
  await t.test('missing complete scope creates tombstone without deleting other scopes',async()=>{
   const s=new MirrorStore(db,'scope');await upload(s,1,[item('task'),item('area','Area','area')],['todo','area']);await upload(s,2,[],['todo']);const state=await s.state();assert.equal(state.confirmed.find(i=>i.id==='task').deleted,1);assert.equal(state.confirmed.find(i=>i.id==='area').deleted,0);
  });
  await t.test('proposal exact approval and pending overlay separate from confirmation',async()=>{
   const s=new MirrorStore(db,'workflow');await upload(s,1);const op=await propose(s);assert.equal((await s.pending()).length,0);await assert.rejects(()=>s.decide(op.id,'wrong',true));await s.decide(op.id,op.revision,true);await s.decide(op.id,op.revision,true);let state=await s.state();assert.equal(state.confirmed[0].fields.title.value,'Original');assert.equal(state.pending_overlay[0].fields.title,'Proposed');await s.claim(op.id,'claim');await assert.rejects(()=>s.claim(op.id,'other'));await s.ack(op.id,'claim',{state:'conflict',before:'new iPhone value'});assert.equal((await s.get(op.id)).state,'conflict');assert.equal((await s.state()).confirmed[0].fields.title.value,'Original');
  });
  await t.test('idempotent proposal, immutable final receipt and audit',async()=>{
   const s=new MirrorStore(db,'idem');await upload(s,1);const op=await propose(s);assert.equal((await propose(s)).revision,op.revision);await assert.rejects(()=>propose(s,'op',{title:'Different'}));await s.decide(op.id,op.revision,true);await s.claim(op.id,'claim');const result={state:'applied',before:'Original',after:'Proposed'};await s.ack(op.id,'claim',result);await s.ack(op.id,'claim',result);await assert.rejects(()=>s.ack(op.id,'claim',{state:'uncertain'}));await assert.rejects(()=>db.prepare("UPDATE mirror_operations SET content='{}' WHERE owner='idem'").run());await assert.rejects(()=>db.prepare("DELETE FROM audit WHERE owner='idem'").run());assert.equal((await db.prepare("SELECT count(*) AS n FROM audit WHERE owner='idem'").first()).n,4);
  });
  await t.test('partial batch outcomes and ambiguous operation are independent',async()=>{
   const s=new MirrorStore(db,'batch');await upload(s,1);const a=await propose(s,'a'),b=await propose(s,'b',{notes:'Edited notes'});for(const op of [a,b]){await s.decide(op.id,op.revision,true);await s.claim(op.id,'claim-'+op.id);}await s.ack('a','claim-a',{state:'applied'});await s.ack('b','claim-b',{state:'uncertain'});const state=await s.state();assert.deepEqual(state.operations.map(o=>o.state).sort(),['applied','uncertain']);assert.equal(state.pending_overlay.length,1);
  });
  await t.test('cloud planning priority never enters Mac pending queue',async()=>{
   const s=new MirrorStore(db,'priority');await upload(s,1);let op=await propose(s,'plan',{planning_priority:'focus'},true);await s.decide(op.id,op.revision,true);await s.decide(op.id,op.revision,true);assert.equal((await s.state()).plans[0].revision,1);assert.equal((await s.state()).plans[0].priority,'focus');op=await propose(s,'plan2',{planning_priority:'later'},true);await s.decide(op.id,op.revision,true);assert.equal((await s.state()).plans[0].revision,2);assert.equal((await s.pending()).length,0);assert.equal((await s.state()).confirmed[0].fields.planning_priority,undefined);
  });
  await t.test('owner isolation and rejected proposal cannot run',async()=>{
   const s=new MirrorStore(db,'reject');await upload(s,1);const op=await propose(s);const other=new MirrorStore(db,'not-owner');await assert.rejects(()=>other.decide(op.id,op.revision,true));assert.equal((await other.state()).confirmed.length,0);await s.decide(op.id,op.revision,false);await assert.rejects(()=>s.decide(op.id,op.revision,true));assert.equal((await s.pending()).length,0);
  });
  await t.test('service disabled by default; bypass alone and wrong scope denied',async()=>{
   assert.equal((await mirrorAPI(req('pending',undefined,true),db,{})).status,503);const bad=req('pending',undefined,true);bad.headers.delete('X-LifeOS-Sync-Key');bad.headers.set('OAI-Sites-Authorization','Bearer public-fixture');assert.equal((await mirrorAPI(bad,db,config)).status,401);for(const action of ['approve','reject','state','propose','exec'])assert.equal((await mirrorAPI(req(action,{},true),db,config)).status,403);assert.equal((await mirrorAPI(req('state',undefined,false,false),db)).status,401);
  });
  await t.test('service binding ignores body owner; owner browser cannot upload',async()=>{
   const fixture=new MirrorStore(db,'manifest-helper');const manifest=await stage(fixture,1,[[item()]]);const request=req('begin',{sequence:1,manifest,owner:'victim'},true);assert.equal((await mirrorAPI(request,db,config)).status,200);assert.ok(await db.prepare("SELECT 1 FROM mirror_uploads WHERE owner='service-owner'").first());assert.equal(await db.prepare("SELECT 1 FROM mirror_uploads WHERE owner='victim'").first(),null);assert.equal((await mirrorAPI(req('begin',{sequence:1,manifest}),db)).status,404);
  });
  await t.test('concurrent commits cannot regress field revisions or snapshots',async()=>{
   const s=new MirrorStore(db,'concurrent');await upload(s,1);await stage(s,2,[[item('task','second')]]);await stage(s,3,[[item('task','third')]]);await Promise.allSettled([s.commit(2),s.commit(3)]);if((await s.meta()).sequence<3)await s.commit(3);assert.equal((await s.state()).confirmed[0].fields.title.value,'third');if((await s.upload(2)).committed)assert.equal((await s.commit(2)).duplicate,true);else await assert.rejects(()=>s.commit(2));assert.equal((await s.meta()).sequence,3);assert.equal((await s.state()).confirmed[0].fields.title.value,'third');
  });
  await t.test('staged snapshot, operations and cells survive full runtime restart',async()=>{
   const s=new MirrorStore(db,'restart');await upload(s,1);await stage(s,2,[[item('task','After restart')]]);const op=await propose(s);await s.decide(op.id,op.revision,true);await mf.dispose();mf=make();db=await mf.getD1Database('DB');const restored=new MirrorStore(db,'restart');await restored.commit(2);assert.equal((await restored.get(op.id)).state,'queued');assert.equal((await restored.state()).confirmed[0].fields.title.value,'After restart');
  });
 });
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
