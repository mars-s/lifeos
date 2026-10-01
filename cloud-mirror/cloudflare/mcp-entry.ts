import OAuthProvider,{OAuthError,authorizationErrorRedirect,type OAuthHelpers,type OAuthResourceAuth} from '@cloudflare/workers-oauth-provider';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import mirror,{writesEnabled} from './worker';
import {NativeQueue,supportedVector} from './native-queue';
import {ownerSync} from './owner-sync';
export {OwnerSync} from './owner-sync';
import {MirrorStore,canonical,type Cell} from '../site/lib/mirror-store';
import {BulkD1} from './d1-bulk';

// OAuth grants explicitly gate read access and queued writes.
type OAuthEnv=Env & {
  OAUTH_KV?:KVNamespace; OAUTH_PROVIDER?:OAuthHelpers;
  GITHUB_CLIENT_ID?:string; GITHUB_CLIENT_SECRET?:string;
  LIFEOS_GITHUB_OWNER_ID?:string;
};
const origin='https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev';
const resource=origin+'/mcp';
const scope='things:read';
const writeScope='things:write';
const writeSecurity={securitySchemes:[{type:'oauth2',scopes:[scope,writeScope]}]};
const policyDescription=(env:Env)=>env.LIFEOS_SMART_SYNC_ENABLED==='true'?'Supported fields merge automatically from the exact observed base. Explicit cloud commands resolve same-field conflicts; conflicting alternatives remain in the journal.':env.LIFEOS_CLOUD_WINS_ENABLED==='true'?'Explicit cloud edits take priority for the requested field until a later Things snapshot confirms them.':'Things wins if the edited field changed; skipped edits remain in the journal.';
const writeConsent=()=>({content:[{type:'text' as const,text:'Reconnect LifeOS and approve things:write before queuing changes.'}],isError:true,_meta:{'mcp/www_authenticate':[`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="things:read things:write"`]}});
type Identity={owner:string;github_id:string;role:'reader'};
const json=(body:unknown,status:number)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
function owner(identity:unknown,env:OAuthEnv):identity is Identity {
  const p=identity as Partial<Identity>|undefined;
  return !!p&&p.owner===env.LIFEOS_OWNER_ID&&p.github_id===env.LIFEOS_GITHUB_OWNER_ID&&p.role==='reader';
}
async function challenge(verifier:string) {
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
async function auth(request:Request,env:OAuthEnv):Promise<Response> {
  const url=new URL(request.url),oauth=env.OAUTH_PROVIDER!;
  let stage='request';
  try {
    if(url.pathname==='/authorize'&&request.method==='GET') {
      stage='client_authorization';
      const req=await oauth.parseAuthRequest(request);
      if(req.scope.some(s=>![scope,writeScope,'offline_access'].includes(s))||req.scope.includes(writeScope)&&!writesEnabled(env))return json({error:'This access is not activated.'},400);
      stage='consent_start';
      const facts=await oauth.describeConsent(req),consent=await oauth.beginConsent(req);
      const headers=consent.headers;headers.set('Content-Type','text/html; charset=utf-8');
      // Chromium applies form-action to the GitHub redirect after this POST.
      // The validated client redirect is also needed when the owner declines.
      const clientOrigin=new URL(req.redirectUri).origin;
      headers.set('Content-Security-Policy',`default-src 'none'; form-action 'self' https://github.com ${clientOrigin}; base-uri 'none'; frame-ancestors 'none'`);
      const writing=req.scope.includes(writeScope)||writesEnabled(env);
      const writeChoice=writesEnabled(env)&&!req.scope.includes(writeScope)?'<p><label><input type="checkbox" name="queued_writes" value="allow" checked> Include queued edits (things:write)</label>. Uncheck for read-only access.</p>':'';
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>LifeOS access</title><h1>Allow ${writing?'reading and queued edits':'cloud mirror reading'}?</h1><p>${escape(facts.clientName)} requests access to cached Things tasks, projects, areas and tags, including notes.${writing?' It may queue title changes, task completion and moving to-dos to recoverable Things Trash. Your Mac applies them when awake. '+policyDescription(env):' Changes remain disabled for this grant.'}</p><p>Tokens return to ${escape(facts.redirectHost)}.${facts.redirectIsLoopback?' This is a local app; verify which app requested access.':''}</p><p>Permissions: things:read${writing?', things:write':''}. Offline access lets the client refresh its sign-in.</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(consent.handle)}">${writeChoice}<button name="decision" value="allow">Allow with GitHub</button><button name="decision" value="deny">Deny</button></form></html>`,{headers});
    }
    if(url.pathname==='/authorize'&&request.method==='POST') {
      stage='consent_session';
      if(request.headers.get('origin')!==origin)return json({error:'Same-origin consent required.'},403);
      const form=await request.formData(),handle=String(form.get('handle')??'');
      if(form.get('decision')==='deny') {const denied=await oauth.denyConsent(request,handle);return new Response(null,{status:302,headers:denied.headers});}
      if(form.get('decision')!=='allow')return json({error:'Consent required.'},400);
      // Only the fixed optional write permission can be added by owner consent.
      // Client identity, redirect and PKCE remain recovered from the bound transaction.
      const approved=await oauth.approveConsent(request,handle,
        form.get('queued_writes')==='allow'&&writesEnabled(env)?{scope:[scope,writeScope,'offline_access']}:{});
      if(approved.request.scope.includes(writeScope)&&!writesEnabled(env))return json({error:'Write activation pending.'},403);
      const verifier=crypto.randomUUID()+crypto.randomUUID();
      stage='github_redirect';
      const upstream=await oauth.beginUpstream(approved.request,{data:{verifier},headers:approved.headers});
      const target=new URL('https://github.com/login/oauth/authorize');
      target.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID!,redirect_uri:origin+'/callback',scope:'',state:upstream.state,code_challenge:await challenge(verifier),code_challenge_method:'S256',allow_signup:'false'}).toString();
      // Finish the form navigation before starting GitHub's redirect chain.
      // Chromium can apply form-action to every destination in that chain.
      upstream.headers.set('Content-Type','text/html; charset=utf-8');
      upstream.headers.set('Referrer-Policy','no-referrer');
      upstream.headers.set('Content-Security-Policy',"default-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Continue LifeOS sign-in</title><h1>Continue LifeOS sign-in</h1><p>Your consent was recorded. Confirm your GitHub account to finish connecting LifeOS.</p><p><a href="${escape(target.href)}">Continue to GitHub</a></p>`,{headers:upstream.headers});
    }
    if(url.pathname==='/callback'&&request.method==='GET') {
      stage='callback_session';
      const resumed=await oauth.finishUpstream<{verifier:string}>(request);
      const deny=()=>{resumed.headers.set('Location',authorizationErrorRedirect(resumed.request,'access_denied'));return new Response(null,{status:302,headers:resumed.headers});};
      const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code)return deny();
      // Access token lives only during this callback, not in grant props/logs/D1.
      stage='github_exchange';
      const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID!,client_secret:env.GITHUB_CLIENT_SECRET!,code,redirect_uri:origin+'/callback',code_verifier:resumed.data.verifier})});
      if(!exchange.ok)return deny();
      const result=await exchange.json() as {access_token?:string;scope?:string;token_type?:string};
      // Refuse an app whose earlier grants accidentally carry repository/user scopes.
      if(!result.access_token||result.token_type!=='bearer'||result.scope?.trim())return deny();
      stage='github_identity';
      const identity=await fetch('https://api.github.com/user',{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+result.access_token,Accept:'application/vnd.github+json','User-Agent':'LifeOSReadOnlyMirror/0.1'}});
      if(!identity.ok)return deny();
      const user=await identity.json() as {id?:number};
      if(!Number.isSafeInteger(user.id)||String(user.id)!==env.LIFEOS_GITHUB_OWNER_ID)return deny();
      stage='grant_completion';
      if(resumed.request.scope.includes(writeScope)&&!writesEnabled(env))return deny();
      const done=await oauth.completeAuthorization({request:resumed.request,userId:String(user.id),metadata:{role:'reader'},scope:resumed.request.scope,props:{owner:env.LIFEOS_OWNER_ID,github_id:String(user.id),role:'reader'} satisfies Identity});
      resumed.headers.set('Location',done.redirectTo);return new Response(null,{status:302,headers:resumed.headers});
    }
    return json({error:'OAuth route not found.'},404);
  }catch(error){
    // Map only fixed library messages. Never expose exception text, URLs,
    // cookies, transaction handles, upstream codes or credentials.
    const description=(error as {description?:string})?.description;
    const reasons:Record<string,string>={
      'This authorization was not started in this browser; start again':'browser_session_missing',
      'This authorization belongs to a different browser session; start again':'browser_session_mismatch',
      'This authorization expired or was already used; start again':'session_expired_or_unavailable',
      'Missing state parameter':'callback_state_missing',
      'Missing transaction handle':'consent_handle_missing',
      'client_id is required':'connection_request_missing',
      'Invalid client_id':'client_registration_missing',
      'Invalid redirect URI':'client_redirect_mismatch'
    };
    return json({error:'Sign-in could not be completed. Restart the connection.',stage,reason:description&&reasons[description]||'authorization_failed'},400);
  }
}
async function mcp(request:Request,env:OAuthEnv,ctx:ExecutionContext):Promise<Response> {
  const c=ctx as ExecutionContext&{props?:Identity;auth?:OAuthResourceAuth};
  if(!owner(c.props,env))return json({error:'Owner read access required.'},403);
  if(!c.auth?.scope.includes(scope))return json({error:'Read scope required.'},403);
  if(new URL(request.url).pathname!=='/mcp')return json({error:'MCP route not found.'},404);
  // HTTP Origin is checked without trusting identity headers or static role keys.
  const source=request.headers.get('origin');
  if(source&&![origin,'https://chatgpt.com','https://chat.openai.com'].includes(source))return json({error:'Origin denied.'},403);
  const server=new McpServer({name:'LifeOS Cloud Mirror',version:'0.4.0'});
  const db=new BulkD1(env.DB),queue=new NativeQueue(db,env.LIFEOS_OWNER_ID);
  server.registerTool('read_things_mirror',{description:'Read the confirmed Things snapshot with sync age, timezone and pending edits. When present, effective shows the cached view including queued edits, with pending operation markers. Confirmed remains the last verified Things state. This cache is not live ThingsCloud. Follow next_cursor until null; restart pagination if sequence changes. Unsupported, absent and unknown fields remain explicit.',inputSchema:{cursor:z.number().int().min(0).max(10000).default(0)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({cursor})=>{
    const state=await new MirrorStore(db,env.LIFEOS_OWNER_ID).state(cursor);
    Object.assign(state,{capabilities:{cloud_queue_enabled:writesEnabled(env),connection_can_write:writesEnabled(env)&&c.auth!.scope.includes(writeScope),supported_writes:['title','complete_todo','trash_todo'],write_access_action:c.auth!.scope.includes(writeScope)?null:'Reconnect this existing app and consent to things:write. Existing read-only grants cannot gain write permission automatically.'}});
    if(writesEnabled(env)) {
      const operations=await queue.recent(),pending=await queue.overlays();
      Object.assign(state,{conflict_policy:env.LIFEOS_SMART_SYNC_ENABLED==='true'?'smart_merge_v1':env.LIFEOS_CLOUD_WINS_ENABLED==='true'?'cloud_wins':'things_wins',native_operations:operations});
      state.pending_overlay.push(...pending.map(o=>({id:o.id,target:o.payload.target,fields:{[o.payload.field]:o.payload.value},state:o.state})));
      Object.assign(state,{queue_view:'complete active desired fields; durable journal retained',effective:state.confirmed.map(item=>{
        const fields={...item.fields},pendingOperations=[];
        for(const operation of pending)if(operation.payload.target===item.id){
          fields[operation.payload.field]={state:'value',value:operation.payload.value,revision:item.fields[operation.payload.field]?.revision};
          pendingOperations.push({id:operation.id,field:operation.payload.field,state:operation.state});
        }
        return {...item,fields,pending_operations:pendingOperations,verification:pendingOperations.length?'pending':'confirmed'};
      })});
      if(env.LIFEOS_SMART_SYNC_ENABLED==='true'){
        const effective=(state as typeof state&{effective:typeof state.confirmed}).effective;
        await queue.effectiveBases(effective,pending,state.sequence);
        const bases=await queue.presentationBases(state.confirmed.map(i=>i.id));
        for(const [source,items] of [['confirmed',state.confirmed],['desired',effective]] as const)for(const item of items)for(const [field,cell] of Object.entries(item.fields) as [string,Cell][]){
          const head=source==='desired'?pending.find(o=>o.payload.target===item.id&&o.payload.field===field):undefined;
          const effectiveTarget=source==='desired'&&pending.some(o=>o.payload.target===item.id);
          const vector=supportedVector(item.fields);
          const basis=bases.find(b=>b.target===item.id&&b.field===field&&(effectiveTarget?b.source==='effective'&&b.ordinal===(head?.ordinal??0)&&canonical(JSON.parse(b.target_fields))===canonical(vector):b.source==='confirmed'&&b.revision===cell.revision)&&JSON.parse(b.cell).value===cell.value);
          if(basis)item.fields[field]={...cell,...{basis_token:basis.token}};
        }
      }
    }
    return {content:[{type:'text',text:JSON.stringify(state)}],structuredContent:state};
  });
  if(writesEnabled(env)) {
    server.registerTool('queue_things_trash',{_meta:writeSecurity,description:'Durably queue an explicitly requested to-do deletion by moving it to Things Trash, where it remains recoverable. Never empties Trash or deletes projects. Use the confirmed in_trash_list revision and a stable operation_id. Pending until the Mac verifies Trash membership. '+policyDescription(env),inputSchema:{operation_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),target:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),base_revision:z.number().int().positive(),basis_token:z.string().regex(/^[a-f0-9]{48}$/).optional()},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}},async({operation_id,target,base_revision,basis_token})=>{
      if(!c.auth!.scope.includes(writeScope))return writeConsent();
      try{const operation=await ownerSync(env).enqueue({id:operation_id,target,base_revision,field:'in_trash_list',value:true,...basis_token?{basis_token}:{}});const result={operation,accepted:['accepted','queued','executing','applied','satisfied'].includes(operation.state),applied:['applied','satisfied'].includes(operation.state),recoverable:true};return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
      catch{return {content:[{type:'text',text:'To-do could not be queued for Trash. Refresh its confirmed in_trash_list revision. Never reuse an operation ID for different content.'}],isError:true};}
    });
    server.registerTool('queue_things_edit',{_meta:writeSecurity,description:'Durably queue one explicit owner-requested title change or task completion. Use a stable operation_id for retries and the confirmed field revision from read_things_mirror. A newly accepted edit is pending until the native agent verifies it. No script, arbitrary fields, delete or bulk edit. '+policyDescription(env),inputSchema:{operation_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),target:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),field:z.enum(['title','status']),value:z.string().max(4000),base_revision:z.number().int().positive(),basis_token:z.string().regex(/^[a-f0-9]{48}$/).optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({operation_id,...input})=>{
      if(!c.auth!.scope.includes(writeScope))return writeConsent();
      try{const operation=await ownerSync(env).enqueue({id:operation_id,...input});const result={operation,accepted:['accepted','queued','executing','applied','satisfied'].includes(operation.state),applied:['applied','satisfied'].includes(operation.state),conflict_policy:env.LIFEOS_SMART_SYNC_ENABLED==='true'?'smart_merge_v1':env.LIFEOS_CLOUD_WINS_ENABLED==='true'?'cloud_wins':'things_wins'};return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
      catch{return {content:[{type:'text',text:'Edit could not be queued. Refresh the target and use only title changes or completed status. An operation ID must never be reused for different content.'}],isError:true};}
    });
  }
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:65536});
  await server.connect(transport);
  try {const response=await transport.handleRequest(request);response.headers.set('Cache-Control','no-store');return response;}
  finally {await server.close();}
}
const provider=new OAuthProvider<OAuthEnv>({apiRoute:'/mcp',apiHandler:{fetch:mcp},defaultHandler:{fetch:auth},authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',clientIdMetadataDocumentEnabled:false,scopesSupported:[scope,writeScope,'offline_access'],requiredScopes:[scope,writeScope],resourceMetadata:{resource,authorization_servers:[origin],resource_name:'LifeOS cloud mirror'},accessTokenTTL:3600,refreshTokenTTL:2592000,clientRegistrationTTL:7776000,onError:()=>{},tokenExchangeCallback(options){if(!owner(options.props,options.env)||options.scope.some(s=>![scope,writeScope,'offline_access'].includes(s))||options.scope.includes(writeScope)&&!writesEnabled(options.env))throw new OAuthError('invalid_grant',{description:'Owner grant required.'});}});
export default {async fetch(request:Request,env:OAuthEnv,ctx:ExecutionContext):Promise<Response> {
  const path=new URL(request.url).pathname;
  if(path==='/health'||path==='/state'||path.startsWith('/api/'))return mirror.fetch(request,env);
  if(new URL(request.url).origin!==origin)return json({error:'OAuth host denied.'},403);
  if(!env.OAUTH_KV||!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.LIFEOS_GITHUB_OWNER_ID)return json({error:'Dot OAuth setup is not activated. Mac sync remains available.'},503);
  if(request.method==='POST') {
    const chunks:Uint8Array[]=[];let size=0;const reader=request.body?.getReader();
    if(reader)for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>65536){void reader.cancel();return json({error:'OAuth/MCP request exceeds budget.'},413);}chunks.push(p.value);}
    const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
    request=new Request(request,{body:bytes});
  }
  return provider.fetch(request,env,ctx);
}};
