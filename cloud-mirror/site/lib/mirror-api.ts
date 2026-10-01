import {identity} from "./demo-api";
import {DemoError} from "./demo-store";
import {MirrorStore} from "./mirror-store";
type ServiceConfig={owner?:string;adapter?:string;keyHash?:string;enabled?:string};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function mirrorAPI(request:Request,db:Pick<D1Database,"prepare"|"batch">,service?:ServiceConfig) {
  try {
    const url=new URL(request.url),action=url.pathname.split("/").pop();
    let owner:string;
    if(service) {
      // Dispatcher bypass is consumed upstream and supplies no human identity.
      // Independent app authentication plus fixed owner/adapter binding is mandatory.
      if(service.enabled!=="true"||!service.owner||!service.adapter||!service.keyHash)throw new DemoError("Mac sync access is not configured.",503);
      const key=request.headers.get("x-lifeos-sync-key")??"";
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key)))).map(x=>x.toString(16).padStart(2,"0")).join("");
      let diff=hash.length^service.keyHash.length;for(let n=0;n<hash.length;n++)diff|=hash.charCodeAt(n)^(service.keyHash.charCodeAt(n)||0);
      if(key.length<32||diff)throw new DemoError("Sync authentication required.",401);
      owner=service.owner;
      if(!["begin","page","commit","pending","claim","ack"].includes(action??""))throw new DemoError("Service route not allowed.",403);
    }else owner=identity(request);
    const store=new MirrorStore(db,owner);
    if(request.method==="GET"&&action==="state"&&!service)return reply({...await store.state(Number(url.searchParams.get("cursor")??0)),owner_binding_id:owner});
    if(request.method==="GET"&&action==="pending"&&service)return reply(await store.pending());
    if(request.method!=="POST")return reply({error:"Route not found."},404);
    if(request.headers.get("origin")&&request.headers.get("origin")!==url.origin)throw new DemoError("Origin mismatch.",403);
    if(!request.headers.get("content-type")?.includes("application/json"))throw new DemoError("JSON required.",415);
    // Bounded stream read avoids materializing an arbitrarily large body.
    const reader=request.body?.getReader();if(!reader)throw new DemoError("Body required.",400);
    let size=0;const chunks:Uint8Array[]=[];for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>256*1024){await reader.cancel();throw new DemoError("Request too large.",413);}chunks.push(part.value);}
    const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=="object"||Array.isArray(body))throw new DemoError("Object required.",400);
    if(!service) {
      if(action==="propose")return reply(await store.propose(body));
      if(action==="approve"||action==="reject")return reply(await store.decide(body.id,body.revision,action==="approve"));
    }else {
      if(action==="begin")return reply(await store.begin(body));
      if(action==="page")return reply(await store.page(body));
      if(action==="commit")return reply(await store.commit(body.sequence));
      if(action==="claim")return reply(await store.claim(body.id,body.claim));
      if(action==="ack")return reply(await store.ack(body.id,body.claim,body.result));
    }
    return reply({error:"Route not found."},404);
  }catch(error) {
    if(error instanceof DemoError)return reply({error:error.message},error.status);
    if(error instanceof SyntaxError||error instanceof TypeError)return reply({error:"Invalid request."},400);
    return reply({error:"Storage request failed; refresh before retrying."},503);
  }
}
