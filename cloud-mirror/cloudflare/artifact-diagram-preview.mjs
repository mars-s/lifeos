// Local-only visual comparison. Requires installed npm dependencies, Google Chrome and Python Pillow.
// Usage: node artifact-diagram-preview.mjs [output-directory] [reference-html]
// Chrome is driven over the DevTools protocol because `--screenshot` can hang on hosts without outbound TLS.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
const output=resolve(process.argv[2]||'/workspace/diagram-verify');
const reference=await readFile(process.argv[3]||'/workspace/lifeos-diagram-ref/example-ontology.html','utf8');
const figure=reference.match(/<figure[^>]*>\s*<svg class="dg"[\s\S]*?<\/figure>/)?.[0];
if(!figure)throw Error('Reference diagram not found');
const referenceStyle=reference.match(/<style>([\s\S]*?)<\/style>/)[1];
const sample=(await readFile('ARTIFACTS.md','utf8')).match(/```html\n(<figure class="card diagram">[\s\S]*?<\/figure>)\n```/)?.[1];
const stylesheet=await readFile('artifact-style.css','utf8');
const scratch=await mkdtemp(join(tmpdir(),'diagram-preview-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome;
try{
 await build({entryPoints:['artifact-page.ts'],outfile:join(scratch,'page.mjs'),bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire('/');"},loader:{'.css':'text'}});
 const {artifactMarkup}=await import(join(scratch,'page.mjs'));
 const markup=body=>artifactMarkup({title:'Reference diagram',summary:'',format:'html',body,created_at:'2026-10-31T00:00:00Z'});
 await mkdir(output,{recursive:true});
 const page=(style,body)=>`<!doctype html><html lang="en-AU"><meta charset="utf-8"><style>${style}</style><body>${body}</body></html>`;
 const regionStyle=stylesheet+' .page-header,.document-footer{display:none}.prose{margin-top:0}';
 await writeFile(join(output,'artifact.html'),page(stylesheet,`<main class="page">${markup(figure)}</main>`));
 await writeFile(join(output,'artifact-region.html'),page(regionStyle,`<main class="page">${markup(figure)}</main>`));
 await writeFile(join(output,'reference-region.html'),page(referenceStyle,`<main class="page">${figure}</main>`));
 if(sample)await writeFile(join(output,'sample-region.html'),page(regionStyle,`<main class="page">${markup(sample)}</main>`));
 const port=9300+Math.floor(Math.random()*500);
 chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars',`--remote-debugging-port=${port}`,`--user-data-dir=${join(scratch,'chrome')}`,'about:blank'],{stdio:'ignore'});
 let targets;for(let i=0;i<60&&!targets;i++){try{targets=await (await fetch(`http://127.0.0.1:${port}/json`)).json()}catch{await sleep(500)}}
 const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id)};
 const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
 await send('Emulation.setDeviceMetricsOverride',{width:748,height:1200,deviceScaleFactor:1,mobile:false});
 for(const theme of ['light','dark'])for(const kind of ['reference','artifact',...sample?['sample']:[]]){
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  await send('Page.navigate',{url:`file://${join(output,kind+'-region.html')}`});await sleep(1500);
  const box=JSON.parse((await send('Runtime.evaluate',{expression:`JSON.stringify((r=>({x:r.x,y:r.y+scrollY,width:r.width,height:r.height}))(document.querySelector('figure').getBoundingClientRect()))`,returnByValue:true})).result.result.value);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:Math.max(0,box.x-12),y:Math.max(0,box.y-12),width:box.width+24,height:box.height+24,scale:1}});
  await writeFile(join(output,`${kind}-${theme}.png`),Buffer.from(shot.result.data,'base64'));
 }
 ws.close();
 for(const theme of ['light','dark'])console.log(execFileSync('python3',['-c',`from PIL import Image, ImageChops, ImageDraw
import sys
left,right=(Image.open(p).convert('RGB') for p in sys.argv[1:3])
out=Image.new('RGB',(left.width+right.width+20,max(left.height,right.height)+30),'#888')
out.paste(left,(0,30));out.paste(right,(left.width+20,30))
draw=ImageDraw.Draw(out);draw.text((10,8),'Reference',fill='white');draw.text((left.width+30,8),'LifeOS artifact',fill='white')
out.save(sys.argv[3])
print(sys.argv[4],'identical' if left.size==right.size and ImageChops.difference(left,right).getbbox() is None else 'DIFFERENT')`,join(output,'reference-'+theme+'.png'),join(output,'artifact-'+theme+'.png'),join(output,'side-by-side-'+theme+'.png'),theme]).toString().trim());
 console.log(output);
}finally{
 if(chrome&&chrome.exitCode===null){const exited=new Promise(r=>chrome.once('exit',r));chrome.kill();await exited;}
 await rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
