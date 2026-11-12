import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ORIGIN as OURA_ORIGIN,random,digest} from '../../integrations/oura-setup/integration.mjs';

await build({entryPoints:['mcp-entry.ts'],outfile:'.test-health.mjs',bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire('/');"},loader:{'.html':'text','.css':'text'},external:['cloudflare:workers']});
// nodePaths lets CI reuse this package's identical OAuth provider without a second install.
const ouraBundle=await build({entryPoints:['../../integrations/oura-setup/index.mjs'],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],nodePaths:[new URL('node_modules',import.meta.url).pathname]});
const origin='https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev',resource=origin+'/mcp',redirect='https://chatgpt.com/connector/oauth/callback';
const collections=JSON.parse(await readFile('../../integrations/oura-setup/health-collections.json','utf8'));
const healthNames=collections.map(kind=>'read_oura_'+kind.toLowerCase());
// Distinctive synthetic health values; none may ever appear in Worker logs.
const sentinel='SYNTHETIC-HEALTH-SENTINEL-7Q2',hrv=61.25;
const logs=[];let githubUser=42,ouraReads=[];
const ownerKey='synthetic-owner-key',encryptionKey=random();
const dir=await mkdtemp(join(tmpdir(),'lifeos-health-fixture-'));
const mf=new Miniflare({...convertV4MiniflareOptions({handleStructuredLogs:log=>logs.push(log.message),workers:[
 {name:'main',modules:true,script:await readFile('.test-health.mjs','utf8'),compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],kvNamespaces:{OAUTH_KV:'main-oauth'},d1Databases:{DB:'fixture'},
  serviceBindings:{OURA_HEALTH:{name:'oura',entrypoint:'HealthReader'}},
  bindings:{LIFEOS_OWNER_ID:'fixture-owner',LIFEOS_ADAPTER_ID:'fixture-mac',LIFEOS_GITHUB_OWNER_ID:'42',GITHUB_CLIENT_ID:'SYNTHETIC-client',GITHUB_CLIENT_SECRET:'SYNTHETIC-secret'},
  outboundService:async req=>{
   const url=new URL(req.url);
   if(url.href==='https://github.com/login/oauth/access_token')return Response.json({access_token:'SYNTHETIC-upstream',token_type:'bearer',scope:''});
   if(url.href==='https://api.github.com/user')return Response.json({id:githubUser});
   throw new Error('Unexpected outbound request from the main Worker');
  }},
 {name:'oura',routes:['lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/*'],modules:true,script:new TextDecoder().decode(ouraBundle.outputFiles[0].contents),compatibilityDate:'2026-09-30',kvNamespaces:{OAUTH_KV:'oura-oauth'},durableObjects:{OURA_VAULT:{className:'OuraVault',useSQLite:true}},
  bindings:{OURA_ENABLED:'true',OURA_CLIENT_ID:'synthetic-oura-client',OURA_CLIENT_SECRET:'synthetic-oura-secret',TOKEN_ENCRYPTION_KEY:encryptionKey,OWNER_KEY_HASH:await digest(ownerKey)},
  outboundService:async req=>{
   const url=new URL(req.url);
   if(url.href==='https://api.ouraring.com/oauth/token')return Response.json({access_token:'synthetic-oura-access',refresh_token:'synthetic-oura-refresh',expires_in:86400,token_type:'bearer'});
   if(url.pathname.startsWith('/v2/usercollection/')){
    ouraReads.push({kind:url.pathname.slice(19),authorization:req.headers.get('authorization'),query:Object.fromEntries(url.searchParams)});
    return Response.json({data:[{id:sentinel,day:url.searchParams.get('start_date'),average_hrv:hrv,score:84}],next_token:null});
   }
   throw new Error('Unexpected outbound request from the Oura Worker');
  }},
]}),resourcePersistencePath:dir});

