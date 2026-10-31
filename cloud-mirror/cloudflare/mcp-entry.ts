import OAuthProvider,{OAuthError,authorizationErrorRedirect,type OAuthHelpers,type OAuthResourceAuth} from '@cloudflare/workers-oauth-provider';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import mirror,{writesEnabled} from './worker';
import {NativeQueue,supportedVector} from './native-queue';
import {ownerSync,rejectedPrefix} from './owner-sync';
import {applyThingsOverlays,overlayCells,type ThingsPayload} from './things-ops';
export {OwnerSync} from './owner-sync';
import {MirrorStore,canonical,type Cell} from '../site/lib/mirror-store';
import {BulkD1} from './d1-bulk';
import {registerCloudUI} from './cloud-ui';
import {registerLocalBridge} from './local-bridge';
import {localScope,notesScope,notesWriteScope} from './bridge-contract';
import {newNonce,pageHeaders,consentPage,continuePage,errorPage} from './consent-page';

// OAuth grants explicitly gate read access and queued writes.
type OAuthEnv=Env & {
  OAUTH_KV?:KVNamespace; OAUTH_PROVIDER?:OAuthHelpers;
  GITHUB_CLIENT_ID?:string; GITHUB_CLIENT_SECRET?:string;
  LIFEOS_GITHUB_OWNER_ID?:string;
  // Extra browser origins allowed to call /mcp, space or comma separated https origins.
  LIFEOS_MCP_ALLOWED_ORIGINS?:string;
};
const origin='https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev';
const resource=origin+'/mcp';
const scope='things:read';
const supportedScopes=['things:read','things:write','lifeos:local',notesScope,notesWriteScope,'offline_access'];
const writeScope='things:write';
const writeSecurity={securitySchemes:[{type:'oauth2',scopes:[scope,writeScope]}]};
const policyDescription=(env:Env)=>env.LIFEOS_SMART_SYNC_ENABLED==='true'?'Supported fields merge automatically from the exact observed base. Explicit cloud commands resolve same-field conflicts; conflicting alternatives remain in the journal.':env.LIFEOS_CLOUD_WINS_ENABLED==='true'?'Explicit cloud edits take priority for the requested field until a later Things snapshot confirms them.':'Things wins if the edited field changed; skipped edits remain in the journal.';
// Shared strict schemas for queued Things operations (payload version 4).
const idSchema=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),tempSchema=z.string().regex(/^tmp-[A-Za-z0-9_-]{1,64}$/),dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const thingsFields={title:z.string().min(1).max(4000),notes:z.string().max(10000),when:z.union([z.enum(['today','evening','anytime','someday']),dateSchema]),deadline:z.union([dateSchema,z.null()]),tags:z.array(z.string().min(1).max(100)).max(20),checklist:z.array(z.strictObject({title:z.string().min(1).max(1000),completed:z.boolean().optional()})).max(100)};
const updateFields=z.strictObject({title:thingsFields.title.optional(),notes:thingsFields.notes.optional(),when:thingsFields.when.optional(),deadline:thingsFields.deadline.optional(),tags:thingsFields.tags.optional(),checklist:thingsFields.checklist.optional()});
const createFields=updateFields.extend({title:thingsFields.title});
const containerSchema=z.discriminatedUnion('type',[z.strictObject({type:z.literal('inbox')}),z.strictObject({type:z.literal('none')}),z.strictObject({type:z.literal('area'),id:idSchema}),z.strictObject({type:z.literal('project'),id:idSchema}),z.strictObject({type:z.literal('heading'),project:idSchema,title:z.string().min(1).max(200)})]);
const revisionsSchema=z.partialRecord(z.enum(['title','notes','activation_date','deadline','tags','checklist','area_id','project_id','heading_id','status','in_trash_list']),z.number().int().min(0));
const opSchemas=[
  z.strictObject({op:z.literal('create'),operation_id:idSchema,kind:z.enum(['todo','project']),temp_id:tempSchema,fields:createFields,container:containerSchema.optional()}),
  z.strictObject({op:z.literal('update'),operation_id:idSchema,target:idSchema,fields:updateFields,base_revisions:revisionsSchema.optional()}),
  z.strictObject({op:z.literal('move'),operation_id:idSchema,target:idSchema,container:containerSchema,base_revisions:revisionsSchema.optional()}),
  z.strictObject({op:z.literal('set_status'),operation_id:idSchema,target:idSchema,status:z.enum(['open','completed','canceled']),base_revisions:revisionsSchema.optional()}),
  z.strictObject({op:z.literal('trash'),operation_id:idSchema,target:idSchema,base_revisions:revisionsSchema.optional()}),
  z.strictObject({op:z.literal('restore'),operation_id:idSchema,target:idSchema,base_revisions:revisionsSchema.optional()})
] as const;
const operationSchema=z.discriminatedUnion('op',opSchemas);
// Drop absent optional values so retries hash identically.
const defined=<T extends Record<string,unknown>>(value:T)=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined)) as T;
const thingsWrites=['create','update','move','set_status','trash','restore','batch'];
const thingsGuide='Targets are confirmed Things IDs from read_things_mirror or temporary ids (tmp-...) from an earlier or same-request create. For a confirmed target, base_revisions must name exactly the mirror fields the change depends on, with their current revisions (title, notes, activation_date for when, deadline, tags, checklist; area_id, project_id and heading_id for a to-do move, area_id for a project move; status; in_trash_list). Omit base_revisions for temporary ids. Reuse the same operation_id and arguments to retry; a different request under the same operation_id is refused. Operations wait in the cloud queue while the Mac sleeps and are applied in order by a Mac that supports Things operations, then verified by reading Things back.';
const writeConsent=()=>({content:[{type:'text' as const,text:'Reconnect LifeOS and approve things:write before queuing changes.'}],isError:true,_meta:{'mcp/www_authenticate':[`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="things:read things:write"`]}});
type NativeOperationView={id:string;state:string;payload:unknown;resolved_refs?:Record<string,string|null>};
type Identity={owner:string;github_id:string;role:'reader'};
// Server-side MCP clients send no Origin and rely on the bearer token alone. Browser-hosted
// clients send one; only this Worker and the listed https origins may use a token from a page.
const defaultBrowserOrigins='https://chatgpt.com https://chat.openai.com';
const browserOrigins=(env:OAuthEnv)=>[origin,...(env.LIFEOS_MCP_ALLOWED_ORIGINS??defaultBrowserOrigins).split(/[\s,]+/).filter(o=>{try{const u=new URL(o);return u.protocol==='https:'&&u.origin===o;}catch{return false;}})];
const json=(body:unknown,status:number)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
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
  // Browsers and link scanners may speculatively load these GETs. A prefetched /callback would
  // consume the single-use upstream state and clear its cookie, so the real navigation then
  // fails with browser_session_missing. Refuse speculative loads before touching any state;
  // browsers drop a failed prefetch and make the real request when the user navigates.
  const purpose=[request.headers.get('sec-purpose'),request.headers.get('purpose'),request.headers.get('x-moz')].join(' ').toLowerCase();
  if(request.method==='GET'&&(url.pathname==='/callback'||url.pathname==='/authorize')&&/prefetch|prerender/.test(purpose))return new Response(null,{status:503,headers:{'Cache-Control':'no-store','Retry-After':'0'}});
  try {
    if(url.pathname==='/authorize'&&request.method==='GET') {
      stage='client_authorization';
      const req=await oauth.parseAuthRequest(request);
      if(req.scope.some(s=>!supportedScopes.includes(s))||req.scope.includes(writeScope)&&!writesEnabled(env))return json({error:'This access is not activated.'},400);
      stage='consent_start';
      const facts=await oauth.describeConsent(req),consent=await oauth.beginConsent(req);
      // Chromium applies form-action to the GitHub redirect after this POST.
      // The validated client redirect is also needed when the owner declines.
      const clientOrigin=new URL(req.redirectUri).origin,nonce=newNonce();
      return new Response(consentPage({clientName:facts.clientName,redirectHost:facts.redirectHost,loopback:facts.redirectIsLoopback,handle:consent.handle,
        writeRequested:req.scope.includes(writeScope),writeOffered:!req.scope.includes(writeScope)&&writesEnabled(env),
        localRequested:req.scope.includes(localScope),notesRequested:req.scope.includes(notesScope),notesWriteRequested:req.scope.includes(notesWriteScope),
        policy:policyDescription(env)},nonce),{headers:pageHeaders(consent.headers,nonce,`'self' https://github.com ${clientOrigin}`)});
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
        form.get('local_tools')==='allow'?{scope:[scope,...form.get('queued_writes')==='allow'&&writesEnabled(env)?[writeScope]:[],localScope,...form.get('notes')==='allow'?[notesScope,...form.get('notes_write')==='allow'?[notesWriteScope]:[]]:[],'offline_access']}:form.get('queued_writes')==='allow'&&writesEnabled(env)?{scope:[scope,writeScope,'offline_access']}:{});
      if(approved.request.scope.includes(writeScope)&&!writesEnabled(env))return json({error:'Write activation pending.'},403);
      const verifier=crypto.randomUUID()+crypto.randomUUID();
      stage='github_redirect';
      const upstream=await oauth.beginUpstream(approved.request,{data:{verifier},headers:approved.headers});
      const target=new URL('https://github.com/login/oauth/authorize');
      target.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID!,redirect_uri:origin+'/callback',scope:'',state:upstream.state,code_challenge:await challenge(verifier),code_challenge_method:'S256',allow_signup:'false'}).toString();
      // Finish the form navigation before starting GitHub's redirect chain.
      // Chromium can apply form-action to every destination in that chain.
      // The page then continues by itself, so the 10 minute upstream cookie is not spent
      // waiting for a second tap, and a double tap cannot race two GitHub round trips.
      const nonce=newNonce();
      return new Response(continuePage(target.href,nonce),{headers:pageHeaders(upstream.headers,nonce)});
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
    const reason=description&&reasons[description]||'authorization_failed';
    // People in a browser get a page with a way to start again; API callers keep the JSON.
    if(/text\/html/.test(request.headers.get('accept')??'')){const nonce=newNonce();return new Response(errorPage(stage,reason,nonce),{status:400,headers:pageHeaders(new Headers(),nonce)});}
    return json({error:'Sign-in could not be completed. Restart the connection.',stage,reason},400);
  }
}
async function mcp(request:Request,env:OAuthEnv,ctx:ExecutionContext):Promise<Response> {
  const c=ctx as ExecutionContext&{props?:Identity;auth?:OAuthResourceAuth};
  if(!owner(c.props,env))return json({error:'Owner read access required.'},403);
  if(!c.auth?.scope.includes(scope))return json({error:'Read scope required.'},403);
  if(new URL(request.url).pathname!=='/mcp')return json({error:'MCP route not found.'},404);
  // HTTP Origin is checked without trusting identity headers or static role keys.
  // An absent Origin is a non-browser client; the bearer token and owner check above still apply.
  const source=request.headers.get('origin');
  if(source!==null&&!browserOrigins(env).includes(source))return json({error:'Origin denied.'},403);
  const server=new McpServer({name:'LifeOS',version:'0.5.2'},{
    instructions:'For ONE task the user explicitly asks to add, use create_requested_task directly. For an explicit single-task edit or deletion, use update_requested_task or trash_requested_task. First resolve the exact task and source_hash with local search_things/read_things_list, not the potentially stale cloud mirror. If ambiguous, ask which task. Deletion means recoverable Trash only. The request is permission: do not prepare a proposal or ask for a second LifeOS approval. Resolve relative dates in the user timezone to YYYY-MM-DD; put timing constraints such as "after 8pm" in notes. These tools do not set a timed alarm. Reuse the same request_id and arguments after a timeout; only report saved when saved is true with a receipt. An awake connected Mac and existing things:write plus lifeos:local permissions are required. Never bypass platform permissions. Inferred meeting follow-ups, batches and Calendar changes still require a reviewed exact-revision proposal and verified apply. When local tools are unavailable or the Mac may be asleep, explicitly requested Things changes can be queued with the queue_things_* tools instead; they wait durably for the Mac and report progress through read_things_operations.',
  });
  const localAvailable=env.OWNER_SYNC?await ownerSync(env).localBridgeAvailable():false;
  const localAllowed=c.auth!.scope.includes(localScope);
  registerCloudUI(server,origin,localAvailable&&localAllowed);
  registerLocalBridge(server,env,c.auth!.scope,origin);
  server.registerTool('get_lifeos_capabilities',{description:'Read the capabilities of this connection. Reports which local LifeOS features have not migrated. Does not establish that the Mac is online.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async()=>{
    const capabilities={connector:'LifeOS',preview_widgets:['day_plan','week_plan','brain_dump_canvas','proposal_review','memory_review'],cloud_queue_enabled:writesEnabled(env),connection_can_write:writesEnabled(env)&&c.auth!.scope.includes(writeScope),supported_writes:['title','complete_todo','trash_todo',...thingsWrites],things_ops_version:1,local_tools_connected:localAvailable,connection_can_use_local_tools:localAllowed,local_tools_available:localAvailable&&localAllowed,local_task_creation_available:localAvailable&&localAllowed&&c.auth!.scope.includes(writeScope),local_task_crud_available:localAvailable&&localAllowed&&c.auth!.scope.includes(writeScope),local_task_tools:['create_requested_task','read_requested_task','update_requested_task','trash_requested_task'],notes_available:localAvailable&&localAllowed&&c.auth!.scope.includes(notesScope),notes_write_available:localAvailable&&localAllowed&&c.auth!.scope.includes(notesWriteScope),notes_storage:'Anytype on the Mac; never stored by this service',raw_capture_storage:'Mac only',local_tool_delivery:'transient, no offline queue or automatic replay',local_write_policy:'Explicit single-task creates, edits and recoverable Trash requests use direct tools without a LifeOS review card. Local reads avoid mirror sync delays. Other changes require exact-revision approval and verified apply.'};
    return {content:[{type:'text' as const,text:JSON.stringify(capabilities)}],structuredContent:capabilities};
  });
  const db=new BulkD1(env.DB),queue=new NativeQueue(db,env.LIFEOS_OWNER_ID);
  server.registerTool('read_things_mirror',{description:'Read the confirmed Things snapshot with sync age, timezone and pending edits. When present, effective shows the cached view including queued edits, with pending operation markers; queued creates appear on the first page under their temporary id until a snapshot confirms the real item. Confirmed remains the last verified Things state, including notes, activation_date, deadline, tags, status (open, completed, canceled), area_id, project_id and Trash membership with per-field revisions. catalog lists areas, projects, tags and headings, and which fields the Mac currently reports. temp_ids maps temporary ids to real Things IDs once verified. This cache is not live ThingsCloud. Follow next_cursor until null; restart pagination if sequence changes. Unsupported, absent and unknown fields remain explicit.',inputSchema:{cursor:z.number().int().min(0).max(10000).default(0)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({cursor})=>{
    const state=await new MirrorStore(db,env.LIFEOS_OWNER_ID).state(cursor);
    Object.assign(state,{catalog:await queue.catalog()});
    Object.assign(state,{capabilities:{cloud_queue_enabled:writesEnabled(env),connection_can_write:writesEnabled(env)&&c.auth!.scope.includes(writeScope),supported_writes:['title','complete_todo','trash_todo',...thingsWrites],things_ops_version:1,write_access_action:c.auth!.scope.includes(writeScope)?null:'Reconnect this existing app and consent to things:write. Existing read-only grants cannot gain write permission automatically.'}});
    if(writesEnabled(env)) {
      const operations=await queue.recent(),pending=await queue.overlays(),things=await queue.thingsOverlays();
      Object.assign(state,{conflict_policy:env.LIFEOS_SMART_SYNC_ENABLED==='true'?'smart_merge_v1':env.LIFEOS_CLOUD_WINS_ENABLED==='true'?'cloud_wins':'things_wins',native_operations:operations});
      state.pending_overlay.push(...pending.map(o=>({id:o.id,target:o.payload.target,fields:{[o.payload.field]:o.payload.value},state:o.state})));
      state.pending_overlay.push(...things.map(o=>({id:o.id,target:o.payload.target,op:(o.payload as unknown as ThingsPayload).op,fields:Object.fromEntries(Object.entries(overlayCells(o.payload as unknown as ThingsPayload,(o as {resolved_refs?:Record<string,string|null>}).resolved_refs??{})).map(([k,c])=>[k,c.state==='value'?c.value:null])),state:o.state})));
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
      const effective=(state as typeof state&{effective:Parameters<typeof applyThingsOverlays>[0]}).effective;
      effective.push(...applyThingsOverlays(effective,things,cursor===0));
      Object.assign(state,{temp_ids:await queue.tempIds()});
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
    const policy=env.LIFEOS_SMART_SYNC_ENABLED==='true'?'smart_merge_v1':env.LIFEOS_CLOUD_WINS_ENABLED==='true'?'cloud_wins':'things_wins';
    // Every version 4 tool funnels into one all-or-nothing coordinator request.
    const queueThings=async(operations:Record<string,unknown>[])=>{
      if(!c.auth!.scope.includes(writeScope))return writeConsent();
      try{
        const ops=await ownerSync(env).enqueueThings(operations.map(defined)) as Array<NativeOperationView>;
        const results=ops.map(o=>{const p=o.payload as unknown as ThingsPayload;return {operation_id:o.id,op:p.op,target:p.target,state:o.state,accepted:['queued','executing','applied','satisfied'].includes(o.state),applied:['applied','satisfied'].includes(o.state),...p.temp_id?{temp_id:p.temp_id,created_id:o.resolved_refs?.[p.temp_id]??null}:{},waiting_for:p.depends_on};});
        const result={results,operations:ops,conflict_policy:policy,delivery:'Queued durably. A Mac that supports Things operations applies them in order when awake and verifies each by reading Things back. Track progress with read_things_operations.'};
        return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
      }catch(error){
        const message=error instanceof Error?error.message:'';
        return {content:[{type:'text' as const,text:message.startsWith(rejectedPrefix)?'Nothing in this request was queued. '+message.slice(rejectedPrefix.length):'The outcome is not yet known. Retry with the same operation IDs and arguments; nothing is queued twice.'}],isError:true};
      }
    };
    const optionalFields={notes:thingsFields.notes.optional(),when:thingsFields.when.optional(),deadline:thingsFields.deadline.optional(),tags:thingsFields.tags.optional()};
    server.registerTool('queue_things_create',{_meta:writeSecurity,description:'Durably queue one explicitly requested new to-do or project, applied by the Mac even if it is asleep now. Supply a stable operation_id and a temporary id (tmp-...). Later operations may target the temporary id or use it as a project container; they wait until the Mac reports the real Things ID. when is today, evening, anytime, someday or YYYY-MM-DD. deadline is YYYY-MM-DD. tags are existing or new tag names. checklist is for to-dos only. container is inbox, an area, a project or a project heading for to-dos, or an area or none for projects. '+thingsGuide+' '+policyDescription(env),inputSchema:{operation_id:idSchema,temp_id:tempSchema,kind:z.enum(['todo','project']).default('todo'),title:thingsFields.title,...optionalFields,checklist:thingsFields.checklist.optional(),container:containerSchema.optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({operation_id,temp_id,kind,container,...fields})=>queueThings([{op:'create',operation_id,kind,temp_id,fields:defined(fields),container}]));
    server.registerTool('queue_things_update',{_meta:writeSecurity,description:'Durably queue an explicit change to fields of one to-do or project: title, notes, when (start date), deadline (null clears it), tags (replaces the set) and, for to-dos, checklist (replaces all items). '+thingsGuide+' '+policyDescription(env),inputSchema:{operation_id:idSchema,target:idSchema,fields:updateFields,base_revisions:revisionsSchema.optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({operation_id,target,fields,base_revisions})=>queueThings([{op:'update',operation_id,target,fields:defined(fields),base_revisions}]));
    server.registerTool('queue_things_move',{_meta:writeSecurity,description:'Durably queue moving one to-do to the Inbox, an area, a project or a project heading, or one project to an area or to no area. '+thingsGuide+' '+policyDescription(env),inputSchema:{operation_id:idSchema,target:idSchema,container:containerSchema,base_revisions:revisionsSchema.optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({operation_id,target,container,base_revisions})=>queueThings([{op:'move',operation_id,target,container,base_revisions}]));
    server.registerTool('queue_things_status',{_meta:writeSecurity,description:'Durably queue completing, reopening or cancelling one to-do or project (status completed, open or canceled). '+thingsGuide+' '+policyDescription(env),inputSchema:{operation_id:idSchema,target:idSchema,status:z.enum(['open','completed','canceled']),base_revisions:revisionsSchema.optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({operation_id,target,status,base_revisions})=>queueThings([{op:'set_status',operation_id,target,status,base_revisions}]));
    server.registerTool('queue_things_restore',{_meta:writeSecurity,description:'Durably queue moving one to-do out of Things Trash. Things automation has no put-back command, so the Mac moves it out of Trash and keeps its project or area when Things allows; it reports the result after reading Things back. '+thingsGuide,inputSchema:{operation_id:idSchema,target:idSchema,base_revisions:revisionsSchema.optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({operation_id,target,base_revisions})=>queueThings([{op:'restore',operation_id,target,base_revisions}]));
    server.registerTool('queue_things_batch',{_meta:writeSecurity,description:'Durably queue up to 25 explicitly requested Things operations in one call: create, update, move, set_status, trash (to-dos to recoverable Trash) and restore, each with its own operation_id. The whole request is validated first; if any operation is invalid nothing is queued. Operations run in the given order, and may reference temporary ids created earlier in the same request. Never empties Trash. '+thingsGuide+' '+policyDescription(env),inputSchema:{operations:z.array(operationSchema).min(1).max(25)},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}},async({operations})=>queueThings(operations as Record<string,unknown>[]));
    server.registerTool('read_things_operations',{description:'Read the status of up to 50 queued Things operations by operation_id: state, receipt, the real Things ID reported for a temporary id, operations still waiting on a create, and fields Things could not read back.',inputSchema:{operation_ids:z.array(idSchema).min(1).max(50)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({operation_ids})=>{
      const result={operations:await queue.statusMany([...new Set(operation_ids)])};
      return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
    });
  }
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:256*1024});
  await server.connect(transport);
  try {const response=await transport.handleRequest(request);response.headers.set('Cache-Control','no-store');return response;}
  finally {await server.close();}
}
const provider=new OAuthProvider<OAuthEnv>({apiRoute:'/mcp',apiHandler:{fetch:mcp},defaultHandler:{fetch:auth},authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',clientIdMetadataDocumentEnabled:false,scopesSupported:supportedScopes,requiredScopes:[scope,writeScope,localScope],resourceMetadata:{resource,authorization_servers:[origin],resource_name:'LifeOS'},accessTokenTTL:3600,refreshTokenTTL:2592000,clientRegistrationTTL:7776000,onError:()=>{},tokenExchangeCallback(options){if(!owner(options.props,options.env)||options.scope.some(s=>!supportedScopes.includes(s))||options.scope.includes(writeScope)&&!writesEnabled(options.env))throw new OAuthError('invalid_grant',{description:'Owner grant required.'});}});
export default {async fetch(request:Request,env:OAuthEnv,ctx:ExecutionContext):Promise<Response> {
  const path=new URL(request.url).pathname;
  if(path==='/health'||path==='/state'||path.startsWith('/api/'))return mirror.fetch(request,env);
  if(new URL(request.url).origin!==origin)return json({error:'OAuth host denied.'},403);
  if(!env.OAUTH_KV||!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.LIFEOS_GITHUB_OWNER_ID)return json({error:'Dot OAuth setup is not activated. Mac sync remains available.'},503);
  if(request.method==='POST') {
    const chunks:Uint8Array[]=[];let size=0;const reader=request.body?.getReader();
    const budget=path==='/mcp'?256*1024:65536;
    if(reader)for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>budget){void reader.cancel();return json({error:'OAuth/MCP request exceeds budget.'},413);}chunks.push(p.value);}
    const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
    request=new Request(request,{body:bytes});
  }
  return provider.fetch(request,env,ctx);
}};
