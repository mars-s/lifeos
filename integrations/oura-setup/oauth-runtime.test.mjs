import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {ORIGIN,random,digest} from './integration.mjs';
const root=new URL('.',import.meta.url).pathname;
test('MCP OAuth discovery, redirect rejection, owner consent, PKCE exchange and protected read tools',async()=>{
 const owner='synthetic-owner',key=random();
 const bundle=await build({entryPoints:[root+'worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
 const script=new TextDecoder().decode(bundle.outputFiles[0].contents);
 const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-08-06',kvNamespaces:['OAUTH_KV'],durableObjects:{OURA_VAULT:{className:'OuraVault',useSQLite:true}},bindings:{OURA_ENABLED:'true',OURA_CLIENT_ID:'synthetic-client',OURA_CLIENT_SECRET:'synthetic-secret',TOKEN_ENCRYPTION_KEY:key,OWNER_KEY_HASH:await digest(owner)},outboundService:()=>Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'bearer'})});
 const send=(path,init={})=>mf.dispatchFetch(ORIGIN+path,{redirect:'manual',...init});
 try{
  let r=await send('/.well-known/oauth-authorization-server');assert.equal(r.status,200);const metadata=await r.json();assert.equal(metadata.authorization_endpoint,ORIGIN+'/authorize');assert.equal(metadata.registration_endpoint,ORIGIN+'/oauth/register');
  r=await send('/mcp');assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/resource_metadata/);
  const register=redirect=>send('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Synthetic test client',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  assert.equal((await register('http://evil.example/callback')).status,400);
  r=await register('https://client.example/callback');assert.equal(r.status,201);const client=await r.json();
  const verifier=random();const authPath='/authorize?'+new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example/callback',response_type:'code',scope:'oura:read offline_access',state:'synthetic-client-state',code_challenge:await digest(verifier),code_challenge_method:'S256',resource:ORIGIN+'/mcp'});
  const bad=authPath.replace('https%3A%2F%2Fclient.example%2Fcallback','https%3A%2F%2Fevil.example%2Fcallback');assert.equal((await send(bad)).status,400);
  // Connect only synthetic provider tokens in local isolated storage.
  r=await send('/oura/connect',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({key:owner,consent:'yes'}).toString()});assert.equal(r.status,200);let loc=new URL((await r.text()).match(/href="(https:\/\/developer.ouraring.com[^"]+)"/)[1].replaceAll('&amp;','&')),cookie=r.headers.get('set-cookie').split(';')[0];
  r=await send('/oura/callback?'+new URLSearchParams({state:loc.searchParams.get('state'),code:'synthetic-code'}),{headers:{cookie}});assert.equal(r.status,303);
  r=await send(authPath);assert.equal(r.status,200);let html=await r.text();assert.match(html,/Authorize this client/);const handle=html.match(/name="handle" value="([^"]+)"/)[1];cookie=r.headers.get('set-cookie').split(';')[0];
  const consent=(key,csrfCookie=cookie)=>send('/authorize',{method:'POST',headers:{origin:ORIGIN,cookie:csrfCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,key,decision:'allow'}).toString()});
  assert.equal((await consent('wrong-owner')).status,401);assert.equal((await consent(owner,'')).status,400);
  r=await consent(owner);assert.equal(r.status,303);loc=new URL(r.headers.get('location'));assert.equal(loc.origin,'https://client.example');assert.equal(loc.searchParams.get('state'),'synthetic-client-state');const code=loc.searchParams.get('code');assert.ok(code);
  assert.equal((await consent(owner)).status,400);
  const exchange=v=>send('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code,redirect_uri:'https://client.example/callback',code_verifier:v,resource:ORIGIN+'/mcp'}).toString()});
  r=await exchange(verifier);assert.equal(r.status,200);const token=await r.json();assert.ok(token.access_token);assert.ok(token.refresh_token);
  r=await send('/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.equal(r.status,200);assert.equal((await r.json()).result.tools.length,18);
  assert.equal((await exchange(verifier)).status,400);
  assert.equal((await send('/mcp',{method:'POST',headers:{'x-lifeos-internal':key,'content-type':'application/json'},body:'{}'})).status,401);
 }finally{await mf.dispose();}
});
