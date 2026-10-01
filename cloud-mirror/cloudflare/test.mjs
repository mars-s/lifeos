import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
await build({entryPoints:['worker.ts'],outfile:'.test-worker.mjs',bundle:true,platform:'node',format:'esm'});
await build({entryPoints:['d1-bulk.ts','../site/tests/entry.ts'],outdir:'.test-build',outbase:'..',bundle:true,platform:'node',format:'esm'});
const {fingerprint,MirrorStore}=await import('./.test-build/site/tests/entry.js');
const {BulkD1}=await import('./.test-build/cloudflare/d1-bulk.js');
const dir=await mkdtemp(join(tmpdir(),'lifeos-worker-fixture-'));
const sync='SYNTHETIC-sync-fixture-only-at-least-32-characters',read='SYNTHETIC-read-fixture-only-at-least-32-characters';
const hash=k=>createHash('sha256').update(k).digest('hex');
const options={modules:true,script:await readFile('.test-worker.mjs','utf8'),compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'fixture'},d1Persist:dir,bindings:{LIFEOS_OWNER_ID:'fixed-owner',LIFEOS_ADAPTER_ID:'fixture-mac',LIFEOS_SYNC_KEY_SHA256:hash(sync),LIFEOS_READ_KEY_SHA256:hash(read)}};
const make=()=>new Miniflare({...convertV4MiniflareOptions(options),resourcePersistencePath:dir});
let mf=make(),db=await mf.getD1Database('DB');
const lists=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
const item=(id,title=id,kind='todo')=>({id,kind,fields:{title:{state:'value',value:title},notes:{state:'value',value:'Synthetic fixture'},recurrence:{state:'unsupported'},opaque_future:{state:'value',value:{retain:true}}}});
async function request(path,body,key=sync,extra={}){return mf.dispatchFetch('https://fixture.test'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(path.startsWith('/api/sync/')?{'X-LifeOS-Sync-Key':key}:{'Authorization':'Bearer '+key}),...extra},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});}
async function begin(sequence,pages,overrides={}) {
 const manifest={observed_at:'2026-09-30T00:00:00Z',zone:'Australia/Melbourne',scopes:['todo','project','area','tag'],count:pages.flat().length,page_hashes:await Promise.all(pages.map(fingerprint)),coverage:'public-top-level-and-all-lists-v2',coverage_evidence:{consistent_passes:2,classified_records:pages.flat().filter(i=>['todo','project'].includes(i.kind)).length,list_ids:lists},...overrides};
 return request('/api/sync/begin',{sequence,manifest});
}
async function stage(sequence,pages) {assert.equal((await begin(sequence,pages)).status,200);for(let page=0;page<pages.length;page++)assert.equal((await request('/api/sync/page',{sequence,page,items:pages[page]})).status,200);}
async function state(cursor=0){const r=await request('/state?cursor='+cursor,undefined,read);assert.equal(r.status,200);return r.json();}
try {
 for(const migration of ['0000_equal_spyke.sql','0001_hard_katie_power.sql'])await db.batch((await readFile('../site/drizzle/'+migration,'utf8')).split('--> statement-breakpoint').map(s=>db.prepare(s.trim())));
 await test('Workers read-only gateway on real local D1',async t=>{
  await t.test('unauthorized and spoofed Sites identity denied',async()=>{
   assert.equal((await request('/health',undefined,'')).status,200);
   assert.equal((await request('/state',undefined,'',{'oai-authenticated-user-id':'fixed-owner','oai-authenticated-user-email':'fixture@example.test'})).status,401);
   assert.equal((await request('/api/sync/begin',{},read)).status,401);
   for(const action of ['approve','reject','propose','claim','ack','pending','exec'])assert.equal((await request('/api/sync/'+action,{})).status,403);
  });
  await t.test('205-record complete inventory, cursor paging and persisted restart',async()=>{
   const items=Array.from({length:205},(_,n)=>item(String(n).padStart(3,'0'))),pages=[items.slice(0,100),items.slice(100,200),items.slice(200)];
   await stage(1,pages);assert.equal((await request('/api/sync/commit',{sequence:1})).status,200);
   const a=await state(),b=await state(a.next_cursor),c=await state(b.next_cursor);assert.deepEqual([a.confirmed.length,b.confirmed.length,c.confirmed.length],[100,100,5]);assert.equal(c.next_cursor,null);assert.equal(a.total_items,205);
   await mf.dispose();mf=make();db=await mf.getD1Database('DB');assert.equal((await state()).sequence,1);
   const duplicate=await request('/api/sync/commit',{sequence:1});assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
  });
  await t.test('incomplete coverage and missing page cannot tombstone confirmed inventory',async()=>{
   assert.equal((await begin(2,[[item('x')]],{coverage_evidence:{consistent_passes:2,classified_records:1,list_ids:lists.slice(0,6)}})).status,409);
   const pages=[[item('000')],[item('new')]];assert.equal((await begin(2,pages)).status,200);assert.equal((await request('/api/sync/page',{sequence:2,page:0,items:pages[0]})).status,200);assert.equal((await request('/api/sync/commit',{sequence:2})).status,409);assert.equal((await state()).sequence,1);assert.equal((await state()).total_items,205);
  });
  await t.test('atomic tombstones, unknown preservation and journal continuity',async()=>{
   const s=new MirrorStore(new BulkD1(db),'fixed-owner'),base=(await state()).confirmed[0].fields.title.revision;
   const op=await s.propose({id:'pending-fixture',target:'000',fields:{title:'Proposal only'},base_revisions:{title:base},zone:'Australia/Melbourne'});await s.decide(op.id,op.revision,true);
   const pages=[[{id:'000',kind:'todo',fields:{title:{state:'unknown'},notes:{state:'absent'},recurrence:{state:'unsupported'}}}],[item('new')]];
   // Sequence2 already has immutable different page content; start a new sequence.
   await stage(3,pages);assert.equal((await request('/api/sync/commit',{sequence:3})).status,200);const v=await state();assert.equal(v.sequence,3);assert.equal(v.confirmed.find(i=>i.id==='000').fields.title.last_known.value,'000');assert.deepEqual(v.confirmed.find(i=>i.id==='000').fields.opaque_future.value,{retain:true});assert.equal(v.confirmed.find(i=>i.id==='001').deleted,1);assert.equal(v.pending_overlay.length,1);assert.equal(v.pending_overlay[0].fields.title,'Proposal only');
  });
  await t.test('replay mutation, stale snapshots and oversized streams rejected',async()=>{
   assert.equal((await begin(3,[[item('different')]])).status,409);
   assert.equal((await begin(1,[[item('old')]])).status,409);
   assert.equal((await request('/api/sync/begin',' '.repeat(256*1024+1))).status,413);
   assert.equal((await state()).sequence,3);
  });
  await t.test('transport retention keeps retry receipts and operation audit',async()=>{
   await stage(4,[[]]);assert.equal((await request('/api/sync/commit',{sequence:4})).status,200);
   const uploads=await db.prepare('SELECT sequence FROM mirror_uploads WHERE owner=? AND committed=1 ORDER BY sequence').bind('fixed-owner').all();assert.deepEqual(uploads.results.map(r=>r.sequence),[3,4]);
   assert.equal((await db.prepare('SELECT count(*) AS n FROM mirror_pages WHERE owner=? AND sequence=1').bind('fixed-owner').first()).n,0);
   assert.equal((await state()).pending_overlay.length,1);
   assert.ok((await db.prepare('SELECT count(*) AS n FROM audit WHERE owner=?').bind('fixed-owner').first()).n>0);
  });
  await t.test('failed bulk transaction rolls back every field update',async()=>{
   const s=new MirrorStore(new BulkD1(db),'fixed-owner');
   await assert.rejects(()=>new BulkD1(db).batch([
    s.stmt('INSERT INTO mirror_items SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT sequence FROM mirror_meta WHERE owner=?),0)=? ON CONFLICT(owner,id) DO UPDATE SET fields=excluded.fields,deleted=0,observed_at=excluded.observed_at','fixed-owner','rollback-new','todo','{}',0,'2026-09-30T00:00:00Z','fixed-owner',4),
    s.stmt('INSERT INTO table_that_does_not_exist VALUES(1)')
   ]));assert.equal(await db.prepare('SELECT * FROM mirror_items WHERE owner=? AND id=?').bind('fixed-owner','rollback-new').first(),null);assert.equal((await state()).sequence,4);
  });
  await t.test('bulk commit remains below50 queries and concurrent guards hold',async()=>{
   let count=0;const counted={prepare(sql){const native=db.prepare(sql);function wrap(s){return{bind(...a){return wrap(s.bind(...a));},first(...a){count++;return s.first(...a);},all(...a){count++;return s.all(...a);},run(...a){count++;return s.run(...a);},raw(...a){count++;return s.raw(...a);},native:s};}return wrap(native);},batch(ss){count+=ss.length;return db.batch(ss.map(s=>s.native??s));}};
   const bulk=new BulkD1(counted),s=new MirrorStore(bulk,'budget-owner');
   const items=Array.from({length:500},(_,n)=>item('b'+n)),pages=Array.from({length:5},(_,n)=>items.slice(n*100,(n+1)*100));
   async function upload(seq,title){const ps=pages.map(p=>p.map(i=>({...i,fields:{...i.fields,title:{state:'value',value:title}}})));await s.begin({sequence:seq,manifest:{observed_at:'2026-09-30T00:00:00Z',zone:'UTC',scopes:['todo'],count:500,page_hashes:await Promise.all(ps.map(fingerprint)),coverage:'fixture'}});for(let n=0;n<5;n++)await s.page({sequence:seq,page:n,items:ps[n]});}
   await upload(1,'A');count=0;await s.commit(1);assert.ok(count<50,'query count '+count);const firstCount=count;
   await upload(2,'B');await upload(3,'C');await Promise.allSettled([s.commit(2),s.commit(3)]);const v=await s.state();assert.ok([2,3].includes(v.sequence));assert.ok(v.confirmed.every(i=>i.fields.title.value===(v.sequence===3?'C':'B')));console.log('500-record commit query count:',firstCount);
  });
 });
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});await rm('.test-build',{recursive:true,force:true});await rm('.test-worker.mjs',{force:true});}
