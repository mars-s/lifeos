import {canonical,fingerprint,type Cell} from '../site/lib/mirror-store';
import {DemoError} from '../site/lib/demo-store';

type Request={id:string;target:string;field:'title'|'status'|'in_trash_list';value:string|boolean;base_revision:number};
export type NativeOperation={id:string;state:string;claim:string|null;ordinal:number;
  payload:{target:string;kind:string;field:'title'|'status'|'in_trash_list';value:string|boolean;base:Cell;conflict_policy:'things_wins'};
  result:unknown;created_at:string;updated_at:string};
type Row=Omit<NativeOperation,'payload'|'result'>&{payload:string;result:string|null};
const decode=(r:Row):NativeOperation=>({...r,payload:JSON.parse(r.payload),result:r.result?JSON.parse(r.result):null});
const now=()=>new Date().toISOString();
function validID(id:unknown){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new DemoError('Invalid operation or target ID.');}
export class NativeQueue {
  constructor(private db:Pick<D1Database,'prepare'|'batch'>,private owner:string) {}
  stmt(sql:string,...args:unknown[]){return this.db.prepare(sql).bind(...args);}
  async get(id:string){const r=await this.stmt('SELECT * FROM native_operations WHERE owner=? AND id=?',this.owner,id).first<Row>();if(!r)throw new DemoError('Operation not found.',404);return decode(r);}
  async enqueue(input:Request) {
    validID(input.id);validID(input.target);
    if(!['title','status','in_trash_list'].includes(input.field)||input.field==='title'&&(typeof input.value!=='string'||!input.value.trim()||input.value.length>4000)||input.field==='status'&&input.value!=='completed'||input.field==='in_trash_list'&&input.value!==true||!Number.isSafeInteger(input.base_revision)||input.base_revision<1)throw new DemoError('Supported edits are title changes, task completion and moving to-dos to Trash.');
    if(Object.keys(input).sort().join(',')!=='base_revision,field,id,target,value')throw new DemoError('Unexpected operation fields.');
    const hash=await fingerprint(input);
    const old=await this.stmt('SELECT request_hash FROM native_operations WHERE owner=? AND id=?',this.owner,input.id).first<{request_hash:string}>();
    if(old){if(old.request_hash!==hash)throw new DemoError('Operation ID reused for a different request.');return this.get(input.id);}
    const row=await this.stmt('SELECT kind,fields,deleted FROM mirror_items WHERE owner=? AND id=?',this.owner,input.target).first<{kind:string;fields:string;deleted:number}>();
    if(!row||row.deleted||!['todo','project'].includes(row.kind)||['status','in_trash_list'].includes(input.field)&&row.kind!=='todo')throw new DemoError('This target is missing or read-only.');
    const cells=JSON.parse(row.fields) as Record<string,Cell>,cell=cells[input.field];
    if(!cell||cell.state!=='value'||typeof cell.value!==(input.field==='in_trash_list'?'boolean':'string')||cells.in_trash_list?.value===true)throw new DemoError('This field or target is unavailable.');
    const payload={target:input.target,kind:row.kind,field:input.field,value:input.value,base:{state:'value',value:cell.value},conflict_policy:'things_wins'};
    const date=now(),guard=`EXISTS(SELECT 1 FROM mirror_items WHERE owner=? AND id=? AND deleted=0 AND COALESCE(json_extract(fields,'$.in_trash_list.value'),0)=0 AND json_extract(fields,?)=?)`;
    // The insertion and superseding of earlier unclaimed edits are one D1 transaction.
    await this.db.batch([
      this.stmt(`INSERT OR IGNORE INTO native_operations(owner,id,request_hash,payload,state,result,created_at,updated_at) VALUES(?,?,?,?,CASE WHEN ${guard} THEN 'queued' ELSE 'skipped' END,CASE WHEN ${guard} THEN NULL ELSE '{"state":"skipped","reason":"things_changed"}' END,?,?)`,this.owner,input.id,hash,canonical(payload),this.owner,input.target,'$.'+input.field+'.revision',input.base_revision,this.owner,input.target,'$.'+input.field+'.revision',input.base_revision,date,date),
      this.stmt(`UPDATE native_operations SET state='superseded',result='{"state":"superseded","reason":"newer_cloud_edit"}',updated_at=? WHERE owner=? AND state='queued' AND id<>? AND json_extract(payload,'$.target')=? AND json_extract(payload,'$.field')=? AND ordinal<(SELECT ordinal FROM native_operations WHERE owner=? AND id=? AND request_hash=? AND state='queued')`,date,this.owner,input.id,input.target,input.field,this.owner,input.id,hash)
    ]);
    const saved=await this.stmt('SELECT request_hash FROM native_operations WHERE owner=? AND id=?',this.owner,input.id).first<{request_hash:string}>();
    if(saved?.request_hash!==hash)throw new DemoError('Concurrent operation ID reuse.');
    return this.get(input.id);
  }
  async pending(){return (await this.stmt("SELECT * FROM native_operations WHERE owner=? AND state IN ('queued','executing') ORDER BY ordinal LIMIT 20",this.owner).all<Row>()).results.map(decode);}
  async recent(){return (await this.stmt('SELECT * FROM native_operations WHERE owner=? ORDER BY ordinal DESC LIMIT 100',this.owner).all<Row>()).results.map(decode);}
  async claim(id:string,claim:string){
    validID(id);validID(claim);
    await this.stmt(`UPDATE native_operations SET state='executing',claim=?,updated_at=? WHERE owner=? AND id=? AND state='queued' AND NOT EXISTS(SELECT 1 FROM native_operations other WHERE other.owner=native_operations.owner AND other.state='executing' AND json_extract(other.payload,'$.target')=json_extract(native_operations.payload,'$.target'))`,claim,now(),this.owner,id).run();
    const op=await this.get(id);if(op.state!=='executing'||op.claim!==claim)throw new DemoError('Another operation owns this target.',409);return op;
  }
  async ack(id:string,claim:string,result:{state:string;reason?:string}) {
    validID(id);validID(claim);
    if(!result||!['applied','satisfied','skipped','failed','uncertain'].includes(result.state)||Object.keys(result).some(k=>!['state','reason'].includes(k))||result.reason!==undefined&&!['things_changed','target_unavailable','automation_denied','verification_failed','interrupted_write'].includes(result.reason))throw new DemoError('Invalid receipt.');
    const op=await this.get(id);if(op.claim!==claim)throw new DemoError('Claim mismatch.');
    if(op.state!=='executing'){if(canonical(op.result)!==canonical(result))throw new DemoError('A final receipt cannot change.');return op;}
    await this.stmt("UPDATE native_operations SET state=?,result=?,updated_at=? WHERE owner=? AND id=? AND state='executing' AND claim=?",result.state,canonical(result),now(),this.owner,id,claim).run();
    const saved=await this.get(id);if(canonical(saved.result)!==canonical(result))throw new DemoError('Receipt raced another acknowledgement.');return saved;
  }
}
