// Synthetic fault injection fixture. Never referenced by the deployment entry.
import {OwnerSync} from './owner-sync';
import mirror from './worker';
import {NativeQueue} from './native-queue';

export class TestOwnerSync extends OwnerSync {
  private deferred:{commit?:()=>Promise<unknown>};
  constructor(ctx:DurableObjectState,env:Env){
    const deferred:{commit?:()=>Promise<unknown>}={};
    const db={prepare:(sql:string)=>env.DB.prepare(sql),batch:async(statements:D1PreparedStatement[])=>{
      const fault=ctx.storage.sql.exec<{count:number;after_commit:number}>('SELECT * FROM test_fault').toArray()[0];
      if(fault?.count>0){
        ctx.storage.sql.exec('UPDATE test_fault SET count=count-1');
        if(!fault.after_commit)throw new Error('Synthetic unavailable D1');
        if(fault.after_commit===2){deferred.commit=()=>env.DB.batch(statements);throw new Error('Synthetic delayed commit');}
        await env.DB.batch(statements);throw new Error('Synthetic lost response after D1 commit');
      }
      return env.DB.batch(statements);
    }} as D1Database;
    super(ctx,{...env,DB:db});
    this.deferred=deferred;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS test_fault(count INTEGER,after_commit INTEGER)');
    ctx.storage.sql.exec('INSERT INTO test_fault SELECT 0,0 WHERE NOT EXISTS(SELECT 1 FROM test_fault)');
  }
  configure(count:number,after:boolean|number){this.ctx.storage.sql.exec('UPDATE test_fault SET count=?,after_commit=?',count,Number(after));}
  async releaseLate(){await this.deferred.commit?.();this.deferred.commit=undefined;}
  async inspect(){return {intents:this.ctx.storage.sql.exec('SELECT * FROM intents ORDER BY position').toArray(),outcomes:this.ctx.storage.sql.exec('SELECT * FROM outcomes').toArray(),watermark:this.ctx.storage.sql.exec('SELECT revision FROM watermark').one().revision,alarm:await this.ctx.storage.getAlarm(),sockets:this.ctx.getWebSockets().length};}
  tick(){return this.alarm();}
}
export default {async fetch(request:Request,env:Env){
  const path=new URL(request.url).pathname;
  const stub=env.OWNER_SYNC.getByName(env.LIFEOS_OWNER_ID) as unknown as DurableObjectStub<TestOwnerSync>;
  if(path.startsWith('/__test/')){
    const input=request.method==='POST'?await request.json() as Record<string,any>:{};
    if(path==='/__test/configure'){await stub.configure(input.count,input.after);return Response.json({ok:true});}
    if(path==='/__test/inspect')return Response.json(await stub.inspect());
    if(path==='/__test/release'){await stub.releaseLate();return Response.json({ok:true});}
    if(path==='/__test/tick'){await stub.tick();return Response.json({ok:true});}
    if(path==='/__test/enqueue'){
      try{return Response.json(await stub.enqueue(input as any));}catch{return Response.json({error:'Rejected'},{status:409});}
    }
    if(path==='/__test/overlays')return Response.json(await new NativeQueue(env.DB,env.LIFEOS_OWNER_ID).overlays());
  }
  return mirror.fetch(request,env);
}};
