import { env } from "cloudflare:workers";
import { demoAPI } from "@/lib/demo-api";
export const dynamic="force-dynamic";
async function handle(request:Request) {
  if(!env.DB)return Response.json({error:"Demo storage is unavailable."},{status:503});
  return demoAPI(request,env.DB);
}
export const GET=handle;
export const POST=handle;
