import {env} from "cloudflare:workers";
import {mirrorAPI} from "@/lib/mirror-api";
export const dynamic="force-dynamic";
export const GET=(request:Request)=>{
  const e=env as unknown as Record<string,string>;
  return mirrorAPI(request,env.DB!,{owner:e.LIFEOS_SYNC_OWNER,adapter:e.LIFEOS_SYNC_ADAPTER,keyHash:e.LIFEOS_SYNC_KEY_SHA256,enabled:e.LIFEOS_SYNC_ENABLED});
};
export const POST=GET;
