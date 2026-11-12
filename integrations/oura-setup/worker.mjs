import {setupResponse} from './setup-pages.mjs';
import {ready,ORIGIN,json,page,forwardVault} from './integration.mjs';
export {OuraVault} from './integration.mjs';
const dynamic=new Set(['/oura/connect','/oura/callback','/oura/status','/oura/disconnect','/oura/webhook','/mcp']);
const resourceDiscovery='/.well-known/oauth-protected-resource';
const protocolRoutes=new Map([
 [resourceDiscovery,['GET','HEAD']],
 [resourceDiscovery+'/mcp',['GET','HEAD']],
 ['/.well-known/oauth-authorization-server',['GET','HEAD']],
 ['/oauth/register',['POST']],['/oauth/token',['POST']],['/mcp',['GET','POST']]
]);
const protocolHeaders=['authorization','content-type','accept','mcp-protocol-version','mcp-session-id','last-event-id'];
function cors(response,methods){
 const h=new Headers(response.headers);h.set('Access-Control-Allow-Origin','*');h.delete('Access-Control-Allow-Credentials');
 h.set('Access-Control-Allow-Methods',[...methods,'OPTIONS'].join(', '));h.set('Access-Control-Allow-Headers',protocolHeaders.join(', '));
 h.set('Access-Control-Expose-Headers','WWW-Authenticate, Retry-After, MCP-Session-Id, MCP-Protocol-Version');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}
async function clientResponse(request,env,ctx){
 try{
  if(!ready(env)||!env.OAUTH_KV)return page('<p>Client OAuth is not configured.</p>',503);
  if(new URL(request.url).pathname===resourceDiscovery)return new Response(null,{status:307,headers:{Location:ORIGIN+resourceDiscovery+'/mcp','Cache-Control':'no-store'}});
  if(request.method==='POST'){const reader=request.body?.getReader(),chunks=[];let total=0;if(reader)for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>16384){await reader.cancel();return json({error:'Request too large.'},413);}chunks.push(part.value);}const bytes=new Uint8Array(total);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}request=new Request(request,{body:bytes});}
  const {provider}=await import('./client-oauth.mjs');return await provider.fetch(request,env,ctx);
 }catch{return json({error:'Request failed safely.'},502);}
}
export default {async fetch(request,env,ctx){
 try{
  const url=new URL(request.url);if(url.origin!==ORIGIN)return json({error:'Host denied.'},403);
  const methods=protocolRoutes.get(url.pathname);
  if(methods){
   // The fixed host check above prevents DNS rebinding. These routes use bearer/PKCE
   // authentication, not browser cookies; consent and owner routes have no CORS.
   if(request.method==='OPTIONS'){
    const method=request.headers.get('access-control-request-method'),requested=request.headers.get('access-control-request-headers');
    if((method&&!methods.includes(method))||(requested&&requested.split(',').some(h=>!protocolHeaders.includes(h.trim().toLowerCase()))))return json({error:'Preflight denied.'},403);
    return cors(new Response(null,{status:204}),methods);
   }
   if(!methods.includes(request.method))return json({error:'Method not allowed.'},405,{Allow:[...methods,'OPTIONS'].join(', ')});
   return cors(await clientResponse(request,env,ctx),methods);
  }
  if(url.pathname==='/authorize'){
   if(request.method==='POST'&&request.headers.get('origin')!==ORIGIN)return json({error:'Same-origin form required.'},403);
   return clientResponse(request,env,ctx);
  }
  if(dynamic.has(url.pathname)){
   if(!ready(env))return page('<p>Integration is not configured. No authorization or health access is active.</p>',503);
   return forwardVault(request,env);
  }
  if(url.pathname==='/oura/connected')return page('<p>Use the authenticated status endpoint to confirm connection state. No health records are shown here.</p>');
  return setupResponse(request)??json({error:'Not found.'},404);
 }catch{return json({error:'Request failed safely.'},502);}
}};
