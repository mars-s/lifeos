import {canonical,type Cell} from '../site/lib/mirror-store';
import {DemoError} from '../site/lib/demo-store';
import type {Policy} from './native-queue';

// Offline Things operations, payload version 4 (protocol things_ops_v1).
// A Mac advertises support with this header; older Macs never see or claim them.
export const thingsOpsHeader='x-lifeos-things-ops',thingsOpsVersion='1';
export type ThingsOp='create'|'update'|'move'|'set_status'|'trash'|'restore';
export type Container={type:'inbox'}|{type:'none'}|{type:'area';id:string}|{type:'project';id:string}|{type:'heading';project:string;title:string};
export type ChecklistItem={title:string;completed:boolean};
export type ThingsFields={title?:string;notes?:string;when?:string;deadline?:string|null;tags?:string[];checklist?:ChecklistItem[]};
export type ThingsPayload={version:4;protocol:'things_ops_v1';op:ThingsOp;kind:'todo'|'project';target:string;temp_id?:string;fields?:ThingsFields;container?:Container;status?:'open'|'completed'|'canceled';
  base:Record<string,Cell>;base_revisions:Record<string,number>;conflict_policy:Policy;intent_kind:'explicit_set';depends_on:string[];refs:string[];verify:string[]};
export type ThingsAudit={applied_after_sequence:number;observed_before?:Record<string,unknown>;verified_after?:Record<string,unknown>;merge_decision?:{algorithm:string;fields:Record<string,string>}};
export const ID=/^[A-Za-z0-9_-]{1,128}$/,TEMP=/^tmp-[A-Za-z0-9_-]{1,64}$/;
export const failedStates=['skipped','failed','uncertain','superseded'];
const OPS:ThingsOp[]=['create','update','move','set_status','trash','restore'];
const WHEN=['today','evening','anytime','someday'],FIELDS=['title','notes','when','deadline','tags','checklist'];
// Payload field -> mirror field whose confirmed revision is the edit base.
export const mirrorField:Record<string,string>={title:'title',notes:'notes',when:'activation_date',deadline:'deadline',tags:'tags',checklist:'checklist'};
const KEYS:Record<ThingsOp,string[]>={create:['operation_id','op','kind','temp_id','fields','container'],update:['operation_id','op','target','fields','base_revisions'],move:['operation_id','op','target','container','base_revisions'],set_status:['operation_id','op','target','status','base_revisions'],trash:['operation_id','op','target','base_revisions'],restore:['operation_id','op','target','base_revisions']};
export const reasons=['things_changed','target_unavailable','automation_denied','verification_failed','interrupted_write','interrupted_delete','newer_cloud_edit','container_unavailable','unsupported_by_things','dependency_unresolved'];
const classifications=['cloud_only','same_value','cloud_fallback','created','unavailable','interrupted'];
const reject=(n:number,message:string):never=>{throw new DemoError(`Operation ${n+1}: ${message}`);};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validDate(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return !isNaN(+d)&&d.toISOString().slice(0,10)===v;}
export const plain=(c:Cell):Cell=>({state:c.state,...c.state==='value'?{value:c.value}:{}});

