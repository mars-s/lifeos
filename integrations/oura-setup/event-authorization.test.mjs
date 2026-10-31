import {test} from 'node:test';import assert from 'node:assert/strict';import {eventPrincipal,grantChecker} from './event-authorization.mjs';
test('grant adapter keeps only fingerprint and rechecks token, grant, client and Oura connection',async()=>{
 const now=1800000000000,raw='lifeos-owner:fixture-grant:fixture-bearer-secret';const p=await eventPrincipal({userId:'lifeos-owner',token:raw,clientId:'fixture-client',expiresAt:now/1000+3600,scope:['oura:read']},{owner:'lifeos-owner',connectionId:'fixture-connection'});
 assert.doesNotMatch(JSON.stringify(p),/fixture-bearer-secret/);const resource='https://example.test/mcp';
 const values={token:{userId:p.owner,grantId:p.grantId,expiresAt:now/1000+3600,audience:resource,scope:['oura:read'],grant:{clientId:p.clientId}},grant:{userId:p.owner,clientId:p.clientId,scope:['oura:read'],expiresAt:now/1000+7200},client:{clientId:p.clientId}};
 let connection=p.connectionId;const checker=grantChecker({kv:{get:async k=>values[k.split(':')[0]]},getConnectionId:async()=>connection,resource,now:()=>now});
 assert.equal(await checker(p),true);connection='replaced';assert.equal(await checker(p),false);connection=p.connectionId;
 for(const field of ['token','grant','client']){const original=values[field];values[field]=null;assert.equal(await checker(p),false);values[field]=original;}
 assert.equal(await checker({...p,expiresAt:now-1}),false);assert.equal(await checker({...p,clientId:'other'}),false);
 values.token.audience='https://other.test/mcp';assert.equal(await checker(p),false);
});
