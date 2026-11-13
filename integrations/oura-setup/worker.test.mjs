import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {ORIGIN} from './integration.mjs';
const env={OURA_ENABLED:'true',OURA_CLIENT_ID:'synthetic-client',OURA_CLIENT_SECRET:'synthetic-secret',TOKEN_ENCRYPTION_KEY:'a'.repeat(43),OWNER_KEY_HASH:'b'.repeat(43),OURA_VAULT:{},OAUTH_KV:{}};
const send=(path,init={},bindings=env)=>worker.fetch(new Request(ORIGIN+path,init),bindings);
test('root resource discovery redirects GET and HEAD to the canonical MCP document',async()=>{
 for(const method of ['GET','HEAD']){
  const r=await send('/.well-known/oauth-protected-resource?ignored=fixture',{method,headers:{origin:'https://grok.com'}});
  assert.equal(r.status,307);assert.equal(r.headers.get('location'),ORIGIN+'/.well-known/oauth-protected-resource/mcp');assert.equal(await r.text(),'');
  assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.equal(r.headers.get('access-control-allow-credentials'),null);
 }
});
test('protocol preflights allow browser OAuth and MCP headers for any client origin',async()=>{
 for(const origin of ['https://grok.com','https://chatgpt.com','https://client.example'])for(const [path,method,headers] of [
  ['/.well-known/oauth-protected-resource','GET','accept'],['/.well-known/oauth-protected-resource/mcp','GET','accept'],
  ['/.well-known/oauth-authorization-server','GET','accept'],['/oauth/register','POST','content-type'],
  ['/oauth/token','POST','authorization, content-type'],['/mcp','POST','Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID']
 ]){
  const r=await send(path,{method:'OPTIONS',headers:{origin,'access-control-request-method':method,'access-control-request-headers':headers}});
  assert.equal(r.status,204,path);assert.equal(await r.text(),'');assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.equal(r.headers.get('access-control-allow-credentials'),null);
  assert.ok(r.headers.get('access-control-allow-methods').split(', ').includes(method));
 }
});
test('CORS is restricted to exact protocol routes, methods and headers',async()=>{
 for(const [path,method,headers] of [['/mcp','DELETE','authorization'],['/oauth/token','GET','authorization'],['/mcp','POST','x-lifeos-internal'],['/mcp','POST','x-custom']]){
  const r=await send(path,{method:'OPTIONS',headers:{origin:'https://grok.com','access-control-request-method':method,'access-control-request-headers':headers}});
  assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
 for(const path of ['/authorize','/oura','/oura/connect','/oauth/unknown','/.well-known/unknown','/mcp/extra']){
  const r=await send(path,{method:'OPTIONS',headers:{origin:'https://grok.com'}},{});assert.equal(r.headers.get('access-control-allow-origin'),null,path);
 }
 for(const [path,method] of [['/oauth/token','GET'],['/.well-known/oauth-protected-resource','POST'],['/mcp','DELETE']]){
  const r=await send(path,{method,headers:{origin:'https://grok.com'}});assert.equal(r.status,405);assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
 const r=await worker.fetch(new Request('https://rebound.example/mcp',{method:'OPTIONS',headers:{origin:'https://grok.com'}}),env);assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('owner consent POST still requires same-origin provenance before accessing OAuth',async()=>{
 for(const origin of [null,'null','https://grok.com','https://chatgpt.com','https://client.example']){
  const r=await send('/authorize',{method:'POST',headers:{...(origin===null?{}:{origin}),'content-type':'application/x-www-form-urlencoded'},body:'decision=allow&key=synthetic-owner'});
  assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(r.headers.get('set-cookie'),null);
 }
});
test('configuration failures remain readable over protocol CORS and keep integration disabled',async()=>{
 for(const path of ['/mcp','/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp','/.well-known/oauth-authorization-server']){
  const r=await send(path,{headers:{origin:'https://grok.com'}},{});assert.equal(r.status,503);assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.equal(r.headers.get('access-control-allow-credentials'),null);
 }
});
test('oversized protocol requests keep the existing bound and readable CORS error',async()=>{
 const r=await send('/mcp',{method:'POST',headers:{origin:'https://grok.com','content-type':'application/json'},body:'x'.repeat(16385)});
 assert.equal(r.status,413);assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.equal(r.headers.get('access-control-allow-credentials'),null);assert.match(r.headers.get('access-control-expose-headers'),/Retry-After/);
});
