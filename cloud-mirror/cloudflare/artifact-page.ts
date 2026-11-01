import {marked} from 'marked';
import sanitizeHtml from 'sanitize-html';
import stylesheet from './artifact-style.css';

type Document = {title:string;summary:string;format:'markdown'|'html';body:string;created_at:string};
const escape = (value:string)=>value.replace(/[&<>"']/g,character=>`&#${character.charCodeAt(0)};`);
const allowedClasses = ['section','subsection','stack','bullets','numbered','checks','compact','callout','info','success','warning','danger','neutral','callout-body','callout-title','callout-text','table-wrap','data','dense','zebra','no-grid','num','label','pill','status','outline','lg','dot','text-muted','text-sm','text-small','code-block','tok-k','tok-s','tok-c','tok-n','link-list','link-card','link-text','link-title','link-sub','accordion','panel'];

const svgTags = ['svg','g','rect','circle','ellipse','line','polyline','polygon','path','text','tspan','title','desc','defs','marker'];
// htmlparser2 keeps camelCase for known SVG tags (foreignObject), so list both spellings.
const svgDropped = ['foreignObject','foreignobject','image','use','animate','animateMotion','animatemotion','animateTransform','animatetransform','set','feImage','feimage'];
const svgClasses = ['dg','nd','bar','nl','nt','ln','dash','hd','el','lbg'];
const svgCommon = 'class role id transform fill stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity aria-label aria-hidden'.split(' ');
const svgGeometry:Record<string,string> = {svg:'x y width height viewbox xmlns preserveaspectratio',g:'',rect:'x y width height rx ry',circle:'cx cy r',ellipse:'cx cy rx ry',line:'x1 y1 x2 y2 marker-end marker-start marker-mid',polyline:'points marker-end marker-start marker-mid',polygon:'points marker-end marker-start marker-mid',path:'d marker-end marker-start marker-mid',text:'x y dx dy text-anchor dominant-baseline font-size font-weight',tspan:'x y dx dy text-anchor dominant-baseline font-size font-weight',title:'',desc:'',defs:'',marker:'refx refy markerwidth markerheight markerunits orient viewbox preserveaspectratio'};
const svgAttributes = Object.fromEntries(svgTags.map(tag=>[tag,[...svgCommon,...svgGeometry[tag].split(' ').filter(Boolean)]]));
const svgCase:Record<string,string> = {viewbox:'viewBox',refx:'refX',refy:'refY',markerwidth:'markerWidth',markerheight:'markerHeight',markerunits:'markerUnits',preserveaspectratio:'preserveAspectRatio'};
const localReference = /^url\(#[A-Za-z][\w-]{0,63}\)$/;
const svgColours = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent none currentcolor').split(' '));
function safeSvg(tagName:string, attributes:Record<string,string>) {
  const attribs:Record<string,string> = {};
  for(const [name,value] of Object.entries(attributes)) {
    if(!svgAttributes[tagName].includes(name) || /javascript\s*:|data\s*:/i.test(value)) continue;
    if(name==='xmlns' && value!=='http://www.w3.org/2000/svg') continue;
    if(name==='id' && !/^[A-Za-z][\w-]{0,63}$/.test(value)) continue;
    if(name.startsWith('marker-') && !localReference.test(value)) continue;
    if((name==='fill' || name==='stroke') && !svgColours.has(value.toLowerCase()) && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) && !localReference.test(value)) continue;
    if(/url\s*\(/i.test(value) && (!['fill','stroke','marker-end','marker-start','marker-mid'].includes(name) || !localReference.test(value))) continue;
    attribs[name] = name==='class'?value.split(/\s+/).filter(name=>svgClasses.includes(name)).join(' '):value;
  }
  return {tagName,attribs};
}

// Run only on sanitised markup. Renderer classes never enter the sanitiser allowlist.
export function expandDiagrams(html:string) {
  const ids = new Set([...html.matchAll(/\sid="([^"]*)"/g)].map(match=>match[1]));
  const frames:boolean[] = [];
  const replacements:{start:number;end:number;value:string}[] = [];
  let depth = 0, start = -1, index = 0;
  for(const match of html.matchAll(/<\/?(div|svg)\b[^>]*>/g)) {
    const tag = match[0], closing = tag.startsWith('</');
    if(match[1]==='div') {
      if(closing) frames.pop();
      else frames.push(frames.includes(true) || tag.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/).includes('dg-frame')===true);
      continue;
    }
    if(!closing) {
      if(depth++===0) start = !frames.includes(true) && (tag.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/).includes('dg'))?match.index!:-1;
    } else if(--depth===0 && start>=0) {
      const end = match.index!+tag.length, svg = html.slice(start,end);
      const opening = svg.slice(0,svg.indexOf('>')+1);
      const label = opening.match(/\saria-label="([^"]*)"/)?.[1] || svg.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1] || 'Diagram';
      // Sanitised entities stay encoded; quotes in title text also need attribute escaping.
      const escapedLabel = sanitizeHtml(label,{allowedTags:[],allowedAttributes:{}}).replace(/"/g,'&#34;').replace(/'/g,'&#39;');
      const ownIds = [...svg.matchAll(/<[^>]*>/g)].flatMap(match=>[...match[0].matchAll(/\sid="([^"]*)"/g)].map(attribute=>attribute[1]));
      let suffix:string;
      do {suffix = `-x${++index}`;} while(ownIds.some(id=>ids.has(id+suffix)));
      for(const id of ownIds) ids.add(id+suffix);
      const labelled = svg.replace(/^<svg\b[^>]*>/,tag=>tag.replace(/\s(?:role|aria-label|aria-hidden)="[^"]*"/g,'').replace(/>$/,` role="img" aria-label="${escapedLabel}">`));
      const copy = labelled.replace(/<[^>]*>/g,tag=>tag.replace(/\sid="([^"]*)"/g,(_match,id:string)=>` id="${id}${suffix}"`).replace(/url\(#([\w-]+)\)/g,(_match,id:string)=>`url(#${ownIds.includes(id)?id+suffix:id})`));
      replacements.push({start,end,value:`<div class="dg-frame">${svg}<details class="dg-expand"><summary><span class="dg-open">Expand diagram</span><span class="dg-close">Close diagram</span></summary><div class="dg-overlay" role="group" aria-label="${escapedLabel}, expanded"><div class="dg-scroll">${copy}</div></div></details></div>`});
      start = -1;
    }
  }
  for(const {start,end,value} of replacements.reverse()) html = html.slice(0,start)+value+html.slice(end);
  return html;
}

export function renderDocument(document:Document) {
  const source = document.format==='markdown'?marked.parse(document.body,{async:false,gfm:true}):document.body;
  let svgDepth = 0;
  let html = sanitizeHtml(source,{
    onOpenTag:tag=>{if(tag==='svg')svgDepth++;},
    onCloseTag:tag=>{if(tag==='svg')svgDepth--;},
    allowedTags:['h1','h2','h3','h4','p','div','section','span','strong','b','em','i','s','del','br','hr','ul','ol','li','blockquote','pre','code','kbd','mark','abbr','a','table','thead','tbody','tfoot','tr','th','td','caption','details','summary','figure','figcaption',...svgTags,...svgDropped],
    // Active SVG elements are admitted only so exclusiveFilter can drop them with everything inside.
    exclusiveFilter:frame=>svgDropped.includes(frame.tag),
    allowedAttributes:{...Object.fromEntries(svgTags.map(tag=>[tag,svgAttributes[tag]])),'*':['class'],'a':['href','title','rel'],'abbr':['title'],'th':['colspan','rowspan','scope'],'td':['colspan','rowspan'],'details':['open'],'ol':['start']},
    allowedClasses:{...Object.fromEntries(svgTags.map(tag=>[tag,svgClasses])),'*':[...allowedClasses,'diagram','card','b','fig'],code:[/^language-[a-z0-9-]+$/]},
    allowedSchemes:['https','http','mailto'],allowProtocolRelative:false,
    nonTextTags:['style','script','textarea','option','noscript','iframe','object','template','math','foreignobject','image','use','animate','set'],
    transformTags:{
      ...Object.fromEntries(svgTags.map(tag=>[tag,safeSvg])),
      h1:'h2',
      a:(_tag,attributes)=>({tagName:'a',attribs:svgDepth?{}:{...attributes,rel:'noreferrer noopener'}}),
      table:()=>({tagName:'table',attribs:{class:'data'}}),
      pre:()=>({tagName:'pre',attribs:{class:'code-block'}}),
    },
    enforceHtmlBoundary:false,
  });
  // Restore SVG spelling after htmlparser2's HTML-mode attribute normalisation.
  html = html.replace(/<(?:svg|g|rect|circle|ellipse|line|polyline|polygon|path|text|tspan|title|desc|defs|marker)\b[^>]*>/g,tag=>tag.replace(/\s(viewbox|refx|refy|markerwidth|markerheight|markerunits|preserveaspectratio)=/g,(_match,name:string)=>` ${svgCase[name]}=`));
  html = expandDiagrams(html);
  const headings:{id:string;text:string;depth:number}[] = [];
  html = html.replace(/<(h[23])(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g,(_whole,tag:string,content:string)=>{
    const id = `section-${headings.length+1}`;
    const text = sanitizeHtml(content,{allowedTags:[],allowedAttributes:{}});
    headings.push({id,text,depth:tag==='h3'?1:0});
    return `<${tag} id="${id}">${content}</${tag}>`;
  }).replace(/<table class="data">/g,'<div class="table-wrap" role="region" aria-label="Document table" tabindex="0"><table class="data">').replace(/<\/table>/g,'</table></div>');
  const toc = headings.length>=2?`<nav class="toc" aria-label="Contents"><p class="toc-title">Contents</p><ul>${headings.map(h=>`<li${h.depth?' class="depth-1"':''}><a href="#${h.id}">${h.text}</a></li>`).join('')}</ul></nav>`:'';
  return {html,toc};
}

async function page(title:string,content:string,status:number) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stylesheet));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return new Response(`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)} · LifeOS</title><style>${stylesheet}</style></head><body><a class="skip-link" href="#document">Skip to document</a><main class="page" id="document">${content}</main></body></html>`,{
    status,headers:{
      'Content-Type':'text/html; charset=utf-8',
      'Content-Security-Policy':`default-src 'none'; style-src 'sha256-${hash}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-popups allow-popups-to-escape-sandbox`,
      'Cache-Control':'private, no-store, max-age=0',
      'Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff',
      'X-Robots-Tag':'noindex, nofollow, noarchive',
      'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    },
  });
}

export function artifactMarkup(document:Document, shared=true) {
  const rendered = renderDocument(document);
  const date = new Date(document.created_at).toLocaleDateString('en-AU',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
  return `<header class="page-header"><h1>${escape(document.title)}</h1>${document.summary?`<p class="summary">${escape(document.summary)}</p>`:''}<p class="meta">${shared?'Shared document':'Private preview'}<span aria-hidden="true">·</span>Snapshot ${escape(date)}</p></header>${rendered.toc}<article class="prose">${rendered.html}</article><footer class="document-footer"><span>LifeOS document</span><span>${shared?'Anyone with this link can view':'Only available through your authenticated LifeOS connection'}</span></footer>`;
}

export function artifactPage(document:Document, shared=true) {
  return page(document.title,artifactMarkup(document,shared),200);
}

export function unavailablePage() {
  return page('Document unavailable','<header class="page-header"><h1>This document is unavailable</h1><p class="summary">The link may have expired or been revoked. Ask the person who shared it for a new link.</p></header>',404);
}