export function fieldsOf(n:number,raw:unknown,kind:string,create:boolean):ThingsFields{
  if(!object(raw))return reject(n,'fields must be an object.');
  const out:ThingsFields={};
  if(Object.keys(raw).some(k=>!FIELDS.includes(k)))reject(n,'only title, notes, when, deadline, tags and checklist can be set.');
  const {title,notes,when,deadline,tags,checklist}=raw;
  if(title!==undefined){if(typeof title!=='string'||!title.trim()||title.length>4000)reject(n,'title must be 1 to 4000 characters.');out.title=title as string;}
  else if(create)reject(n,'title is required.');
  if(notes!==undefined){if(typeof notes!=='string'||notes.length>10000)reject(n,'notes must be at most 10000 characters.');out.notes=notes as string;}
  if(when!==undefined){if(typeof when!=='string'||!WHEN.includes(when)&&!validDate(when))reject(n,'when must be today, evening, anytime, someday or a YYYY-MM-DD date.');out.when=when as string;}
  if(deadline!==undefined){if(deadline!==null&&!validDate(deadline))reject(n,'deadline must be a YYYY-MM-DD date or null to clear it.');out.deadline=deadline as string|null;}
  if(tags!==undefined){
    if(!Array.isArray(tags)||tags.length>20||tags.some(t=>typeof t!=='string'||!t.trim()||t.length>100||t.includes(','))||new Set(tags.map(t=>String(t).trim().toLowerCase())).size!==tags.length)reject(n,'tags must be up to 20 unique tag names without commas.');
    out.tags=(tags as string[]).map(t=>t.trim());
  }
  if(checklist!==undefined){
    if(kind!=='todo')reject(n,'only to-dos have checklists.');
    if(!Array.isArray(checklist)||checklist.length>100||checklist.some(i=>!object(i)||Object.keys(i).some(k=>!['title','completed'].includes(k))||typeof i.title!=='string'||!i.title.trim()||i.title.length>1000||i.completed!==undefined&&typeof i.completed!=='boolean'))reject(n,'checklist must be up to 100 items with a title and optional completed flag.');
    out.checklist=(checklist as Record<string,unknown>[]).map(i=>({title:i.title as string,completed:i.completed===true}));
  }
  if(!create&&!Object.keys(out).length)reject(n,'name at least one field to change.');
  return out;
}
export function containerOf(n:number,raw:unknown,kind:string):Container{
  if(!object(raw)||typeof raw.type!=='string')return reject(n,'container must name a type.');
  const keys=Object.keys(raw).sort().join(','),t=raw.type;
  const allowed=kind==='todo'?['inbox','area','project','heading']:['none','area'];
  if(!allowed.includes(t))reject(n,kind==='todo'?'to-dos move to the Inbox, an area, a project or a project heading.':'projects move to an area or to no area (none).');
  if(t==='inbox'||t==='none'){if(keys!=='type')reject(n,'unexpected container fields.');return {type:t} as Container;}
  if(t==='area'||t==='project'){if(keys!=='id,type'||typeof raw.id!=='string'||!ID.test(raw.id))reject(n,'container id is invalid.');return {type:t,id:raw.id as string};}
  if(keys!=='project,title,type'||typeof raw.project!=='string'||!ID.test(raw.project)||typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>200)reject(n,'a heading container needs a project id and a heading title of up to 200 characters.');
  return {type:'heading',project:raw.project as string,title:raw.title as string};
}
// Shape-only validation of one operation; references are checked against D1 later.
export function shapeOf(n:number,raw:unknown){
  if(!object(raw)||typeof raw.op!=='string'||!OPS.includes(raw.op as ThingsOp))return reject(n,'op must be create, update, move, set_status, trash or restore.');
  const op=raw.op as ThingsOp;
  if(typeof raw.operation_id!=='string'||!ID.test(raw.operation_id))reject(n,'operation_id is invalid.');
  if(Object.keys(raw).some(k=>!KEYS[op].includes(k)))reject(n,'unexpected operation fields.');
  if(op==='create'){
    if(raw.kind!=='todo'&&raw.kind!=='project')reject(n,'kind must be todo or project.');
    if(typeof raw.temp_id!=='string'||!TEMP.test(raw.temp_id))reject(n,'temp_id must look like tmp- followed by up to 64 letters, digits, _ or -.');
  }else{
    if(typeof raw.target!=='string'||!ID.test(raw.target))reject(n,'target is invalid.');
    if(raw.base_revisions!==undefined&&(!object(raw.base_revisions)||Object.keys(raw.base_revisions).length>8||Object.values(raw.base_revisions).some(v=>!Number.isSafeInteger(v)||(v as number)<0)))reject(n,'base_revisions must map field names to revisions.');
  }
  if(op==='set_status'&&!['open','completed','canceled'].includes(raw.status as string))reject(n,'status must be open, completed or canceled.');
  if(op==='move'&&raw.container===undefined)reject(n,'container is required.');
  return {op,raw,id:raw.operation_id as string};
}
export function dependentFields(op:ThingsOp,kind:string,fields?:ThingsFields){
  if(op==='update')return [...new Set(Object.keys(fields??{}).map(k=>mirrorField[k]))];
  if(op==='move')return kind==='todo'?['area_id','project_id','heading_id']:['area_id'];
  if(op==='set_status')return ['status'];
  if(op==='trash'||op==='restore')return ['in_trash_list'];
  return [];
}
export function verifyKeys(p:{op:ThingsOp;fields?:ThingsFields;container?:Container}){
  if(p.op==='create')return [...Object.keys(p.fields??{}),...p.container?['container']:[]].sort();
  if(p.op==='update')return Object.keys(p.fields??{}).sort();
  return [p.op==='move'?'container':p.op==='set_status'?'status':'in_trash_list'];
}
export const resolveContainer=(c:Container,refs:Record<string,string|null>):Container=>c.type==='area'||c.type==='project'?{...c,id:refs[c.id]??c.id}:c.type==='heading'?{...c,project:refs[c.project]??c.project}:c;
export function expectedCell(p:ThingsPayload,key:string,refs:Record<string,string|null>):Cell{
  if(key==='container')return {state:'value',value:resolveContainer(p.container!,refs)};
  if(key==='status')return {state:'value',value:p.status};
  if(key==='in_trash_list')return {state:'value',value:p.op==='trash'};
  const v=(p.fields as Record<string,unknown>)[key];
  return v===null?{state:'absent'}:{state:'value',value:v};
}
// Fields Things automation cannot read back; the Mac reports them as unsupported.
export const unverifiable=(p:ThingsPayload,key:string)=>key==='checklist'||key==='when'&&p.fields?.when==='evening'||key==='container'&&p.container?.type==='heading';
const comparable=(key:string,c:Cell)=>key==='tags'&&c.state==='value'&&Array.isArray(c.value)?{state:'value',value:(c.value as string[]).map(t=>String(t).toLowerCase()).sort()}:c;
function typedCell(c:unknown){
  if(!object(c))return false;
  if(c.state==='value')return Object.keys(c).sort().join(',')==='state,value'&&c.value!==undefined&&canonical(c.value).length<=20000;
  return ['absent','unknown','unsupported'].includes(String(c.state))&&Object.keys(c).every(k=>['state','reason'].includes(k))&&(c.reason===undefined||typeof c.reason==='string'&&c.reason.length<=200);
}
const cellMap=(m:unknown,keys?:string[])=>object(m)&&Object.keys(m).length<=12&&Object.values(m).every(typedCell)&&(!keys||Object.keys(m).every(k=>keys.includes(k)));
// Strict validation of a version 4 receipt. Throws DemoError on any mismatch.
export function validateThingsReceipt(p:ThingsPayload,result:Record<string,unknown>,audit:ThingsAudit|undefined,refs:Record<string,string|null>,createdTaken:boolean){
  if(!object(result)||!['applied','satisfied','skipped','failed','uncertain'].includes(result.state as string)||Object.keys(result).some(k=>!['state','reason','created_id'].includes(k))||result.reason!==undefined&&!reasons.includes(result.reason as string))throw new DemoError('Invalid receipt.');
  const success=['applied','satisfied'].includes(result.state as string);
  if(p.op==='create'&&success!==(result.created_id!==undefined)||result.created_id!==undefined&&(p.op!=='create'||typeof result.created_id!=='string'||!ID.test(result.created_id)||TEMP.test(result.created_id)||createdTaken))throw new DemoError('Create receipts must report one new real Things ID.');
  if(!audit||!Number.isSafeInteger(audit.applied_after_sequence)||audit.applied_after_sequence<0||Object.keys(audit).some(k=>!['applied_after_sequence','observed_before','verified_after','merge_decision'].includes(k))||canonical(audit).length>48000)throw new DemoError('Things receipts require a causal fence and bounded audit.');
  const keys=p.verify;
  if(audit.observed_before!==undefined&&!cellMap(audit.observed_before,[...Object.keys(p.base),...keys]))throw new DemoError('Invalid observed fields.');
  if(audit.verified_after!==undefined&&!cellMap(audit.verified_after,keys))throw new DemoError('Invalid verified fields.');
  const decision=audit.merge_decision;
  if(decision!==undefined&&(p.conflict_policy!=='smart_merge_v1'||!object(decision)||Object.keys(decision).sort().join(',')!=='algorithm,fields'||decision.algorithm!=='things_fields_v1'||!object(decision.fields)||Object.keys(decision.fields).some(k=>!keys.includes(k))||Object.values(decision.fields).some(v=>!classifications.includes(v as string))))throw new DemoError('Invalid merge decision.');
  if(!success)return [];
  if(p.conflict_policy==='smart_merge_v1'&&(!decision||Object.keys(decision.fields).sort().join(',')!==keys.join(',')))throw new DemoError('Smart receipts must classify every changed field.');
  const verified=audit.verified_after as Record<string,Cell>|undefined;
  if(!verified||Object.keys(verified).sort().join(',')!==keys.join(','))throw new DemoError('Verified result must read back every changed field.');
  const unverified:string[]=[];
  for(const key of keys){
    const cell=verified[key];
    if(cell.state==='unsupported'&&unverifiable(p,key)){unverified.push(key);continue;}
    // The Mac canonicalises a local-today read-back to the requested date.
    // Keep this comparison date-exact: Worker time and receipt retry time can differ.
    if(canonical(comparable(key,cell))!==canonical(comparable(key,expectedCell(p,key,refs))))throw new DemoError('Verified result does not match desired value.');
  }
  return unverified;
}

