import {DemoError} from "./demo-store";

export type Cell={state:"value"|"absent"|"unsupported"|"unknown";value?:unknown;last_known?:unknown;revision?:number};
export type MirrorItem={id:string;kind:string;fields:Record<string,Cell>;deleted:number;observed_at:string};
export type MirrorOperation={id:string;revision:string;content:{request:unknown;target:string;kind:string;fields:Record<string,unknown>;base:Record<string,Cell>;zone:string;planning:boolean;plan_revision:number};state:string;claim:string|null;result:unknown};
const kinds=new Set(["todo","project","area","tag","heading"]), at=()=>new Date().toISOString();
export function canonical(value:unknown):string {
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  return JSON.stringify(value);
}
export async function fingerprint(v:unknown) {return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(v))))).map(x=>x.toString(16).padStart(2,"0")).join("");}
function decoded(row:Record<string,unknown>):MirrorOperation {return {...row,content:JSON.parse(String(row.content)),result:row.result?JSON.parse(String(row.result)):null} as MirrorOperation;}
function fail(message:string):never {throw new DemoError(message);}
function validID(id:unknown):asserts id is string {if(typeof id!=="string"||!id||id.length>128)fail("Invalid ID.");}
type Manifest={observed_at:string;zone:string;scopes:string[];count:number;page_hashes:string[];coverage:string};
export class MirrorStore {
  constructor(private db:Pick<D1Database,"prepare"|"batch">,private owner:string) {if(!owner)throw new DemoError("Owner context required.",401);}
  stmt(sql:string,...args:unknown[]) {return this.db.prepare(sql).bind(...args);}
  async meta() {return this.stmt("SELECT * FROM mirror_meta WHERE owner=?",this.owner).first<{sequence:number;observed_at:string;zone:string}>();}
  async upload(sequence:number) {
    const row=await this.stmt("SELECT * FROM mirror_uploads WHERE owner=? AND sequence=?",this.owner,sequence).first<{manifest:string;manifest_hash:string;committed:number}>();
    if(!row)fail("Begin this inventory first.");return row;
  }
  async begin(input:{sequence:number;manifest:Manifest}) {
    const {sequence,manifest:m}=input;
    if(!Number.isSafeInteger(sequence)||sequence<1||!m||!Number.isInteger(m.count)||m.count<0||m.count>10000||!Array.isArray(m.page_hashes)||m.page_hashes.length<1||m.page_hashes.length>100||m.page_hashes.some(h=>!/^[a-f0-9]{64}$/.test(h))||!Array.isArray(m.scopes)||!m.scopes.length||new Set(m.scopes).size!==m.scopes.length||m.scopes.some(s=>!kinds.has(s)))fail("Invalid complete inventory manifest.");
    if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(m.observed_at)||!Number.isFinite(Date.parse(m.observed_at))||Date.parse(m.observed_at)>Date.now()+30000)fail("Invalid observation timestamp.");
    try{new Intl.DateTimeFormat("en",{timeZone:m.zone});}catch{fail("IANA timezone required.");}
    const prior=await this.meta();if(prior&&(sequence<prior.sequence||Date.parse(m.observed_at)<Date.parse(prior.observed_at)))fail("Stale inventory or lost helper journal; reconcile rather than resetting sequence.");
    const hash=await fingerprint(m);
    await this.stmt("INSERT OR IGNORE INTO mirror_uploads VALUES(?,?,?,?,0)",this.owner,sequence,canonical(m),hash).run();
    const saved=await this.upload(sequence);if(saved.manifest_hash!==hash)fail("Sequence already used for a different manifest.");return {committed:!!saved.committed};
  }
  async page(input:{sequence:number;page:number;items:MirrorItem[]}) {
    const upload=await this.upload(input.sequence),m:Manifest=JSON.parse(upload.manifest);
    if(!Number.isInteger(input.page)||input.page<0||input.page>=m.page_hashes.length||!Array.isArray(input.items)||input.items.length>100)fail("Invalid snapshot page.");
    const hash=await fingerprint(input.items);if(hash!==m.page_hashes[input.page])fail("Page does not match the manifest.");
    await this.stmt("INSERT OR IGNORE INTO mirror_pages VALUES(?,?,?,?,?)",this.owner,input.sequence,input.page,canonical(input.items),hash).run();
    const saved=await this.stmt("SELECT hash FROM mirror_pages WHERE owner=? AND sequence=? AND page=?",this.owner,input.sequence,input.page).first<{hash:string}>();
    if(saved?.hash!==hash)fail("Page number already used for different content.");return {received:true};
  }
  async commit(sequence:number) {
    const upload=await this.upload(sequence);if(upload.committed)return {duplicate:true};
    const m:Manifest=JSON.parse(upload.manifest),prior=await this.meta();
    if(prior&&sequence<=prior.sequence)fail("A newer snapshot was already committed.");
    const pages=await this.stmt("SELECT page,items,hash FROM mirror_pages WHERE owner=? AND sequence=? ORDER BY page",this.owner,sequence).all<{page:number;items:string;hash:string}>();
    if(pages.results.length!==m.page_hashes.length||pages.results.some((p,n)=>p.page!==n||p.hash!==m.page_hashes[n]))fail("Missing inventory pages; confirmed snapshot has not changed.");
    const items:MirrorItem[]=pages.results.flatMap(p=>JSON.parse(p.items));
    if(items.length!==m.count||new Set(items.map(i=>i.id)).size!==items.length)fail("Inventory count/IDs do not match.");
    const old=(await this.stmt("SELECT * FROM mirror_items WHERE owner=?",this.owner).all<{id:string;kind:string;fields:string;deleted:number}>()).results;
    const priorItems=new Map(old.map(i=>[i.id,i]));const updates=[];
    for(const item of items) {
      validID(item.id);if(!m.scopes.includes(item.kind)||!item.fields||typeof item.fields!=="object"||Array.isArray(item.fields))fail("Invalid inventory item scope/fields.");
      const previous=priorItems.get(item.id);if(previous&&previous.kind!==item.kind)fail("Item kind changed for an existing ID.");
      const fields:Record<string,Cell>=previous?JSON.parse(previous.fields):{};
      for(const [key,incoming] of Object.entries(item.fields)) {
        if(key.length>100||!incoming||!["value","absent","unsupported","unknown"].includes(incoming.state)||incoming.state==="value"&&!("value" in incoming)||incoming.state!=="value"&&"value" in incoming)fail("Invalid field cell.");
        const prev=fields[key], cell:Cell={state:incoming.state,...incoming.state==="value"?{value:incoming.value}:{}};
        if(["unknown","unsupported"].includes(cell.state)&&prev)cell.last_known=prev.state==="value"?{state:prev.state,value:prev.value}:prev.last_known??prev;
        const comparable=(c:Cell|undefined)=>c?{state:c.state,...c.state==="value"?{value:c.value}:{},...c.last_known!==undefined?{last_known:c.last_known}:{}}:null;
        cell.revision=canonical(comparable(prev))===canonical(comparable(cell))?(prev?.revision??1):(prev?.revision??0)+1;
        fields[key]=cell;
      }
      // WHERE guard protects against an older commit that raced a newer one.
      updates.push(this.stmt("INSERT INTO mirror_items SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT sequence FROM mirror_meta WHERE owner=?),0)=? ON CONFLICT(owner,id) DO UPDATE SET fields=excluded.fields,deleted=0,observed_at=excluded.observed_at",this.owner,item.id,item.kind,canonical(fields),0,m.observed_at,this.owner,prior?.sequence??0));
      priorItems.delete(item.id);
    }
    for(const item of priorItems.values())if(m.scopes.includes(item.kind))updates.push(this.stmt("UPDATE mirror_items SET deleted=1,observed_at=? WHERE owner=? AND id=? AND COALESCE((SELECT sequence FROM mirror_meta WHERE owner=?),0)=?",m.observed_at,this.owner,item.id,this.owner,prior?.sequence??0));
    updates.push(this.stmt("INSERT INTO mirror_meta VALUES(?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET sequence=excluded.sequence,manifest_hash=excluded.manifest_hash,observed_at=excluded.observed_at,received_at=excluded.received_at,zone=excluded.zone WHERE mirror_meta.sequence=? AND mirror_meta.sequence<excluded.sequence",this.owner,sequence,upload.manifest_hash,m.observed_at,at(),m.zone,prior?.sequence??0));
    updates.push(this.stmt("UPDATE mirror_uploads SET committed=1 WHERE owner=? AND sequence=? AND EXISTS(SELECT 1 FROM mirror_meta WHERE owner=? AND sequence=? AND manifest_hash=?)",this.owner,sequence,this.owner,sequence,upload.manifest_hash));
    await this.db.batch(updates);
    if(!(await this.upload(sequence)).committed)fail("Inventory raced another upload; refresh.");return {duplicate:false};
  }
  async get(id:string) {
    const row=await this.stmt("SELECT * FROM mirror_operations WHERE owner=? AND id=?",this.owner,id).first<Record<string,unknown>>();
    if(!row)throw new DemoError("Operation not found.",404);return decoded(row);
  }
  async propose(input:{id:string;target:string;fields:Record<string,unknown>;base_revisions:Record<string,number>;zone:string;planning?:boolean;plan_revision?:number}) {
    validID(input.id);validID(input.target);
    const fields=input.fields,keys=Object.keys(fields??{}),planning=input.planning===true;
    if(keys.length!==1||keys.some(k=>!(planning?["planning_priority"]:["title","notes"]).includes(k)))fail("First phase permits one title/notes field or a separate cloud planning priority.");
    const key=keys[0],value=fields[key];if(typeof value!=="string"||value.length>(key==="notes"?10000:4000)||key==="title"&&!value.trim()||planning&&!["focus","normal","later"].includes(value))fail("Invalid field value.");
    try{new Intl.DateTimeFormat("en",{timeZone:input.zone});}catch{fail("IANA timezone required.");}
    const existing=await this.stmt("SELECT * FROM mirror_operations WHERE owner=? AND id=?",this.owner,input.id).first<Record<string,unknown>>();
    if(existing){const op=decoded(existing);if(canonical(op.content.request)!==canonical(input))fail("ID reused for different content.");return op;}
    const row=await this.stmt("SELECT * FROM mirror_items WHERE owner=? AND id=? AND deleted=0",this.owner,input.target).first<{kind:string;fields:string}>();
    if(!row)fail("Confirmed target missing.");if(!planning&&!["todo","project"].includes(row.kind))fail("This kind is read-only in phase one.");
    const cells:Record<string,Cell>=JSON.parse(row.fields),base:Record<string,Cell>={};
    if(!planning){const cell=cells[key];if(!cell||cell.state!=="value"||cell.revision!==input.base_revisions?.[key])fail("Field is unobserved, unsupported, or has changed. Refresh.");base[key]={state:"value",value:cell.value};}
    const plan=await this.stmt("SELECT revision FROM mirror_plans WHERE owner=? AND id=?",this.owner,input.target).first<{revision:number}>();
    if(planning&&(plan?.revision??0)!==(input.plan_revision??0))fail("Cloud plan changed. Refresh.");
    const content={request:input,target:input.target,kind:row.kind,fields,base,zone:input.zone,planning,plan_revision:plan?.revision??0};
    const revision=await fingerprint({id:input.id,content}),date=at();
    await this.stmt("INSERT OR IGNORE INTO mirror_operations VALUES(?,?,?,?,'draft',NULL,NULL,?,?)",this.owner,input.id,revision,canonical(content),date,date).run();
    const op=await this.get(input.id);if(op.revision!==revision)fail("Concurrent proposal ID reuse.");return op;
  }
  async decide(id:string,revision:string,approved:boolean) {
    const op=await this.get(id);if(op.revision!==revision)fail("Review the exact immutable revision.");
    if(op.content.planning&&approved) {
      const c=op.content,p=c.fields.planning_priority;
      // A cloud-only priority is never queued for or applied to Things.
      await this.db.batch([
        this.stmt("INSERT INTO mirror_plans SELECT ?,?,?,1 WHERE ?=0 AND EXISTS(SELECT 1 FROM mirror_operations WHERE owner=? AND id=? AND state='draft') ON CONFLICT(owner,id) DO UPDATE SET priority=excluded.priority,revision=mirror_plans.revision+1 WHERE mirror_plans.revision=?",this.owner,c.target,p,c.plan_revision,this.owner,id,c.plan_revision),
        this.stmt("UPDATE mirror_plans SET priority=?,revision=revision+1 WHERE owner=? AND id=? AND revision=? AND ?>0 AND EXISTS(SELECT 1 FROM mirror_operations WHERE owner=? AND id=? AND state='draft')",p,this.owner,c.target,c.plan_revision,c.plan_revision,this.owner,id),
        this.stmt("UPDATE mirror_operations SET state=CASE WHEN EXISTS(SELECT 1 FROM mirror_plans WHERE owner=? AND id=? AND revision=? AND priority=?) THEN 'applied_cloud' ELSE 'conflict' END,result=?,updated_at=? WHERE owner=? AND id=? AND revision=? AND state='draft'",this.owner,c.target,c.plan_revision+1,p,canonical({scope:"cloud planning only; no Things priority property"}),at(),this.owner,id,revision),
      ]);
    }else await this.stmt("UPDATE mirror_operations SET state=?,updated_at=? WHERE owner=? AND id=? AND revision=? AND state='draft'",approved?"queued":"rejected",at(),this.owner,id,revision).run();
    const saved=await this.get(id);if(saved.revision!==revision||![approved?op.content.planning?"applied_cloud":"queued":"rejected","conflict"].includes(saved.state))fail("Decision no longer matches a draft.");return saved;
  }
  async pending() {return (await this.stmt("SELECT * FROM mirror_operations WHERE owner=? AND state IN ('queued','executing') ORDER BY CASE state WHEN 'queued' THEN 0 ELSE 1 END,created_at,id LIMIT 10",this.owner).all<Record<string,unknown>>()).results.map(decoded);}
  async claim(id:string,claim:string) {
    validID(claim);await this.stmt("UPDATE mirror_operations SET state='executing',claim=?,updated_at=? WHERE owner=? AND id=? AND state='queued'",claim,at(),this.owner,id).run();
    const op=await this.get(id);if(op.claim!==claim||op.state!=="executing")fail("Operation belongs to another claim or is final.");return op;
  }
  async ack(id:string,claim:string,result:{state:string}) {
    if(!result||!["applied","conflict","failed","uncertain"].includes(result.state))fail("Invalid outcome.");
    const op=await this.get(id);if(op.claim!==claim)fail("Claim mismatch.");
    if(op.state!=="executing"){if(canonical(op.result)!==canonical(result))fail("Final receipt cannot change.");return op;}
    await this.stmt("UPDATE mirror_operations SET state=?,result=?,updated_at=? WHERE owner=? AND id=? AND state='executing' AND claim=?",result.state,canonical(result),at(),this.owner,id,claim).run();const saved=await this.get(id);if(canonical(saved.result)!==canonical(result))fail("Concurrent acknowledgement mismatch.");return saved;
  }
  async state(cursor=0) {
    if(!Number.isInteger(cursor)||cursor<0||cursor>10000)fail("Invalid page cursor.");
    const [meta,rows,operations,plans,count,pending]=await Promise.all([this.meta(),this.stmt("SELECT * FROM mirror_items WHERE owner=? ORDER BY kind,id LIMIT 100 OFFSET ?",this.owner,cursor).all<{id:string;kind:string;fields:string;deleted:number;observed_at:string}>(),this.stmt("SELECT * FROM mirror_operations WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT 100",this.owner).all<Record<string,unknown>>(),this.stmt("SELECT * FROM mirror_plans WHERE owner=?",this.owner).all<{id:string;priority:string;revision:number}>(),this.stmt("SELECT count(*) AS n FROM mirror_items WHERE owner=?",this.owner).first<{n:number}>(),this.pending()]);
    const ops=operations.results.map(decoded);
    return {mode:"mirror",last_sync_at:meta?.observed_at??null,sequence:meta?.sequence??0,zone:meta?.zone??null,
      sync_age_seconds:meta?Math.max(0,(Date.now()-Date.parse(meta.observed_at))/1000):null,
      confirmed:rows.results.map(r=>({...r,fields:JSON.parse(r.fields)})),
      total_items:count?.n??0,next_cursor:cursor+rows.results.length<(count?.n??0)?cursor+rows.results.length:null,
      pending_overlay:[...new Map([...ops.filter(o=>o.state==="uncertain"),...pending].map(o=>[o.id,o])).values()].map(o=>({id:o.id,target:o.content.target,fields:o.content.fields,state:o.state})),operations:ops.reverse(),plans:plans.results,
      journal_view:"latest 100 operations; complete journal retained",pending_view:"next 10 runnable/claimed operations plus recent uncertain outcomes"};
  }
}
