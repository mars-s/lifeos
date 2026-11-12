// Hardening for the GitHub return to /callback. A browser can load /callback twice at once
// (a fast meta refresh and redirect chain, or a speculative load that still carries cookies).
// KV cannot consume a transaction atomically, so the loser either finds it gone or fails the
// second GitHub exchange, and its error page can replace the winner's redirect in the tab.
// The winner therefore publishes its client redirect for two minutes, and a sibling holding
// the same state and binding cookie returns that same redirect instead of an error.

const encoder = new TextEncoder();
const upstreamCookie = '__Host-oauth-upstream-';
const ttlSeconds = 120;
const sleep = (ms:number) => new Promise(resolve => setTimeout(resolve, ms));
const b64 = (bytes:Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text:string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function hex(value:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2,'0')).join('');
}
// Only a holder of the state can decrypt the stored redirect; KV and memory keep its hash.
async function redirectKey(state:string) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode('lifeos-callback-redirect:'+state)), 'AES-GCM', false, ['encrypt','decrypt']);
}
const recent = new Map<string,{sealed:string;expires:number}>();

/** The request carries the library's binding cookie for this exact state. */
export async function boundToState(request:Request, state:string) {
  const hash = await hex(state), name = upstreamCookie + hash.slice(0,16) + '=';
  return (request.headers.get('cookie') ?? '').split(';').some(part => part.trim() === name + hash);
}
export async function clearBindingCookie(state:string) {
  return `${upstreamCookie}${(await hex(state)).slice(0,16)}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function rememberRedirect(kv:KVNamespace, state:string, location:string) {
  const hash = await hex(state), iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = b64(iv)+'.'+b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await redirectKey(state), encoder.encode(location))));
  const now = Date.now();
  for(const [key,entry] of recent) if(entry.expires<=now) recent.delete(key);
  recent.set(hash, {sealed, expires:now+ttlSeconds*1000});
  // Best effort: the sign-in already succeeded, and memory covers a sibling in this isolate.
  try { await kv.put('callback-redirect:'+hash, sealed, {expirationTtl:ttlSeconds}); } catch {}
}

async function lookup(kv:KVNamespace, state:string) {
  const hash = await hex(state), memory = recent.get(hash);
  const sealed = memory && memory.expires>Date.now() ? memory.sealed : await kv.get('callback-redirect:'+hash);
  if(!sealed) return null;
  try {
    const [iv,data] = sealed.split('.');
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)}, await redirectKey(state), unb64(data)));
  } catch { return null; }
}

/** Waits about a second for a sibling request that is still finishing to publish its redirect. */
export async function awaitRedirect(kv:KVNamespace, state:string, attempts=8, delayMs=150) {
  for(let attempt=0; attempt<attempts; attempt++) {
    const location = await lookup(kv, state);
    if(location) return location;
    if(attempt<attempts-1) await sleep(delayMs);
  }
  return null;
}

/**
 * Retries a missed read of a library transaction a few times, for a write that this location
 * has not seen yet. Every other KV call passes straight through.
 */
export function retryingTransactionKv(kv:KVNamespace, delays=[50,100,200]):KVNamespace {
  const read = kv.get.bind(kv) as (key:unknown, options?:unknown)=>Promise<unknown>;
  const get = async (key:unknown, options?:unknown) => {
    let value = await read(key, options);
    if(typeof key!=='string' || !key.startsWith('transaction:')) return value;
    for(const delay of delays) {
      if(value!==null) break;
      await sleep(delay);
      value = await read(key, options);
    }
    return value;
  };
  return new Proxy(kv, {get(target, property) {
    if(property==='get') return get;
    const value = Reflect.get(target, property);
    return typeof value==='function' ? value.bind(target) : value;
  }});
}

const token = (value:string|null) => value && /^[a-z?0-9-]{1,32}$/i.test(value) ? value : value===null ? null : 'other';
/** Facts safe to log about a sign-in request: no URL, query string, cookie, token or code. */
export function requestFacts(request:Request) {
  const h = request.headers;
  return {
    path:new URL(request.url).pathname, method:request.method,
    colo:token((request as Request&{cf?:{colo?:string}}).cf?.colo ?? null), ray:token(h.get('cf-ray')),
    state_present:new URL(request.url).searchParams.has('state'),
    upstream_cookie_present:(h.get('cookie') ?? '').split(';').some(part => part.trim().startsWith(upstreamCookie)),
    speculative_headers:['sec-purpose','purpose','x-moz'].some(name => h.has(name)),
    sec_fetch_dest:token(h.get('sec-fetch-dest')), sec_fetch_mode:token(h.get('sec-fetch-mode')), sec_fetch_site:token(h.get('sec-fetch-site')),
  };
}
