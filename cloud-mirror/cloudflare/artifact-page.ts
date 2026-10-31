import {marked} from 'marked';
import sanitizeHtml from 'sanitize-html';
import stylesheet from './artifact-style.css';

type Document = {title:string;summary:string;format:'markdown'|'html';body:string;created_at:string};
const escape = (value:string)=>value.replace(/[&<>"']/g,character=>`&#${character.charCodeAt(0)};`);
const allowedClasses = ['section','subsection','stack','bullets','numbered','checks','compact','callout','info','success','warning','danger','neutral','callout-body','callout-title','callout-text','table-wrap','data','dense','zebra','no-grid','num','label','pill','status','outline','lg','dot','text-muted','text-sm','text-small','code-block','tok-k','tok-s','tok-c','tok-n','link-list','link-card','link-text','link-title','link-sub','accordion','panel'];

export function renderDocument(document:Document) {
  const source = document.format==='markdown'?marked.parse(document.body,{async:false,gfm:true}):document.body;
  let html = sanitizeHtml(source,{
    allowedTags:['h1','h2','h3','h4','p','div','section','span','strong','b','em','i','s','del','br','hr','ul','ol','li','blockquote','pre','code','kbd','mark','abbr','a','table','thead','tbody','tfoot','tr','th','td','caption','details','summary'],
    allowedAttributes:{'*':['class'],'a':['href','title','rel'],'abbr':['title'],'th':['colspan','rowspan','scope'],'td':['colspan','rowspan'],'details':['open'],'ol':['start']},
    allowedClasses:{'*':allowedClasses,code:[/^language-[a-z0-9-]+$/]},
    allowedSchemes:['https','http','mailto'],allowProtocolRelative:false,
    nonTextTags:['style','script','textarea','option','noscript','iframe','object','template','svg','math'],
    transformTags:{
      h1:'h2',
      a:(_tag,attributes)=>({tagName:'a',attribs:{...attributes,rel:'noreferrer noopener'}}),
      table:()=>({tagName:'table',attribs:{class:'data'}}),
      pre:()=>({tagName:'pre',attribs:{class:'code-block'}}),
    },
    enforceHtmlBoundary:false,
  });
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
