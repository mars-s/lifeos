// Disposable local preview. No credentials, upstream services or production data.
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const directory=await mkdtemp(join(tmpdir(),'lifeos-document-preview-'));
const output=join(directory,'worker.mjs');
await build({entryPoints:['mcp-entry.ts'],outfile:output,bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire('/');"},loader:{'.html':'text','.css':'text'},external:['cloudflare:workers']});
const preview=new Miniflare({...convertV4MiniflareOptions({modules:true,script:await readFile(output,'utf8'),compatibilityDate:'2026-09-30',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'synthetic-documents'},bindings:{LIFEOS_OWNER_ID:'synthetic-owner',LIFEOS_ADAPTER_ID:'synthetic-mac'}}),host:'127.0.0.1',port:8791});
const db=await preview.getD1Database('DB');
await db.batch((await readFile('../site/drizzle/0006_artifacts.sql','utf8')).split('--> statement-breakpoint').map(sql=>db.prepare(sql.trim())));
const id=crypto.randomUUID(),share=crypto.randomUUID(),token='a'.repeat(64),date=new Date().toISOString();
const body=`## A place for the finished thought

Research is easier to share when the reader gets the document, without needing the conversation that produced it. This is a synthetic example of a LifeOS document.

<div class="callout info"><div class="callout-body"><p class="callout-title">One link, one document</p><p>Anyone with this link can read it. The owner can expire or revoke this link at any time.</p></div></div>

## What the reader receives

| Part | How it works |
| --- | --- |
| Document | A snapshot of the content at the time it was saved |
| Share link | Read-only access, with no account needed |
| Invite links | A separate link for each person, independently revocable |
| Expiry | Optional, checked every time the link opens |

### Designed for reading

Quiet type, a narrow reading column and hairline tables keep the focus on the words. The page follows the reader's light or dark system setting and prints cleanly.

- Headings become an automatic contents list.
- Tables stay readable on a small screen.
- Code, references and callouts belong in the document.

## Keep the source clear

> A document should tell the reader what is known, where it came from and what remains uncertain.

This preview uses invented content. It contains no personal notes, health records or account information.


<div class="accordion"><details><summary>What happens when a link is revoked?</summary><div class="panel">Future requests show a document unavailable page. A copy someone has already saved remains with them.</div></details></div>

## Sources and further reading

The layout follows the supplied Page design brief. Tool connections use the [Model Context Protocol](https://modelcontextprotocol.io/).
`;
await db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?)').bind('synthetic-owner',id,'preview','synthetic','A clearer way to share your work','A LifeOS document preview, using the supplied Page design system.','markdown',body,date).run();
await db.prepare('INSERT INTO artifact_shares VALUES(?,?,?,?,?,?,?,?,?,NULL)').bind('synthetic-owner',share,id,'preview','synthetic',token,'Preview only',date,null).run();
console.log(new URL('/s/'+token,await preview.ready).href);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await preview.dispose();await rm(directory,{recursive:true,force:true});process.exit(0);});
