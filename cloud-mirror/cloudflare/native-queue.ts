import {canonical,fingerprint,type Cell} from '../site/lib/mirror-store';
import {DemoError} from '../site/lib/demo-store';

export type Policy='things_wins'|'cloud_wins'|'smart_merge_v1';
export type EnqueueRequest={id:string;target:string;field:'title'|'status'|'in_trash_list';value:string|boolean;base_revision:number;basis_token?:string;intent_kind?:'explicit_set'|'derived_patch'};
export type MergeDecision={algorithm:'supported_fields_v1';intent_kind:'explicit_set'|'derived_patch';classification:'cloud_only'|'same_value'|'cloud_fallback'|'no_change'|'delete_edit_cloud_fallback'|'unavailable'|'interrupted';base:Cell;local:Cell;desired:string|boolean;observed_fields?:Record<string,Cell>};
export type ReceiptAudit={applied_after_sequence:number;observed_before?:unknown;verified_after?:unknown;merge_decision?:MergeDecision};
export type PreparedEnqueue={input:EnqueueRequest;hash:string;payload:NativeOperation['payload'];date:string};
export type NativeOperation={id:string;state:string;claim:string|null;ordinal:number;
  payload:{target:string;kind:string;field:'title'|'status'|'in_trash_list';value:string|boolean;base:Cell;conflict_policy:Policy;version?:2|3;base_revision?:number;intent_kind?:'explicit_set'|'derived_patch';fallback?:'cloud';recorded_divergence?:boolean;base_fields?:Record<string,Cell>;basis?:{token:string;source:string;sequence:number;revision:number;ordinal:number;target_fields:Record<string,Cell>}};
  result:unknown;created_at:string;updated_at:string};
