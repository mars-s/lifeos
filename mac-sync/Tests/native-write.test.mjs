import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const script=await readFile(new URL('../Resources/native-write.js',import.meta.url),'utf8');
function apply({field='title',base='Original',desired='Cloud',current='Original',trash=false,failAfter=false}={}){
 let value=current,writes=0;
 const obj={id:()=> 'fixture'};
 for(const key of ['name','status'])Object.defineProperty(obj,key,{get:()=>()=>value,set:v=>{value=v;writes++;if(failAfter)throw Error('lost outcome');}});
 const app={running:()=>true,toDos:{byId:()=>obj},projects:{byId:()=>obj},lists:{byId:()=>({toDos:()=>trash?[obj]:[]})},delete:()=>{trash=true;writes++;if(failAfter)throw Error('lost outcome');}};
 const req=JSON.stringify({allow_write:true,app_path:'SYNTHETIC.app',payload:{target:'fixture',kind:'todo',field,value:desired,base:{state:'value',value:base},conflict_policy:'things_wins'}});
 const context=vm.createContext({Application:()=>app,ObjC:{import(){},unwrap:x=>x},$:{NSFileHandle:{fileHandleWithStandardInput:{readDataToEndOfFile:req}},NSString:{alloc:{initWithDataEncoding:x=>x}},NSUTF8StringEncoding:4}});
 vm.runInContext(script,context);const result=JSON.parse(context.run());return {result,writes,value};
}
test('title and completion use public setters with a fresh base check',()=>{
 assert.equal(apply().result.state,'applied');
 const completed=apply({field:'status',base:'open',current:'open',desired:'completed'});assert.equal(completed.value,'completed');assert.equal(completed.writes,1);
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
