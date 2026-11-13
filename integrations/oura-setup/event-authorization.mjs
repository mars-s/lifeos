// Storage adapter pinned to @cloudflare/workers-oauth-provider 1.2.1.
// Receives ctx.auth only after provider validation. Retains a non-reversible token
// fingerprint and grant ID, never the bearer token itself.
export async function eventPrincipal(auth,props){
 if(auth?.userId!=='lifeos-owner'||props?.owner!=='lifeos-owner'||!auth.scope?.includes('oura:read')||!auth.clientId||!props.connectionId||!Number.isFinite(auth.expiresAt))return null;
 const parts=auth.token?.split(':');if(parts?.length!==3||parts[0]!==auth.userId||!parts[1]||parts[1].length>256)return null;
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(auth.token));
 return {owner:auth.userId,clientId:auth.clientId,connectionId:props.connectionId,expiresAt:auth.expiresAt*1000,grantId:parts[1],tokenId:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};
}
export function grantChecker({kv,getConnectionId,resource,now=()=>Date.now()}){return async p=>{
 try{
 if(p?.owner!=='lifeos-owner'||!p.clientId||!p.connectionId||!Number.isFinite(p.expiresAt)||p.expiresAt<=now()||typeof p.grantId!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(p.grantId)||! /^[a-f0-9]{64}$/.test(p.tokenId))return false;
 const [token,grant,client,connectionId]=await Promise.all([kv.get(`token:${p.owner}:${p.grantId}:${p.tokenId}`,{type:'json'}),kv.get(`grant:${p.owner}:${p.grantId}`,{type:'json'}),kv.get(`client:${p.clientId}`,{type:'json'}),getConnectionId()]);
 return !!(token&&grant&&client&&connectionId===p.connectionId&&token.userId===p.owner&&token.grantId===p.grantId&&token.expiresAt*1000>now()&&token.audience===resource&&token.scope?.includes('oura:read')&&token.grant?.clientId===p.clientId&&grant.clientId===p.clientId&&grant.userId===p.owner&&grant.scope?.includes('oura:read')&&(!grant.expiresAt||grant.expiresAt*1000>now()));
 }catch{return false;}
};}
