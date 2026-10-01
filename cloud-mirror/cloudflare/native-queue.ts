import {canonical,fingerprint,type Cell} from '../site/lib/mirror-store';
import {DemoError} from '../site/lib/demo-store';

export type EnqueueRequest={id:string;target:string;field:'title'|'status'|'in_trash_list';value:string|boolean;base_revision:number};
export type ReceiptAudit={applied_after_sequence:number;observed_before?:unknown;verified_after?:unknown};
export type PreparedEnqueue={input:EnqueueRequest;hash:string;payload:NativeOperation['payload'];date:string};
export type NativeOperation={id:string;state:string;claim:string|null;ordinal:number;
  payload:{target:string;kind:string;field:'title'|'status'|'in_trash_list';value:string|boolean;base:Cell;conflict_policy:'things_wins'|'cloud_wins';version?:2;base_revision?:number};
  result:unknown;created_at:string;updated_at:string};
type Row=Omit<NativeOperation,'payload'|'result'>&{payload:string;result:string|null};
const decode=(r:Row):NativeOperation=>({...r,payload:JSON.parse(r.payload),result:r.result?JSON.parse(r.result):null});
const now=()=>new Date().toISOString();
function validID(id:unknown){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new DemoError('Invalid operation or target ID.');}
export class NativeQueue {
  constructor(private db:Pick<D1Database,'prepare'|'batch'>,private owner:string) {}
  stmt(sql:string,...args:unknown[]){return this.db.prepare(sql).bind(...args);}
  async get(id:string){const r=await this.stmt('SELECT * FROM native_operations WHERE owner=? AND id=?',this.owner,id).first<Row>();if(!r)throw new DemoError('Operation not found.',404);return decode(r);}
  async operationStatus(id:string){
    const op=await this.get(id);
    const desired=await this.stmt('SELECT ordinal FROM native_desired_fields WHERE owner=? AND target=? AND field=?',this.owner,op.payload.target,op.payload.field).first<{ordinal:number}>();
    return {...op,current_desired_revision:desired?.ordinal??0};
  }
  async prepareEnqueue(input:EnqueueRequest,policy:'things_wins'|'cloud_wins'='things_wins'):Promise<PreparedEnqueue|NativeOperation> {
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
    const payload:NativeOperation['payload']={target:input.target,kind:row.kind,field:input.field,value:input.value,base:{state:'value',value:cell.value},conflict_policy:policy,...policy==='cloud_wins'?{version:2,base_revision:input.base_revision}: {}};
    return {input,hash,payload,date:now()};
  }
  async commitEnqueue(prepared:PreparedEnqueue){
    const {input,hash,payload,date}=prepared,policy=payload.conflict_policy;
    const guard=`EXISTS(SELECT 1 FROM mirror_items WHERE owner=? AND id=? AND deleted=0 AND COALESCE(json_extract(fields,'$.in_trash_list.value'),0)=0 AND (json_extract(fields,?)=? OR ${policy==='cloud_wins'?1:0}=1))`;
    // The insertion and superseding of earlier unclaimed edits are one D1 transaction.
    await this.db.batch([
      this.stmt(`INSERT OR IGNORE INTO native_operations(owner,id,request_hash,payload,state,result,created_at,updated_at) VALUES(?,?,?,?,CASE WHEN ${guard} THEN 'queued' ELSE 'skipped' END,CASE WHEN ${guard} THEN NULL ELSE '{"state":"skipped","reason":"things_changed"}' END,?,?)`,this.owner,input.id,hash,canonical(payload),this.owner,input.target,'$.'+input.field+'.revision',input.base_revision,this.owner,input.target,'$.'+input.field+'.revision',input.base_revision,date,date),
      this.stmt(`UPDATE native_operations SET state='superseded',result='{"state":"superseded","reason":"newer_cloud_edit"}',updated_at=? WHERE owner=? AND state='queued' AND id<>? AND json_extract(payload,'$.target')=? AND json_extract(payload,'$.field')=? AND ordinal<(SELECT ordinal FROM native_operations WHERE owner=? AND id=? AND request_hash=? AND state='queued')`,date,this.owner,input.id,input.target,input.field,this.owner,input.id,hash),
      ...(policy==='cloud_wins'?[this.stmt(`INSERT INTO native_desired_fields(owner,target,field,operation_id,ordinal,value) SELECT owner,?,?,id,ordinal,? FROM native_operations WHERE owner=? AND id=? AND request_hash=? AND state='queued' ON CONFLICT(owner,target,field) DO UPDATE SET operation_id=excluded.operation_id,ordinal=excluded.ordinal,value=excluded.value WHERE excluded.ordinal>native_desired_fields.ordinal`,input.target,input.field,canonical(input.value),this.owner,input.id,hash)]:[])
    ]);
    const saved=await this.stmt('SELECT request_hash FROM native_operations WHERE owner=? AND id=?',this.owner,input.id).first<{request_hash:string}>();
    if(saved?.request_hash!==hash)throw new DemoError('Concurrent operation ID reuse.');
    return this.get(input.id);
  }
  async pending(){return (await this.stmt(`SELECT * FROM native_operations WHERE owner=? AND (state='executing' OR (state='queued' AND NOT EXISTS(SELECT 1 FROM native_operations other WHERE other.owner=native_operations.owner AND other.state='executing' AND json_extract(other.payload,'$.target')=json_extract(native_operations.payload,'$.target')))) ORDER BY CASE state WHEN 'queued' THEN 0 ELSE 1 END,ordinal LIMIT 20`,this.owner).all<Row>()).results.map(decode);}
  async revision(){return (await this.stmt('SELECT COALESCE(MAX(ordinal),0) AS revision FROM native_operations WHERE owner=?',this.owner).first<{revision:number}>())!.revision;}
  async overlays(){return (await this.stmt(`SELECT o.* FROM native_operations o WHERE o.owner=? AND (EXISTS(SELECT 1 FROM native_desired_fields d WHERE d.owner=o.owner AND d.operation_id=o.id) OR (json_extract(o.payload,'$.conflict_policy')='things_wins' AND o.state IN ('queued','executing'))) ORDER BY ordinal`,this.owner).all<Row>()).results.map(decode);}
  async overlaysNeedConfirmation(){return !!await this.stmt(`SELECT 1 FROM native_desired_fields d JOIN native_operations o ON o.owner=d.owner AND o.id=d.operation_id WHERE d.owner=? AND o.state IN ('applied','satisfied') LIMIT 1`,this.owner).first();}
  async recent(){return (await this.stmt('SELECT * FROM native_operations WHERE owner=? ORDER BY ordinal DESC LIMIT 100',this.owner).all<Row>()).results.map(decode);}
  async claim(id:string,claim:string){
    validID(id);validID(claim);
    await this.stmt(`UPDATE native_operations SET state='executing',claim=?,updated_at=? WHERE owner=? AND id=? AND state='queued' AND NOT EXISTS(SELECT 1 FROM native_operations other WHERE other.owner=native_operations.owner AND other.state='executing' AND json_extract(other.payload,'$.target')=json_extract(native_operations.payload,'$.target'))`,claim,now(),this.owner,id).run();
    const op=await this.get(id);if(op.state!=='executing'||op.claim!==claim)throw new DemoError('Another operation owns this target.',409);return op;
  }
  async ack(id:string,claim:string,result:{state:string;reason?:string},audit?:ReceiptAudit) {
    validID(id);validID(claim);
    if(!result||!['applied','satisfied','skipped','failed','uncertain'].includes(result.state)||Object.keys(result).some(k=>!['state','reason'].includes(k))||result.reason!==undefined&&!['things_changed','target_unavailable','automation_denied','verification_failed','interrupted_write','interrupted_delete','newer_cloud_edit'].includes(result.reason))throw new DemoError('Invalid receipt.');
    const op=await this.get(id);if(op.claim!==claim)throw new DemoError('Claim mismatch.');
    const savedAudit=await this.stmt('SELECT metadata FROM native_receipt_audit WHERE owner=? AND operation_id=?',this.owner,id).first<{metadata:string}>();
    if(savedAudit&&(!audit||savedAudit.metadata!==canonical(audit)))throw new DemoError('Receipt audit cannot change.');
    if(op.state!=='executing'&&audit&&!savedAudit)throw new DemoError('Receipt audit cannot be added after finalization.');
    if(op.payload.conflict_policy==='cloud_wins'&&!audit)throw new DemoError('Cloud receipt requires a causal fence.');
    if(audit){
      const cell=(c:unknown)=>{if(c===undefined)return true;if(!c||typeof c!=='object'||Array.isArray(c))return false;const v=c as Record<string,unknown>;return v.state==='value'&&['string','boolean','number'].includes(typeof v.value)&&Object.keys(v).sort().join(',')==='state,value'||v.state==='unknown'&&typeof v.reason==='string'&&v.reason.length<=200&&Object.keys(v).sort().join(',')==='reason,state';};
      if(!Number.isSafeInteger(audit.applied_after_sequence)||audit.applied_after_sequence<0||Object.keys(audit).some(k=>!['applied_after_sequence','observed_before','verified_after'].includes(k))||!cell(audit.observed_before)||!cell(audit.verified_after))throw new DemoError('Invalid receipt audit.');
    }
    if(op.state!=='executing'){if(canonical(op.result)!==canonical(result))throw new DemoError('A final receipt cannot change.');return op;}
    await this.db.batch([
      ...(audit?[this.stmt(`INSERT OR IGNORE INTO native_receipt_audit SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM native_operations WHERE owner=? AND id=? AND state='executing' AND claim=?)`,this.owner,id,canonical(audit),this.owner,id,claim),this.stmt(`SELECT CASE WHEN (SELECT metadata FROM native_receipt_audit WHERE owner=? AND operation_id=?)<>? THEN json('invalid receipt audit') ELSE 1 END`,this.owner,id,canonical(audit))]:[]),
      this.stmt("UPDATE native_operations SET state=?,result=?,updated_at=? WHERE owner=? AND id=? AND state='executing' AND claim=?",result.state,canonical(result),now(),this.owner,id,claim)
    ]);
    const saved=await this.get(id);if(canonical(saved.result)!==canonical(result))throw new DemoError('Receipt raced another acknowledgement.');return saved;
  }
}
