import {DurableObject} from 'cloudflare:workers';
import {NativeQueue,type EnqueueRequest,type NativeOperation,type PreparedEnqueue,type Policy} from './native-queue';
import {BulkD1} from './d1-bulk';
import {canonical,fingerprint,MirrorStore} from '../site/lib/mirror-store';
import {SyncFeed} from './sync-feed';
import {DemoError} from '../site/lib/demo-store';

type Mutation='claim'|'ack'|'commit';
type Intent={position:number;id:string;hash:string;request:string;policy:Policy|Mutation;prepared:string|null};
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
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS feed_watermark(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO feed_watermark VALUES(1,0)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS mutation_outcomes(id TEXT PRIMARY KEY,result TEXT NOT NULL)');
  }
  private queue(){return new NativeQueue(new BulkD1(this.env.DB),this.env.LIFEOS_OWNER_ID);}
  private revision(){return this.ctx.storage.sql.exec<{revision:number}>('SELECT revision FROM watermark').one().revision;}
  private feedRevision(){return this.ctx.storage.sql.exec<{revision:number}>('SELECT revision FROM feed_watermark').one().revision;}
  private feed(){return new SyncFeed(new BulkD1(this.env.DB),this.env.LIFEOS_OWNER_ID);}
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
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO intents(id,hash,request,policy) VALUES(?,?,?,?)',input.id,hash,canonical(input),this.env.LIFEOS_SMART_SYNC_ENABLED==='true'?'smart_merge_v1':this.env.LIFEOS_CLOUD_WINS_ENABLED==='true'?'cloud_wins':'things_wins');
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
  async mutate(action:Mutation,input:Record<string,unknown>):Promise<unknown>{
    if(!['claim','ack','commit'].includes(action)||!input||canonical(input).length>40000)throw new DemoError('Invalid semantic mutation.');
    const allowed=action==='claim'?['id','claim']:action==='commit'?['sequence']:['id','claim','result','applied_after_sequence','observed_before','verified_after','merge_decision'];
    if(Object.keys(input).some(k=>!allowed.includes(k)))throw new DemoError('Unexpected semantic mutation fields.');
    const hash=await fingerprint({action,input}),id='mutation-'+hash;
    const saved=this.ctx.storage.sql.exec<{result:string}>('SELECT result FROM mutation_outcomes WHERE id=?',id).toArray()[0];if(saved){const result=JSON.parse(saved.result);if(result?.mutation_rejected)this.ctx.storage.sql.exec('DELETE FROM mutation_outcomes WHERE id=?',id);else return result;}
    await this.ctx.storage.transaction(async()=>{this.ctx.storage.sql.exec('INSERT OR IGNORE INTO intents(id,hash,request,policy) VALUES(?,?,?,?)',id,hash,canonical(input),action);await this.ctx.storage.setAlarm(Date.now()+1000);});
    await this.locked(()=>this.drain());
    const outcome=this.ctx.storage.sql.exec<{result:string}>('SELECT result FROM mutation_outcomes WHERE id=?',id).toArray()[0];
    if(!outcome)throw new Error('Durable mutation is pending recovery.');const result=JSON.parse(outcome.result);if(result?.mutation_rejected){this.ctx.storage.sql.exec('DELETE FROM mutation_outcomes WHERE id=?',id);throw new DemoError('Semantic mutation rejected.');}return result;
  }
  private async drain(){
    for(;;){
      const head=this.ctx.storage.sql.exec<Intent>('SELECT * FROM intents ORDER BY position LIMIT 1').toArray()[0];
      if(!head)break;
      if(['claim','ack','commit'].includes(head.policy)){
        const input=JSON.parse(head.request);let result:unknown;
        try{
          if(head.policy==='claim')result=await this.queue().claim(input.id,input.claim);
          else if(head.policy==='ack')result=await this.queue().ack(input.id,input.claim,input.result,input.applied_after_sequence!==undefined?{applied_after_sequence:input.applied_after_sequence,...input.observed_before!==undefined?{observed_before:input.observed_before}:{},...input.verified_after!==undefined?{verified_after:input.verified_after}:{},...input.merge_decision!==undefined?{merge_decision:input.merge_decision}:{}}:undefined);
          else result=await new MirrorStore(new BulkD1(this.env.DB),this.env.LIFEOS_OWNER_ID).commit(input.sequence);
        }catch(error){if(!(error instanceof DemoError)){await this.ctx.storage.setAlarm(Date.now()+5000);return;}result={mutation_rejected:true};}
        const revision=await this.queue().revision(),feed=await this.feed().revision();
        this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('UPDATE watermark SET revision=MAX(revision,?)',revision);this.ctx.storage.sql.exec('UPDATE feed_watermark SET revision=MAX(revision,?)',feed);this.ctx.storage.sql.exec('INSERT OR IGNORE INTO mutation_outcomes VALUES(?,?)',head.id,canonical(result));this.ctx.storage.sql.exec('DELETE FROM intents WHERE position=?',head.position);});
        this.broadcast();continue;
      }
      let operation:NativeOperation|undefined,prepared:PreparedEnqueue|undefined=head.prepared?JSON.parse(head.prepared):undefined;
      if(!prepared){
        try{
          const result=await this.queue().prepareEnqueue(JSON.parse(head.request),head.policy as Policy);
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
      const feed=await this.feed().revision();
      this.ctx.storage.transactionSync(()=>{
        this.ctx.storage.sql.exec('UPDATE watermark SET revision=MAX(revision,?)',operation.ordinal);
        this.ctx.storage.sql.exec('UPDATE feed_watermark SET revision=MAX(revision,?)',feed);
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
      const state=socket.deserializeAttachment() as {ack:number;retries:number;version?:number};
      const watermark=state.version===3?this.feedRevision():revision;if(state.ack>=watermark)continue;
      try{socket.send(JSON.stringify({version:state.version===3?3:1,revision:watermark}));}catch{socket.close(1011,'Delivery failed');}
    }
  }
  private async schedule(){
    const intents=this.ctx.storage.sql.exec('SELECT 1 FROM intents LIMIT 1').toArray().length>0;
    const delivery=this.ctx.getWebSockets().some(s=>{const state=s.deserializeAttachment() as {ack:number;version?:number};return s.readyState===WebSocket.OPEN&&state.ack<(state.version===3?this.feedRevision():this.revision());});
    if(intents||delivery)await this.ctx.storage.setAlarm(Date.now()+5000);
    else await this.ctx.storage.deleteAlarm();
  }
  async fetch(request:Request){
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    const version=request.headers.get('X-LifeOS-Protocol')==='3'?3:1;
    server.serializeAttachment({ack:0,retries:0,version});this.ctx.acceptWebSocket(server);
    // Register before catch-up read, so racing commits cannot be missed.
    const revision=await this.queue().revision();
    const feed=await this.feed().revision();
    this.ctx.storage.sql.exec('UPDATE watermark SET revision=MAX(revision,?)',revision);
    this.ctx.storage.sql.exec('UPDATE feed_watermark SET revision=MAX(revision,?)',feed);
    server.send(JSON.stringify({version,revision:version===3?this.feedRevision():this.revision()}));
    await this.schedule();return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(socket:WebSocket,message:string|ArrayBuffer){
    try{
      const input=JSON.parse(typeof message==='string'?message:'');
      const state=socket.deserializeAttachment() as {ack:number;retries:number;version?:number};const version=state.version===3?3:1;
      if(input.version!==version||Object.keys(input).sort().join(',')!=='ack,version'||!Number.isSafeInteger(input.ack)||input.ack<0||input.ack>(version===3?this.feedRevision():this.revision()))throw new Error();
      socket.serializeAttachment({...state,ack:Math.max(state.ack,input.ack),retries:0});
    }catch{socket.close(1008,'Invalid acknowledgement');}
    await this.schedule();
  }
  async webSocketClose(socket:WebSocket,code:number,reason:string){socket.close(code,reason);await this.schedule();}
  async webSocketError(socket:WebSocket){socket.close(1011,'Connection failed');await this.schedule();}
  async alarm(){
    try{await this.locked(()=>this.drain());}
    catch{await this.ctx.storage.setAlarm(Date.now()+5000);return;}
    for(const socket of this.ctx.getWebSockets()){
      const state=socket.deserializeAttachment() as {ack:number;retries:number;version?:number};
      if(state.ack>=(state.version===3?this.feedRevision():this.revision()))continue;
      if(state.retries>=3){socket.close(1011,'Reconnect for catch-up');continue;}
      socket.serializeAttachment({...state,retries:state.retries+1});
    }
    this.broadcast();await this.schedule();
  }
}
export function ownerSync(env:Env){return env.OWNER_SYNC.getByName(env.LIFEOS_OWNER_ID);}
