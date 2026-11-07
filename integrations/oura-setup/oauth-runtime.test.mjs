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
  const browser={origin:'https://grok.com'},checkCors=r=>{assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.equal(r.headers.get('access-control-allow-credentials'),null);assert.match(r.headers.get('access-control-expose-headers'),/WWW-Authenticate/i);};
  let r=await send('/.well-known/oauth-authorization-server',{headers:browser});assert.equal(r.status,200);checkCors(r);const metadata=await r.json();assert.equal(metadata.issuer,ORIGIN);assert.equal(metadata.authorization_endpoint,ORIGIN+'/authorize');assert.equal(metadata.registration_endpoint,ORIGIN+'/oauth/register');assert.equal(metadata.token_endpoint,ORIGIN+'/oauth/token');assert.deepEqual(metadata.scopes_supported,['oura:read','offline_access']);assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);
  r=await send('/.well-known/oauth-protected-resource',{headers:browser});assert.equal(r.status,307);checkCors(r);const discovery=r.headers.get('location');assert.equal(discovery,ORIGIN+'/.well-known/oauth-protected-resource/mcp');
  r=await send(new URL(discovery).pathname,{headers:browser});assert.equal(r.status,200);checkCors(r);const resource=await r.json();assert.equal(resource.resource,ORIGIN+'/mcp');assert.deepEqual(resource.authorization_servers,[metadata.issuer]);assert.deepEqual(resource.scopes_supported,['oura:read']);assert.deepEqual(resource.bearer_methods_supported,['header']);
  for(const path of ['/.well-known/oauth-authorization-server',new URL(discovery).pathname]){r=await send(path,{method:'HEAD',headers:browser});assert.equal(r.status,200);assert.equal(await r.text(),'');checkCors(r);}
  for(const headers of [browser,{...browser,authorization:'Bearer synthetic-invalid'},{...browser,authorization:'Bearer '+owner}]){r=await send('/mcp',{headers});assert.equal(r.status,401);checkCors(r);assert.ok(r.headers.get('www-authenticate').includes('resource_metadata="'+discovery+'"'));assert.match(r.headers.get('www-authenticate'),/scope="oura:read"/);}
  r=await send('/authorize');assert.equal(r.status,400);assert.equal(r.headers.get('location'),null);assert.equal(r.headers.get('set-cookie'),null);assert.match((await r.json()).error_description,/S256 PKCE/);
  const register=redirect=>send('/oauth/register',{method:'POST',headers:{...browser,'Content-Type':'application/json'},body:JSON.stringify({client_name:'Synthetic test client',redirect_uris:Array.isArray(redirect)?redirect:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
  assert.equal((await register('http://evil.example/callback')).status,400);
  const grok=['https://www.cursor.com/agents/mcp/oauth/callback','http://localhost:8787/callback'];assert.equal((await register(grok)).status,201);assert.equal((await register(Array(6).fill(grok[0]))).status,400);assert.equal((await register([...grok,'http://example.com/cb'])).status,400);
  const redirect='http://127.0.0.1:8787/callback';r=await register(redirect);assert.equal(r.status,201);checkCors(r);const client=await r.json();
  const verifier=random();const params=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',scope:'oura:read offline_access',state:'synthetic-client-state',code_challenge:await digest(verifier),code_challenge_method:'S256',resource:ORIGIN+'/mcp'}),authPath='/authorize?'+params;
  for(const name of ['client_id','redirect_uri','response_type','code_challenge','code_challenge_method']){const incomplete=new URLSearchParams(params);incomplete.delete(name);r=await send('/authorize?'+incomplete);assert.equal(r.status,400,name);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('location'),null);}
  for(const [name,value] of [['redirect_uri','https://evil.example/callback'],['code_challenge_method','plain'],['scope','oura:write'],['resource',ORIGIN+'/other']]){const invalid=new URLSearchParams(params);invalid.set(name,value);r=await send('/authorize?'+invalid);assert.equal(r.status,400,name);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('location'),null);}
  // Connect only synthetic provider tokens in local isolated storage.
  r=await send('/oura/connect',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({key:owner,consent:'yes'}).toString()});assert.equal(r.status,200);let loc=new URL((await r.text()).match(/href="(https:\/\/developer.ouraring.com[^"]+)"/)[1].replaceAll('&amp;','&')),cookie=r.headers.get('set-cookie').split(';')[0];
  r=await send('/oura/callback?'+new URLSearchParams({state:loc.searchParams.get('state'),code:'synthetic-code'}),{headers:{cookie}});assert.equal(r.status,303);
  r=await send(authPath,{headers:browser});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(r.headers.get('referrer-policy'),'same-origin');let html=await r.text();assert.match(html,/Authorize this client/);const handle=html.match(/name="handle" value="([^"]+)"/)[1];cookie=r.headers.get('set-cookie').split(';')[0];
  const consent=(key,csrfCookie=cookie)=>send('/authorize',{method:'POST',headers:{origin:ORIGIN,cookie:csrfCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,key,decision:'allow'}).toString()});
  for(const origin of ['https://grok.com','https://chatgpt.com','null']){r=await send('/authorize',{method:'POST',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handle,key:owner,decision:'allow'}).toString()});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);}
  assert.equal((await consent('wrong-owner')).status,401);assert.equal((await consent(owner,'')).status,400);
  r=await consent(owner);assert.equal(r.status,303);assert.equal(r.headers.get('access-control-allow-origin'),null);loc=new URL(r.headers.get('location'));assert.equal(loc.origin,new URL(redirect).origin);assert.equal(loc.searchParams.get('state'),'synthetic-client-state');const code=loc.searchParams.get('code');assert.ok(code);
  assert.equal((await consent(owner)).status,400);
  const exchange=(v,resource=ORIGIN+'/mcp')=>send('/oauth/token',{method:'POST',headers:{...browser,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code,redirect_uri:redirect,...(v===undefined?{}:{code_verifier:v}),resource}).toString()});
  for(const [v,resource] of [[undefined,ORIGIN+'/mcp'],[random(),ORIGIN+'/mcp'],[verifier,ORIGIN+'/other']]){r=await exchange(v,resource);assert.equal(r.status,400);checkCors(r);assert.equal((await r.json()).access_token,undefined);}
  r=await exchange(verifier);assert.equal(r.status,200);checkCors(r);const token=await r.json();assert.ok(token.access_token);assert.ok(token.refresh_token);
  r=await send('/mcp',{method:'POST',headers:{...browser,authorization:'Bearer '+token.access_token,'content-type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.equal(r.status,200);checkCors(r);assert.equal((await r.json()).result.tools.length,18);
  assert.equal((await exchange(verifier)).status,400);
  assert.equal((await send('/mcp',{method:'POST',headers:{'x-lifeos-internal':key,'content-type':'application/json'},body:'{}'})).status,401);
 }finally{await mf.dispose();}
});