type EffectiveItem={id:string;kind:string;fields:Record<string,Cell>;pending_operations:unknown[];verification:string;temp_id?:string;resolved_id?:string|null};
// Apply version 4 overlays to the effective page. Pending creates appear under their temporary id
// until a snapshot confirms the real item; returns those synthetic items.
export function applyThingsOverlays(effective:EffectiveItem[],ops:Array<{id:string;state:string;payload:unknown;resolved_refs?:Record<string,string|null>}>,includeCreates:boolean){
  const byId=new Map(effective.map(i=>[i.id,i])),creates:EffectiveItem[]=[];
  for(const o of ops){
    const p=o.payload as ThingsPayload,refs=o.resolved_refs??{},real=TEMP.test(p.target)?refs[p.target]??null:p.target;
    let item=(real?byId.get(real):undefined)??byId.get(p.target);
    if(!item&&p.op==='create'&&includeCreates){
      item={id:p.target,temp_id:p.target,resolved_id:real,kind:p.kind,fields:{status:{state:'value',value:'open'},in_trash_list:{state:'value',value:false}},pending_operations:[],verification:'pending'};
      creates.push(item);byId.set(p.target,item);
    }
    if(!item)continue;
    for(const [k,c] of Object.entries(overlayCells(p,refs)))item.fields[k]={...c,...item.fields[k]?.revision!==undefined?{revision:item.fields[k].revision}:{}};
    item.pending_operations.push({id:o.id,op:p.op,fields:p.verify,state:o.state});item.verification='pending';
  }
  return creates;
}
// Effective cells an operation implies, keyed by mirror field.
export function overlayCells(p:ThingsPayload,refs:Record<string,string|null>):Record<string,Cell>{
  const cells:Record<string,Cell>={},v=(value:unknown):Cell=>({state:'value',value});
  for(const [key,value] of Object.entries(p.fields??{})){
    if(key==='when'){cells.when=v(value);if(validDate(value))cells.activation_date=v(value);else if(value==='anytime'||value==='someday')cells.activation_date={state:'absent'};}
    else cells[key]=value===null?{state:'absent'}:v(value);
  }
  if(p.container){
    const c=resolveContainer(p.container,refs),none:Cell={state:'absent'};
    if(c.type==='inbox'||c.type==='none')Object.assign(cells,{area_id:none,...p.kind==='todo'?{project_id:none,heading_id:none}:{}});
    if(c.type==='area')Object.assign(cells,{area_id:v(c.id),...p.kind==='todo'?{project_id:none,heading_id:none}:{}});
    if(c.type==='project')Object.assign(cells,{area_id:none,project_id:v(c.id),heading_id:none});
    if(c.type==='heading')Object.assign(cells,{area_id:none,project_id:v(c.project),heading_title:v(c.title)});
  }
  if(p.status)cells.status=v(p.status);
  if(p.op==='trash'||p.op==='restore')cells.in_trash_list=v(p.op==='trash');
  return cells;
}
