// Synthetic local CPU proxy only. Production Worker CPU must be measured after
// deployment: process.cpuUsage does not measure the remote workerd process.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
const compiled=await build({entryPoints:['../site/lib/mirror-store.ts'],write:false,bundle:true,platform:'node',format:'esm'});
const {canonical,fingerprint}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const records=Array.from({length:59},(_,n)=>({id:'fixture-'+n,kind:n<49?'todo':'tag',fields:Object.fromEntries(Array.from({length:22},(_,k)=>['field-'+k,{state:k>15?'unsupported':'value',...(k<=15?{value:k===1?'Synthetic notes '.repeat(80):'Synthetic value '+n}:{})}]))}));
const times=[];
for(let n=0;n<100;n++) {
 const start=process.cpuUsage();
 const key=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('PUBLIC-SYNTHETIC-fixture-key-at-least-32-characters')));
 createHash('sha256').update(key).digest('hex');
 await fingerprint(records);
 JSON.parse(canonical(records));JSON.stringify({confirmed:records});
 const used=process.cpuUsage(start);times.push((used.user+used.system)/1000);
}
times.sort((a,b)=>a-b);
console.log(JSON.stringify({fixture_records:59,bytes:Buffer.byteLength(canonical(records)),local_cpu_proxy_median_ms:times[50],local_cpu_proxy_p95_ms:times[95],production_cpu_verified:false}));
