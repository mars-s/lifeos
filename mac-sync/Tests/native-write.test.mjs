import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const script=await readFile(new URL('../Resources/native-write.js',import.meta.url),'utf8');
function apply({field='title',base='Original',desired='Cloud',current='Original',trash=false,failAfter=false,policy='things_wins',missing=false,recovering=false,intent='explicit_set',prepare=false,prepared,baseFields,diverged=false}={}){
 let value=current,writes=0;
 const obj={id:()=> 'fixture'};
 for(const key of ['name','status'])Object.defineProperty(obj,key,{get:()=>()=>value,set:v=>{value=v;writes++;if(failAfter)throw Error('lost outcome');}});
 const lookup=()=>{if(missing)throw Error('absent target');return obj;};
 const app={running:()=>true,toDos:{byId:lookup},projects:{byId:lookup},lists:{byId:()=>({toDos:()=>trash?[obj]:[]})},delete:()=>{trash=true;writes++;if(failAfter)throw Error('lost outcome');}};
 const req=JSON.stringify({allow_write:true,app_path:'SYNTHETIC.app',payload:{version:policy==='smart_merge_v1'?3:2,intent_kind:intent,prepare_only:prepare,prepared_decision:prepared,base_fields:baseFields,recorded_divergence:diverged,recovering,target:'fixture',kind:'todo',field,value:desired,base:{state:'value',value:base},conflict_policy:policy}});
 const context=vm.createContext({Application:()=>app,ObjC:{import(){},unwrap:x=>x},$:{NSFileHandle:{fileHandleWithStandardInput:{readDataToEndOfFile:req}},NSString:{alloc:{initWithDataEncoding:x=>x}},NSUTF8StringEncoding:4}});
 vm.runInContext(script,context);const result=JSON.parse(context.run());return {result,writes,value};
}
test('title and completion use public setters with a fresh base check',()=>{
 assert.equal(apply().result.state,'applied');
 const completed=apply({field:'status',base:'open',current:'open',desired:'completed'});assert.equal(completed.value,'completed');assert.equal(completed.writes,1);
});
test('versioned cloud wins converges after local edits and reports immutable audit cells',()=>{
 const result=apply({current:'Local',policy:'cloud_wins'});
 assert.equal(result.writes,1);
 assert.deepEqual(result.result,{state:'applied',observed_before:{state:'value',value:'Local'},verified_after:{state:'value',value:'Cloud'}});
 const retry=apply({current:'Cloud',policy:'cloud_wins'});
 assert.equal(retry.writes,0);assert.equal(retry.result.state,'satisfied');
});
test('Trash membership is checked before resolving a vanished target',()=>{
 const r=apply({field:'in_trash_list',base:false,desired:true,trash:true,missing:true,policy:'cloud_wins'});
 assert.equal(r.result.state,'satisfied');assert.equal(r.writes,0);
});
test('interrupted deletion only verifies membership and never repeats delete',()=>{
 const r=apply({field:'in_trash_list',base:false,desired:true,policy:'cloud_wins',recovering:true});
 assert.equal(r.result.state,'uncertain');assert.equal(r.result.reason,'interrupted_delete');assert.equal(r.writes,0);
});
test('Things wins same-field conflicts without writes',()=>{
 const r=apply({current:'Local'});assert.deepEqual(r.result,{state:'skipped',reason:'things_changed'});assert.equal(r.writes,0);
});
test('already desired and trashed targets cause no duplicate writes',()=>{
 assert.equal(apply({current:'Cloud'}).result.state,'satisfied');assert.equal(apply({current:'Cloud'}).writes,0);
 assert.equal(apply({trash:true}).result.reason,'target_unavailable');assert.equal(apply({trash:true}).writes,0);
});
test('ambiguous setter failures are uncertain and titles remain literal data',()=>{
 assert.equal(apply({failAfter:true}).result.state,'uncertain');
 const title='"; throw Error("not code");';assert.equal(apply({desired:title}).value,title);
});
test('deletion moves to Trash, verifies membership and never repeats a satisfied deletion',()=>{
 const request={field:'in_trash_list',base:false,desired:true};
 assert.deepEqual(apply(request).result,{state:'applied'});
 assert.equal(apply(request).writes,1);
 assert.deepEqual(apply({...request,trash:true}).result,{state:'satisfied'});
 assert.equal(apply({...request,trash:true}).writes,0);
 assert.equal(apply({...request,failAfter:true}).result.state,'uncertain');
 assert.throws(()=>apply({...request,desired:false}),/unsupported typed operation/);
});
test('smart preparation archives the competing local title before a guarded public setter',()=>{
 const request={policy:'smart_merge_v1',current:'Local',prepare:true};
 const before=apply(request);assert.equal(before.writes,0);assert.equal(before.result.merge_decision.classification,'cloud_fallback');
 const after=apply({...request,prepare:false,prepared:before.result.merge_decision});
 assert.equal(after.writes,1);assert.equal(after.value,'Cloud');assert.equal(after.result.merge_decision.local.value,'Local');
 assert.equal(apply({...request,prepare:false,current:'Changed',prepared:before.result.merge_decision}).writes,0);
});
test('explicit reaffirmation writes while a derived no-op preserves the current title',()=>{
 const request={policy:'smart_merge_v1',base:'Original',desired:'Original',current:'Local'};
 const explicit=apply({...request,prepare:true});
 assert.equal(apply({...request,prepared:explicit.result.merge_decision}).writes,1);
 const derived=apply({...request,intent:'derived_patch',prepare:true});
 assert.equal(derived.result.merge_decision.classification,'no_change');
 assert.equal(apply({...request,intent:'derived_patch',prepared:derived.result.merge_decision}).writes,0);
});
test('smart ambiguous recovery never repeats a setter even when current equals the original base',()=>{
 const result=apply({policy:'smart_merge_v1',recovering:true});
 assert.equal(result.writes,0);assert.equal(result.result.state,'uncertain');assert.equal(result.result.reason,'interrupted_write');
 const same=apply({policy:'smart_merge_v1',recovering:true,current:'Cloud'});assert.equal(same.writes,0);assert.equal(same.result.state,'satisfied');
});
test('smart Trash compares supported semantic fields and preserves the observed alternatives',()=>{
 const baseFields={title:{state:'value',value:'Original'},status:{state:'value',value:'Original'}};
 const request={policy:'smart_merge_v1',field:'in_trash_list',base:false,desired:true,prepare:true,baseFields};
 assert.equal(apply(request).result.merge_decision.classification,'cloud_only');
 const conflict=apply({...request,current:'Local'});assert.equal(conflict.result.merge_decision.classification,'delete_edit_cloud_fallback');
 assert.equal(conflict.result.merge_decision.observed_fields.title.value,'Local');assert.equal(conflict.writes,0);
 assert.equal(apply({...request,diverged:true}).result.merge_decision.classification,'delete_edit_cloud_fallback');
 assert.equal(apply({...request,baseFields:undefined}).result.merge_decision.classification,'delete_edit_cloud_fallback');
});
