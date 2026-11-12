import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupResponse} from './setup-pages.mjs';
const origin='https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev';
test('all public pages render with safe headers',async()=>{for(const path of ['/oura','/oura/privacy','/oura/terms']){const r=setupResponse(new Request(origin+path));assert.equal(r.status,200);assert.match(await r.text(),/<!doctype html>/);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');}});
test('callbacks fail closed without reflecting query values',async()=>{for(const suffix of ['','?code=SENSITIVE&state=SENSITIVE','?error=SENSITIVE']){const r=setupResponse(new Request(origin+'/oura/callback'+suffix));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/SENSITIVE/);}});
test('unrelated routes are not handled',()=>{for(const path of ['/','/callback','/authorize','/mcp','/health','/state','/api/sync/begin'])assert.equal(setupResponse(new Request(origin+path)),null);});
test('writes refused and HEAD empty',async()=>{assert.equal(setupResponse(new Request(origin+'/oura/callback',{method:'POST',body:'secret'})).status,405);assert.equal(await setupResponse(new Request(origin+'/oura',{method:'HEAD'})).text(),'');});
