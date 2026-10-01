import {build} from '../site/node_modules/esbuild/lib/main.js';
import {mkdirSync,copyFileSync} from 'node:fs';
await build({entryPoints:['site/tests/entry.ts'],outfile:'railway/mirror.mjs',bundle:true,platform:'node',format:'esm'});
mkdirSync('railway/migrations',{recursive:true});
for(const name of ['0000_equal_spyke.sql','0001_hard_katie_power.sql'])copyFileSync('site/drizzle/'+name,'railway/migrations/'+name);
