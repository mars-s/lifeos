// Preserve MirrorStore's guarded transaction while staying within D1 Free's
// 50 queries per invocation. No external database or mutable isolate state.
type Bound = {sql:string;args:unknown[]};
export class BulkD1 {
  constructor(private db:D1Database) {}
  prepare(sql:string) {return new BoundStatement(this.db,sql,[]);}
  async batch<T=unknown>(statements:BoundStatement[]) {
    const inserts:Bound[]=[],deletes:Bound[]=[],rest:BoundStatement[]=[];
    for(const s of statements) {
      if(s.sql.startsWith('INSERT INTO mirror_items SELECT '))inserts.push(s);
      else if(s.sql.startsWith('UPDATE mirror_items SET deleted=1,'))deletes.push(s);
      else rest.push(s);
    }
    if(!inserts.length&&!deletes.length)return this.db.batch<T>(statements.map(s=>s.native()));
    // Only collapse the exact ordered snapshot batch shape; fail closed on drift.
    if(statements.some((s,n)=>n<inserts.length?!s.sql.startsWith('INSERT INTO mirror_items SELECT '):n<inserts.length+deletes.length?!s.sql.startsWith('UPDATE mirror_items SET deleted=1,'):false))throw new Error('Snapshot batch shape changed.');
    const batch:D1PreparedStatement[]=[];
    if(inserts.length) {
      const [owner,,,,,,guardOwner,base]=inserts[0].args;
      if(inserts.some(s=>s.args[0]!==owner||s.args[6]!==guardOwner||s.args[7]!==base))throw new Error('Mixed snapshot guards.');
      const rows=inserts.map(s=>s.args.slice(0,6));
      batch.push(this.db.prepare(`INSERT INTO mirror_items(owner,id,kind,fields,deleted,observed_at)
        SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]')
        FROM json_each(?) WHERE COALESCE((SELECT sequence FROM mirror_meta WHERE owner=?),0)=?
        ON CONFLICT(owner,id) DO UPDATE SET fields=excluded.fields,deleted=0,observed_at=excluded.observed_at
        WHERE mirror_items.fields<>excluded.fields OR mirror_items.deleted<>0`).bind(JSON.stringify(rows),guardOwner,base));
    }
    if(deletes.length) {
      const [at,owner,,guardOwner,base]=deletes[0].args;
      if(deletes.some(s=>s.args[0]!==at||s.args[1]!==owner||s.args[3]!==guardOwner||s.args[4]!==base))throw new Error('Mixed tombstone guards.');
      batch.push(this.db.prepare(`UPDATE mirror_items SET deleted=1,observed_at=? WHERE owner=? AND id IN(SELECT value FROM json_each(?)) AND COALESCE((SELECT sequence FROM mirror_meta WHERE owner=?),0)=?`).bind(at,owner,JSON.stringify(deletes.map(s=>s.args[2])),guardOwner,base));
    }
    batch.push(...rest.map(s=>s.native()));return this.db.batch<T>(batch);
  }
}
export class BoundStatement {
  constructor(private db:D1Database,public sql:string,public args:unknown[]) {}
  bind(...args:unknown[]) {return new BoundStatement(this.db,this.sql,args);}
  native() {return this.db.prepare(this.sql).bind(...this.args);}
  first<T=Record<string,unknown>>(column?:string) {return column===undefined?this.native().first<T>():this.native().first<T>(column);}
  get raw() {const statement=this.native();return statement.raw.bind(statement);}
  all<T=Record<string,unknown>>() {return this.native().all<T>();}
  run<T=Record<string,unknown>>() {return this.native().run<T>();}
}