type Row=Omit<NativeOperation,'payload'|'result'>&{payload:string;result:string|null};
const decode=(r:Row):NativeOperation=>({...r,payload:JSON.parse(r.payload),result:r.result?JSON.parse(r.result):null});
const now=()=>new Date().toISOString();
function boundedOperations<T extends NativeOperation>(rows:T[],limit=200*1024){const kept:T[]=[];let bytes=512;for(const row of rows){const n=new TextEncoder().encode(canonical(row)).length;if(bytes+n>limit)break;kept.push(row);bytes+=n;}return kept;}
function validID(id:unknown){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new DemoError('Invalid operation or target ID.');}
export class NativeQueue {
  constructor(private db:Pick<D1Database,'prepare'|'batch'>,private owner:string) {}
  stmt(sql:string,...args:unknown[]){return this.db.prepare(sql).bind(...args);}
  async get(id:string){const r=await this.stmt('SELECT * FROM native_operations WHERE owner=? AND id=?',this.owner,id).first<Row>();if(!r)throw new DemoError('Operation not found.',404);return decode(r);}
  async operationStatus(id:string){
    const op=await this.get(id);
    const desired=await this.stmt('SELECT ordinal FROM native_desired_fields WHERE owner=? AND target=? AND field=?',this.owner,op.payload.target,op.payload.field).first<{ordinal:number}>();
    const trashed=await this.stmt("SELECT 1 AS yes FROM native_desired_fields WHERE owner=? AND target=? AND field='in_trash_list' AND value='true'",this.owner,op.payload.target).first();
    return {...op,current_desired_revision:desired?.ordinal??0,target_trashed_desired:!!trashed};
  }
  async prepareEnqueue(input:EnqueueRequest,policy:Policy='things_wins'):Promise<PreparedEnqueue|NativeOperation> {
    validID(input.id);validID(input.target);
    if(!['title','status','in_trash_list'].includes(input.field)||input.field==='title'&&(typeof input.value!=='string'||!input.value.trim()||input.value.length>4000)||input.field==='status'&&input.value!=='completed'||input.field==='in_trash_list'&&input.value!==true||!Number.isSafeInteger(input.base_revision)||input.base_revision<1)throw new DemoError('Supported edits are title changes, task completion and moving to-dos to Trash.');
    if(Object.keys(input).some(k=>!['base_revision','field','id','target','value','basis_token','intent_kind'].includes(k))||input.basis_token!==undefined&&(typeof input.basis_token!=='string'||!/^[a-f0-9]{48}$/.test(input.basis_token))||input.intent_kind!==undefined&&!['explicit_set','derived_patch'].includes(input.intent_kind))throw new DemoError('Unexpected operation fields.');
    const hash=await fingerprint(input);
    const old=await this.stmt('SELECT request_hash FROM native_operations WHERE owner=? AND id=?',this.owner,input.id).first<{request_hash:string}>();
    if(old){if(old.request_hash!==hash)throw new DemoError('Operation ID reused for a different request.');return this.get(input.id);}
    const row=await this.stmt('SELECT kind,fields,deleted FROM mirror_items WHERE owner=? AND id=?',this.owner,input.target).first<{kind:string;fields:string;deleted:number}>();
    if(!row||row.deleted||!['todo','project'].includes(row.kind)||['status','in_trash_list'].includes(input.field)&&row.kind!=='todo')throw new DemoError('This target is missing or read-only.');
    const cells=JSON.parse(row.fields) as Record<string,Cell>,cell=cells[input.field];
    if(!cell||cell.state!=='value'||typeof cell.value!==(input.field==='in_trash_list'?'boolean':'string')||cells.in_trash_list?.value===true)throw new DemoError('This field or target is unavailable.');
    if(policy==='smart_merge_v1'&&input.field!=='in_trash_list'&&await this.stmt("SELECT 1 FROM native_desired_fields WHERE owner=? AND target=? AND field='in_trash_list' AND value='true'",this.owner,input.target).first())throw new DemoError('Target has a pending Trash command.');
    let base:Cell={state:'value',value:cell.value},basis:NativeOperation['payload']['basis'];
    if(policy==='smart_merge_v1'){
      type Basis={token:string;cell:string;source:string;sequence:number;revision:number;ordinal:number;target_fields:string;created_at:string;pinned:number};
      const select="SELECT b.*,EXISTS(SELECT 1 FROM native_operations o WHERE o.owner=b.owner AND json_extract(o.payload,'$.basis.token')=b.token) OR EXISTS(SELECT 1 FROM native_desired_fields d WHERE d.owner=b.owner AND d.target=b.target AND d.field=b.field AND d.ordinal=b.ordinal AND b.source IN ('desired','effective')) AS pinned FROM native_bases b WHERE b.owner=? AND b.target=? AND b.field=?";
      const saved= input.basis_token ? await this.stmt(select+' AND b.token=?',this.owner,input.target,input.field,input.basis_token).first<Basis>() : await this.stmt(select+" AND b.revision=? AND b.source='confirmed' ORDER BY b.sequence DESC",this.owner,input.target,input.field,input.base_revision).first<Basis>();
      if(!saved||saved.revision!==input.base_revision)throw new DemoError('Observed base is unavailable. Refresh without discarding the requested edit.');
      const currentVector=Object.fromEntries(['title','status','in_trash_list'].map(k=>[k,cells[k]??null]));
      if(Date.parse(saved.created_at)<Date.now()-90*86400000&&!saved.pinned&&!(saved.source==='confirmed'&&canonical(JSON.parse(saved.target_fields))===canonical(currentVector)))throw new DemoError('Observed base expired. Refresh without discarding the requested edit.');
      if(saved.source==='confirmed'&&saved.revision===cell.revision&&canonical(JSON.parse(saved.cell).value)!==canonical(cell.value))throw new DemoError('Field revision history is inconsistent. Refresh required.');
      base=JSON.parse(saved.cell);basis={token:saved.token,source:saved.source,sequence:saved.sequence,revision:saved.revision,ordinal:saved.ordinal,target_fields:JSON.parse(saved.target_fields)};
    }
    const baseFields=basis&&input.basis_token?Object.fromEntries(['title','status'].filter(k=>basis!.target_fields[k]).map(k=>{const c=basis!.target_fields[k];return [k,{state:c.state,...c.state==='value'?{value:c.value}:{}}];})):undefined;
    const payload:NativeOperation['payload']={target:input.target,kind:row.kind,field:input.field,value:input.value,base,conflict_policy:policy,...policy==='cloud_wins'?{version:2,base_revision:input.base_revision}:policy==='smart_merge_v1'?{version:3,base_revision:input.base_revision,basis,intent_kind:input.intent_kind??'explicit_set',fallback:'cloud',recorded_divergence:cell.revision!==basis!.revision,...input.field==='in_trash_list'&&baseFields?{base_fields:baseFields}:{}}: {}};
    return {input,hash,payload,date:now()};
  }
  async commitEnqueue(prepared:PreparedEnqueue){
    const {input,hash,payload,date}=prepared,policy=payload.conflict_policy;
    const smart=policy==='smart_merge_v1',desired=policy!=='things_wins';
    const noop=smart&&payload.intent_kind==='derived_patch'&&canonical(payload.base.value)===canonical(payload.value);
    const guard=`EXISTS(SELECT 1 FROM mirror_items WHERE owner=? AND id=? AND deleted=0 AND COALESCE(json_extract(fields,'$.in_trash_list.value'),0)=0 AND (json_extract(fields,?)=? OR ${desired?1:0}=1)${smart&&input.field!=='in_trash_list'?` AND NOT EXISTS(SELECT 1 FROM native_desired_fields d WHERE d.owner=mirror_items.owner AND d.target=mirror_items.id AND d.field='in_trash_list' AND d.value='true')`:''})`;
    // The insertion and superseding of earlier unclaimed edits are one D1 transaction.
    await this.db.batch([
      this.stmt(`INSERT OR IGNORE INTO native_operations(owner,id,request_hash,payload,state,result,created_at,updated_at) VALUES(?,?,?,?,CASE WHEN ${guard} THEN '${noop?'skipped':'queued'}' ELSE 'skipped' END,CASE WHEN ${guard} THEN ${noop?`'{"state":"skipped","reason":"no_change"}'`:'NULL'} ELSE '{"state":"skipped","reason":"things_changed"}' END,?,?)`,this.owner,input.id,hash,canonical(payload),this.owner,input.target,'$.'+input.field+'.revision',input.base_revision,this.owner,input.target,'$.'+input.field+'.revision',input.base_revision,date,date),
      this.stmt(`UPDATE native_operations SET state='superseded',result='{"state":"superseded","reason":"newer_cloud_edit"}',updated_at=? WHERE owner=? AND state='queued' AND id<>? AND json_extract(payload,'$.target')=? AND json_extract(payload,'$.field')=? AND ordinal<(SELECT ordinal FROM native_operations WHERE owner=? AND id=? AND request_hash=? AND state='queued')`,date,this.owner,input.id,input.target,input.field,this.owner,input.id,hash),
      ...(desired?[this.stmt(`INSERT INTO native_desired_fields(owner,target,field,operation_id,ordinal,value) SELECT owner,?,?,id,ordinal,? FROM native_operations WHERE owner=? AND id=? AND request_hash=? AND state='queued' ON CONFLICT(owner,target,field) DO UPDATE SET operation_id=excluded.operation_id,ordinal=excluded.ordinal,value=excluded.value WHERE excluded.ordinal>native_desired_fields.ordinal`,input.target,input.field,canonical(input.value),this.owner,input.id,hash)]:[]),
      ...(smart&&input.field==='in_trash_list'?[this.stmt("UPDATE native_operations SET state='superseded',result='{\"state\":\"superseded\",\"reason\":\"newer_cloud_trash\"}',updated_at=? WHERE owner=? AND state='queued' AND id<>? AND json_extract(payload,'$.target')=? AND json_extract(payload,'$.field')<>'in_trash_list' AND EXISTS(SELECT 1 FROM native_operations accepted WHERE accepted.owner=? AND accepted.id=? AND accepted.state='queued')",date,this.owner,input.id,input.target,this.owner,input.id),this.stmt("DELETE FROM native_desired_fields WHERE owner=? AND target=? AND field<>'in_trash_list' AND EXISTS(SELECT 1 FROM native_operations accepted WHERE accepted.owner=? AND accepted.id=? AND accepted.state='queued')",this.owner,input.target,this.owner,input.id)]:[])
    ]);
    const saved=await this.stmt('SELECT request_hash FROM native_operations WHERE owner=? AND id=?',this.owner,input.id).first<{request_hash:string}>();
    if(saved?.request_hash!==hash)throw new DemoError('Concurrent operation ID reuse.');
    return this.get(input.id);
  }
  async pending(){return boundedOperations((await this.stmt(`SELECT * FROM native_operations WHERE owner=? AND (state='executing' OR (state='queued' AND NOT EXISTS(SELECT 1 FROM native_operations other WHERE other.owner=native_operations.owner AND other.state='executing' AND json_extract(other.payload,'$.target')=json_extract(native_operations.payload,'$.target')))) ORDER BY CASE state WHEN 'queued' THEN 0 ELSE 1 END,ordinal LIMIT 20`,this.owner).all<Row>()).results.map(decode));}
  async revision(){return (await this.stmt('SELECT COALESCE(MAX(ordinal),0) AS revision FROM native_operations WHERE owner=?',this.owner).first<{revision:number}>())!.revision;}
  async overlays(){return (await this.stmt(`SELECT o.* FROM native_operations o WHERE o.owner=? AND (EXISTS(SELECT 1 FROM native_desired_fields d WHERE d.owner=o.owner AND d.operation_id=o.id) OR (json_extract(o.payload,'$.conflict_policy')='things_wins' AND o.state IN ('queued','executing'))) ORDER BY ordinal`,this.owner).all<Row>()).results.map(decode);}
  async overlaysNeedConfirmation(){return !!await this.stmt(`SELECT 1 FROM native_desired_fields d JOIN native_operations o ON o.owner=d.owner AND o.id=d.operation_id WHERE d.owner=? AND o.state IN ('applied','satisfied') LIMIT 1`,this.owner).first();}
  async recent(){return boundedOperations((await this.stmt('SELECT o.*,a.metadata AS audit,r.disposition,r.sequence AS reconciliation_sequence,r.observed AS reconciliation_observed FROM native_operations o LEFT JOIN native_receipt_audit a ON a.owner=o.owner AND a.operation_id=o.id LEFT JOIN native_reconciliations r ON r.owner=o.owner AND r.operation_id=o.id WHERE o.owner=? ORDER BY o.ordinal DESC LIMIT 100',this.owner).all<Row&{audit:string|null;disposition:string|null;reconciliation_sequence:number|null;reconciliation_observed:string|null}>()).results.map(row=>({...decode(row),...row.audit?{audit:JSON.parse(row.audit)}:{},...row.disposition?{reconciliation:{disposition:row.disposition,sequence:row.reconciliation_sequence,observed:JSON.parse(row.reconciliation_observed!)}}:{}})),160*1024);}
  async presentationBases(targets:string[]){
    return (await this.stmt('SELECT token,target,field,revision,ordinal,source,cell,sequence,target_fields FROM native_bases WHERE owner=? AND target IN(SELECT value FROM json_each(?)) ORDER BY sequence DESC',this.owner,canonical(targets)).all<{token:string;target:string;field:string;revision:number;ordinal:number;source:string;cell:string;sequence:number;target_fields:string}>()).results;
  }
  async effectiveBases(items:Array<{id:string;fields:Record<string,Cell>}>,heads:NativeOperation[],sequence:number){
    const rows=[];for(const item of items){if(!heads.some(o=>o.payload.target===item.id))continue;const vector=Object.fromEntries(['title','status','in_trash_list'].filter(k=>item.fields[k]).map(k=>[k,item.fields[k]]));for(const field of ['title','status','in_trash_list']){const cell=item.fields[field];if(cell?.state!=='value'||!cell.revision)continue;const head=heads.find(o=>o.payload.target===item.id&&o.payload.field===field);rows.push({token:Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join(''),target:item.id,field,revision:cell.revision,sequence,ordinal:head?.ordinal??0,cell:canonical({state:'value',value:cell.value}),vector:canonical(vector)});}}
    if(!rows.length)return;
    await this.stmt(`INSERT OR IGNORE INTO native_bases(token,owner,target,field,revision,sequence,source,ordinal,cell,target_fields,created_at) SELECT json_extract(value,'$.token'),?,json_extract(value,'$.target'),json_extract(value,'$.field'),json_extract(value,'$.revision'),json_extract(value,'$.sequence'),'effective',json_extract(value,'$.ordinal'),json_extract(value,'$.cell'),json_extract(value,'$.vector'),? FROM json_each(?)`,this.owner,now(),canonical(rows)).run();
  }
  async claim(id:string,claim:string){
    validID(id);validID(claim);
    await this.stmt(`UPDATE native_operations SET state='executing',claim=?,updated_at=? WHERE owner=? AND id=? AND state='queued' AND NOT EXISTS(SELECT 1 FROM native_operations other WHERE other.owner=native_operations.owner AND other.state='executing' AND json_extract(other.payload,'$.target')=json_extract(native_operations.payload,'$.target'))`,claim,now(),this.owner,id).run();
    const op=await this.get(id);if(op.state!=='executing'||op.claim!==claim)throw new DemoError('Another operation owns this target.',409);return op;
  }
  async ack(id:string,claim:string,result:{state:string;reason?:string},audit?:ReceiptAudit) {
    validID(id);validID(claim);
    if(!result||!['applied','satisfied','skipped','failed','uncertain'].includes(result.state)||Object.keys(result).some(k=>!['state','reason'].includes(k))||result.reason!==undefined&&!['things_changed','target_unavailable','automation_denied','verification_failed','interrupted_write','interrupted_delete','newer_cloud_edit'].includes(result.reason))throw new DemoError('Invalid receipt.');
    const op=await this.get(id);if(op.claim!==claim)throw new DemoError('Claim mismatch.');
    const smart=op.payload.version===3&&op.payload.conflict_policy==='smart_merge_v1';
    if(smart&&!(result.state==='skipped'&&['newer_cloud_edit','target_unavailable'].includes(result.reason??'')&&audit&&!audit.merge_decision)){
      const decision=audit?.merge_decision;
      const typed=(cell:unknown)=>{if(!cell||typeof cell!=='object'||Array.isArray(cell))return false;const c=cell as Record<string,unknown>;return c.state==='value'&&Object.keys(c).sort().join(',')==='state,value'&&typeof c.value===(op.payload.field==='in_trash_list'?'boolean':'string')&&(typeof c.value!=='string'||c.value.length<=4000)||['absent','unknown','unsupported'].includes(String(c.state))&&Object.keys(c).every(k=>['state','reason'].includes(k))&&(c.reason===undefined||typeof c.reason==='string'&&c.reason.length<=200);};
      const vector=decision?.observed_fields;const validVector=vector===undefined||op.payload.field==='in_trash_list'&&vector&&Object.keys(vector).sort().join(',')==='status,title'&&Object.values(vector).every(c=>c&&(c.state==='value'&&typeof c.value==='string'&&c.value.length<=4000&&Object.keys(c).sort().join(',')==='state,value'||['absent','unknown','unsupported'].includes(c.state)&&Object.keys(c).every(k=>['state','reason'].includes(k))));
      if(!audit||!decision||canonical(decision).length>24000||Object.keys(decision).filter(k=>k!=='observed_fields').sort().join(',')!=='algorithm,base,classification,desired,intent_kind,local'||!validVector||decision.algorithm!=='supported_fields_v1'||decision.intent_kind!==op.payload.intent_kind||!['cloud_only','same_value','cloud_fallback','no_change','delete_edit_cloud_fallback','unavailable','interrupted'].includes(decision.classification)||canonical(decision.base)!==canonical(op.payload.base)||canonical(decision.desired)!==canonical(op.payload.value)||!typed(decision.local)||!typed(decision.base)||audit.observed_before!==undefined&&!typed(audit.observed_before)||audit.verified_after!==undefined&&!typed(audit.verified_after))throw new DemoError('Invalid smart merge decision.');
      if(['applied','satisfied'].includes(result.state)&&canonical(audit.verified_after)!==canonical({state:'value',value:op.payload.value}))throw new DemoError('Verified result does not match desired value.');
    }
    const storedAudit=audit?{...audit,...smart?{receipt_hash:await fingerprint({id,claim,payload:op.payload,result,audit})}:{}}:undefined;
    const savedAudit=await this.stmt('SELECT metadata FROM native_receipt_audit WHERE owner=? AND operation_id=?',this.owner,id).first<{metadata:string}>();
    if(savedAudit&&(!storedAudit||savedAudit.metadata!==canonical(storedAudit)))throw new DemoError('Receipt audit cannot change.');
    if(op.state!=='executing'&&audit&&!savedAudit)throw new DemoError('Receipt audit cannot be added after finalization.');
    if(op.payload.conflict_policy!=='things_wins'&&!audit)throw new DemoError('Cloud receipt requires a causal fence.');
    if(audit){
      const cell=(c:unknown)=>{if(c===undefined)return true;if(!c||typeof c!=='object'||Array.isArray(c))return false;const v=c as Record<string,unknown>;return v.state==='value'&&['string','boolean','number'].includes(typeof v.value)&&Object.keys(v).sort().join(',')==='state,value'||v.state==='unknown'&&typeof v.reason==='string'&&v.reason.length<=200&&Object.keys(v).sort().join(',')==='reason,state';};
      if(!Number.isSafeInteger(audit.applied_after_sequence)||audit.applied_after_sequence<0||Object.keys(audit).some(k=>!['applied_after_sequence','observed_before','verified_after','merge_decision'].includes(k))||(!smart&&(!cell(audit.observed_before)||!cell(audit.verified_after)||audit.merge_decision!==undefined)))throw new DemoError('Invalid receipt audit.');
    }
    const confirmed=(operation:NativeOperation)=>({...operation,...smart&&audit&&['applied','satisfied'].includes(operation.state)?{receipt_confirmation:{id,receipt_hash:(storedAudit as ReceiptAudit&{receipt_hash:string}).receipt_hash,applied_after_sequence:audit.applied_after_sequence,ordinal:operation.ordinal}}:{}});
    if(op.state!=='executing'){if(canonical(op.result)!==canonical(result))throw new DemoError('A final receipt cannot change.');return confirmed(op);}
    await this.db.batch([
      ...(storedAudit?[this.stmt(`INSERT OR IGNORE INTO native_receipt_audit SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM native_operations WHERE owner=? AND id=? AND state='executing' AND claim=?)`,this.owner,id,canonical(storedAudit),this.owner,id,claim),this.stmt(`SELECT CASE WHEN (SELECT metadata FROM native_receipt_audit WHERE owner=? AND operation_id=?)<>? THEN json('invalid receipt audit') ELSE 1 END`,this.owner,id,canonical(storedAudit))]:[]),
      this.stmt("UPDATE native_operations SET state=?,result=?,updated_at=? WHERE owner=? AND id=? AND state='executing' AND claim=?",result.state,canonical(result),now(),this.owner,id,claim),
      ...(smart&&!['applied','satisfied'].includes(result.state)?[this.stmt("INSERT OR IGNORE INTO native_reconciliations SELECT owner,id,ordinal,?,'execution_review',?,? FROM native_operations WHERE owner=? AND id=? AND state=?",audit!.applied_after_sequence,canonical(audit!.verified_after??audit!.observed_before??{state:'unknown'}),(storedAudit as ReceiptAudit&{receipt_hash:string}).receipt_hash,this.owner,id,result.state),this.stmt('DELETE FROM native_desired_fields WHERE owner=? AND operation_id=? AND ordinal=?',this.owner,id,op.ordinal)]:[])
    ]);
    const saved=await this.get(id);if(canonical(saved.result)!==canonical(result))throw new DemoError('Receipt raced another acknowledgement.');return confirmed(saved);
  }
}
