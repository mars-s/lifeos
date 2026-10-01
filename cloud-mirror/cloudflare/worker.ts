import {MirrorStore,fingerprint} from '../site/lib/mirror-store';
import {NativeQueue} from './native-queue';
import {ownerSync} from './owner-sync';
import {mirrorAPI} from '../site/lib/mirror-api';
import {BulkD1} from './d1-bulk';
import {timingSafeEqual} from 'node:crypto';
// Wrangler generates the nonsecret bindings; secret bindings are optional until
// the user-mediated provisioning step completes.
declare global {interface Env {LIFEOS_SYNC_KEY_SHA256?:string;LIFEOS_READ_KEY_SHA256?:string;LIFEOS_AGENT_KEY_SHA256?:string}}
export const writesEnabled=(env:Env)=>env.LIFEOS_WRITES_ENABLED==='true'&&!!env.LIFEOS_AGENT_KEY_SHA256;

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
    if(url.pathname==='/health'&&request.method==='GET')return reply({status:'ok',mode:writesEnabled(env)?'queued mirror edits':'read-only mirror',configured:!!env.LIFEOS_OWNER_ID&&!!env.LIFEOS_SYNC_KEY_SHA256});
    if(!env.DB||!env.LIFEOS_OWNER_ID||!env.LIFEOS_ADAPTER_ID)return reply({error:'Private mirror setup incomplete.'},503);
    if(env.LIFEOS_SYNC_KEY_SHA256&&env.LIFEOS_SYNC_KEY_SHA256===env.LIFEOS_READ_KEY_SHA256)return reply({error:'Distinct role credentials required.'},503);
    // D1 has transaction-level guards, never rely on per-isolate serialization.
    const db=new BulkD1(env.DB),store=new MirrorStore(db,env.LIFEOS_OWNER_ID);
    try {
      if(url.pathname.startsWith('/api/native/')) {
        if(!writesEnabled(env))return reply({error:'Native write activation pending.'},503);
        if(!await matches(request.headers.get('x-lifeos-agent-key')??'',env.LIFEOS_AGENT_KEY_SHA256))return reply({error:'Native agent authentication required.'},401);
        if(request.headers.has('origin'))return reply({error:'Native routes do not accept browser requests.'},403);
        const queue=new NativeQueue(db,env.LIFEOS_OWNER_ID),action=url.pathname.split('/').pop();
        if(action==='events'&&request.method==='GET'){
          if(url.search||request.headers.get('upgrade')?.toLowerCase()!=='websocket')return reply({error:'Native WebSocket required.'},400);
          return ownerSync(env).fetch(request);
        }
        if(action==='pending'&&request.method==='GET')return reply({sequence:(await store.meta())?.sequence??0,revision:await queue.revision(),operations:await queue.pending(),overlaysNeedConfirmation:await queue.overlaysNeedConfirmation()});
        if(request.method!=='POST'||!['snapshot','claim','ack','operation'].includes(action??''))return reply({error:'Native route not found.'},404);
        if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
        const input=JSON.parse(new TextDecoder().decode(await body(request,1024*1024)));
        if(action==='operation')return reply(await queue.operationStatus(input.id));
        if(action==='claim')return reply(await queue.claim(input.id,input.claim));
        if(action==='ack')return reply(await queue.ack(input.id,input.claim,input.result,input.applied_after_sequence!==undefined?{applied_after_sequence:input.applied_after_sequence,...input.observed_before!==undefined?{observed_before:input.observed_before}:{},...input.verified_after!==undefined?{verified_after:input.verified_after}:{}}:undefined));
        if(!Array.isArray(input.items)||input.items.length>10000||Object.keys(input).sort().join(',')!=='items,manifest,sequence')return reply({error:'Complete inventory required.'},409);
        coverage(input.manifest);
        if(input.items.filter((i:{kind:string})=>['todo','project'].includes(i.kind)).length!==input.manifest.coverage_evidence.classified_records)return reply({error:'Classification count mismatch.'},409);
        const pages=[];for(let n=0;n<input.items.length;n+=100)pages.push(input.items.slice(n,n+100));if(!pages.length)pages.push([]);
        const manifest={...input.manifest,count:input.items.length,page_hashes:await Promise.all(pages.map(fingerprint))};
        await store.begin({sequence:input.sequence,manifest});
        for(let page=0;page<pages.length;page++)await store.page({sequence:input.sequence,page,items:pages[page]});
        const result=await store.commit(input.sequence);
        // Preserve retry receipts while bounding retained snapshot transport data.
        await env.DB.batch([
          env.DB.prepare('DELETE FROM mirror_pages WHERE owner=? AND sequence IN(SELECT sequence FROM mirror_uploads WHERE owner=? AND committed=1 ORDER BY sequence DESC LIMIT -1 OFFSET 2)').bind(env.LIFEOS_OWNER_ID,env.LIFEOS_OWNER_ID),
          env.DB.prepare('DELETE FROM mirror_uploads WHERE owner=? AND committed=1 AND sequence IN(SELECT sequence FROM mirror_uploads WHERE owner=? AND committed=1 ORDER BY sequence DESC LIMIT -1 OFFSET 2)').bind(env.LIFEOS_OWNER_ID,env.LIFEOS_OWNER_ID)
        ]);
        return reply(result);
      }
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
