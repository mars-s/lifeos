import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// Minimal D1-shaped boundary; the tested MirrorStore stays the source of truth.
export class SQLite {
  constructor(path, migrations) {
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version>migrations.length)throw new Error('Database schema is newer than this runtime.');
    for(let n=version;n<migrations.length;n++) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(readFileSync(migrations[n],'utf8'));
        this.db.exec(`PRAGMA user_version=${n+1}; COMMIT;`);
      }catch(error){this.db.exec('ROLLBACK');throw error;}
    }
  }
  prepare(sql) {return new Statement(this,sql,[]);}
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results=statements.map(s=>s.execute());
      this.db.exec('COMMIT');return results;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  close(){this.db.close();}
}
class Statement {
  constructor(database,sql,args){this.database=database;this.sql=sql;this.args=args;}
  bind(...args){return new Statement(this.database,this.sql,args);}
  execute(){return this.database.db.prepare(this.sql).run(...this.args);}
  async run(){return this.execute();}
  async first(){return this.database.db.prepare(this.sql).get(...this.args)??null;}
  async all(){return {results:this.database.db.prepare(this.sql).all(...this.args)};}
}
