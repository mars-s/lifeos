import {WorkerEntrypoint} from 'cloudflare:workers';
import {ORIGIN,ready,forwardVault} from './integration.mjs';

// A named entrypoint has no public URL. Only Workers whose own configuration binds
// service lifeos-app-setup with entrypoint HealthReader can call it, so no shared secret
// crosses Workers. Callers must enforce their own owner and health:read checks first.
export class HealthReader extends WorkerEntrypoint {
 async read(kind,args){
  if(!ready(this.env))return {ok:false,reason:'unavailable'};
  try{
   const response=await forwardVault(new Request(ORIGIN+'/oura/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,args})}),this.env,true);
   return await response.json();
  }catch{return {ok:false,reason:'unavailable'};}
 }
}
