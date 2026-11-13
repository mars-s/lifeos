import {DurableObject} from 'cloudflare:workers';

// Workers KV is eventually consistent and does not read its own writes, even in one colo, so
// a GitHub callback a few seconds after consent can miss the sign-in transaction. These short
// lived records live in one strongly consistent Durable Object instead. Clients, grants and
// tokens stay on KV. Keys and values are never logged.
const routed = (key:unknown): key is string => typeof key==='string' && (key.startsWith('transaction:') || key.startsWith('callback-redirect:'));
const sweepMs = 15*60*1000;
type Stored = {value:string; exp:number|null};

export class OAuthTransactions extends DurableObject {
  async get(key:string):Promise<string|null> {
    const record = await this.ctx.storage.get<Stored>(key);
    if(!record) return null;
    if(record.exp!==null && record.exp<=Date.now()) { await this.ctx.storage.delete(key); return null; }
    return record.value;
  }
  async put(key:string, value:string, expirationTtl?:number) {
    await this.ctx.storage.put<Stored>(key, {value, exp:expirationTtl ? Date.now()+expirationTtl*1000 : null});
    if(await this.ctx.storage.getAlarm()===null) await this.ctx.storage.setAlarm(Date.now()+sweepMs);
  }
  async delete(key:string) {
    await this.ctx.storage.delete(key);
  }
  /** Removes abandoned sign-ins that nobody read back after they expired. */
  async alarm() {
    const now = Date.now(), records = await this.ctx.storage.list<Stored>();
    const expired = [...records].filter(([,record]) => record.exp!==null && record.exp<=now).map(([key]) => key);
    for(let i=0; i<expired.length; i+=128) await this.ctx.storage.delete(expired.slice(i, i+128));
    if(records.size>expired.length) await this.ctx.storage.setAlarm(now+sweepMs);
  }
}

/** OAUTH_KV with sign-in transactions and callback redirects held in the OAuthTransactions object. */
export function consistentTransactionKv(kv:KVNamespace, namespace:DurableObjectNamespace<OAuthTransactions>):KVNamespace {
  const store = () => namespace.get(namespace.idFromName('oauth-transactions'));
  const get = async (key:unknown, options?:unknown) => {
    if(!routed(key)) return (kv.get as (k:unknown, o?:unknown)=>Promise<unknown>)(key, options);
    const value = await store().get(key);
    const type = typeof options==='string' ? options : (options as {type?:string}|undefined)?.type;
    return value!==null && type==='json' ? JSON.parse(value) : value;
  };
  const put = async (key:unknown, value:unknown, options?:{expirationTtl?:number}) => {
    if(!routed(key)) return (kv.put as (k:unknown, v:unknown, o?:unknown)=>Promise<void>)(key, value, options);
    if(typeof value!=='string') throw new TypeError('Sign-in transaction values must be strings.');
    await store().put(key, value, options?.expirationTtl);
  };
  const remove = async (key:unknown) => routed(key) ? store().delete(key) : kv.delete(key as string);
  return new Proxy(kv, {get(target, property) {
    if(property==='get') return get;
    if(property==='put') return put;
    if(property==='delete') return remove;
    const value = Reflect.get(target, property);
    return typeof value==='function' ? value.bind(target) : value;
  }});
}
