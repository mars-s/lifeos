import {createHash,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SQLite} from './sqlite.mjs';
import {MirrorStore,mirrorAPI} from './mirror.mjs';

const lists=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const matches=(key,hash)=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&key.length>=32&&key.length<=12000&&timingSafeEqual(Buffer.from(sha(key)),Buffer.from(hash));

function coverage(m) {
  const e=m?.coverage_evidence;
  if(m?.coverage!=='public-top-level-and-all-lists-v2'||!Array.isArray(m.scopes)||[...m.scopes].sort().join(',')!=='area,project,tag,todo'||!e||e.consistent_passes!==2||!Number.isSafeInteger(e.classified_records)||e.classified_records<0||!Array.isArray(e.list_ids)||lists.some(id=>!e.list_ids.includes(id)))throw new Error('Complete supported public-list coverage required.');
}
export function configured(env) {
  const owner=env.LIFEOS_OWNER_ID,adapter=env.LIFEOS_ADAPTER_ID;
  if(!owner||!adapter||owner.length>128||adapter.length>128)throw new Error('Fixed owner and adapter bindings required.');
  const sync=env.LIFEOS_SYNC_KEY_SHA256,read=env.LIFEOS_READ_KEY_SHA256;
  if(!/^[a-f0-9]{64}$/.test(sync??'')||!/^[a-f0-9]{64}$/.test(read??'')||sync===read)throw new Error('Distinct sync and read credential hashes required.');
  return {owner,adapter,sync,read};
}
export function gateway(db,config) {
  // Serialize requests inside the sole instance, including async Store checks.
  let queue=Promise.resolve();
  return request=>{
    const run=queue.then(()=>dispatch(request,db,config));queue=run.catch(()=>{});return run;
  };
}
async function dispatch(request,db,config) {
  const url=new URL(request.url);
  if(url.pathname==='/health'&&request.method==='GET')return response({status:'ok',mode:'read-only mirror'});
  // Railway has no Sites dispatcher: never trust caller-supplied oai identity headers.
  if(url.pathname.startsWith('/api/sync/')) {
    const action=url.pathname.split('/').pop();
    if(!matches(request.headers.get('x-lifeos-sync-key')??'',config.sync))return response({error:'Sync authentication required.'},401);
    if(!['begin','page','commit'].includes(action))return response({error:'Real task writes and operation claims are disabled.'},403);
    try {
      // Preflight has the same byte cap as mirrorAPI and leaves its body intact.
      const reader=request.clone().body?.getReader();if(!reader)return response({error:'Body required.'},400);
      const chunks=[];let size=0;
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>256*1024){await reader.cancel();return response({error:'Request too large.'},413);}chunks.push(part.value);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const store=new MirrorStore(db,config.owner);
      if(action==='begin')coverage(input.manifest);
      if(action==='commit') {
        const saved=await store.upload(input.sequence),manifest=JSON.parse(saved.manifest);coverage(manifest);
        const rows=await store.stmt('SELECT items FROM mirror_pages WHERE owner=? AND sequence=?',config.owner,input.sequence).all();
        const classified=rows.results.flatMap(p=>JSON.parse(p.items)).filter(i=>['todo','project'].includes(i.kind)).length;
        if(classified!==manifest.coverage_evidence.classified_records)return response({error:'Classified inventory count differs; confirmed data unchanged.'},409);
      }
      return await mirrorAPI(request,db,{enabled:'true',owner:config.owner,adapter:config.adapter,keyHash:config.sync});
    }catch{return response({error:'Invalid or incomplete snapshot; confirmed data unchanged.'},409);}
  }
  const bearer=request.headers.get('authorization')??'';
  if(!matches(bearer.startsWith('Bearer ')?bearer.slice(7):'',config.read))return response({error:'Read authentication required.'},401);
  const store=new MirrorStore(db,config.owner);
  if(request.method==='GET'&&url.pathname==='/state') {
    try{return response(await store.state(Number(url.searchParams.get('cursor')??0)));}catch{return response({error:'Invalid cursor.'},400);}
  }
  // Read credential represents access, not a human reviewer: no approvals/edits.
  if(request.method==='POST'&&url.pathname==='/mcp') {
    try {
      const raw=await request.text();if(Buffer.byteLength(raw)>16384)return response({error:'Request too large.'},413);
      const m=JSON.parse(raw);let result;
      if(m.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'lifeos-railway-read-cache',version:'0.1.0'}};
      else if(m.method==='notifications/initialized')return new Response(null,{status:202});
      else if(m.method==='tools/list')result={tools:[{name:'read_things_mirror',description:'Read one page of the last confirmed supported Things snapshot; follow next_cursor. Separate pending overlay. Not live ThingsCloud.',inputSchema:{type:'object',properties:{cursor:{type:'integer',minimum:0}},additionalProperties:false}}]};
      else if(m.method==='tools/call'&&m.params?.name==='read_things_mirror')result={content:[{type:'text',text:JSON.stringify(await store.state(m.params.arguments?.cursor??0))}]};
      else return response({jsonrpc:'2.0',id:m.id??null,error:{code:-32601,message:'Read-only method not found.'}},400);
      return response({jsonrpc:'2.0',id:m.id??null,result});
    }catch{return response({error:'Invalid request.'},400);}
  }
  return response({error:'Read-only route not found.'},404);
}

export function start(env=process.env) {
  const config=configured(env),dir=env.LIFEOS_DATA_DIR??'/data';
  if(env.RAILWAY_ENVIRONMENT_ID&&env.RAILWAY_VOLUME_MOUNT_PATH!==dir)throw new Error('Durable Railway volume must be mounted at the data directory.');
  mkdirSync(dir,{recursive:true,mode:0o700});if(!statSync(dir).isDirectory())throw new Error('Data directory unavailable.');
  process.umask(0o077);
  const migrations=['0000_equal_spyke.sql','0001_hard_katie_power.sql'].map(name=>fileURLToPath(new URL('./migrations/'+name,import.meta.url)));
  const db=new SQLite(join(dir,'mirror.sqlite3'),migrations),handler=gateway(db,config);
  const server=createServer(async(req,res)=>{
    try {
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>256*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const request=new Request('https://gateway.invalid'+req.url,{method:req.method,headers:req.headers,...chunks.length?{body:Buffer.concat(chunks)}:{}});
      const reply=await handler(request);res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(Buffer.from(await reply.arrayBuffer()));
    }catch{res.writeHead(503);res.end('{"error":"Service unavailable."}');}
  });
  server.headersTimeout=10000;server.requestTimeout=30000;server.keepAliveTimeout=5000;
  server.listen(Number(env.PORT??8080),'0.0.0.0');
  const stop=()=>server.close(()=>{db.close();process.exit(0);});process.once('SIGTERM',stop);process.once('SIGINT',stop);
  return {server,db};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try{start();}catch{console.error('LifeOS startup failed: check durable storage and fixed authentication configuration.');process.exitCode=1;}
}
