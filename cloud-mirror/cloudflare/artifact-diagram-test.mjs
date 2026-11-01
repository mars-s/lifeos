import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'artifact-diagram-test-'));
let renderDocument,artifactMarkup,expandDiagrams;
try{
 await build({entryPoints:['artifact-page.ts'],outfile:join(dir,'page.mjs'),bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire('/');"},loader:{'.css':'text'}});
 ({renderDocument,artifactMarkup,expandDiagrams}=await import(join(dir,'page.mjs')));
}finally{await rm(dir,{recursive:true,force:true});}
const doc=(body,format='html')=>({body,format,title:'Diagram',summary:'',created_at:'2026-10-31T00:00:00Z'});
const render=(body,format)=>renderDocument(doc(body,format)).html;
const fixture=await readFile('diagram-fixture.html','utf8');
test('reference diagram retains every shape, class and SVG attribute in HTML and Markdown',()=>{
 for(const format of ['html','markdown']){
  const html=render(fixture,format);
  assert.match(html,/viewBox="0 0 680 1028"/);assert.match(html,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  for(const match of fixture.matchAll(/(?:class|d|x|y|width|height|rx|text-anchor)="[^"]*"/g))assert.ok(html.includes(match[0]),match[0]);
  assert.equal((html.match(/<path /g)||[]).length,2*(fixture.match(/<path /g)||[]).length);
  assert.match(html,/<figure class="b fig card diagram">/);
 }
 assert.match(artifactMarkup(doc(fixture),false),/class="dg"/);
});
test('SVG strips active elements and their content, styles, links and handlers',()=>{
 const html=render(`<svg onload="bad()"><script>scriptSentinel</script><style>styleSentinel</style><foreignObject><div>foreignSentinel</div></foreignObject><use href="#node"/><image href="data:image/svg+xml,bad"/><animate attributeName="x"/><set attributeName="y"/><a href="https://bad.invalid" xlink:href="https://bad.invalid"><text onclick="bad()" style="fill:red">Safe text</text></a><path onclick="bad()" href="https://bad.invalid" xlink:href="#node" style="stroke:red" d="M0 0L1 1"/></svg>`);
 assert.doesNotMatch(html,/script|Sentinel|style|foreign|<use|<image|<animate|<set|onload|onclick|href|bad\(/i);assert.match(html,/Safe text/);assert.match(html,/d="M0 0L1 1"/);
});
test('SVG validates references, namespace, IDs, classes and presentation values',()=>{
 for(const value of ['javascript:alert(1)','data:bad','url(https://bad.invalid/a)','url(//bad.invalid)','url(#bad) red','var(--bad)','red;stroke:blue','notacolour']){
  const html=render(`<svg><path fill="${value}" stroke="${value}" marker-end="${value}" d="M0 0"/></svg>`);
  assert.doesNotMatch(html,/fill=|stroke=|marker-end=/);
 }
 const html=render('<svg xmlns="https://bad.invalid" class="dg evil" viewBox="0 0 10 10" preserveAspectRatio="xMidYMid meet"><defs><marker id="arrow" refX="5" refY="3" markerWidth="6" markerHeight="6" markerUnits="strokeWidth" orient="auto"><path d="M0 0L6 3L0 6" fill="currentColor"/></marker></defs><path id="bad.id" class="ln dash evil" marker-end="url(#arrow)" marker-start="url(#arrow)" marker-mid="url(#arrow)" fill="url(#arrow)" stroke="#abc"/><rect fill="none"/><circle fill="red"/></svg>');
 for(const attribute of ['viewBox','preserveAspectRatio','refX','refY','markerWidth','markerHeight','markerUnits'])assert.ok(html.includes(attribute+'='),attribute);
 assert.match(html,/marker-end="url\(#arrow\)"/);assert.match(html,/fill="url\(#arrow\)"/);assert.match(html,/class="ln dash"/);assert.doesNotMatch(html,/bad.invalid|bad.id|evil/);
});
test('headings and tables around SVG remain well formed; Mermaid stays code',()=>{
 const html=render('## One\n\n'+fixture+'\n\n## Two\n\n| A |\n| - |\n| B |\n\n```mermaid\ngraph TD; A-->B\n```','markdown');
 assert.match(html,/id="section-1"/);assert.match(html,/id="section-2"/);assert.match(html,/<\/details><\/div><\/figure>/);assert.match(html,/<div class="table-wrap"/);assert.match(html,/class="language-mermaid"/);
});
test('SVG drops camelCase and mixed-case active elements with their children',()=>{
 const html=render('<svg><FOREIGNOBJECT><p>upperSentinel</p></FOREIGNOBJECT><animateMotion><p>motionSentinel</p></animateMotion><animateTransform attributeName="transform"/><feImage href="https://bad.invalid"/><text>kept</text></svg>');
 assert.doesNotMatch(html,/Sentinel|animate|feimage|bad.invalid/i);assert.match(html,/<text>kept<\/text>/);
});
test('only dg SVGs receive one expansion each and expansion is idempotent',()=>{
 const html=render('<svg class="dg nd"><title>One</title></svg><svg class="nd"><title>Other</title></svg><svg class="dg"><title>Two</title></svg>');
 assert.equal((html.match(/class="dg-frame"/g)||[]).length,2);
 assert.equal((html.match(/class="dg-expand"/g)||[]).length,2);
 assert.match(html,/<svg class="nd"><title>Other<\/title><\/svg>/);
 assert.equal(expandDiagrams(html),html);
 assert.match(html,/role="img" aria-label="One"/);
});
test('copies have unique IDs and matching local references, avoiding suffix collisions',()=>{
 const html=render('<svg class="dg"><defs><marker id="arrow"><path id="tip"/></marker></defs><path id="line" marker-end="url(#arrow)" marker-start="url(#arrow)" marker-mid="url(#arrow)" fill="url(#tip)" stroke="url(#tip)"/></svg><svg class="dg"><rect id="box"/></svg><svg><rect id="arrow-x1"/></svg>');
 const ids=[...html.matchAll(/ id="([^"]*)"/g)].map(match=>match[1]);
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ['arrow-x2','tip-x2','line-x2','box-x3'])assert.ok(ids.includes(id),id);
 for(const attribute of ['marker-end','marker-start','marker-mid'])assert.ok(html.includes(`${attribute}="url(#arrow-x2)"`));
 assert.match(html,/fill="url\(#tip-x2\)"/);assert.match(html,/stroke="url\(#tip-x2\)"/);
});
test('expanded labels escape attributes and fall back from aria-label to title to Diagram',()=>{
 const html=render('<svg class="dg" aria-label="A &amp; &quot;B&quot; &lt;C&gt;"><title>Ignored</title></svg><svg class="dg"><title>Title &amp; "quotes" &lt;safe&gt;</title></svg><svg class="dg"></svg>');
 assert.match(html,/aria-label="A &amp; (?:&quot;|&#34;)B(?:&quot;|&#34;) &lt;C&gt;, expanded"/);
 assert.match(html,/aria-label="Title &amp; &#34;quotes&#34; &lt;safe&gt;, expanded"/);
 assert.match(html,/aria-label="Diagram, expanded"/);
 assert.doesNotMatch(html,/<C>|<safe>/);
});
test('bot markup cannot supply renderer classes on HTML or SVG elements',()=>{
 const classes='dg-expand dg-frame dg-overlay dg-scroll dg-open dg-close';
 const html=render(`<div class="${classes}"><details class="${classes}"><summary class="${classes}">Bot</summary><span class="${classes}">Text</span></details></div><svg class="${classes}"><g class="${classes}"></g></svg>`);
 assert.doesNotMatch(html,/dg-(?:expand|frame|overlay|scroll|open|close)/);
});
test('expansion handles nested SVG boundaries',()=>{
 const html=expandDiagrams('<svg class="dg"><svg class="dg"><title>Nested</title></svg></svg>');
 assert.equal((html.match(/class="dg-frame"/g)||[]).length,1);
 assert.equal(expandDiagrams(html),html);
});
