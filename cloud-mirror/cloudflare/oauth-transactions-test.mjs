// The sign-in transaction store on a real Durable Object, behind a KV that hides each write for
// five seconds, which is how Workers KV behaved for Avi's GitHub callback.
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const fixture=`
import {OAuthTransactions,consistentTransactionKv} from './oauth-transactions.ts';
export {OAuthTransactions};
const laggy=kv=>{const hidden=new Map();return {
  async get(key,options){return (hidden.get(key)??0)>Date.now()?null:kv.get(key,options);},
  async put(key,value,options){hidden.set(key,Date.now()+5000);return kv.put(key,value,options);},
  delete:key=>kv.delete(key),list:options=>kv.list(options),
};};
export default {async fetch(request,env){
  const store=consistentTransactionKv(laggy(env.KV),env.OAUTH_TX),out={};
  await store.put('transaction:a','sealed-a',{expirationTtl:600});
  out.immediate=await store.get('transaction:a');out.immediateText=await store.get('transaction:a',{type:'text'});out.inKv=await env.KV.get('transaction:a');
  await store.put('callback-redirect:b','redirect-b',{expirationTtl:120});out.redirect=await store.get('callback-redirect:b','text');
  await store.delete('transaction:a');out.afterDelete=await store.get('transaction:a');
  await store.put('transaction:short','x',{expirationTtl:1});await new Promise(r=>setTimeout(r,1100));out.expired=await store.get('transaction:short');
  await store.put('client:c',JSON.stringify({n:1}));out.clientThroughLaggyKv=await store.get('client:c','json');out.clientInKv=await env.KV.get('client:c','json');
  try{await store.put('transaction:object',{not:'a string'});out.objectAccepted=true;}catch{out.objectAccepted=false;}
  return Response.json(out);
}};`;
const bundle=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:new TextDecoder().decode(bundle.outputFiles[0].contents),compatibilityDate:'2026-09-30',kvNamespaces:['KV'],durableObjects:{OAUTH_TX:{className:'OAuthTransactions',useSQLite:true}}})});
try {
 await test('OAuth transaction store reads its own writes',async()=>{
  const out=await (await mf.dispatchFetch('https://fixture.invalid/')).json();
  assert.equal(out.immediate,'sealed-a','put then immediate get returns the value');
  assert.equal(out.immediateText,'sealed-a','text option form');
  assert.equal(out.inKv,null,'the transaction never reached KV');
  assert.equal(out.redirect,'redirect-b','callback redirects use the same store');
  assert.equal(out.afterDelete,null,'delete is gone');
  assert.equal(out.expired,null,'expired records are gone');
  assert.equal(out.clientThroughLaggyKv,null,'other keys still go to KV, lag and all');
  assert.deepEqual(out.clientInKv,{n:1});
  assert.equal(out.objectAccepted,false,'transaction values must be strings');
 });
} finally {await mf.dispose();}
