import {DurableObject} from 'cloudflare:workers';
import {NativeQueue,type EnqueueRequest,type NativeOperation,type PreparedEnqueue} from './native-queue';
import {BulkD1} from './d1-bulk';
import {canonical,fingerprint} from '../site/lib/mirror-store';
import {DemoError} from '../site/lib/demo-store';

type Intent={position:number;id:string;hash:string;request:string;policy:'things_wins'|'cloud_wins';prepared:string|null};
type Outcome={hash:string;rejected:number};
export type Acceptance=NativeOperation|{id:string;state:'accepted';acceptance_pending:true};
export class OwnerSync extends DurableObject<Env> {
  private serial:Promise<void>=Promise.resolve();
  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS intents(position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,request TEXT NOT NULL,policy TEXT NOT NULL,prepared TEXT)`);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS outcomes(id TEXT PRIMARY KEY,hash TEXT NOT NULL,rejected INTEGER NOT NULL DEFAULT 0)`);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS watermark(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL)`);
    ctx.storage.sql.exec(`INSERT OR IGNORE INTO watermark VALUES(1,0)`);
  }
  private queue(){return new NativeQueue(new BulkD1(this.env.DB),this.env.LIFEOS_OWNER_ID);}
  private revision(){return this.ctx.storage.sql.exec<{revision:number}>('SELECT revision FROM watermark').one().revision;}
  private async locked<T>(action:()=>Promise<T>):Promise<T>{
    const run=this.serial.then(action);this.serial=run.then(()=>{},()=>{});return run;
  }
  async enqueue(input:EnqueueRequest):Promise<Acceptance>{
    // Bound and validate the identity before it can enter durable ordering.
    if(!input||typeof input.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.id)||canonical(input).length>12000)throw new DemoError('Invalid enqueue request.');
    const hash=await fingerprint(input);
    const old=this.ctx.storage.sql.exec<Outcome>('SELECT hash,rejected FROM outcomes WHERE id=?',input.id).toArray()[0];
    if(old){if(old.hash!==hash)throw new DemoError('Operation ID reused.');if(old.rejected)throw new DemoError('Operation was rejected.');return this.queue().get(input.id);}
    const pending=this.ctx.storage.sql.exec<Intent>('SELECT * FROM intents WHERE id=?',input.id).toArray()[0];
    if(pending&&pending.hash!==hash)throw new DemoError('Operation ID reused.');
    await this.ctx.storage.transaction(async()=>{
      const outcome=this.ctx.storage.sql.exec<Outcome>('SELECT hash,rejected FROM outcomes WHERE id=?',input.id).toArray()[0];
      const intent=this.ctx.storage.sql.exec<Intent>('SELECT * FROM intents WHERE id=?',input.id).toArray()[0];
      if(outcome?.hash!==undefined&&outcome.hash!==hash||intent?.hash!==undefined&&intent.hash!==hash)throw new DemoError('Operation ID reused.');
      if(outcome)return;
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO intents(id,hash,request,policy) VALUES(?,?,?,?)',input.id,hash,canonical(input),this.env.LIFEOS_CLOUD_WINS_ENABLED==='true'?'cloud_wins':'things_wins');
      // The alarm is durable before the first external D1 attempt.
      await this.ctx.storage.setAlarm(Date.now()+1000);
    });
    await this.locked(()=>this.drain());
    const outcome=this.ctx.storage.sql.exec<Outcome>('SELECT hash,rejected FROM outcomes WHERE id=?',input.id).toArray()[0];
    if(outcome&&outcome.hash!==hash)throw new DemoError('Operation ID reused.');
    if(outcome?.rejected)throw new DemoError('Operation was rejected.');
    if(outcome)return this.queue().get(input.id);
    return {id:input.id,state:'accepted',acceptance_pending:true};
  }
  private async drain(){
    for(;;){
      const head=this.ctx.storage.sql.exec<Intent>('SELECT * FROM intents ORDER BY position LIMIT 1').toArray()[0];
      if(!head)break;
      let operation:NativeOperation|undefined,prepared:PreparedEnqueue|undefined=head.prepared?JSON.parse(head.prepared):undefined;
      if(!prepared){
        try{
          const result=await this.queue().prepareEnqueue(JSON.parse(head.request),head.policy);
          if('input' in result){
            prepared=result;
            this.ctx.storage.sql.exec('UPDATE intents SET prepared=? WHERE position=?',canonical(prepared),head.position);
            await this.ctx.storage.sync();
          }else operation=result;
        }catch(error){
          if(!(error instanceof DemoError)){await this.ctx.storage.setAlarm(Date.now()+5000);return;}
          // Only preparation may reject: no mutating D1 attempt has occurred.
          this.ctx.storage.transactionSync(()=>{
            this.ctx.storage.sql.exec('INSERT OR IGNORE INTO outcomes(id,hash,rejected) VALUES(?,?,1)',head.id,head.hash);
            this.ctx.storage.sql.exec('DELETE FROM intents WHERE position=?',head.position);
          });continue;
        }
      }
      if(!operation){
        try{operation=await this.queue().commitEnqueue(prepared!);}
        catch{await this.ctx.storage.setAlarm(Date.now()+5000);return;}
      }
      this.ctx.storage.transactionSync(()=>{
        this.ctx.storage.sql.exec('UPDATE watermark SET revision=MAX(revision,?)',operation.ordinal);
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO outcomes(id,hash) VALUES(?,?)',head.id,head.hash);
        this.ctx.storage.sql.exec('DELETE FROM intents WHERE position=?',head.position);
      });
      this.broadcast();
    }
    await this.schedule();
  }
  private broadcast(){
    const revision=this.revision();
    for(const socket of this.ctx.getWebSockets()){
      if(socket.readyState!==WebSocket.OPEN)continue;
      const state=socket.deserializeAttachment() as {ack:number;retries:number};
      if(state.ack>=revision)continue;
      try{socket.send(JSON.stringify({version:1,revision}));}catch{socket.close(1011,'Delivery failed');}
    }
  }
  private async schedule(){
    const intents=this.ctx.storage.sql.exec('SELECT 1 FROM intents LIMIT 1').toArray().length>0;
    const revision=this.revision(),delivery=this.ctx.getWebSockets().some(s=>s.readyState===WebSocket.OPEN&&(s.deserializeAttachment() as {ack:number}).ack<revision);
    if(intents||delivery)await this.ctx.storage.setAlarm(Date.now()+5000);
    else await this.ctx.storage.deleteAlarm();
  }
  async fetch(request:Request){
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    server.serializeAttachment({ack:0,retries:0});this.ctx.acceptWebSocket(server);
    // Register before catch-up read, so racing commits cannot be missed.
    const revision=await this.queue().revision();
    this.ctx.storage.sql.exec('UPDATE watermark SET revision=MAX(revision,?)',revision);
    server.send(JSON.stringify({version:1,revision:this.revision()}));
    await this.schedule();return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(socket:WebSocket,message:string|ArrayBuffer){
    try{
      const input=JSON.parse(typeof message==='string'?message:'');
      if(input.version!==1||Object.keys(input).sort().join(',')!=='ack,version'||!Number.isSafeInteger(input.ack)||input.ack<0||input.ack>this.revision())throw new Error();
      const state=socket.deserializeAttachment() as {ack:number;retries:number};
      socket.serializeAttachment({ack:Math.max(state.ack,input.ack),retries:0});
    }catch{socket.close(1008,'Invalid acknowledgement');}
    await this.schedule();
  }
  async webSocketClose(socket:WebSocket,code:number,reason:string){socket.close(code,reason);await this.schedule();}
  async webSocketError(socket:WebSocket){socket.close(1011,'Connection failed');await this.schedule();}
  async alarm(){
    try{await this.locked(()=>this.drain());}
    catch{await this.ctx.storage.setAlarm(Date.now()+5000);return;}
    for(const socket of this.ctx.getWebSockets()){
      const state=socket.deserializeAttachment() as {ack:number;retries:number};
      if(state.ack>=this.revision())continue;
      if(state.retries>=3){socket.close(1011,'Reconnect for catch-up');continue;}
      socket.serializeAttachment({...state,retries:state.retries+1});
    }
    this.broadcast();await this.schedule();
  }
}
export function ownerSync(env:Env){return env.OWNER_SYNC.getByName(env.LIFEOS_OWNER_ID);}
