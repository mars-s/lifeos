import { env } from "cloudflare:workers";
import { identity } from "@/lib/demo-api";
import { DemoStore } from "@/lib/demo-store";
import {MirrorStore} from "@/lib/mirror-store";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  try {
    const message=await request.json() as {id?:number|string;method:string;params?:{name:string;arguments:{cursor?:number}}};
    const tools=[{name:"read_synthetic_cache",description:"Read your synthetic LifeOS demo cache. No live Things or Calendar access.",inputSchema:{type:"object",properties:{},additionalProperties:false}}];
    const mirrorRead={name:"read_things_mirror",description:"Read one page of your last confirmed supported Things mirror and separate pending overlay. Follow next_cursor until null. Empty until approved Mac upload. Not live ThingsCloud.",inputSchema:{type:"object",properties:{cursor:{type:"integer",minimum:0}},additionalProperties:false}};
    const mirrorPropose={name:"propose_mirror_edit",description:"Create an immutable draft for owner review. One title/notes field, or separate cloud-only planning priority. Does not approve or execute.",inputSchema:{type:"object",properties:{id:{type:"string"},target:{type:"string"},fields:{type:"object"},base_revisions:{type:"object"},zone:{type:"string"},planning:{type:"boolean"},plan_revision:{type:"integer"}},required:["id","target","fields","base_revisions","zone"],additionalProperties:false}};
    let result:unknown;
    if(message.method==="initialize")result={protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"lifeos-synthetic-cache",version:"0.1.0"}};
    else if(message.method==="notifications/initialized")return new Response(null,{status:202});
    else if(message.method==="tools/list")result={tools:[...tools,mirrorRead,mirrorPropose]};
    else if(message.method==="tools/call"&&message.params?.name==="read_synthetic_cache") {
      const owner=identity(request);if(!env.DB)throw new Error("storage unavailable");
      result={content:[{type:"text",text:JSON.stringify(await new DemoStore(env.DB,owner).state())}]};
    }else if(message.method==="tools/call"&&["read_things_mirror","propose_mirror_edit"].includes(message.params?.name??"")) {
      const owner=identity(request);if(!env.DB)throw new Error("storage unavailable");const store=new MirrorStore(env.DB,owner);
      const data=message.params!.name==="read_things_mirror"?await store.state(message.params?.arguments?.cursor??0):await store.propose(message.params!.arguments as Parameters<MirrorStore["propose"]>[0]);
      result={content:[{type:"text",text:JSON.stringify(data)}]};
    }else return Response.json({jsonrpc:"2.0",id:message.id??null,error:{code:-32601,message:"Method not found"}},{status:400});
    return Response.json({jsonrpc:"2.0",id:message.id??null,result},{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"Authenticated owner context required; live sync is disabled."},{status:401});}
}
