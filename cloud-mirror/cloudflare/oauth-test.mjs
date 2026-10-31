// OAuth browser-session hardening and consent page checks, with a non-ChatGPT client and an
// extra configured browser origin. Synthetic GitHub only; no real credentials.
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
await build({entryPoints:['mcp-entry.ts'],outfile:'.test-oauth.mjs',bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire('/');"},loader:{'.html':'text','.css':'text'},external:['cloudflare:workers']});
const origin='https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev',resource=origin+'/mcp';
const redirectUri='https://claude.ai/api/mcp/auth_callback';
const dir=await mkdtemp(join(tmpdir(),'lifeos-oauth-fixture-'));
const hash=s=>createHash('sha256').update(s).digest('hex');
let upstreamCalls=0;
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:await readFile('.test-oauth.mjs','utf8'),compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],kvNamespaces:['OAUTH_KV'],d1Databases:{DB:'fixture'},bindings:{LIFEOS_OWNER_ID:'fixture-owner',LIFEOS_ADAPTER_ID:'fixture-mac',LIFEOS_GITHUB_OWNER_ID:'42',LIFEOS_WRITES_ENABLED:'true',LIFEOS_SMART_SYNC_ENABLED:'true',LIFEOS_AGENT_KEY_SHA256:hash('SYNTHETIC-agent-fixture-only-at-least-32-characters'),LIFEOS_MCP_ALLOWED_ORIGINS:'https://claude.ai, https://*.example.invalid http://insecure.invalid',GITHUB_CLIENT_ID:'SYNTHETIC-client',GITHUB_CLIENT_SECRET:'SYNTHETIC-secret',LIFEOS_SYNC_KEY_SHA256:hash('SYNTHETIC-sync-fixture-only-at-least-32-characters'),LIFEOS_READ_KEY_SHA256:hash('SYNTHETIC-read-fixture-only-at-least-32-characters')},outboundService:async req=>{
  upstreamCalls++;const url=new URL(req.url);
  if(url.href==='https://github.com/login/oauth/access_token')return Response.json({access_token:'SYNTHETIC-upstream',token_type:'bearer',scope:''});
  if(url.href==='https://api.github.com/user')return Response.json({id:42});
  throw new Error('Unexpected outbound fixture request');
}}),resourcePersistencePath:dir});
// A cookie jar per simulated browser. Records attributes so the binding cookie can be inspected.
class Jar {
  cookies=new Map();set=[];
  header(){return [...this.cookies].map(([k,v])=>k+'='+v).join('; ');}
  take(r){for(const c of r.headers.getSetCookie()){this.set.push(c);const [pair]=c.split(';'),p=pair.indexOf('='),name=pair.slice(0,p),value=pair.slice(p+1);if(/max-age=0\b/i.test(c)||!value)this.cookies.delete(name);else this.cookies.set(name,value);}return r;}
}
async function request(jar,path,{method='GET',body,headers={}}={}) {
  const r=await mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(jar?{Cookie:jar.header()}:{}),...headers},body});
  return jar?jar.take(r):r;
}
const verifier='SYNTHETIC-pkce-verifier-long-enough-at-least-forty-three';
const pkce=createHash('sha256').update(verifier).digest('base64url');
const decode=s=>s.replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
let clientId;
async function consent(jar,scope='things:read offline_access') {
  const r=await request(jar,'/authorize?'+new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirectUri,scope,state:'fixture-client-state',code_challenge:pkce,code_challenge_method:'S256',resource}),{headers:{Accept:'text/html'}});
  return {r,html:await r.text()};
}
const handleOf=html=>html.match(/name="handle" value="([^"]+)"/)[1];
async function approve(jar,html,extra={}) {
  const r=await request(jar,'/authorize',{method:'POST',body:new URLSearchParams({handle:handleOf(html),decision:'allow',...extra}),headers:{Origin:origin,Accept:'text/html'}});
  assert.equal(r.status,200);const page=await r.text();
  const github=new URL(decode(page.match(/href="([^"]+)"/)[1]));assert.equal(github.origin,'https://github.com');
  return {r,page,github,callback:'/callback?'+new URLSearchParams({code:'SYNTHETIC-code',state:github.searchParams.get('state')})};
}
const cspOf=r=>Object.fromEntries(r.headers.get('content-security-policy').split(';').map(d=>d.trim().split(/\s+/)).map(([k,...v])=>[k,v]));
function assertStrictCsp(r,html) {
  const csp=cspOf(r),raw=r.headers.get('content-security-policy');
  assert.deepEqual(csp['default-src'],["'none'"]);assert.deepEqual(csp['base-uri'],["'none'"]);assert.deepEqual(csp['frame-ancestors'],["'none'"]);
  assert.ok(csp['form-action']);assert.doesNotMatch(raw,/unsafe-inline|unsafe-eval|unsafe-hashes|\*/);
  assert.equal(csp['style-src'].length,1);const nonce=csp['style-src'][0].match(/^'nonce-([A-Za-z0-9+/=]{16,})'$/)?.[1];assert.ok(nonce,'style nonce');
  assert.equal(html.match(/<style\b/g).length,1);assert.ok(html.includes(`<style nonce="${nonce}">`));
  assert.doesNotMatch(html,/<script|<link\b|<img\b|<iframe|\bstyle="|https?:\/\/(?!github\.com)[^"\s]*\.(css|js|woff2?)/i);
  assert.match(html,/<html lang="en-AU">/);assert.ok(!html.includes('\u2014'),'no em dash');
  return nonce;
}
try {
 await test('OAuth browser-session hardening',async t=>{
  await t.test('a client other than ChatGPT registers and reaches consent',async()=>{
   const registered=await request(null,'/oauth/register',{method:'POST',body:JSON.stringify({client_name:'Synthetic "Claude" <b>client</b>',redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}),headers:{'Content-Type':'application/json'}});
   assert.equal(registered.status,201);clientId=(await registered.json()).client_id;
   const {r}=await consent(new Jar());assert.equal(r.status,200);assert.deepEqual(cspOf(r)['form-action'],["'self'",'https://github.com','https://claude.ai']);
  });
  await t.test('binding cookie is per transaction, host-only, Lax, whole-site and 10 minutes',async()=>{
   const jar=new Jar(),{html}=await consent(jar);
   const consentCookie=jar.set.find(c=>c.startsWith('__Host-oauth-consent-'));assert.ok(consentCookie);
   const {callback}=await approve(jar,html);
   const upstream=jar.set.find(c=>c.startsWith('__Host-oauth-upstream-'));
   assert.match(upstream,/^__Host-oauth-upstream-[0-9a-f]{16}=[0-9a-f]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
   assert.ok(jar.set.some(c=>c.startsWith(consentCookie.split('=')[0]+'=;')&&/Max-Age=0/.test(c)),'consent cookie cleared on approval');
   assert.equal((await request(jar,callback)).status,302);
  });
  await t.test('consent accepts null or missing Origin only with same-origin fetch metadata and bound cookies',async()=>{
   for(const originHeaders of [{Origin:'null'},{}]){
    for(const decision of ['allow','deny']){
     const jar=new Jar(),{html}=await consent(jar);
     const body=new URLSearchParams({handle:handleOf(html),decision});
     const headers={...originHeaders,'Sec-Fetch-Site':'same-origin'};
     const response=await request(jar,'/authorize',{method:'POST',body,headers});
     assert.equal(response.status,decision==='allow'?200:302,JSON.stringify({originHeaders,decision,status:response.status,error:response.status===403?await response.text():undefined}));
     if(decision==='deny')assert.equal(new URL(response.headers.get('location')).searchParams.get('error'),'access_denied');
     const replay=await request(jar,'/authorize',{method:'POST',body,headers});assert.equal(replay.status,400,'one-time consent still applies');
    }
   }
   const ownerJar=new Jar(),{html}=await consent(ownerJar);
   const unbound=await request(new Jar(),'/authorize',{method:'POST',body:new URLSearchParams({handle:handleOf(html),decision:'allow'}),headers:{Origin:'null','Sec-Fetch-Site':'same-origin'}});
   assert.equal(unbound.status,400);assert.equal((await unbound.json()).reason,'browser_session_missing');
  });
  await t.test('consent rejects foreign origins and unproven null or missing origins without consuming consent',async()=>{
   const jar=new Jar(),{html}=await consent(jar),body=new URLSearchParams({handle:handleOf(html),decision:'allow'});
   const before=upstreamCalls;
   for(const headers of [
    {Origin:'null'},{},
    {Origin:'null','Sec-Fetch-Site':'cross-site'},{Origin:'null','Sec-Fetch-Site':'same-site'},
    {'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'none'},
    {Origin:'https://attacker.invalid','Sec-Fetch-Site':'same-origin'},
    {Origin:origin+'.attacker.invalid','Sec-Fetch-Site':'same-origin'},
   ]){
    const denied=await request(jar,'/authorize',{method:'POST',body,headers});assert.equal(denied.status,403,JSON.stringify(headers));assert.deepEqual(await denied.json(),{error:'Same-origin consent required.'});
   }
   assert.equal(upstreamCalls,before);await approve(jar,html);
  });
  await t.test('root cause: a second load of the callback finds its cookie already cleared',async()=>{
   // Reload, back/forward, a double tap on the old manual link, or a scanner that followed the
   // GitHub redirect: the first load consumes the state and clears the cookie, the second fails.
   const jar=new Jar(),{html}=await consent(jar),{callback}=await approve(jar,html);
   const first=await request(jar,callback);assert.equal(first.status,302);assert.equal(new URL(first.headers.get('location')).origin,'https://claude.ai');
   const second=await request(jar,callback);assert.equal(second.status,400);
   assert.deepEqual(await second.json(),{error:'Sign-in could not be completed. Restart the connection.',stage:'callback_session',reason:'browser_session_missing'});
  });
  await t.test('fix: a prefetched callback does not consume the one-time state',async()=>{
   const jar=new Jar(),{html}=await consent(jar),{callback}=await approve(jar,html),calls=upstreamCalls;
   for(const headers of [{'Sec-Purpose':'prefetch'},{'Sec-Purpose':'prefetch;prerender'},{Purpose:'prefetch'},{'X-Moz':'prefetch'}]){
     const pre=await request(jar,callback,{headers});assert.equal(pre.status,503);assert.equal(pre.headers.getSetCookie().length,0);assert.equal(pre.headers.get('location'),null);
   }
   assert.equal(upstreamCalls,calls,'no GitHub exchange for a prefetch');
   const real=await request(jar,callback,{headers:{Accept:'text/html'}});assert.equal(real.status,302);assert.ok(new URL(real.headers.get('location')).searchParams.get('code'));
   assert.equal((await request(jar,'/authorize?client_id=x',{headers:{'Sec-Purpose':'prefetch'}})).status,503);
  });
  await t.test('fix: the continue page goes on to GitHub by itself',async()=>{
   const jar=new Jar(),{html}=await consent(jar),{r,page,github,callback}=await approve(jar,html);
   assertStrictCsp(r,page);assert.deepEqual(cspOf(r)['form-action'],["'none'"]);assert.equal(r.headers.get('referrer-policy'),'same-origin');assert.equal(r.headers.get('location'),null);
   const refresh=page.match(/<meta http-equiv="refresh" content="0;url=([^"]+)">/);assert.ok(refresh,'meta refresh');assert.equal(new URL(decode(refresh[1])).href,github.href);
   assert.equal(github.searchParams.get('code_challenge_method'),'S256');assert.equal(github.searchParams.get('scope'),'');assert.equal(github.searchParams.get('redirect_uri'),origin+'/callback');
   assert.match(page,/Continue to GitHub/);assert.match(page,/<main id="main">/);
   assert.equal((await request(jar,callback)).status,302);
  });
  await t.test('parallel sign-ins in one browser do not overwrite each other',async()=>{
   const jar=new Jar(),a=await consent(jar),b=await consent(jar);
   const flowB=await approve(jar,b.html),flowA=await approve(jar,a.html);
   assert.equal((await request(jar,flowA.callback)).status,302);assert.equal((await request(jar,flowB.callback)).status,302);
  });
  await t.test('a callback in another browser gets a friendly page, not raw JSON',async()=>{
   const jar=new Jar(),{html}=await consent(jar),{callback}=await approve(jar,html);
   const other=await request(new Jar(),callback,{headers:{Accept:'text/html,application/xhtml+xml'}});
   assert.equal(other.status,400);assert.match(other.headers.get('content-type'),/^text\/html/);assert.equal(other.headers.get('cache-control'),'no-store');
   const page=await other.text();assertStrictCsp(other,page);assert.deepEqual(cspOf(other)['form-action'],["'none'"]);
   assert.match(page,/<h1>Sign-in did not finish<\/h1>/);assert.match(page,/<h2 id="again">Start again<\/h2>/);assert.match(page,/<ol>/);
   assert.match(page,/stage <code>callback_session<\/code>, reason <code>browser_session_missing<\/code>/);
   const state=new URL(origin+callback).searchParams.get('state');assert.ok(!page.includes(state),'state handle not echoed');assert.ok(!page.includes('SYNTHETIC'));
   // The original browser can still finish: the stray request consumed nothing.
   assert.equal((await request(jar,callback)).status,302);
  });
  await t.test('expired or replayed consent also gets the friendly page',async()=>{
   const jar=new Jar(),{html}=await consent(jar);await approve(jar,html);
   const again=await request(jar,'/authorize',{method:'POST',body:new URLSearchParams({handle:handleOf(html),decision:'allow'}),headers:{Origin:origin,Accept:'text/html'}});
   assert.equal(again.status,400);const page=await again.text();assertStrictCsp(again,page);assert.match(page,/stage <code>consent_session<\/code>, reason <code>browser_session_missing<\/code>/);
   assert.ok(!page.includes(handleOf(html)));
   assert.equal((await request(jar,'/authorize',{method:'POST',body:new URLSearchParams({handle:handleOf(html),decision:'allow'}),headers:{Origin:'https://claude.ai'}})).status,403,'consent POST stays same-origin');
  });
  await t.test('consent page: strict CSP, labelled fields, escaped values, no em dash',async()=>{
   const jar=new Jar(),{r,html}=await consent(jar);assert.equal(r.status,200);
   const nonce=assertStrictCsp(r,html),again=assertStrictCsp(...Object.values(await consent(new Jar())));assert.notEqual(nonce,again,'fresh nonce per response');
   assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'same-origin');
   assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1">/);assert.match(html,/prefers-color-scheme:dark/);assert.match(html,/prefers-reduced-motion:reduce/);assert.match(html,/:focus-visible\{outline:3px/);
   assert.match(html,/<main id="main">/);assert.match(html,/<h1>Allow access to LifeOS\?<\/h1>/);
   assert.ok(html.includes('Synthetic &#34;Claude&#34; &#60;b&#62;client&#60;/b&#62;'));assert.ok(!html.includes('<b>client'));
   assert.equal(html.match(/<form /g).length,1);assert.match(html,/<form method="post" action="\/authorize">/);
   assert.match(html,/<input type="hidden" name="handle" value="[^"]+">/);
   const boxes=[...html.matchAll(/<input type="checkbox" id="([^"]+)" name="([^"]+)" value="allow" aria-describedby="([^"]+)"( checked)?>/g)].map(([,id,name,described,checked])=>({id,name,described,checked:!!checked}));
   assert.deepEqual(boxes.map(b=>[b.name,b.checked]),[['queued_writes',true],['local_tools',false],['notes',false],['notes_write',false],['artifacts',false]]);
   for(const b of boxes){assert.match(html,new RegExp(`<label class="row" for="${b.id}"><input type="checkbox" id="${b.id}"`));assert.match(html,new RegExp(`<p id="${b.described}">[^<]{20,}</p>`));}
   assert.equal([...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]).length,new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1])).size,'unique ids');
   assert.match(html,/<button class="primary" name="decision" value="allow">Allow with GitHub<\/button><button class="secondary" name="decision" value="deny">Deny<\/button>/);
   assert.match(html,/<fieldset><legend>Optional<\/legend>/);
   for(const words of ['things:read','offline_access','things:write','lifeos:local','notes:write','Create, update, move, complete, cancel, trash and restore','offline queue','Never deletes','30 days','10 minutes'])assert.ok(html.includes(words),words);
   assert.match(html,/Supported fields merge automatically/,'conflict policy shown with queued edits');
  });
  await t.test('client-requested scopes become hidden fields and the POST still grants them',async()=>{
   const jar=new Jar(),{html}=await consent(jar,'things:read things:write lifeos:local notes offline_access');
   assert.match(html,/<input type="hidden" name="queued_writes" value="allow">/);assert.match(html,/<input type="hidden" name="local_tools" value="allow">/);
   assert.doesNotMatch(html,/type="checkbox"[^>]*name="(queued_writes|local_tools)"/);assert.match(html,/name="notes" value="allow" aria-describedby="opt-notes-text" checked>/);
   const fields=Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]+)">/g)].map(m=>[m[1],decode(m[2])]));
   const {callback}=await approve(jar,html,{...fields,notes:'allow',notes_write:'allow'});
   const code=new URL((await request(jar,callback)).headers.get('location')).searchParams.get('code');
   const token=await request(null,'/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:redirectUri,code_verifier:verifier,resource})});
   assert.deepEqual((await token.json()).scope.split(' ').sort(),['lifeos:local','notes','notes:write','offline_access','things:read','things:write']);
   const deny=await consent(jar),denied=await request(jar,'/authorize',{method:'POST',body:new URLSearchParams({handle:handleOf(deny.html),decision:'deny'}),headers:{Origin:origin}});
   assert.equal(denied.status,302);assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'),'access_denied');
  });
  await t.test('configured browser origin is accepted; wildcards and http are ignored',async()=>{
   const jar=new Jar(),{html}=await consent(jar),{callback}=await approve(jar,html);
   const code=new URL((await request(jar,callback)).headers.get('location')).searchParams.get('code');
   const token=await request(null,'/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:redirectUri,code_verifier:verifier,resource})});assert.equal(token.status,200);
   const access=(await token.json()).access_token;
   const list=headers=>mf.dispatchFetch(resource,{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
   assert.equal((await list({})).status,200);assert.equal((await list({Origin:'https://claude.ai'})).status,200);
   for(const denied of ['https://chatgpt.com','https://a.example.invalid','http://insecure.invalid','https://claude.ai.attacker.invalid'])assert.equal((await list({Origin:denied})).status,403,denied);
  });
 });
}finally {await mf.dispose();await rm(dir,{recursive:true,force:true});await rm('.test-oauth.mjs',{force:true});}
