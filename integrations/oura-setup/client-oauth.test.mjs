import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('./client-oauth.mjs',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fake-provider',setup(b){b.onResolve({filter:/^@cloudflare\/workers-oauth-provider$/},()=>({path:'provider',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export default class Provider{constructor(options){this.options=options}};export class OAuthError extends Error{}'}));}}]});
const {validRedirect,provider}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const options=provider.options,pair=['https://www.cursor.com/agents/mcp/oauth/callback','http://localhost:8787/callback'];
test('redirects allow HTTPS and explicit loopback hosts only',()=>{
 for(const uri of [...pair,'http://127.0.0.1:1234/cb','http://[::1]:8080/cb'])assert.equal(validRedirect(uri),true,uri);
 for(const uri of ['https://x/cb#fragment','http://localhost/cb#fragment','https://u:p@x/','http://u:p@localhost/','http://example.com/cb','http://127.0.0.2/','http://localhost.evil.com/','com.example:/cb','javascript:alert(1)','data:text/plain,hi','ftp://example.com/'])assert.equal(validRedirect(uri),false,uri);
});
test('registration accepts exact Grok Bot pair and rejects excessive or mixed redirects',()=>{
 const register=redirect_uris=>options.clientRegistrationCallback({clientMetadata:{redirect_uris}});assert.equal(register(pair),undefined);
 for(const redirects of [Array(6).fill(pair[0]),[...pair,'http://example.com/cb']])assert.equal(register(redirects).description,'One to five HTTPS or loopback redirects without fragments or userinfo required.');
});
test('auth catch logs bounded summary and keeps the same safe 400 response',async t=>{
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));const env={OAUTH_PROVIDER:{async denyConsent(){throw new TypeError('synthetic failure');}}};
 const r=await options.defaultHandler.fetch(new Request('https://example.com/authorize',{method:'POST',headers:{origin:'https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev','content-type':'application/x-www-form-urlencoded'},body:'handle=PRIVATE_CODE&key=PRIVATE_KEY&token=PRIVATE_TOKEN&decision=deny'}),env);
 assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'Authorization failed. Restart the client connection.'});assert.deepEqual(logs,[['client_oauth_failed',{path:'/authorize',method:'POST',name:'TypeError',message:'synthetic failure'}]]);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE/);
 options.onError({code:'invalid_request',description:'Invalid request',status:400,headers:{secret:'PRIVATE'},internal:{secret:'PRIVATE'}});assert.deepEqual(logs[1],['client_oauth_error',{code:'invalid_request',description:'Invalid request',status:400}]);
});
test('loopback consent CSP includes redirect origin',async()=>{
 const r=await options.defaultHandler.fetch(new Request('https://example.com/authorize'),{OAUTH_PROVIDER:{async parseAuthRequest(){return {responseType:'code',codeChallengeMethod:'S256',codeChallenge:'a'.repeat(43),redirectUri:pair[1],scope:['oura:read']};},async describeConsent(){return {clientName:'Synthetic'};},async beginConsent(){return {handle:'synthetic',headers:{}};}}});assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/form-action 'self' http:\/\/localhost:8787;/);
});
