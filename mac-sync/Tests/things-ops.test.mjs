import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../Resources/things-ops.js',import.meta.url),'utf8');
// Synthetic dictionary bridge only. These tests do not establish that JXA's
// command/property spellings work against the real Things dictionary.
function fixture(){
 const state={name:'Before',notes:'Old',dueDate:null,activationDate:null,status:'open',area:null,project:null,tags:[]};
 const writes=[],membership={TMInboxListSource:true};
 const obj={id:()=> 'Real1'};
 for(const key of Object.keys(state))Object.defineProperty(obj,key,{get:()=>()=>state[key],set:v=>{state[key]=v;writes.push(key);}});
 Object.defineProperty(obj,'tagNames',{set:v=>{state.tags=v?v.split(',').map(name=>({name:()=>name})):[];writes.push('tags');}});
 const app={running:()=>true,toDos:{byId:()=>obj},projects:{byId:id=>id==='Real1'?obj:{id:()=>id}},areas:{byId:id=>({id:()=>id})},
 lists:{byId:id=>({id:()=>id,toDos:()=>membership[id]?[obj]:[]})},
 make:args=>{writes.push('make');Object.assign(state,args.withProperties);return obj;},
 move:(o,{to})=>{writes.push('move');for(const k of Object.keys(membership))membership[k]=false;membership[to.id()]=true;},
 schedule:(o,args)=>{writes.push('schedule');state.activationDate=args.for;},delete:()=>{writes.push('delete');membership.TMTrashListSource=true;}};
 function run(p){
  const input=JSON.stringify({payload:{version:4,protocol:'things_ops_v1',kind:'todo',target:'Real1',op:'update',v4_action:'read',...p},app_path:'/SYNTHETIC.app',allow_write:true});
  const context=vm.createContext({Application:()=>app,ObjC:{import(){},unwrap:x=>x},$:{NSFileHandle:{fileHandleWithStandardInput:{readDataToEndOfFile:input}},NSString:{alloc:{initWithDataEncoding:x=>x}},NSUTF8StringEncoding:4}});
  vm.runInContext(source,context);return JSON.parse(context.run());
 }
 return {run,writes,state,membership,app};
}
test('fixed dictionary setters preserve text as literal data and read back names and cleared deadline',()=>{
 const f=fixture(),title='"; delete everything; //';
 f.run({v4_action:'write',fields:{title,notes:'line 1\nline 2',tags:['Home','Errand'],deadline:null}});
 const fields=f.run({}).fields;
 assert.equal(fields.title.value,title);assert.equal(fields.notes.value,'line 1\nline 2');
 assert.deepEqual(fields.tags.value,['Home','Errand']);assert.deepEqual(fields.deadline,{state:'absent'});
});
test('unsupported fields are refused before a create or partial update',()=>{
 for(const fields of [{title:'New',checklist:[]},{title:'New',when:'evening'}]){
  const f=fixture();assert.equal(f.run({op:'create',v4_action:'write',fields}).reason,'unsupported_by_things');assert.equal(f.writes.length,0);
 }
 const f=fixture();assert.equal(f.run({v4_action:'write',container:{type:'heading',project:'p',title:'Later'}}).reason,'container_unavailable');assert.equal(f.writes.length,0);
});
test('create returns the ID before any following setters; finishing never calls make again',()=>{
 const f=fixture(),p={op:'create',fields:{title:'New',when:'someday'},container:{type:'project',id:'project1'}};
 assert.equal(f.run({...p,v4_action:'write'}).created_id,'Real1');assert.deepEqual(f.writes,['make']);
 f.run({...p,created_id:'Real1',v4_action:'finish_create'});
 assert.equal(f.writes.filter(x=>x==='make').length,1);
 assert.equal(f.run({}).fields.project_id.value,'project1');assert.equal(f.run({}).fields.when.value,'someday');
});
test('missing destination is detected before creating anything',()=>{
 const f=fixture();f.app.areas.byId=()=>{throw Error('missing');};
 assert.equal(f.run({op:'create',v4_action:'write',fields:{title:'New'},container:{type:'area',id:'absent'}}).reason,'container_unavailable');assert.equal(f.writes.length,0);
});
test('date scheduling uses schedule rather than setting activation date',()=>{
 const f=fixture();f.run({v4_action:'write',fields:{when:'2026-11-06'}});
 assert.deepEqual(f.writes,['schedule']);assert.equal(f.run({}).fields.when.value,'2026-11-06');
});
test('status, Trash and restore use fixed commands and membership read-back',()=>{
 const f=fixture();f.run({op:'set_status',v4_action:'write',status:'canceled'});assert.equal(f.run({}).fields.status.value,'canceled');
 f.run({op:'trash',v4_action:'write'});assert.equal(f.run({op:'trash'}).fields.in_trash_list.value,true);
 f.run({op:'restore',v4_action:'write'});assert.equal(f.run({}).fields.in_trash_list.value,false);
 assert.ok(f.writes.includes('delete'));assert.ok(f.writes.includes('move'));
});
test('restore refusal is explicitly unsupported, never a success',()=>{
 const f=fixture();f.membership.TMTrashListSource=true;f.app.move=()=>{throw Error('no put back');};
 assert.equal(f.run({op:'restore',v4_action:'write'}).reason,'unsupported_by_things');
});
test('a changed before image prevents a setter after Swift policy evaluation',()=>{
 const f=fixture();const expected={title:{state:'value',value:'Before'}};f.state.name='Local edit';
 const result=f.run({v4_action:'write',fields:{title:'Cloud'},expected_before:expected,conflict_policy:'things_wins'});
 assert.deepEqual(result,{state:'skipped',reason:'things_changed'});assert.equal(f.writes.length,0);
});
