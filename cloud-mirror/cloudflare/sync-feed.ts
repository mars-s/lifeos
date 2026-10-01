import {DemoError} from '../site/lib/demo-store';

type Database=Pick<D1Database,'prepare'|'batch'>;
type BootstrapPage={cursor:string;feed_revision:number;sequence:number;operation_revision:number;items:string;next_cursor:string|null};
const size=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
export class SyncFeed {
  constructor(private db:Database,private owner:string) {}
  private stmt(sql:string,...args:unknown[]){return this.db.prepare(sql).bind(...args);}
  async cleanup(){
    await this.db.batch([
      this.stmt('DELETE FROM native_bootstrap_pages WHERE cursor IN(SELECT cursor FROM native_bootstrap_pages WHERE owner=? AND created_at<? ORDER BY created_at LIMIT 100)',this.owner,new Date(Date.now()-3600000).toISOString()),
      this.stmt("DELETE FROM native_bases WHERE token IN(SELECT b.token FROM native_bases b WHERE b.owner=? AND b.created_at<? AND NOT EXISTS(SELECT 1 FROM native_operations o WHERE o.owner=b.owner AND json_extract(o.payload,'$.basis.token')=b.token) AND NOT EXISTS(SELECT 1 FROM mirror_items i WHERE i.owner=b.owner AND i.id=b.target AND i.deleted=0 AND b.source='confirmed' AND json_extract(i.fields,'$.'||b.field||'.revision')=b.revision AND b.target_fields=json_object('title',json_extract(i.fields,'$.title'),'status',json_extract(i.fields,'$.status'),'in_trash_list',json_extract(i.fields,'$.in_trash_list'))) AND NOT EXISTS(SELECT 1 FROM native_desired_fields d WHERE d.owner=b.owner AND d.target=b.target AND d.field=b.field AND d.ordinal=b.ordinal AND b.source IN ('desired','effective')) ORDER BY b.created_at LIMIT 200)",this.owner,new Date(Date.now()-90*86400000).toISOString())
    ]);
  }
  async revision(){return (await this.stmt('SELECT COALESCE(MAX(revision),0) AS n FROM native_changes WHERE owner=?',this.owner).first<{n:number}>())!.n;}
  async metadata(){const rows=await this.db.batch([this.stmt('SELECT COALESCE(MAX(revision),0) AS n FROM native_changes WHERE owner=?',this.owner),this.stmt('SELECT COALESCE(MAX(sequence),0) AS n FROM mirror_meta WHERE owner=?',this.owner),this.stmt('SELECT COALESCE(MAX(ordinal),0) AS n FROM native_operations WHERE owner=?',this.owner)]);return {cursor:(rows[0].results[0] as {n:number}).n,sequence:(rows[1].results[0] as {n:number}).n,operation_revision:(rows[2].results[0] as {n:number}).n};}
  async changes(input:{since:number;limit?:number}){
    if(!input||Object.keys(input).some(k=>!['since','limit'].includes(k))||!Number.isSafeInteger(input.since)||input.since<0||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>200))throw new DemoError('Invalid change cursor.');
    const meta=await this.metadata();if(input.since>meta.cursor)return {version:3,...meta,has_more:false,reset:true,changes:[]};
    const limit=input.limit??100;
    const rows=(await this.stmt('SELECT revision,kind,id,payload FROM native_changes WHERE owner=? AND revision>? AND revision<=? ORDER BY revision LIMIT ?',this.owner,input.since,meta.cursor,limit+1).all<{revision:number;kind:string;id:string;payload:string}>()).results;
    const changes:Array<{revision:number;kind:string;id:string;payload:object}>=[];let bytes=512;
    for(const row of rows.slice(0,limit)){const event={...row,payload:JSON.parse(row.payload)};const n=size(event);if(bytes+n>255*1024)break;changes.push(event);bytes+=n;}
    const cursor=changes.at(-1)?.revision??input.since;
    if(!changes.length&&rows.length)throw new DemoError('Projection event exceeds response budget.');
    return {version:3,cursor,has_more:rows.some(r=>r.revision>cursor),reset:false,changes,sequence:meta.sequence,operation_revision:meta.operation_revision};
  }
  async bootstrap(input:{cursor?:string}){
    if(!input||Object.keys(input).some(k=>k!=='cursor')||input.cursor!==undefined&&(typeof input.cursor!=='string'||!/^[a-f0-9-]{36}$/.test(input.cursor)))throw new DemoError('Invalid bootstrap cursor.');
    if(input.cursor!==undefined){const page=await this.stmt('SELECT * FROM native_bootstrap_pages WHERE owner=? AND cursor=? AND created_at>=?',this.owner,input.cursor,new Date(Date.now()-3600000).toISOString()).first<BootstrapPage>();if(!page)throw new DemoError('Bootstrap expired. Restart bootstrap.');return this.page(page);}
    await this.cleanup();
    const result=await this.db.batch([this.stmt('SELECT COALESCE(MAX(revision),0) AS n FROM native_changes WHERE owner=?',this.owner),this.stmt('SELECT COALESCE(MAX(sequence),0) AS n FROM mirror_meta WHERE owner=?',this.owner),this.stmt('SELECT COALESCE(MAX(ordinal),0) AS n FROM native_operations WHERE owner=?',this.owner),this.stmt('SELECT id,kind,fields,deleted,observed_at FROM mirror_items WHERE owner=? ORDER BY id',this.owner)]);
    const revision=(result[0].results[0] as {n:number}).n,sequence=(result[1].results[0] as {n:number}).n,ordinal=(result[2].results[0] as {n:number}).n;
    const items=(result[3].results as Record<string,unknown>[]).map(r=>({...r,fields:JSON.parse(String(r.fields))}));const pages:typeof items[]=[];let page:typeof items=[],bytes=512;
    for(const item of items){const n=size(item);if(n>196608)throw new DemoError('Bootstrap item exceeds projection budget.');if(bytes+n>200*1024&&page.length){pages.push(page);page=[];bytes=512;}page.push(item);bytes+=n;}pages.push(page);
    if(pages.length===1)return {version:3,cursor:revision,has_more:false,next_cursor:null,items:pages[0],sequence,operation_revision:ordinal};
    const date=new Date().toISOString(),cursors=pages.slice(1).map(()=>crypto.randomUUID());
    await this.db.batch(pages.slice(1).map((p,n)=>this.stmt('INSERT INTO native_bootstrap_pages(cursor,owner,feed_revision,sequence,operation_revision,items,next_cursor,created_at) VALUES(?,?,?,?,?,?,?,?)',cursors[n],this.owner,revision,sequence,ordinal,JSON.stringify(p),cursors[n+1]??null,date)));
    return {version:3,cursor:revision,has_more:true,next_cursor:cursors[0],items:pages[0],sequence,operation_revision:ordinal};
  }
  private page(p:BootstrapPage){return {version:3,cursor:p.feed_revision,has_more:p.next_cursor!==null,next_cursor:p.next_cursor,items:JSON.parse(p.items),sequence:p.sequence,operation_revision:p.operation_revision};}
}