const cookies=new Map();
async function request(path,{method='GET',body,headers={},cookie=true}={}) {
 const r=await mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(cookie?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...headers},body});
 for(const c of r.headers.getSetCookie()){const [pair]=c.split(';'),p=pair.indexOf('=');cookies.set(pair.slice(0,p),pair.slice(p+1));}
 return r;
}
const ouraFetch=(path,init={})=>mf.dispatchFetch(OURA_ORIGIN+path,{redirect:'manual',...init});
const verifier='SYNTHETIC-pkce-verifier-long-enough-at-least-forty-three',pkce=createHash('sha256').update(verifier).digest('base64url');
let clientId;
const handle=html=>html.match(/name="handle" value="([^"]+)"/)[1];
async function consent(scope='things:read offline_access') {
 const r=await request('/authorize?'+new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirect,scope,state:'fixture-state',code_challenge:pkce,code_challenge_method:'S256',resource}));
 return {r,html:await r.text()};
}
// Runs consent, GitHub and the token exchange. Returns the token response, or the denial redirect.
async function signIn({health=false}={}) {
 const {html}=await consent();
 const next=await request('/authorize',{method:'POST',body:new URLSearchParams({handle:handle(html),decision:'allow',...(health?{health:'allow'}:{})}),headers:{Origin:origin}});
 const target=new URL((await next.text()).match(/href="([^"]+)"/)[1].replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))));
 const callback=await request('/callback?'+new URLSearchParams({code:'SYNTHETIC-code',state:target.searchParams.get('state')}));
 const back=new URL(callback.headers.get('location')),code=back.searchParams.get('code');
 if(!code)return {denied:back.searchParams.get('error')};
 const token=await request('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:redirect,code_verifier:verifier,resource})});
 assert.equal(token.status,200);return token.json();
}
async function connect(access) {
 const sdk=new Client({name:'Health fixture bot',version:'1'});
 await sdk.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+access}},fetch:(url,init)=>mf.dispatchFetch(url,init)}));
 return sdk;
}

