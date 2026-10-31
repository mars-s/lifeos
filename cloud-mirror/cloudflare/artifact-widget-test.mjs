import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';

const html=await readFile('artifact-widget.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function viewer(handler){
 const nodes=new Map(),calls=[],events=new Map();
 const doc={id:randomUUID(),title:'Private synthetic document',visibility:'private'};
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{hidden:id==='sharing',events:{},addEventListener(name,handler){this.events[name]=handler;}});return nodes.get(id);}};
 const openai={toolOutput:{result:doc},toolResponseMetadata:{artifact_markup:'<!doctype html><h1>Private preview</h1>'},async callTool(name,args){calls.push({name,args});return {structuredContent:{result:await handler(name,args)}};}};
 runInNewContext(script,{document,window:{openai},parent:{postMessage(){throw Error('Unexpected fallback bridge');}},addEventListener(name,handler){events.set(name,handler);},crypto:{randomUUID},URL,setTimeout,clearTimeout});
 return {nodes,calls,doc,openai,events,click:async id=>nodes.get(id).events.click()};
}
test('private preview never publishes on load; explicit Share and Revoke control access',async()=>{
 const link={share_id:randomUUID(),active:true,url:'https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev/s/'+'a'.repeat(64)};
 const fixture=viewer(name=>name==='share_artifact'?link:name==='revoke_artifact_share'?{revoked:true}:{...fixture.doc,visibility:'private'});
 assert.equal(fixture.calls.length,0);assert.equal(fixture.nodes.get('state').textContent,'Private');assert.equal(fixture.nodes.get('document').hidden,false);
 await fixture.click('share');assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0].name,'share_artifact');assert.equal(fixture.nodes.get('sharing').hidden,false);
 assert.equal(fixture.nodes.get('state').textContent,'Shared');assert.equal(fixture.nodes.get('link').href,link.url);
 await fixture.click('revoke');assert.deepEqual(fixture.calls.map(call=>call.name),['share_artifact','revoke_artifact_share','read_artifact']);assert.equal(fixture.nodes.get('sharing').hidden,true);assert.equal(fixture.nodes.get('state').textContent,'Private');
});
test('uncertain Share retries the exact request_id and arguments',async()=>{
 let attempt=0;
 const fixture=viewer(()=>{if(++attempt===1)throw Error('Response lost');return {share_id:randomUUID(),active:true,url:'https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev/s/'+'b'.repeat(64)};});
 await fixture.click('share');assert.equal(fixture.nodes.get('sharing').hidden,true);
 assert.equal(fixture.nodes.get('state').textContent,'Sharing unconfirmed');assert.match(fixture.nodes.get('message').textContent,/A link may have been created/);
 fixture.events.get('openai:set_globals')({detail:{globals:fixture.openai}});
 assert.equal(fixture.nodes.get('state').textContent,'Sharing unconfirmed');
 await fixture.click('share');assert.equal(fixture.calls.length,2);assert.deepEqual(fixture.calls[0].args,fixture.calls[1].args);
 assert.equal(fixture.nodes.get('state').textContent,'Shared');
});
test('private preview refuses a returned link to an unexpected host',async()=>{
 const fixture=viewer(()=>({active:true,url:'https://attacker.invalid/s/'+'c'.repeat(64)}));
 await fixture.click('share');assert.equal(fixture.nodes.get('sharing').hidden,true);assert.match(fixture.nodes.get('message').textContent,/invalid share link/);
});
test('standard MCP Apps bridge receives private results and only shares after a click',async()=>{
 const nodes=new Map(),events=new Map(),messages=[];
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{hidden:id==='sharing',events:{},addEventListener(name,handler){this.events[name]=handler;}});return nodes.get(id);}};
 const parent={postMessage(message){messages.push(message);}};
 runInNewContext(script,{document,window:{},parent,addEventListener(name,handler){events.set(name,handler);},crypto:{randomUUID},URL,setTimeout,clearTimeout});
 const receive=data=>events.get('message')({source:parent,data:{jsonrpc:'2.0',...data}});
 assert.equal(messages[0].method,'ui/initialize');receive({id:messages[0].id,result:{}});await Promise.resolve();
 const doc={id:randomUUID(),title:'Private standard-host fixture',visibility:'private'};
 receive({method:'ui/notifications/tool-result',params:{structuredContent:{result:doc},_meta:{artifact_markup:'<h1>Private fixture</h1>'}}});
 assert.equal(nodes.get('state').textContent,'Private');assert.ok(messages.every(message=>message.method!=='tools/call'));
 events.get('message')({source:{},data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{result:{...doc,title:'Forged result'}},_meta:{artifact_markup:'Forged'}}}});
 assert.equal(nodes.get('title').textContent,doc.title);
 const clicking=nodes.get('share').events.click();const call=messages.find(message=>message.method==='tools/call');assert.equal(call.params.name,'share_artifact');assert.equal(call.params.arguments.artifact_id,doc.id);
 receive({id:call.id,result:{structuredContent:{result:{active:true,share_id:randomUUID(),url:'https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev/s/'+'d'.repeat(64)}}}});
 await clicking;assert.equal(nodes.get('state').textContent,'Shared');
});
