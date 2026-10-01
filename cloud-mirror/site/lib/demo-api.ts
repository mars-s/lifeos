import { DemoError, DemoStore } from "./demo-store";

// Trusted only behind the Sites dispatcher (or synthetic local test harness).
// Public requests and identity-less service requests cannot use any data route.
export function identity(request:Request):string {
  const id=request.headers.get("oai-authenticated-user-id");
  const email=request.headers.get("oai-authenticated-user-email");
  if(!id||!email)throw new DemoError("Sign in to access this private demo.",401);
  return id;
}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});

export async function demoAPI(request:Request,db:D1Database):Promise<Response> {
  try {
    const owner=identity(request), url=new URL(request.url), action=url.pathname.split("/").pop();
    const store=new DemoStore(db,owner);
    if(request.method==="GET"&&action==="state")return reply(await store.state());
    if(request.method!=="POST")return reply({error:"Route not found"},404);
    if(request.headers.get("origin")&&request.headers.get("origin")!==url.origin)throw new DemoError("Request origin does not match this Site.",403);
    if(!request.headers.get("content-type")?.includes("application/json"))throw new DemoError("Use a JSON request.",415);
    const raw=await request.text();if(raw.length>16384)throw new DemoError("Request is too large.",413);
    const body=JSON.parse(raw);
    if(!body||typeof body!=="object"||Array.isArray(body))throw new DemoError("JSON object required.",400);
    if(action==="seed")return reply(await store.seed());
    if(action==="propose")return reply(await store.propose(body));
    if(action==="approve"||action==="reject")return reply(await store.decide(body.id,body.revision,action==="approve"));
    if(action==="reconnect")return reply(await store.reconnect());
    if(action==="offline")return reply(await store.setOffline());
    if(action==="conflict")return reply(await store.conflict(body.target));
    return reply({error:"Route not found"},404);
  }catch(error) {
    if(error instanceof DemoError)return reply({error:error.message},error.status);
    if(error instanceof SyntaxError||error instanceof TypeError)return reply({error:"Invalid request. Refresh and try again."},400);
    return reply({error:"Demo storage is unavailable. Your submitted changes may have been saved; refresh before retrying."},503);
  }
}
