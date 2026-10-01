import {OwnerSync} from './owner-sync';
import mirror from './worker';
import {NativeQueue} from './native-queue';

type Fault={kind:string;remaining:number;after_commit:number};
function semanticKind(sql:string){
  if(/INSERT INTO mirror_meta|UPDATE mirror_meta SET/i.test(sql))return 'snapshot';
  if(/native_receipt_audit/.test(sql))return 'ack';
  if(/native_operations/.test(sql)&&/state\s*=\s*'executing'/.test(sql))return 'claim';
  if(/native_operations/.test(sql)&&/INSERT/i.test(sql))return 'enqueue';
  return '';
}

export class SmartTestOwnerSync extends OwnerSync {
  constructor(ctx:DurableObjectState,env:Env){
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS smart_test_fault(singleton INTEGER PRIMARY KEY,kind TEXT,remaining INTEGER,after_commit INTEGER)');
    ctx.storage.sql.exec("INSERT OR IGNORE INTO smart_test_fault VALUES(1,'',0,0)");
    const raw=new WeakMap<object,D1PreparedStatement>(),queries=new WeakMap<object,string>();
    function consume(kind:string){
      const fault=ctx.storage.sql.exec<Fault>('SELECT kind,remaining,after_commit FROM smart_test_fault WHERE singleton=1').one();
      if(fault.kind!==kind||fault.remaining<=0)return null;
      ctx.storage.sql.exec('UPDATE smart_test_fault SET remaining=remaining-1 WHERE singleton=1');return fault;
    }
    async function inject<T>(kind:string,run:()=>Promise<T>):Promise<T>{
      const fault=consume(kind);
      if(fault&&!fault.after_commit)throw new Error('Synthetic failure before semantic commit');
      const result=await run();
      if(fault)throw new Error('Synthetic response loss after semantic commit');
      return result;
    }
    function wrap(statement:D1PreparedStatement,sql:string):D1PreparedStatement{
      const proxy=new Proxy(statement,{get(target,key){
        if(key==='bind')return (...values:unknown[])=>wrap(target.bind(...values),sql);
        if(key==='run')return ()=>inject(semanticKind(sql),()=>target.run());
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      raw.set(proxy,statement);queries.set(proxy,sql);return proxy;
    }
    const db={prepare:(sql:string)=>wrap(env.DB.prepare(sql),sql),batch:(statements:D1PreparedStatement[])=>{
      const kind=semanticKind(statements.map(statement=>queries.get(statement)??'').join('\n'));
      return inject(kind,()=>env.DB.batch(statements.map(statement=>raw.get(statement)??statement)));
    }} as D1Database;
    super(ctx,{...env,DB:db});
  }
  configure(kind:string,remaining:number,after_commit:boolean){
    if(!['enqueue','claim','ack','snapshot'].includes(kind)||!Number.isInteger(remaining)||remaining<0||remaining>4)throw new Error('Invalid synthetic fault');
    this.ctx.storage.sql.exec('UPDATE smart_test_fault SET kind=?,remaining=?,after_commit=? WHERE singleton=1',kind,remaining,Number(after_commit));
  }
  async inspect(){
    const names=this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(row=>row.name);
    const retained:Record<string,unknown[]>={};
    for(const name of ['intents','mutations','mutation_intents','watermark','feed_watermark'])if(names.includes(name))retained[name]=this.ctx.storage.sql.exec(`SELECT * FROM ${name}`).toArray();
    return {retained,alarm:await this.ctx.storage.getAlarm(),sockets:this.ctx.getWebSockets().length,fault:this.ctx.storage.sql.exec('SELECT * FROM smart_test_fault').one()};
  }
  tick(){return this.alarm();}
}

export default {async fetch(request:Request,env:Env){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/__smart_test/')){
    const input=request.method==='POST'?await request.json() as Record<string,any>:{};
    const stub=env.OWNER_SYNC.getByName(env.LIFEOS_OWNER_ID) as unknown as DurableObjectStub<SmartTestOwnerSync>;
    if(path==='/__smart_test/fault'){await stub.configure(input.kind,input.remaining,input.after_commit);return Response.json({ok:true});}
    if(path==='/__smart_test/inspect')return Response.json(await stub.inspect());
    if(path==='/__smart_test/tick'){await stub.tick();return Response.json({ok:true});}
    if(path==='/__smart_test/enqueue'){
      try{return Response.json(await stub.enqueue(input as any));}catch(error){return Response.json({error:String(error)},{status:409});}
    }
    if(path==='/__smart_test/prepare_legacy'){
      const queue=new NativeQueue(env.DB,env.LIFEOS_OWNER_ID);
      try{const prepared=await queue.prepareEnqueue(input as any,'things_wins');return Response.json('input' in prepared?await queue.commitEnqueue(prepared):prepared);}
      catch{return Response.json({error:'Synthetic legacy request rejected'},{status:409});}
    }
    if(path==='/__smart_test/prepare_smart'){
      try{return Response.json(await new NativeQueue(env.DB,env.LIFEOS_OWNER_ID).prepareEnqueue(input as any,'smart_merge_v1'));}
      catch(error){return Response.json({error:String(error)},{status:409});}
    }
    if(path==='/__smart_test/overlays')return Response.json(await new NativeQueue(env.DB,env.LIFEOS_OWNER_ID).overlays());
  }
  return mirror.fetch(request,env);
}};
