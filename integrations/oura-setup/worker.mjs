import {setupResponse} from './setup-pages.mjs';
import {ready,ORIGIN,json,page,forwardVault} from './integration.mjs';
export {OuraVault} from './integration.mjs';
const dynamic=new Set(['/oura/connect','/oura/callback','/oura/status','/oura/disconnect','/oura/webhook','/mcp']);
export default {async fetch(request,env,ctx){
 try{
  const url=new URL(request.url);if(url.origin!==ORIGIN)return json({error:'Host denied.'},403);
  const clientOAuth=url.pathname==='/mcp'||url.pathname==='/authorize'||url.pathname.startsWith('/oauth/')||url.pathname.startsWith('/.well-known/');
  if(clientOAuth){
   if(!ready(env)||!env.OAUTH_KV)return page('<p>Client OAuth is not configured.</p>',503);
   const origin=request.headers.get('origin');if(origin&&![ORIGIN,'https://chatgpt.com','https://chat.openai.com'].includes(origin))return json({error:'Origin denied.'},403);
   if(request.method==='POST'){const reader=request.body?.getReader(),chunks=[];let total=0;if(reader)for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>16384){await reader.cancel();return json({error:'Request too large.'},413);}chunks.push(part.value);}const bytes=new Uint8Array(total);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}request=new Request(request,{body:bytes});}
   const {provider}=await import('./client-oauth.mjs');return provider.fetch(request,env,ctx);
  }
  if(dynamic.has(url.pathname)){
   if(!ready(env))return page('<p>Integration is not configured. No authorization or health access is active.</p>',503);
   return forwardVault(request,env);
  }
  if(url.pathname==='/oura/connected')return page('<p>Use the authenticated status endpoint to confirm connection state. No health records are shown here.</p>');
  return setupResponse(request)??json({error:'Not found.'},404);
 }catch{return json({error:'Request failed safely.'},502);}
}};