try {
 await test('Oura health through the main LifeOS connection',async t=>{
  const registered=await request('/oauth/register',{method:'POST',body:JSON.stringify({client_name:'Health fixture bot',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}),headers:{'Content-Type':'application/json'}});
  assert.equal(registered.status,201);clientId=(await registered.json()).client_id;
  let r=await ouraFetch('/oura/connect',{method:'POST',headers:{origin:OURA_ORIGIN,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({key:ownerKey,consent:'yes'}).toString()});assert.equal(r.status,200,await r.clone().text());
  const upstream=new URL((await r.text()).match(/href="(https:\/\/developer.ouraring.com[^"]+)"/)[1].replaceAll('&amp;','&'));
  r=await ouraFetch('/oura/callback?'+new URLSearchParams({state:upstream.searchParams.get('state'),code:'synthetic-code'}),{headers:{cookie:r.headers.get('set-cookie').split(';')[0]}});assert.equal(r.status,303);

  await t.test('unauthenticated and wrong-owner callers get no health data',async()=>{
   const anonymous=await request('/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_oura_sleep',arguments:{start_date:'2026-11-01',end_date:'2026-11-02'}}}),headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'}});
   assert.equal(anonymous.status,401);assert.match(anonymous.headers.get('www-authenticate'),/oauth-protected-resource/);
   const forged=await request('/mcp',{method:'POST',body:'{}',headers:{'Content-Type':'application/json',Authorization:'Bearer '+encryptionKey}});assert.equal(forged.status,401);
   githubUser=43;assert.deepEqual(await signIn({health:true}),{denied:'access_denied'});githubUser=42;
   assert.deepEqual(ouraReads,[]);
  });

  await t.test('consent offers Oura health as an unticked opt-in',async()=>{
   const plain=(await consent()).html;assert.match(plain,/Oura health/);assert.match(plain,/<input type="checkbox" id="opt-health" name="health" value="allow" aria-describedby="opt-health-text">/);
   assert.match((await consent('things:read health:read offline_access')).html,/id="opt-health" name="health" value="allow" aria-describedby="opt-health-text" checked>/);
  });

  await t.test('a grant without health:read hides and refuses every Oura tool',async()=>{
   const access=await signIn();assert.ok(!access.scope.split(' ').includes('health:read'));
   const sdk=await connect(access.access_token);
   try {
    const names=(await sdk.listTools()).tools.map(tool=>tool.name);assert.ok(healthNames.every(name=>!names.includes(name)));
    const refused=await sdk.callTool({name:'read_oura_sleep',arguments:{start_date:'2026-11-01',end_date:'2026-11-02'}});assert.equal(refused.isError,true);
    const capabilities=(await sdk.callTool({name:'get_lifeos_capabilities',arguments:{}})).structuredContent;
    assert.equal(capabilities.health_available,false);assert.match(capabilities.health_access_action,/health:read/);
   } finally {await sdk.close();}
   assert.deepEqual(ouraReads,[]);
   const upgraded=await request('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:clientId,refresh_token:access.refresh_token,scope:'things:read health:read offline_access',resource})});
   if(upgraded.status===200)assert.ok(!(await upgraded.json()).scope.split(' ').includes('health:read'));else assert.equal(upgraded.status,400);
  });

  await t.test('a health:read grant reads live Oura data through the private binding',async()=>{
   const access=await signIn({health:true});assert.ok(access.scope.split(' ').includes('health:read'));
   const sdk=await connect(access.access_token);
   try {
    assert.match(sdk.getInstructions(),/read_oura_sleep/);
    const tools=(await sdk.listTools()).tools,health=tools.filter(tool=>tool.name.startsWith('read_oura_'));
    assert.deepEqual(health.map(tool=>tool.name),healthNames);
    for(const tool of health){assert.equal(tool.annotations.readOnlyHint,true,tool.name);assert.equal(tool.annotations.destructiveHint,false,tool.name);}
    const sleep=await sdk.callTool({name:'read_oura_sleep',arguments:{start_date:'2026-11-01',end_date:'2026-11-07'}});
    assert.equal(sleep.isError,undefined);assert.equal(sleep.structuredContent.data[0].average_hrv,hrv);assert.equal(sleep.structuredContent.source,'Oura API');
    assert.deepEqual(ouraReads,[{kind:'sleep',authorization:'Bearer synthetic-oura-access',query:{start_date:'2026-11-01',end_date:'2026-11-07'}}]);
    for(const name of ['read_oura_daily_readiness','read_oura_daily_activity','read_oura_daily_sleep'])assert.equal((await sdk.callTool({name,arguments:{start_date:'2026-11-01',end_date:'2026-11-01'}})).structuredContent.data[0].score,84,name);
    const before=ouraReads.length;
    for(const args of [{start_date:'2026-11-01',end_date:'2026-11-02'},{start_date:'2026-11-02',end_date:'2026-11-01'}]){
     const refused=await sdk.callTool({name:'read_oura_heartrate',arguments:args});assert.equal(refused.isError,true);assert.match(refused.content[0].text,/Invalid date range/);
    }
    assert.equal((await sdk.callTool({name:'read_oura_sleep',arguments:{start_date:'2026-01-01',end_date:'2026-03-01'}})).isError,true);
    assert.equal(ouraReads.length,before);
    assert.equal((await sdk.callTool({name:'get_lifeos_capabilities',arguments:{}})).structuredContent.health_available,true);
   } finally {await sdk.close();}
  });

  await t.test('the internal read path is unreachable from the internet, even with the vault key',async()=>{
   for(const headers of [{},{'x-lifeos-internal':encryptionKey},{authorization:'Bearer '+ownerKey}]){
    const r=await ouraFetch('/oura/read',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({kind:'sleep',args:{start_date:'2026-11-01',end_date:'2026-11-01'}})});
    assert.equal(r.status,404);assert.ok(!(await r.text()).includes(sentinel));
   }
  });

  await t.test('a disconnected Oura account reports reconnect without reading',async()=>{
   assert.equal((await ouraFetch('/oura/disconnect',{method:'POST',headers:{authorization:'Bearer '+ownerKey}})).status,200);
   const access=await signIn({health:true}),sdk=await connect(access.access_token),before=ouraReads.length;
   try {
    const result=await sdk.callTool({name:'read_oura_sleep',arguments:{start_date:'2026-11-01',end_date:'2026-11-01'}});
    assert.equal(result.isError,true);assert.match(result.content[0].text,/reconnect it at https:\/\/lifeos-app-setup/);
   } finally {await sdk.close();}
   assert.equal(ouraReads.length,before);
  });

  await t.test('no health values reach Worker logs',()=>{
   const text=logs.join('\n');
   for(const secret of [sentinel,String(hrv),'synthetic-oura-access','synthetic-oura-refresh',encryptionKey,ownerKey])assert.ok(!text.includes(secret),secret);
  });
 });
} finally {await mf.dispose();await rm(dir,{recursive:true,force:true});await rm('.test-health.mjs',{force:true});}
