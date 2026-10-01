import {MirrorStore} from '../site/lib/mirror-store';
import {mirrorAPI} from '../site/lib/mirror-api';
import {BulkD1} from './d1-bulk';
import {timingSafeEqual} from 'node:crypto';
// Wrangler generates the nonsecret bindings; secret bindings are optional until
// the user-mediated provisioning step completes.
declare global {interface Env {LIFEOS_SYNC_KEY_SHA256?:string;LIFEOS_READ_KEY_SHA256?:string}}

const lists=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function matches(key:string,expected:string|undefined) {
  if(!expected||!/^[a-f0-9]{64}$/.test(expected)||key.length<32||key.length>4096)return false;
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
  const bytes=Uint8Array.from(expected.match(/../g)!,n=>parseInt(n,16));
  return timingSafeEqual(hash,bytes);
}
async function body(request:Request,limit:number) {
  const reader=request.body?.getReader();if(!reader)throw new Error('Body required');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>limit){void reader.cancel();throw new RangeError('Too large');}chunks.push(p.value);}
  const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}return bytes;
}
function coverage(m:Record<string,unknown>) {
  const e=m?.coverage_evidence as {consistent_passes?:number;classified_records?:number;list_ids?:string[]}|undefined;
  if(m?.coverage!=='public-top-level-and-all-lists-v2'||!Array.isArray(m.scopes)||[...m.scopes].sort().join(',')!=='area,project,tag,todo'||!e||e.consistent_passes!==2||!Number.isSafeInteger(e.classified_records)||e.classified_records!<0||!Array.isArray(e.list_ids)||lists.some(id=>!e.list_ids!.includes(id)))throw new Error('Incomplete public coverage');
}
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')return reply({status:'ok',mode:'read-only mirror',configured:!!env.LIFEOS_OWNER_ID&&!!env.LIFEOS_SYNC_KEY_SHA256});
    if(!env.DB||!env.LIFEOS_OWNER_ID||!env.LIFEOS_ADAPTER_ID)return reply({error:'Private mirror setup incomplete.'},503);
    if(env.LIFEOS_SYNC_KEY_SHA256&&env.LIFEOS_SYNC_KEY_SHA256===env.LIFEOS_READ_KEY_SHA256)return reply({error:'Distinct role credentials required.'},503);
    // D1 has transaction-level guards, never rely on per-isolate serialization.
    const db=new BulkD1(env.DB),store=new MirrorStore(db,env.LIFEOS_OWNER_ID);
    try {
      if(url.pathname.startsWith('/api/sync/')) {
        if(!await matches(request.headers.get('x-lifeos-sync-key')??'',env.LIFEOS_SYNC_KEY_SHA256))return reply({error:'Sync authentication required.'},401);
        const action=url.pathname.split('/').pop();
        if(!['begin','page','commit'].includes(action??''))return reply({error:'Task writes and review decisions are disabled.'},403);
        if(request.method!=='POST')return reply({error:'POST required.'},405);
        const bytes=await body(request,256*1024),input=JSON.parse(new TextDecoder().decode(bytes));
        if(action==='begin')coverage(input.manifest);
        if(action==='commit') {
          const saved=await store.upload(input.sequence),m=JSON.parse(saved.manifest);coverage(m);
          const pages=await store.stmt('SELECT items FROM mirror_pages WHERE owner=? AND sequence=?',env.LIFEOS_OWNER_ID,input.sequence).all<{items:string}>();
          // Bound commit CPU/memory. Never truncate a snapshot to fit Free limits.
          if(pages.results.reduce((n,p)=>n+new TextEncoder().encode(p.items).length,0)>1024*1024)return reply({error:'Snapshot exceeds first-phase 1 MiB budget; confirmed data unchanged.'},413);
          const count=pages.results.flatMap(p=>JSON.parse(p.items)).filter(i=>['todo','project'].includes(i.kind)).length;
          if(count!==m.coverage_evidence.classified_records)return reply({error:'Incomplete classified inventory; confirmed data unchanged.'},409);
        }
        const result=await mirrorAPI(new Request(request.url,{method:request.method,headers:request.headers,body:bytes}),db,{enabled:'true',owner:env.LIFEOS_OWNER_ID,adapter:env.LIFEOS_ADAPTER_ID,keyHash:env.LIFEOS_SYNC_KEY_SHA256});
        if(action==='commit'&&result.ok) {
          // Keep the two newest committed transport snapshots for retry receipts.
          // Confirmed fields, tombstones, pending operations and audit are retained.
          // Cleanup failure must not turn a successful durable commit into failure.
          try {await env.DB.batch([
            env.DB.prepare('DELETE FROM mirror_pages WHERE owner=? AND sequence IN(SELECT sequence FROM mirror_uploads WHERE owner=? AND committed=1 ORDER BY sequence DESC LIMIT -1 OFFSET 2)').bind(env.LIFEOS_OWNER_ID,env.LIFEOS_OWNER_ID),
            env.DB.prepare('DELETE FROM mirror_uploads WHERE owner=? AND committed=1 AND sequence IN(SELECT sequence FROM mirror_uploads WHERE owner=? AND committed=1 ORDER BY sequence DESC LIMIT -1 OFFSET 2)').bind(env.LIFEOS_OWNER_ID,env.LIFEOS_OWNER_ID)
          ]);}catch{/* Retried at next successful commit; no private diagnostics. */}
        }
        return result;
      }
      // These are access credentials, never an owner-authenticated reviewer.
      // Caller-supplied Sites identity headers are deliberately ignored.
      const auth=request.headers.get('authorization')??'';
      if(!await matches(auth.startsWith('Bearer ')?auth.slice(7):'',env.LIFEOS_READ_KEY_SHA256))return reply({error:'Read authentication required.'},401);
      if(env.LIFEOS_READ_KEY_SHA256===env.LIFEOS_SYNC_KEY_SHA256)return reply({error:'Distinct role credentials required.'},503);
      if(url.pathname==='/state'&&request.method==='GET')return reply(await store.state(Number(url.searchParams.get('cursor')??0)));
      // Dot OAuth remains a separate integration gate. No static-token MCP is advertised.
      return reply({error:'Read-only route not found.'},404);
    }catch(error) {
      return reply({error:error instanceof RangeError?'Request too large.':'Invalid or incomplete request; confirmed data unchanged.'},error instanceof RangeError?413:409);
    }
  }
};
