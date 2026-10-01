import {env} from "cloudflare:workers";
import {mirrorAPI} from "@/lib/mirror-api";
export const dynamic="force-dynamic";
export const GET=(request:Request)=>mirrorAPI(request,env.DB!);
export const POST=GET;
