export type Task = {id:string; title:string; title_rev:number; notes:string; deadline:string|null; deleted:number};
export type Content = {kind:"patch"; target:string; fields:{title:string}; base:{title:string; title_rev:number}; zone:string};
export type Operation = {id:string; revision:string; content:Content; state:string; result:Record<string, unknown>|null; created_at:string};
export type DemoState = {mode:"synthetic"; last_sync_at:string|null; sync_age_seconds:number|null; sequence:number; adapter_status:string; confirmed:Task[]; operations:Operation[]; audit_count:number};

export class DemoError extends Error {
  constructor(message:string, public status=409) {super(message);}
}
const now = () => new Date().toISOString();
const operation = (row:Record<string, unknown>):Operation => ({...row,
  content:JSON.parse(row.content as string), result:row.result ? JSON.parse(row.result as string):null}) as Operation;

export async function hash(value:unknown):Promise<string> {
  const data=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(data)).map(x=>x.toString(16).padStart(2,"0")).join("");
}

export class DemoStore {
  constructor(private db:D1Database, private owner:string) {
    if(!owner) throw new DemoError("Sign in to access this private demo.",401);
  }
  stmt(sql:string, ...args:unknown[]) {return this.db.prepare(sql).bind(...args);}
  async seed() {
    const at=now();
    await this.db.batch([
      this.stmt("INSERT OR IGNORE INTO sync_state VALUES(?,1,?,'offline')",this.owner,at),
      ...[{id:"demo-flight",title:"Check flight details",notes:"Synthetic sample task",deadline:"2026-10-03"},
          {id:"demo-pack",title:"Pack travel adapter",notes:"Synthetic sample task",deadline:null}].flatMap(t=>[
        this.stmt("INSERT OR IGNORE INTO mock_tasks VALUES(?,?,?,1,?,?,0,NULL)",this.owner,t.id,t.title,t.notes,t.deadline),
        this.stmt("INSERT OR IGNORE INTO snapshots VALUES(?,?,?,1,?,?,0)",this.owner,t.id,t.title,t.notes,t.deadline),
      ]),
    ]);
    return this.state();
  }
  async state():Promise<DemoState> {
    const [sync,tasks,ops,count]=await Promise.all([
      this.stmt("SELECT * FROM sync_state WHERE owner=?",this.owner).first<{observed_at:string; sequence:number; adapter_status:string}>(),
      this.stmt("SELECT id,title,title_rev,notes,deadline,deleted FROM snapshots WHERE owner=? ORDER BY id",this.owner).all<Task>(),
      this.stmt("SELECT id,revision,content,state,result,created_at FROM operations WHERE owner=? ORDER BY created_at,id",this.owner).all<Record<string,unknown>>(),
      this.stmt("SELECT count(*) AS n FROM audit WHERE owner=?",this.owner).first<{n:number}>(),
    ]);
    return {mode:"synthetic",last_sync_at:sync?.observed_at??null,sequence:sync?.sequence??0,
      sync_age_seconds:sync?Math.max(0,Math.floor((Date.now()-Date.parse(sync.observed_at))/1000)):null,
      adapter_status:sync?.adapter_status??"offline",confirmed:tasks.results,operations:ops.results.map(operation),audit_count:count?.n??0};
  }
  async get(id:string):Promise<Operation> {
    const row=await this.stmt("SELECT * FROM operations WHERE owner=? AND id=?",this.owner,id).first<Record<string,unknown>>();
    if(!row)throw new DemoError("Proposal not found in your demo.",404);
    return operation(row);
  }
  async propose(input:{id:string;target:string;title:string;base_title_rev:number;zone:string}) {
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(input.id)||!input.target||!input.title?.trim()||input.title.length>300||!Number.isInteger(input.base_title_rev))
      throw new DemoError("Choose a task and enter a title of 1–300 characters.");
    try{new Intl.DateTimeFormat("en",{timeZone:input.zone});}catch{throw new DemoError("Use a valid IANA timezone.");}
    const existing=await this.stmt("SELECT * FROM operations WHERE owner=? AND id=?",this.owner,input.id).first<Record<string,unknown>>();
    if(existing) {
      const op=operation(existing);
      if(op.content.target!==input.target||op.content.fields.title!==input.title||op.content.zone!==input.zone||op.content.base.title_rev!==input.base_title_rev)
        throw new DemoError("This request ID was already used for different content.");
      return op;
    }
    const task=await this.stmt("SELECT * FROM snapshots WHERE owner=? AND id=? AND deleted=0",this.owner,input.target).first<Task>();
    if(!task||task.title_rev!==input.base_title_rev)throw new DemoError("The snapshot changed. Refresh and review a new proposal.");
    const content:Content={kind:"patch",target:input.target,fields:{title:input.title},base:{title:task.title,title_rev:task.title_rev},zone:input.zone};
    const revision=await hash({id:input.id,content});const at=now();
    await this.stmt("INSERT OR IGNORE INTO operations(owner,id,revision,content,state,result,created_at,updated_at) SELECT ?,?,?,?,'draft',NULL,?,? FROM snapshots WHERE owner=? AND id=? AND title_rev=? AND deleted=0",
      this.owner,input.id,revision,JSON.stringify(content),at,at,this.owner,input.target,input.base_title_rev).run();
    const saved=await this.get(input.id);
    if(saved.revision!==revision)throw new DemoError("This request ID was already used for different content.");
    return saved;
  }
  async decide(id:string,revision:string,approve:boolean) {
    const desired=approve?"queued":"rejected";
    await this.stmt("UPDATE operations SET state=?,updated_at=? WHERE owner=? AND id=? AND revision=? AND state='draft'",desired,now(),this.owner,id,revision).run();
    const op=await this.get(id);
    if(op.revision!==revision||op.state!==desired)throw new DemoError("Decision must match the exact draft revision. Refresh to see its current state.");
    return op;
  }
  async setOffline() {
    await this.stmt("UPDATE sync_state SET adapter_status='offline' WHERE owner=?",this.owner).run();
    return this.state();
  }
  async conflict(target:string) {
    const result=await this.stmt("UPDATE mock_tasks SET title=title||' · changed on mock iPhone',title_rev=title_rev+1 WHERE owner=? AND id=? AND deleted=0",this.owner,target).run();
    if(!result.meta.changes)throw new DemoError("Sample task not found.",404);
    return this.state(); // Changed mock source stays separate until a simulated sync.
  }
  async reconnect() {
    const pending=(await this.stmt("SELECT * FROM operations WHERE owner=? AND state='queued' ORDER BY created_at,id",this.owner).all<Record<string,unknown>>()).results.map(operation);
    for(const op of pending) {
      const c=op.content, at=now();
      // Atomicity is valid only for this D1 mock source, not a Things API guarantee.
      await this.db.batch([
        this.stmt("UPDATE mock_tasks SET title=?,title_rev=title_rev+1,last_op=? WHERE owner=? AND id=? AND title=? AND title_rev=? AND deleted=0 AND EXISTS(SELECT 1 FROM operations WHERE owner=? AND id=? AND state='queued')",
          c.fields.title,op.id,this.owner,c.target,c.base.title,c.base.title_rev,this.owner,op.id),
        this.stmt("UPDATE operations SET state=CASE WHEN EXISTS(SELECT 1 FROM mock_tasks WHERE owner=? AND id=? AND last_op=?) THEN 'applied' ELSE 'conflict' END,result=CASE WHEN EXISTS(SELECT 1 FROM mock_tasks WHERE owner=? AND id=? AND last_op=?) THEN ? ELSE ? END,updated_at=? WHERE owner=? AND id=? AND state='queued'",
          this.owner,c.target,op.id,this.owner,c.target,op.id,
          JSON.stringify({before:c.base.title,after:c.fields.title,verified_at:at,scope:"synthetic D1 source only"}),
          JSON.stringify({reason:"The same field changed after review. No mock overwrite occurred."}),at,this.owner,op.id),
      ]);
    }
    await this.db.batch([
      this.stmt("UPDATE snapshots SET deleted=1 WHERE owner=? AND NOT EXISTS(SELECT 1 FROM mock_tasks WHERE mock_tasks.owner=snapshots.owner AND mock_tasks.id=snapshots.id AND mock_tasks.deleted=0)",this.owner),
      this.stmt("INSERT INTO snapshots SELECT owner,id,title,title_rev,notes,deadline,deleted FROM mock_tasks WHERE owner=? ON CONFLICT(owner,id) DO UPDATE SET title=excluded.title,title_rev=excluded.title_rev,notes=excluded.notes,deadline=excluded.deadline,deleted=excluded.deleted",this.owner),
      this.stmt("UPDATE sync_state SET sequence=sequence+1,observed_at=?,adapter_status='recent' WHERE owner=?",now(),this.owner),
    ]);
    return this.state();
  }
}
