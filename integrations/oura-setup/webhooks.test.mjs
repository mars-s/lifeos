import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectWebhook,recordWebhook,webhookFreshness} from './webhooks.mjs';
import {digest,seal,open,random} from './integration.mjs';
const now=Date.parse('2026-10-23T12:00:00Z');
async function setup(){return {OURA_WEBHOOK_ENABLED:'true',OURA_WEBHOOK_VERIFY_TOKEN:'fixture-verification',OURA_WEBHOOK_OWNER_ID_HASH:await digest('fixture-user'),OURA_CLIENT_SECRET:'fixture-secret',TOKEN_ENCRYPTION_KEY:random()};}
async function request(env,changes={},stamp=String(now/1000)){
 const body={event_type:'update',data_type:'daily_sleep',object_id:'fixture-object',user_id:'fixture-user',event_time:new Date(now).toISOString(),...changes};
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.OURA_CLIENT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(stamp+JSON.stringify(body)))),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
 return new Request('https://example.test/oura/webhook',{method:'POST',headers:{'x-oura-timestamp':stamp,'x-oura-signature':signature},body:JSON.stringify(body)});
}
test('webhooks inactive without activation; challenge requires exact token',async()=>{
 const env=await setup();assert.equal((await inspectWebhook(new Request('https://example.test/'),{}, {digest,now})).status,503);
 for(const [token,status] of [['wrong',401],['fixture-verification',200]])assert.equal((await inspectWebhook(new Request('https://example.test/?challenge=fixture&verification_token='+token),env,{digest,now})).status,status);
});
test('signature, owner, timestamp and type validation fail closed',async()=>{
 const env=await setup();assert.equal((await inspectWebhook(await request(env),env,{digest,now})).status,200);
 assert.equal((await inspectWebhook(await request(env,{},String(now/1000-301)),env,{digest,now})).status,401);
 assert.equal((await inspectWebhook(await request(env,{user_id:'other'}),env,{digest,now})).status,403);
 assert.equal((await inspectWebhook(await request(env,{data_type:'ring_configuration'}),env,{digest,now})).status,400);
 const forged=await request(env);forged.headers.set('x-oura-signature','0'.repeat(64));assert.equal((await inspectWebhook(forged,env,{digest,now})).status,401);
});
test('encrypted deduplication, out-of-order freshness and expiry omit identifiers',async()=>{
 const env=await setup(),map=new Map(),storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v)};
 const e=(await inspectWebhook(await request(env),env,{digest,now})).event;
 assert.equal(await recordWebhook(storage,e,{seal,open,env,now}),true);assert.equal(await recordWebhook(storage,e,{seal,open,env,now}),false);
 assert.doesNotMatch(JSON.stringify([...map]),/fixture-user|fixture-object|daily_sleep/);
 const old={...e,id:'older-fixture',event_time:new Date(now-60000).toISOString()};await recordWebhook(storage,old,{seal,open,env,now});
 const state=await webhookFreshness(storage,{open,env,now});assert.equal(state.observed_updates.daily_sleep.event_time,e.event_time);assert.doesNotMatch(JSON.stringify(state),/fixture-user|fixture-object/);
 assert.deepEqual((await webhookFreshness(storage,{open,env,now:now+86400001})).observed_updates,{});
});
