import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../lifeos_cache/things_read.js',import.meta.url),'utf8');
const builtin=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
function record(id,title='Fixture') {
  const data={id,name:title,notes:'Synthetic',status:'open',creationDate:null,modificationDate:null,completionDate:null,cancellationDate:null,dueDate:null,activationDate:null,area:null,project:null,parentTag:null};
  const o={tags:()=>[]};for(const key of Object.keys(data))o[key]=()=>data[key];o.data=data;return o;
}
function collection(rows) {const f=()=>rows;f.byId=id=>{const o=rows.find(o=>o.id()===id);if(!o)throw Error('fixture missing');return o;};return f;}
function fixture() {
  const open=record('open'),archived=record('archived'),trash=record('trash'),project=record('project'),child=record('child');
  const all=[open,archived,trash,project,child];
  const app={running:()=>true,toDos:collection([open]),projects:collection([project]),areas:collection([]),tags:collection([])};
  // Stable-ID lookup sees children even when top-level enumeration omits them.
  app.toDos.byId=id=>all.find(o=>o.id()===id);
  const lists=builtin.map(id=>({id:()=>id,toDos:collection(id===builtin[1]||id===builtin[3]?[open]:id===builtin[5]?[archived,project]:id===builtin[6]?[trash]:[])}));
  app.lists=()=>lists;
  return {app,lists,all,classes:{open:'todo',archived:'todo',trash:'todo',project:'project',child:'todo'}};
}
function run(f) {
  const input=JSON.stringify({app_path:'/fixture',action:'inventory',classifications:f.classes});
  const context={Application:()=>f.app,ObjC:{import(){},unwrap:x=>x},$:{NSUTF8StringEncoding:4,NSFileHandle:{fileHandleWithStandardInput:{readDataToEndOfFile:input}},NSString:{alloc:{initWithDataEncoding:x=>x}}}};
  vm.createContext(context);vm.runInContext(source,context);
  return JSON.parse(context.run([]));
}
test('union deduplicates overlapping lists, classifies projects, includes hidden child and retains archive/Trash membership',()=>{
  const result=run(fixture());assert.equal(result.items.length,5);
  const byId=Object.fromEntries(result.items.map(x=>[x.id,x]));
  assert.equal(byId.project.kind,'project');assert.equal(byId.child.kind,'todo');
  assert.equal(byId.archived.fields.in_logbook_list.value,true);
  assert.equal(byId.trash.fields.in_trash_list.value,true);
  assert.equal(byId.open.fields.in_trash_list.value,false);
  assert.equal(byId.open.fields.list_memberships.value.length,2);
  assert.equal('deleted' in byId.trash,false);assert.equal(result.coverage_evidence.consistent_passes,2);
});
test('unavailable or missing built-in list aborts instead of partial output',()=>{
  const f=fixture();f.lists.pop();assert.throws(()=>run(f),/built-in list missing/);
  const g=fixture();g.lists[0].toDos=()=>{throw Error('fixture list unreadable');};assert.throws(()=>run(g),/unreadable/);
});
test('unknown class, missing class and stable-ID kind collision abort',()=>{
  for(const kind of ['heading',undefined]){const f=fixture();f.classes.trash=kind;assert.throws(()=>run(f),/classification missing/);}
  const f=fixture();f.app.areas=collection([record('open')]);assert.throws(()=>run(f),/class collision/);
});
test('membership/order drift and title drift invalidate the two-pass snapshot',()=>{
  const f=fixture();let calls=0;f.app.lists=()=>{if(++calls===2)f.lists[5].toDos=collection([]);return f.lists;};assert.throws(()=>run(f),/changed while reading/);
  const g=fixture();let reads=0;g.app.toDos=()=>{if(++reads===2)g.all[0].data.name='Changed';return [g.all[0]];};g.app.toDos.byId=id=>g.all.find(o=>o.id()===id);assert.throws(()=>run(g),/changed while reading/);
});
test('oversized snapshot aborts without truncating',()=>{
  const f=fixture();f.all[0].data.notes='x'.repeat(3*1024*1024);assert.throws(()=>run(f),/safety budget/);
});
test('duplicate stable ID within a single list aborts instead of claiming an ordering',()=>{
  const f=fixture();f.lists[5].toDos=collection([f.all[1],f.all[1]]);assert.throws(()=>run(f),/duplicate stable ID/);
});
